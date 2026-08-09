import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { WeaponSystem } from '../src/combat/WeaponSystem.js';
import { WEAPON_CONFIGS, WEAPON_ORDER } from '../src/configs/weaponConfigs.js';

const noopEffects = {
  spawnTracer() {},
  spawnMuzzle() {},
  spawnImpact() {},
  spawnExplosion() {},
};

function createWeapons(player = null) {
  return new WeaponSystem({
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    eventBus: { emit() {} },
    audioManager: { playUI() {} },
    effects: noopEffects,
    arena: null,
    player,
  });
}

test('WeaponSystem creates and switches across the five configured weapons', () => {
  const weapons = createWeapons();

  assert.deepEqual(weapons.weaponOrder, [...WEAPON_ORDER]);
  assert.equal(weapons.models.size, 5);
  assert.equal(weapons.currentId, 'carbine');
  assert.equal([...weapons.models.values()].filter((model) => model.visible).length, 0);

  const modelSignatures = [];
  for (const id of WEAPON_ORDER) {
    const model = weapons.models.get(id);
    const meshes = [];
    model.traverse((object) => { if (object.isMesh) meshes.push(object); });
    assert.equal(model.userData.partCount, meshes.length);
    assert.ok(meshes.length >= 10, `${id} needs a readable procedural silhouette`);
    assert.ok(meshes.length <= 16, `${id} viewmodel should stay within the draw-call budget`);
    assert.ok(model.userData.muzzle?.isObject3D, `${id} needs a muzzle anchor`);
    assert.ok(model.userData.basePosition?.isVector3);
    assert.ok(model.userData.adsPosition?.isVector3);

    assert.equal(model.userData.muzzle.parent, model);
    assert.ok(model.userData.muzzle.position.toArray().every(Number.isFinite));
    assert.equal(model.userData.muzzle.position.z, WEAPON_CONFIGS[id].viewModel.muzzleZ);

    const localBounds = new THREE.Box3();
    const localParts = [];
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox();
      mesh.updateMatrix();
      localBounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));
      const round = (value) => Number(value.toFixed(4));
      localParts.push(JSON.stringify({
        type: mesh.geometry.type,
        position: mesh.position.toArray().map(round),
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map(round),
        scale: mesh.scale.toArray().map(round),
      }));
    }
    assert.ok(
      Math.abs(model.userData.muzzle.position.z - localBounds.min.z) <= 0.025,
      `${id} muzzle must sit at the barrel tip`,
    );
    modelSignatures.push(localParts.sort().join('|'));
  }
  assert.equal(new Set(modelSignatures).size, WEAPON_ORDER.length, 'all weapon silhouettes must be distinct');

  assert.equal(weapons.switchTo(3), true);
  assert.equal(weapons.currentId, 'plasma');
  assert.equal([...weapons.models.values()].filter((model) => model.visible).length, 0);
  assert.equal(weapons.switchTo(4), true);
  assert.equal(weapons.currentId, 'nova');
  assert.equal(weapons.switchTo(5), false);
  assert.equal(weapons.currentId, 'nova');

  weapons.reset();
  assert.equal(weapons.currentId, 'carbine');

  weapons.setEnabled(true);
  assert.deepEqual(
    [...weapons.models.entries()].filter(([, model]) => model.visible).map(([id]) => id),
    ['carbine'],
  );
  const inputFor = (pressed, wheel = 0) => ({
    wasPressed: (action) => action === pressed,
    isDown: () => false,
    consumeWheel: () => wheel,
  });
  weapons.update(1 / 60, inputFor('weapon4'));
  assert.equal(weapons.currentId, 'plasma');
  assert.deepEqual([...weapons.models.entries()].filter(([, model]) => model.visible).map(([id]) => id), ['plasma']);
  weapons.update(1 / 60, inputFor('weapon5'));
  assert.equal(weapons.currentId, 'nova');
  weapons.update(1 / 60, inputFor(null, 1));
  assert.equal(weapons.currentId, 'carbine');

  let blastCall = null;
  weapons.setEnemySystem({
    damageInRadius: (...args) => {
      blastCall = args;
      return 2;
    },
  });
  weapons.switchTo(4);
  const blast = weapons.applyImpactBlast(new THREE.Vector3(1, 2, 3), weapons.currentConfig);
  assert.equal(blast.hits, 2);
  assert.equal(blast.radius, 5.2);
  assert.equal(blastCall[3].weapon, 'nova-blast');

  const ownedResources = new Set();
  for (const model of weapons.models.values()) {
    model.traverse((object) => { if (object.isMesh) ownedResources.add(object.geometry); });
    for (const material of model.userData.materials) ownedResources.add(material);
  }
  const modelsBeforeDispose = [...weapons.models.values()];
  const disposeCounts = new Map([...ownedResources].map((resource) => [resource, 0]));
  for (const resource of ownedResources) {
    resource.addEventListener('dispose', () => disposeCounts.set(resource, disposeCounts.get(resource) + 1));
  }
  weapons.dispose();
  for (const count of disposeCounts.values()) assert.equal(count, 1);
  for (const model of modelsBeforeDispose) assert.equal(model.parent, null);
  assert.equal(weapons.models.size, 0);
  weapons.dispose();
  for (const count of disposeCounts.values()) assert.equal(count, 1);
});

test('viewmodel bob settles to the same pose at different frame rates', () => {
  const settleAt = (fps) => {
    const player = {
      getViewBob: () => ({ x: 0.025, y: 0.018 }),
      setAiming() {},
    };
    const weapons = createWeapons(player);
    weapons.setEnabled(true);
    const idleInput = {
      wasPressed: () => false,
      isDown: () => false,
      consumeWheel: () => 0,
    };
    for (let frame = 0; frame < fps * 2; frame += 1) weapons.update(1 / fps, idleInput);
    const position = weapons.currentModel.position.clone();
    const expected = weapons.currentModel.userData.basePosition.clone().add(new THREE.Vector3(0.025, 0.018, 0));
    weapons.dispose();
    return { position, expected };
  };

  const at60 = settleAt(60);
  const at144 = settleAt(144);
  assert.ok(at60.position.distanceTo(at60.expected) < 0.001);
  assert.ok(at144.position.distanceTo(at144.expected) < 0.001);
  assert.ok(at60.position.distanceTo(at144.position) < 0.001);
});

test('reset restores procedural viewmodel poses for a fresh run', () => {
  const player = { getViewBob: () => ({ x: 0, y: 0 }), setAiming() {} };
  const weapons = createWeapons(player);
  weapons.setEnabled(true);
  weapons.switchTo(2);
  const rail = weapons.currentModel;
  const idleInput = { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 };
  for (let frame = 0; frame < 30; frame += 1) weapons.update(1 / 60, idleInput);
  assert.ok(rail.userData.animationTime > 0);
  assert.ok(rail.userData.spinParts.some((part) => !part.mesh.rotation.equals(part.baseRotation)));

  rail.position.set(9, 9, 9);
  rail.rotation.set(1, 1, 1);
  weapons.reset();

  for (const model of weapons.models.values()) {
    assert.ok(model.position.equals(model.userData.basePosition));
    assert.equal(model.rotation.x, 0);
    assert.equal(model.rotation.y, model.userData.baseYaw);
    assert.equal(model.rotation.z, 0);
    assert.equal(model.userData.animationTime, 0);
    for (const part of model.userData.pulseParts) assert.ok(part.mesh.scale.equals(part.baseScale));
    for (const part of model.userData.spinParts) assert.ok(part.mesh.rotation.equals(part.baseRotation));
  }
  weapons.dispose();
});
