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
    assert.ok(map.spawns.enemyBands.reduce((sum, band) => sum + band.count, 0) >= 18);
    assert.ok(map.shifts.bridges.entries.length >= 2);
    assert.ok(map.shifts.doors.count >= 4);
    assert.ok(map.shifts.cover.count >= 10);
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
