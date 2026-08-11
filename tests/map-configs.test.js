import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import {
  DEFAULT_MAP_ID,
  MAP_CONFIGS,
  MAP_ORDER,
  resolveMapConfig,
  resolveMapId,
} from '../src/configs/mapConfigs.js';
import { Arena } from '../src/world/Arena.js';

const previousBounds = {
  'null-grid': 46,
  'sky-foundry': 44,
  'sunken-relay': 54,
};

function configuredEnemySpawnCount(map) {
  return (map.spawns.enemyPoints?.length ?? 0)
    + map.spawns.enemyBands.reduce((sum, band) => sum + band.count, 0);
}

function insideFootprint(map, point, margin = 0) {
  const [x, , z] = point;
  if (map.foundation.shape === 'box') {
    return Math.abs(x) <= map.foundation.size[0] * 0.5 - margin
      && Math.abs(z) <= map.foundation.size[2] * 0.5 - margin;
  }
  const innerBoundary = map.foundation.boundary.radius - map.foundation.boundary.size[2] * 0.5;
  return Math.hypot(x, z) <= innerBoundary - margin;
}

test('map catalog exposes three immutable canonical variants and legacy aliases', () => {
  assert.equal(DEFAULT_MAP_ID, 'null-grid');
  assert.deepEqual(MAP_ORDER, ['null-grid', 'sky-foundry', 'sunken-relay']);
  assert.deepEqual(Object.keys(MAP_CONFIGS), MAP_ORDER);
  assert.equal(resolveMapId('null-lattice'), 'null-grid');
  assert.equal(resolveMapId('zenith-forge'), 'sky-foundry');
  assert.equal(resolveMapId('fracture-yard'), 'sunken-relay');
  assert.equal(resolveMapConfig('missing').id, DEFAULT_MAP_ID);
  assert.ok(Object.isFrozen(MAP_CONFIGS));
  assert.ok(Object.isFrozen(MAP_CONFIGS['sky-foundry'].navigation));

  for (const id of MAP_ORDER) {
    const map = MAP_CONFIGS[id];
    assert.equal(map.id, id);
    assert.ok(map.name && map.description);
    assert.ok(map.central.objectives.length >= 5);
    assert.ok(map.spawns.player.length >= 3);
    assert.ok(configuredEnemySpawnCount(map) >= 18);
    assert.ok(map.shifts.bridges.entries.length >= 2);
    assert.ok(map.shifts.doors.count >= 4);
    assert.ok(map.shifts.cover.count >= 10);
  }
});

test('expanded layouts keep spawns, objectives and material roles inside logical geometry', () => {
  for (const id of MAP_ORDER) {
    const map = MAP_CONFIGS[id];
    const growth = map.bounds.radius / previousBounds[id];
    assert.ok(growth >= 1.25 && growth <= 1.35, `${id} footprint should grow by 25-35%`);

    for (const point of map.spawns.player) {
      assert.ok(insideFootprint(map, point, 1), `${id} player spawn must stay inside its boundary`);
    }
    for (const point of map.spawns.enemyPoints ?? []) {
      assert.ok(insideFootprint(map, point, 1), `${id} explicit enemy spawn must stay inside its boundary`);
    }
    for (const band of map.spawns.enemyBands) {
      const point = [band.radius, band.y, 0];
      assert.ok(insideFootprint(map, point, 1), `${id} enemy band must stay inside its boundary`);
    }
    for (const objective of map.central.objectives) {
      const point = objective.position ?? [
        Math.cos(objective.angle) * objective.radius,
        objective.y,
        Math.sin(objective.angle) * objective.radius,
      ];
      assert.ok(insideFootprint(map, point, 1), `${id} objective must stay inside its boundary`);
    }

    for (const box of map.geometryBoxes) {
      if (['boundary', 'structure', 'support'].includes(box.role)) assert.equal(box.material, 'structure');
      if (box.role === 'cover') assert.equal(box.material, 'cover');
      if (box.role === 'surface') assert.ok(['elevated', 'bridge'].includes(box.material));
      if (['boundary', 'structure', 'cover', 'support'].includes(box.role)) {
        assert.ok(Math.abs(box.position[1] - box.size[1] * 0.5) < 1e-6, `${box.name} must sit on the floor`);
      }
    }

    const floorTop = map.foundation.y + map.foundation.depth * 0.5;
    assert.ok(
      map.shifts.doors.openY + map.shifts.doors.size[1] * 0.5 <= floorTop + 0.01,
      `${id} open gates should retract below the floor instead of floating`,
    );
  }
});

test('every arena variant builds, shifts and exposes map-specific debug data', () => {
  for (const id of MAP_ORDER) {
    const scene = new THREE.Scene();
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    const arena = new Arena({ scene, mapId: id });
    arena.build(world);
    const debug = arena.getDebugData();

    assert.equal(arena.getMapInfo().id, id);
    assert.equal(debug.map.id, id);
    assert.deepEqual(debug.bounds, MAP_CONFIGS[id].bounds);
    assert.equal(debug.rings.length, MAP_CONFIGS[id].rings.length);
    assert.ok(debug.colliderCount > 20, `${id} needs meaningful collision geometry`);
    assert.ok(debug.enemySpawns.length >= 18);
    assert.ok(debug.objectives.length >= 5);
    assert.ok(debug.waypoints.length >= 16);
    assert.ok(arena.applyShift('bridge'));
    assert.ok(arena.applyShift('doors'));
    assert.ok(arena.applyShift('cover'));
    arena.dispose();
    assert.equal(world.bodies.length, 0);
  }
});

test('setMap rebuilds in place without leaking old colliders or ring debug data', () => {
  const scene = new THREE.Scene();
  const world = new CANNON.World();
  const arena = new Arena({ scene, mapId: 'null-grid' }).build(world);
  arena.setMap('sunken-relay', { rebuild: true });

  assert.equal(arena.mapId, 'sunken-relay');
  assert.equal(arena.getDebugData().rings.length, 0);
  assert.equal(world.bodies.length, arena.staticBodies.length);
  assert.ok(world.bodies.length > 20);
  arena.dispose();
});

test('movement bounds and surface queries follow each map physical footprint', () => {
  const scene = new THREE.Scene();
  const world = new CANNON.World();
  const arena = new Arena({ scene, mapId: 'sunken-relay' }).build(world);

  assert.deepEqual(arena.getMovementBounds(), {
    shape: 'box',
    minX: -60.75,
    maxX: 60.75,
    minZ: -48.75,
    maxZ: 48.75,
  });
  for (const point of arena.enemySpawnPoints) {
    const bounds = arena.getMovementBounds();
    assert.ok(point.x >= bounds.minX && point.x <= bounds.maxX);
    assert.ok(point.z >= bounds.minZ && point.z <= bounds.maxZ);
  }

  assert.ok(Math.abs(arena.getSurfaceHeight(new THREE.Vector3(0, 1.05, 20), {
    above: 1.6,
    below: 2.2,
    currentY: 1.05,
  })) < 1e-5);
  assert.ok(Math.abs(arena.getSurfaceHeight(new THREE.Vector3(0, 5.2, -34), {
    above: 1,
    below: 2,
    currentY: 5.2,
  }) - 5) < 1e-4);
  // A ground actor below the gantry must not snap through it to the upper deck.
  assert.ok(Math.abs(arena.getSurfaceHeight(new THREE.Vector3(0, 1.05, -34), {
    above: 1.6,
    below: 2.2,
    currentY: 1.05,
  })) < 1e-5);

  arena.setMap('null-grid', { rebuild: true });
  assert.equal(arena.getMovementBounds().shape, 'disc');
  assert.equal(arena.getSurfaceHeight(new THREE.Vector3(55, 1, 55)), null);
  assert.ok(Math.abs(arena.getSurfaceHeight(new THREE.Vector3(55, 1, 0), {
    above: 2,
    below: 3,
    currentY: 1,
  }) + 1.1) < 1e-4, 'disc foundation collider should be upright and match the visible floor');
  arena.dispose();
});
