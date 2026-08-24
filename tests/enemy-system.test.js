import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { EnemySystem } from '../src/combat/EnemySystem.js';
import { getEnemyAnchorPosition, updateEnemyVisual } from '../src/combat/enemyVisuals.js';
import { ENEMY_CONFIGS } from '../src/configs/enemyConfigs.js';
import { Arena } from '../src/world/Arena.js';

const noopEffects = {
  spawnImpact() {},
  spawnEnemyDeath() {},
  spawnShiftPulse() {},
};

function createEnemies({ arena = null, scene = new THREE.Scene() } = {}) {
  const player = {
    position: new THREE.Vector3(0, 0, 12),
    forward: new THREE.Vector3(0, 0, -1),
    health: 100,
    maxHealth: 100,
    damage() {},
  };
  const system = new EnemySystem({
    scene,
    player,
    eventBus: { emit() {}, on() { return () => {}; } },
    audioManager: { playEffect() {}, playUI() {} },
    effects: noopEffects,
    arena,
    random: () => 0.5,
  });
  return { system, scene, player };
}

function createSurfaceArena({
  heightAt = () => 0,
  bounds = { shape: 'disc', centerX: 0, centerZ: 0, radius: 40 },
  obstacleRaycast = null,
} = {}) {
  return {
    mapConfig: { bounds: bounds.shape === 'disc' ? { radius: bounds.radius } : { ...bounds } },
    getMovementBounds(margin = 0) {
      if (bounds.shape === 'box') {
        return {
          shape: 'box',
          minX: bounds.minX + margin,
          maxX: bounds.maxX - margin,
          minZ: bounds.minZ + margin,
          maxZ: bounds.maxZ - margin,
        };
      }
      return {
        shape: 'disc',
        centerX: bounds.centerX ?? 0,
        centerZ: bounds.centerZ ?? 0,
        radius: bounds.radius - margin,
      };
    },
    getSurfaceHeight(position, { above = 1.6, below = 2.4, currentY = position.y - 1 } = {}) {
      const height = heightAt(position.x, position.z);
      if (!Number.isFinite(height) || height > currentY + above || height < currentY - below) return null;
      return height;
    },
    raycastWorld(origin, direction, maxDistance) {
      if (direction.y < -0.9) {
        const height = heightAt(origin.x, origin.z);
        const distance = origin.y - height;
        if (!Number.isFinite(height) || distance < 0 || distance > maxDistance) {
          return { hit: false, hasHit: false, distance: Infinity };
        }
        return {
          hit: true,
          hasHit: true,
          distance,
          point: new THREE.Vector3(origin.x, height, origin.z),
          normal: new THREE.Vector3(0, 1, 0),
          body: { userData: { arenaSurface: true } },
        };
      }
      return obstacleRaycast?.(origin, direction, maxDistance)
        ?? { hit: false, hasHit: false, distance: Infinity };
    },
    hasLineOfSight() { return true; },
    getNavigationTarget(from, to) { return to?.clone?.() ?? from.clone(); },
  };
}

function round(value) {
  return Number(value.toFixed(4));
}

function silhouetteFingerprint(root) {
  root.updateMatrixWorld(true);
  const fromWorld = root.matrixWorld.clone().invert();
  const parts = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.computeBoundingBox();
    const dimensions = object.geometry.boundingBox.getSize(new THREE.Vector3());
    const localMatrix = fromWorld.clone().multiply(object.matrixWorld);
    parts.push(JSON.stringify({
      geometry: object.geometry.type,
      dimensions: dimensions.toArray().map(round),
      transform: localMatrix.elements.map(round),
    }));
  });
  return parts.sort().join('|');
}

function assertObjectPart(root, part, label) {
  assert.ok(part?.isObject3D, `${label} must be an Object3D`);
  let cursor = part;
  while (cursor && cursor !== root) cursor = cursor.parent;
  assert.equal(cursor, root, `${label} must belong to the enemy model`);
}

function assertPartArray(root, parts, label, minimum = 2) {
  assert.ok(Array.isArray(parts), `${label} must be an array`);
  assert.ok(parts.length >= minimum, `${label} must contain at least ${minimum} parts`);
  parts.forEach((part, index) => assertObjectPart(root, part, `${label}[${index}]`));
}

function spawnRoster(system) {
  return [
    system.spawn('trooper', new THREE.Vector3(-4, 0, 0)),
    system.spawn('hunter', new THREE.Vector3(0, 0, 0)),
    system.spawn('warden', new THREE.Vector3(4, 0, 0)),
  ];
}

test('procedural enemy models have distinct silhouettes and animation-part contracts', (t) => {
  const { system } = createEnemies();
  t.after(() => system.dispose());
  const [trooper, hunter, warden] = spawnRoster(system);

  const fingerprints = [trooper, hunter, warden].map(({ root, type }) => {
    const meshCount = root.getObjectsByProperty('isMesh', true).length;
    assert.ok(meshCount >= 8, `${type} needs a readable procedural silhouette`);
    return silhouetteFingerprint(root);
  });
  assert.equal(new Set(fingerprints).size, 3, 'each enemy role must have a distinct model silhouette');

  const trooperParts = trooper.root.userData.visualParts;
  assert.ok(trooperParts, 'trooper must expose visualParts for animation');
  assertObjectPart(trooper.root, trooperParts.weapon, 'trooper.weapon');
  assertPartArray(trooper.root, trooperParts.telegraphLights, 'trooper.telegraphLights', 3);

  const hunterParts = hunter.root.userData.visualParts;
  assert.ok(hunterParts, 'hunter must expose visualParts for animation');
  assertPartArray(hunter.root, hunterParts.blades, 'hunter.blades');
  assertObjectPart(hunter.root, hunterParts.core, 'hunter.core');
  assertPartArray(hunter.root, hunterParts.fins, 'hunter.fins');

  const wardenParts = warden.root.userData.visualParts;
  assert.ok(wardenParts, 'warden must expose visualParts for animation');
  assertObjectPart(warden.root, wardenParts.core, 'warden.core');
  assertObjectPart(warden.root, wardenParts.crown, 'warden.crown');
  assertPartArray(warden.root, wardenParts.pylons, 'warden.pylons');
  assertObjectPart(warden.root, wardenParts.shield, 'warden.shield');
  assert.equal(warden.root.userData.shield, wardenParts.shield, 'shield logic and animation must share one mesh');
});

test('enemy hit meshes retain finite body, head and limb zones', (t) => {
  const { system } = createEnemies();
  t.after(() => system.dispose());
  const roster = spawnRoster(system);
  const allowedZones = new Set(['body', 'head', 'limb']);

  for (const enemy of roster) {
    assert.ok(enemy.hitMeshes.length >= 4, `${enemy.type} needs enough meshes for aimed shots`);
    assert.equal(new Set(enemy.hitMeshes).size, enemy.hitMeshes.length, `${enemy.type} hit meshes must be unique`);
    const zones = new Set(enemy.hitMeshes.map((mesh) => mesh.userData.hitZone));
    assert.ok(zones.has('body'), `${enemy.type} is missing a body hit zone`);
    assert.ok(zones.has('head'), `${enemy.type} is missing a head hit zone`);
    assert.ok(zones.has('limb'), `${enemy.type} is missing limb hit zones`);

    enemy.root.updateMatrixWorld(true);
    for (const mesh of enemy.hitMeshes) {
      assert.ok(mesh.isMesh, `${enemy.type} hit zones must reference meshes`);
      assert.ok(allowedZones.has(mesh.userData.hitZone), `${enemy.type} has an unsupported hit zone`);
      assert.equal(mesh.userData.enemyId, enemy.id);
      assert.ok(system.hitMeshes.includes(mesh), `${enemy.type} hit mesh must be registered globally`);
      const bounds = new THREE.Box3().setFromObject(mesh);
      assert.equal(bounds.isEmpty(), false, `${enemy.type}.${mesh.userData.hitZone} bounds must not be empty`);
      assert.ok(
        [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite),
        `${enemy.type}.${mesh.userData.hitZone} bounds must be finite`,
      );
      let cursor = mesh;
      while (cursor && cursor !== enemy.root) cursor = cursor.parent;
      assert.equal(cursor, enemy.root, `${enemy.type} hit mesh must belong to its model`);
    }
  }

  assert.equal(system.hitMeshes.length, roster.reduce((sum, enemy) => sum + enemy.hitMeshes.length, 0));
});

test('enemy visual resources are disposed exactly once', () => {
  const { system } = createEnemies();
  const roster = spawnRoster(system);
  const resources = new Set();
  for (const enemy of roster) {
    enemy.root.traverse((object) => {
      if (object.geometry) resources.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => resources.add(material));
    });
  }
  assert.ok(resources.size > 0);

  const disposalCounts = new Map([...resources].map((resource) => [resource, 0]));
  for (const resource of resources) {
    resource.addEventListener('dispose', () => disposalCounts.set(resource, disposalCounts.get(resource) + 1));
  }

  system.reset();
  for (const [resource, count] of disposalCounts) {
    assert.equal(count, 1, `${resource.type} must be disposed exactly once`);
  }
  roster.forEach((enemy) => assert.equal(enemy.root.parent, null));
  assert.equal(system.enemies.length, 0);
  assert.equal(system.hitMeshes.length, 0);
  assert.equal(system.byId.size, 0);

  system.reset();
  system.dispose();
  for (const count of disposalCounts.values()) assert.equal(count, 1);
});

test('hunter spawns with its configured shield and damage consumes it before health', (t) => {
  const { system } = createEnemies();
  t.after(() => system.dispose());
  const hunter = system.spawn('hunter', new THREE.Vector3());
  const configuredShield = ENEMY_CONFIGS.hunter.shield;

  assert.ok(configuredShield > 0, 'hunter config must define a meaningful shield');
  assert.equal(hunter.shield, configuredShield);
  assert.equal(hunter.maxShield, configuredShield);

  const initialHealth = hunter.health;
  const firstHit = Math.max(1, Math.floor(configuredShield * 0.6));
  const shieldedResult = system.damage(hunter, firstHit, { point: hunter.root.position.clone() });
  assert.equal(shieldedResult.shield, configuredShield - firstHit);
  assert.equal(hunter.health, initialHealth, 'shield-only damage must not leak into health');

  const overflow = 7;
  system.damage(hunter, hunter.shield + overflow, { point: hunter.root.position.clone() });
  assert.equal(hunter.shield, 0);
  assert.equal(hunter.health, initialHealth - overflow);
});

test('radial damage can return exact hit, kill and falloff totals without breaking the numeric contract', (t) => {
  const { system } = createEnemies();
  t.after(() => system.dispose());
  const close = system.spawn('trooper', new THREE.Vector3(0, 0, 0));
  const far = system.spawn('trooper', new THREE.Vector3(2, 0, 0));
  close.health = 1;
  far.health = 1;

  const summary = system.damageInRadius(new THREE.Vector3(), 5, 10, {
    source: 'player',
    weapon: 'nova-blast',
    returnSummary: true,
  });

  assert.equal(summary.hits, 2);
  assert.equal(summary.kills, 2);
  assert.ok(summary.damage > 10);
  assert.ok(summary.damage < 20, 'reported blast damage must include radial falloff');

  system.spawn('trooper', new THREE.Vector3(0, 0, 0));
  assert.equal(system.damageInRadius(new THREE.Vector3(), 1, 1), 1);
});

test('enemy rigs animate windups and phases without moving gameplay roots', (t) => {
  const { system } = createEnemies();
  t.after(() => system.dispose());
  const [trooper, hunter, warden] = [
    system.spawn('trooper', new THREE.Vector3(-4, 1.25, 0)),
    system.spawn('hunter', new THREE.Vector3(0, 1.25, 0)),
    system.spawn('warden', new THREE.Vector3(4, 1.25, 0)),
  ];
  const rootHeights = [trooper, hunter, warden].map((enemy) => enemy.root.position.y);

  const weaponRotation = trooper.root.userData.visualParts.weapon.rotation.x;
  trooper.pendingAttack = { kind: 'burst', remaining: 0.12, duration: 0.3 };
  updateEnemyVisual(trooper, 1 / 60);
  assert.notEqual(trooper.root.userData.visualParts.weapon.rotation.x, weaponRotation);

  const bladeRotation = hunter.root.userData.visualParts.blades[0].rotation.z;
  hunter.pendingAttack = { kind: 'melee', remaining: 0.16, duration: 0.38 };
  updateEnemyVisual(hunter, 1 / 60);
  assert.notEqual(hunter.root.userData.visualParts.blades[0].rotation.z, bladeRotation);

  const crownHeight = warden.root.userData.visualParts.crown.position.y;
  warden.elitePhase = 3;
  warden.pendingAttack = { kind: 'hazard', remaining: 0.4, duration: 1.1 };
  updateEnemyVisual(warden, 1 / 60);
  assert.ok(warden.root.userData.visualParts.crown.position.y > crownHeight);

  warden.elitePhase = 1;
  warden.health = warden.maxHealth * 0.5;
  warden.shield = 0;
  warden.attackCooldown = 10;
  system.updateShieldVisual(warden);
  const depletedOpacity = warden.root.userData.shield.material.opacity;
  system.thinkWarden(warden, 10, true);
  assert.equal(warden.elitePhase, 2);
  assert.ok(warden.shield > 0);
  assert.equal(warden.root.userData.shield.visible, true);
  assert.ok(warden.root.userData.shield.material.opacity > depletedOpacity);

  [trooper, hunter, warden].forEach((enemy, index) => {
    assert.equal(enemy.root.position.y, rootHeights[index], `${enemy.type} animation must not move its gameplay root`);
    const previousTime = enemy.visualTime;
    enemy.stateTime = 0;
    updateEnemyVisual(enemy, 1 / 60);
    assert.ok(enemy.visualTime > previousTime, `${enemy.type} visual time must survive AI state resets`);
  });
});

test('enemy projectiles originate from authored weapon and reactor anchors', (t) => {
  const { system } = createEnemies();
  t.after(() => system.dispose());
  const trooper = system.spawn('trooper', new THREE.Vector3(-3, 0, 0));
  const expectedMuzzle = getEnemyAnchorPosition(trooper, 'muzzle', 1.35);
  assert.ok(expectedMuzzle.z > trooper.root.position.z, 'trooper muzzle must sit in front of the body');
  system.executeBurst(trooper);
  const burst = system.projectiles.items.filter((projectile) => projectile.active);
  assert.equal(burst.length, 3);
  burst.forEach((projectile) => assert.ok(projectile.previous.distanceTo(expectedMuzzle) < 1e-6));

  const warden = system.spawn('warden', new THREE.Vector3(3, 0, 0));
  const expectedCore = getEnemyAnchorPosition(warden, 'orbAnchor', 1.65);
  assert.ok(expectedCore.z > warden.root.position.z, 'warden orb anchor must sit in front of the reactor');
  system.executeOrbVolley(warden);
  const volley = system.projectiles.items.filter((projectile) => projectile.active).slice(burst.length);
  assert.equal(volley.length, 5);
  volley.forEach((projectile) => assert.ok(projectile.previous.distanceTo(expectedCore) < 1e-6));
});

test('gameplay roots stay at navigation height while rigs and shields meet the floor', (t) => {
  const { system } = createEnemies();
  t.after(() => system.dispose());
  const [trooper, hunter, warden] = [
    system.spawn('trooper', new THREE.Vector3(-3, 1.05, 0)),
    system.spawn('hunter', new THREE.Vector3(0, 1.05, 0)),
    system.spawn('warden', new THREE.Vector3(3, 1.05, 0)),
  ];

  for (const enemy of [trooper, hunter, warden]) {
    const parts = enemy.root.userData.visualParts;
    assert.equal(enemy.root.position.y, 1.05, `${enemy.type} gameplay root must retain navigation Y`);
    assert.equal(parts.visualRoot.position.y, -1, `${enemy.type} rig must be lowered from its gameplay root`);
    enemy.root.updateMatrixWorld(true);
    const feet = new THREE.Box3().setFromObject(parts.legs[0]);
    assert.ok(feet.min.y >= 0.04 && feet.min.y <= 0.16, `${enemy.type} feet must meet the floor, got ${feet.min.y}`);
    if (parts.shield) {
      const shieldBounds = new THREE.Box3().setFromObject(parts.shield);
      assert.ok(shieldBounds.min.y >= 0.03, `${enemy.type} shield must not clip below the floor`);
    }
  }
});

test('enemy movement follows elevated and sloped arena surfaces', (t) => {
  const arena = createSurfaceArena({ heightAt: (x) => x * 0.22 });
  const { system } = createEnemies({ arena });
  t.after(() => system.dispose());
  const enemy = system.spawn('trooper', new THREE.Vector3(0, 1, 0));
  enemy.target.set(5, 1, 0);

  for (let index = 0; index < 100; index += 1) system.moveEnemy(enemy, 1 / 60);

  assert.ok(enemy.root.position.x > 3, 'enemy must make horizontal progress up the ramp');
  assert.ok(
    Math.abs(enemy.root.position.y - (arena.getSurfaceHeight(enemy.root.position) + enemy.groundOffset)) < 0.03,
    'gameplay root must track the supporting surface instead of preserving spawn Y',
  );
  enemy.root.updateMatrixWorld(true);
  const feet = new THREE.Box3().setFromObject(enemy.root.userData.visualParts.legs[0]);
  assert.ok(Math.abs(feet.min.y - arena.getSurfaceHeight(enemy.root.position)) < 0.12);
});

test('enemy crosses the real null-grid ramp seam without losing floor support', (t) => {
  const scene = new THREE.Scene();
  const world = new CANNON.World();
  const arena = new Arena({ scene, mapId: 'null-grid' }).build(world);
  const { system } = createEnemies({ arena, scene });
  t.after(() => {
    system.dispose();
    arena.dispose();
  });
  const enemy = system.spawn('trooper', new THREE.Vector3(12, 1.05, 0));
  enemy.target.set(27, 3.55, 0);

  for (let index = 0; index < 300; index += 1) system.moveEnemy(enemy, 1 / 60);

  assert.ok(enemy.root.position.x > 24, 'enemy must cross the collider overlap at the ramp entrance');
  assert.ok(Math.abs(enemy.root.position.y - 3.55) < 0.04, 'enemy must arrive on the elevated ring');
  assert.equal(enemy.hasSurfaceSupport, true);
  assert.ok(Math.abs(enemy.surfaceY - 2.55) < 0.04);
});

test('enemy movement respects map-specific disc bounds and refuses unsupported steps', (t) => {
  const arena = createSurfaceArena({
    bounds: { shape: 'disc', centerX: 0, centerZ: 0, radius: 10 },
    heightAt: (x) => (x <= 8.6 ? 0 : null),
  });
  const { system } = createEnemies({ arena });
  t.after(() => system.dispose());
  const enemy = system.spawn('trooper', new THREE.Vector3(0, 1, 0));
  enemy.target.set(40, 1, 0);

  for (let index = 0; index < 300; index += 1) system.moveEnemy(enemy, 1 / 60);

  const allowedRadius = arena.getMovementBounds(enemy.config.radius + 0.12).radius;
  assert.ok(Math.hypot(enemy.root.position.x, enemy.root.position.z) <= allowedRadius + 1e-6);
  assert.ok(enemy.root.position.x <= 8.65, 'enemy must not step into a gap with no supporting surface');
  assert.equal(enemy.root.position.y, 1);
});

test('wide enemy sweep slides along walls instead of tunnelling through them', (t) => {
  const wallX = 1.5;
  const arena = createSurfaceArena({
    obstacleRaycast(origin, direction, maxDistance) {
      if (direction.x <= 1e-6) return { hit: false, hasHit: false, distance: Infinity };
      const distance = (wallX - origin.x) / direction.x;
      if (distance < 0 || distance > maxDistance) return { hit: false, hasHit: false, distance: Infinity };
      return {
        hit: true,
        hasHit: true,
        distance,
        point: origin.clone().addScaledVector(direction, distance),
        normal: new THREE.Vector3(-1, 0, 0),
        body: { userData: { arenaWall: true } },
      };
    },
  });
  const { system } = createEnemies({ arena });
  t.after(() => system.dispose());
  const enemy = system.spawn('warden', new THREE.Vector3(0, 1, 0));
  enemy.target.set(6, 1, 6);

  for (let index = 0; index < 90; index += 1) system.moveEnemy(enemy, 1 / 60);

  assert.ok(enemy.root.position.x <= wallX - enemy.config.radius + 0.03, 'sweep must preserve body clearance');
  assert.ok(enemy.root.position.z > 1, 'enemy should slide along the obstacle instead of freezing');
  assert.ok([enemy.root.position, enemy.velocity, enemy.forward].every((vector) => vector.toArray().every(Number.isFinite)));
});

test('enemy raycast resolves nested visual intersections to their registered hit zone', (t) => {
  const { system } = createEnemies();
  t.after(() => system.dispose());
  const enemy = system.spawn('trooper', new THREE.Vector3(0, 0, 0));
  const body = enemy.root.userData.visualParts.body;
  const nested = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.24, 0.24),
    new THREE.MeshBasicMaterial(),
  );
  nested.position.z = 2;
  body.add(nested);
  enemy.root.updateMatrixWorld(true);
  const bodyWorld = body.getWorldPosition(new THREE.Vector3());

  const hit = system.raycast(new THREE.Vector3(bodyWorld.x, bodyWorld.y, 1), new THREE.Vector3(0, 0, 1), 5);

  assert.ok(hit, 'nested mesh must remain hittable');
  assert.equal(hit.enemy, enemy);
  assert.equal(hit.zone, 'body');
});
