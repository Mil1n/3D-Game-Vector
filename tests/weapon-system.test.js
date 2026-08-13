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
    audioManager: { playUI() {}, playWeapon() {}, playEffect() {} },
    effects: noopEffects,
    arena: null,
    player,
  });
}

test('successful hits emit combat activity for Momentum decay tracking', () => {
  const events = [];
  const enemy = { type: 'trooper' };
  const weapons = new WeaponSystem({
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    eventBus: { emit: (name, payload) => events.push({ name, payload }) },
    audioManager: { playUI() {}, playWeapon() {}, playEffect() {} },
    effects: noopEffects,
    arena: { raycastWorld: () => null },
    player: null,
    enemySystem: {
      raycast: (_origin, _direction, distance) => ({
        enemy,
        distance: Math.min(2, distance),
        point: new THREE.Vector3(0, 0, -2),
        zone: 'body',
      }),
      damage: () => ({ applied: 17, killed: false }),
    },
  });

  weapons.traceShot(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), weapons.currentConfig);
  const activity = events.find(({ name }) => name === 'combat:damage-dealt');
  assert.ok(activity);
  assert.equal(activity.payload.damage, 17);
  assert.equal(activity.payload.weapon, 'carbine');
  assert.equal(activity.payload.enemyType, 'trooper');
  assert.equal(activity.payload.killed, false);
  weapons.dispose();
});

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
    assert.equal(
      model.userData.weaponPartCount + model.userData.armPartCount,
      meshes.length,
      `${id} must account for weapon and operator meshes separately`,
    );
    assert.ok(model.userData.weaponPartCount >= 16, `${id} needs a premium procedural silhouette`);
    assert.equal(model.userData.armPartCount, 10, `${id} needs two complete procedural arms`);
    assert.ok(meshes.length <= 30, `${id} viewmodel should stay within the draw-call budget`);
    assert.ok(model.userData.muzzle?.isObject3D, `${id} needs a muzzle anchor`);
    assert.ok(model.userData.basePosition?.isVector3);
    assert.ok(model.userData.adsPosition?.isVector3);

    const armParts = model.userData.armParts;
    assert.equal(armParts.length, 10);
    for (const side of ['left', 'right']) {
      const sideParts = armParts.filter((part) => part.userData.armSide === side);
      assert.equal(sideParts.length, 5, `${id} needs a sleeve, cuff and complete ${side} glove`);
      assert.ok(sideParts.some((part) => part.userData.viewModelRole === 'sleeve'));
      assert.ok(sideParts.some((part) => part.userData.viewModelRole === 'cuff'));
      assert.equal(sideParts.filter((part) => part.userData.viewModelRole === 'hand').length, 2);
      assert.ok(model.userData.hands[side]?.isMesh);
      assert.ok(
        model.userData.hands[side].position.equals(model.userData.gripAnchors[side]),
        `${id} ${side} hand must stay centered on its configured grip`,
      );
    }
    assert.ok(model.userData.materials.some((material) => material.name === 'operator-sleeve'));
    assert.ok(model.userData.materials.some((material) => material.name === 'operator-glove'));

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

test('equip and reload poses move the complete arm rig without leaving floating parts', () => {
  const player = { getViewBob: () => ({ x: 0, y: 0 }), setAiming() {} };
  const weapons = createWeapons(player);
  const idleInput = { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 };
  weapons.setEnabled(true);

  const model = weapons.currentModel;
  assert.equal(model.userData.equipAmount, 1);
  weapons.update(1 / 60, idleInput);
  assert.ok(model.position.y < model.userData.basePosition.y, 'equip should raise the weapon from below frame');
  for (let frame = 0; frame < 120; frame += 1) weapons.update(1 / 60, idleInput);
  assert.ok(model.userData.equipAmount < 0.001);
  assert.ok(Math.abs(model.rotation.z) < 0.001);

  weapons.currentAmmo.magazine = 0;
  assert.equal(weapons.startReload(), true);
  const magazinePart = model.userData.motionParts.find((part) => part.mesh.name.includes('magazine'));
  assert.ok(magazinePart, 'carbine needs a removable reload magazine');
  const leftHand = model.userData.hands.left;
  weapons.update(weapons.currentConfig.reloadTime / 2, idleInput);
  assert.ok(leftHand.position.distanceTo(model.userData.gripAnchors.left) > 0.1);
  assert.ok(magazinePart.mesh.position.distanceTo(magazinePart.basePosition) > 0.2);
  assert.ok(model.rotation.z > 0.15, 'reload should visibly roll the full weapon and arms');

  weapons.update(weapons.currentConfig.reloadTime / 2 + 0.01, idleInput);
  assert.equal(weapons.reloadRemaining, 0);
  for (const part of model.userData.motionParts) {
    assert.ok(part.mesh.position.equals(part.basePosition));
    assert.ok(part.mesh.quaternion.equals(part.baseQuaternion));
  }
  assert.ok(leftHand.position.equals(model.userData.gripAnchors.left));

  weapons.switchTo(1);
  assert.equal(weapons.currentModel.userData.equipAmount, 1);
  assert.equal([...weapons.models.values()].filter((entry) => entry.visible).length, 1);
  weapons.dispose();
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
    assert.equal(model.userData.equipAmount, 0);
    for (const part of model.userData.motionParts) {
      assert.ok(part.mesh.position.equals(part.basePosition));
      assert.ok(part.mesh.quaternion.equals(part.baseQuaternion));
    }
    for (const part of model.userData.pulseParts) assert.ok(part.mesh.scale.equals(part.baseScale));
    for (const part of model.userData.spinParts) assert.ok(part.mesh.rotation.equals(part.baseRotation));
  }
  weapons.dispose();
});

test('Overdrive accelerates fire and switching without accumulating across disable or reset', () => {
  const weapons = createWeapons();
  const effects = {
    fireRateMultiplier: 2,
    reloadTimeMultiplier: 0.5,
    weaponSwitchTimeMultiplier: 0.5,
  };

  assert.equal(weapons.tryFire(false), true);
  const baselineFireCooldown = weapons.cooldown;
  weapons.cooldown = 0;

  weapons.setOverdrive(true, effects);
  assert.equal(weapons.tryFire(false), true);
  const boostedFireCooldown = weapons.cooldown;
  assert.ok(boostedFireCooldown < baselineFireCooldown);
  assert.ok(Math.abs(boostedFireCooldown - baselineFireCooldown / 2) < 0.000001);
  weapons.setOverdrive(false);
  assert.ok(
    Math.abs(weapons.cooldown - baselineFireCooldown) < 0.000001,
    'ending Overdrive must restore the remaining fire interval',
  );

  weapons.cooldown = 0;
  weapons.setOverdrive(true, effects);
  assert.equal(weapons.tryFire(false), true);
  assert.ok(
    Math.abs(weapons.cooldown - boostedFireCooldown) < 0.000001,
    'repeated activation must not compound the fire-rate multiplier',
  );

  weapons.cooldown = 0;
  weapons.setOverdrive(false);
  assert.equal(weapons.tryFire(false), true);
  assert.ok(Math.abs(weapons.cooldown - baselineFireCooldown) < 0.000001);

  weapons.cooldown = 0;
  assert.equal(weapons.switchTo(1), true);
  const baselineSwitchCooldown = weapons.cooldown;
  assert.ok(Math.abs(baselineSwitchCooldown - 0.18) < 0.000001);

  weapons.reset();
  weapons.setOverdrive(true, effects);
  assert.equal(weapons.switchTo(1), true);
  const boostedSwitchCooldown = weapons.cooldown;
  assert.ok(Math.abs(boostedSwitchCooldown - baselineSwitchCooldown / 2) < 0.000001);
  weapons.setOverdrive(false);
  assert.ok(
    Math.abs(weapons.cooldown - baselineSwitchCooldown) < 0.000001,
    'ending Overdrive must restore the remaining switch interval',
  );

  weapons.cooldown = 0;
  assert.equal(weapons.switchTo(2), true);
  assert.ok(Math.abs(weapons.cooldown - baselineSwitchCooldown) < 0.000001);

  weapons.reset();
  assert.equal(weapons.getState().overdrive, false);
  assert.deepEqual(weapons.runtimeModifiers, weapons.defaultRuntimeModifiers());
  assert.equal(weapons.switchTo(1), true);
  assert.ok(Math.abs(weapons.cooldown - baselineSwitchCooldown) < 0.000001);
  weapons.dispose();
});

test('Overdrive rescales an active reload while preserving progress and disable restores timing', () => {
  const weapons = createWeapons();
  const idleInput = { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 };
  const effects = { reloadTimeMultiplier: 0.5, weaponSwitchTimeMultiplier: 0.5 };
  weapons.setEnabled(true);

  const baselineDuration = weapons.getReloadDuration();
  weapons.currentAmmo.magazine = 0;
  assert.equal(weapons.startReload(), true);
  weapons.update(baselineDuration * 0.4, idleInput);
  const progressBeforeOverdrive = weapons.getState().reloadProgress;
  assert.ok(Math.abs(progressBeforeOverdrive - 0.4) < 0.000001);

  weapons.setOverdrive(true, effects);
  assert.ok(Math.abs(weapons.reloadDuration - baselineDuration / 2) < 0.000001);
  assert.ok(Math.abs(weapons.getState().reloadProgress - progressBeforeOverdrive) < 0.000001);
  assert.ok(
    Math.abs(weapons.reloadRemaining - weapons.reloadDuration * (1 - progressBeforeOverdrive)) < 0.000001,
  );

  weapons.applyModifiers({ reloadMultiplier: 0.8 });
  assert.ok(Math.abs(weapons.reloadDuration - baselineDuration * 0.8 / 2) < 0.000001);
  assert.ok(
    Math.abs(weapons.getState().reloadProgress - progressBeforeOverdrive) < 0.000001,
    'a run upgrade applied during Overdrive must preserve active reload progress',
  );

  const fastDuration = weapons.reloadDuration;
  const fastRemaining = weapons.reloadRemaining;
  weapons.setOverdrive(true, effects);
  assert.ok(Math.abs(weapons.reloadDuration - fastDuration) < 0.000001);
  assert.ok(Math.abs(weapons.reloadRemaining - fastRemaining) < 0.000001);

  weapons.setOverdrive(false);
  assert.ok(Math.abs(weapons.reloadDuration - baselineDuration * 0.8) < 0.000001);
  assert.ok(Math.abs(weapons.getState().reloadProgress - progressBeforeOverdrive) < 0.000001);

  weapons.setOverdrive(true, effects);
  const boostedRemaining = weapons.reloadRemaining;
  weapons.update(boostedRemaining + 0.001, idleInput);
  assert.equal(weapons.reloadRemaining, 0, 'the shortened reload must complete on its accelerated schedule');

  weapons.currentAmmo.magazine = 0;
  assert.equal(weapons.startReload(), true);
  weapons.reset();
  assert.equal(weapons.reloadDuration, 0);
  assert.equal(weapons.reloadRemaining, 0);
  assert.equal(weapons.getState().overdrive, false);
  assert.ok(Math.abs(weapons.getReloadDuration() - baselineDuration) < 0.000001);
  assert.deepEqual(weapons.runtimeModifiers, weapons.defaultRuntimeModifiers());
  weapons.dispose();
});
