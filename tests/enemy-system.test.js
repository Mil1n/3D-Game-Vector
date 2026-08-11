import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { EnemySystem } from '../src/combat/EnemySystem.js';
import { getEnemyAnchorPosition, updateEnemyVisual } from '../src/combat/enemyVisuals.js';
import { ENEMY_CONFIGS } from '../src/configs/enemyConfigs.js';

const noopEffects = {
  spawnImpact() {},
  spawnEnemyDeath() {},
  spawnShiftPulse() {},
};

function createEnemies() {
  const scene = new THREE.Scene();
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
    arena: null,
    random: () => 0.5,
  });
  return { system, scene, player };
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
