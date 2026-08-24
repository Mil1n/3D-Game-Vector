import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { WeaponSystem } from '../src/combat/WeaponSystem.js';
import { WEAPON_CONFIGS, WEAPON_ORDER } from '../src/configs/weaponConfigs.js';
import { EventBus } from '../src/core/EventBus.js';
import { Game } from '../src/core/Game.js';
import { GAME_STATES } from '../src/core/GameStateManager.js';

const noopEffects = {
  spawnTracer() {},
  spawnMuzzle() {},
  spawnImpact() {},
  spawnExplosion() {},
};

function createWeapons(player = null, { random = Math.random, eventBus = { emit() {} } } = {}) {
  return new WeaponSystem({
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    eventBus,
    audioManager: { playUI() {}, playWeapon() {}, playEffect() {} },
    effects: noopEffects,
    arena: null,
    player,
    random,
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

test('one scatter shot aggregates all pellets into one semantic combat impact', () => {
  const events = [];
  const enemyHitSounds = [];
  const enemy = { type: 'trooper' };
  const weapons = new WeaponSystem({
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    eventBus: { emit: (name, payload) => events.push({ name, payload }) },
    audioManager: { playUI() {}, playWeapon() {}, playEffect: (id) => enemyHitSounds.push(id) },
    effects: noopEffects,
    arena: { raycastWorld: () => null },
    enemySystem: {
      raycast: (_origin, _direction, distance) => ({
        enemy,
        distance: Math.min(2, distance),
        point: new THREE.Vector3(0, 0, -2),
        zone: 'body',
      }),
      damage: (_target, amount) => ({ applied: amount, killed: false }),
    },
    random: () => 0.5,
  });
  weapons.switchTo(1);
  weapons.cooldown = 0;

  assert.equal(weapons.tryFire(false), true);
  const impacts = events.filter(({ name }) => name === 'combat:impact');
  const pelletHits = events.filter(({ name }) => name === 'combat:hit');
  assert.equal(impacts.length, 1);
  assert.equal(pelletHits.length, WEAPON_CONFIGS.scatter.pellets);
  assert.equal(impacts[0].payload.weapon, 'scatter');
  assert.equal(impacts[0].payload.hitCount, WEAPON_CONFIGS.scatter.pellets);
  assert.equal(impacts[0].payload.damage, WEAPON_CONFIGS.scatter.damage * WEAPON_CONFIGS.scatter.pellets);
  assert.equal(impacts[0].payload.headshot, false);
  assert.equal(impacts[0].payload.killed, false);
  assert.equal(impacts[0].payload.hitStop, WEAPON_CONFIGS.scatter.hitStop.body);
  assert.equal(impacts[0].payload.shotId, 1);
  assert.deepEqual(enemyHitSounds, [], 'per-pellet enemy sounds must be replaced by one aggregate confirmation');
  weapons.dispose();
});

test('direct body, headshot and lethal headshot impacts preserve their aggregate flags', () => {
  const cases = [
    { zone: 'body', killed: false, headshot: false },
    { zone: 'head', killed: false, headshot: true },
    { zone: 'head', killed: true, headshot: true },
  ];

  for (const expected of cases) {
    const events = [];
    const damageContexts = [];
    const tracedDirections = [];
    const enemy = { type: 'trooper' };
    const weapons = new WeaponSystem({
      camera: new THREE.PerspectiveCamera(),
      scene: new THREE.Scene(),
      eventBus: { emit: (name, payload) => events.push({ name, payload }) },
      audioManager: { playUI() {}, playWeapon() {}, playEffect() {} },
      effects: noopEffects,
      arena: { raycastWorld: () => null },
      enemySystem: {
        raycast: (_origin, direction, distance) => {
          tracedDirections.push(direction.clone());
          return {
            enemy,
            distance: Math.min(2, distance),
            point: new THREE.Vector3(0, 0, -2),
            zone: expected.zone,
          };
        },
        damage: (_target, amount, context) => {
          damageContexts.push(context);
          return { applied: amount, killed: expected.killed };
        },
      },
      random: () => 0.5,
    });
    weapons.cooldown = 0;

    assert.equal(weapons.tryFire(false), true);
    const impacts = events.filter(({ name }) => name === 'combat:impact');
    assert.equal(impacts.length, 1);
    assert.equal(impacts[0].payload.shotId, 1);
    assert.equal(impacts[0].payload.headshot, expected.headshot);
    assert.equal(impacts[0].payload.killed, expected.killed);
    assert.equal(impacts[0].payload.hitCount, 1);
    assert.equal(damageContexts.length, 1);
    assert.equal(damageContexts[0].zone, expected.zone);
    assert.ok(damageContexts[0].direction instanceof THREE.Vector3);
    assert.ok(Math.abs(damageContexts[0].direction.length() - 1) < 1e-8);
    assert.ok([...damageContexts[0].direction.toArray()].every(Number.isFinite));
    assert.ok(damageContexts[0].direction.dot(tracedDirections[0]) > 1 - 1e-8);
    weapons.dispose();
  }
});

test('misses emit no combat impact while a lethal Nova wall blast emits exactly one promoted impact', () => {
  const missEvents = [];
  const miss = createWeapons(null, {
    random: () => 0.5,
    eventBus: { emit: (name, payload) => missEvents.push({ name, payload }) },
  });
  assert.equal(miss.tryFire(false), true);
  assert.equal(missEvents.some(({ name }) => name === 'combat:impact'), false);
  miss.dispose();

  const blastEvents = [];
  const nova = new WeaponSystem({
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    eventBus: { emit: (name, payload) => blastEvents.push({ name, payload }) },
    audioManager: { playUI() {}, playWeapon() {}, playEffect() {} },
    effects: noopEffects,
    arena: {
      raycastWorld: () => ({
        distance: 3,
        normal: new THREE.Vector3(0, 0, 1),
        material: 'metal',
      }),
    },
    enemySystem: {
      raycast: () => null,
      damageInRadius: () => ({ hits: 2, kills: 1, damage: 13 }),
    },
    random: () => 0.5,
  });
  nova.switchTo(4);
  nova.cooldown = 0;

  assert.equal(nova.tryFire(false), true);
  const impacts = blastEvents.filter(({ name }) => name === 'combat:impact');
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].payload.weapon, 'nova');
  assert.equal(impacts[0].payload.blastHits, 2);
  assert.equal(impacts[0].payload.hitCount, 2);
  assert.equal(impacts[0].payload.damage, 13);
  assert.equal(impacts[0].payload.killed, true);
  assert.equal(impacts[0].payload.hitStop, WEAPON_CONFIGS.nova.hitStop.kill);
  nova.dispose();
});

test('a complete automatic fire click buffered during hit-stop fires exactly once across catch-up steps', () => {
  const weapons = createWeapons();
  weapons.switchTo(3);
  weapons.setEnabled(true);
  weapons.cooldown = 0.05;
  weapons.cooldownKind = 'fire';
  const bufferedClick = {
    wasPressed: (action) => action === 'fire',
    wasReleased: (action) => action === 'fire',
    isDown: () => false,
    consumeWheel: () => 0,
  };
  const idle = {
    wasPressed: () => false,
    wasReleased: () => false,
    isDown: () => false,
    consumeWheel: () => 0,
  };

  for (let step = 0; step < 5; step += 1) weapons.update(1 / 60, bufferedClick);
  weapons.update(1 / 60, idle);

  assert.equal(weapons.shotsFired, 1);
  assert.equal(weapons.triggerReleased, true);
  weapons.fireBufferRemaining = 0.08;
  weapons.firePressConsumed = true;
  weapons.triggerReleased = false;
  weapons.clearInputBuffer();
  assert.equal(weapons.fireBufferRemaining, 0);
  assert.equal(weapons.firePressConsumed, false);
  assert.equal(weapons.triggerReleased, true);
  weapons.dispose();
});

test('completed fire clicks survive fully frozen Game frames and fire exactly once after thaw', () => {
  for (const weaponIndex of [1, 3]) {
    const weapons = createWeapons();
    weapons.switchTo(weaponIndex);
    weapons.setEnabled(true);
    weapons.cooldown = 0;
    weapons.cooldownKind = null;

    let edgePending = true;
    let endedFrames = 0;
    const gameplayInput = {
      beginStepBatch() {},
      wasPressed: (action) => action === 'fire' && edgePending,
      wasReleased: (action) => action === 'fire' && edgePending,
      isDown: () => false,
      consumeWheel: () => 0,
    };
    const game = {
      input: {
        wasPressed: () => false,
        endFrame() {
          edgePending = false;
          endedFrames += 1;
        },
      },
      gameplayInput,
      physicsAccumulator: 0,
      state: { state: GAME_STATES.PLAYING },
      player: {
        horizontalSpeed: 0,
        position: { y: 1 },
        fixedUpdate() {},
      },
      world: { step() {} },
      weapons,
      enemies: { update() {} },
      director: { update() {} },
      effects: { update() {} },
      arena: { update() {} },
      momentum: {
        getState: () => ({ overdrive: { active: false } }),
        update() {},
      },
      matchTutorial: false,
      tutorialComplete: true,
    };

    for (let frame = 0; frame < 3; frame += 1) {
      Game.prototype.updateGameplay.call(game, 0, { hitStopped: true });
    }
    assert.equal(weapons.shotsFired, 0, `${weapons.currentId} must stay frozen`);
    assert.equal(endedFrames, 0, `${weapons.currentId} input edges must stay buffered`);

    Game.prototype.updateGameplay.call(game, 1 / 60);
    assert.equal(weapons.shotsFired, 1, `${weapons.currentId} must fire once after thaw`);
    assert.equal(endedFrames, 1);

    Game.prototype.updateGameplay.call(game, 1 / 60);
    assert.equal(weapons.shotsFired, 1, `${weapons.currentId} must not replay the completed click`);
    weapons.dispose();
  }
});

test('Nova direct and blast damage share one unique impact ID per shot', () => {
  const events = [];
  const enemy = { type: 'trooper' };
  const nova = new WeaponSystem({
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    eventBus: { emit: (name, payload) => events.push({ name, payload }) },
    audioManager: { playUI() {}, playWeapon() {}, playEffect() {} },
    effects: noopEffects,
    arena: { raycastWorld: () => null },
    enemySystem: {
      raycast: (_origin, _direction, distance) => ({
        enemy,
        distance: Math.min(2, distance),
        point: new THREE.Vector3(0, 0, -2),
        zone: 'body',
      }),
      damage: (_target, amount) => ({ applied: amount, killed: false }),
      damageInRadius: () => ({ hits: 2, kills: 1, damage: 13 }),
    },
    random: () => 0.5,
  });
  nova.switchTo(4);
  nova.cooldown = 0;
  nova.cooldownKind = null;

  assert.equal(nova.tryFire(false), true);
  nova.cooldown = 0;
  nova.cooldownKind = null;
  assert.equal(nova.tryFire(false), true);

  const impacts = events.filter(({ name }) => name === 'combat:impact');
  assert.deepEqual(impacts.map(({ payload }) => payload.shotId), [1, 2]);
  for (const impact of impacts) {
    assert.equal(impact.payload.hitCount, 3);
    assert.equal(impact.payload.blastHits, 2);
    assert.equal(impact.payload.killed, true);
    assert.equal(impact.payload.damage, WEAPON_CONFIGS.nova.damage + 13);
    assert.equal(impact.payload.hitStop, WEAPON_CONFIGS.nova.hitStop.kill);
  }
  for (const eventName of ['combat:hit', 'combat:blast', 'combat:shot']) {
    assert.deepEqual(
      events.filter(({ name }) => name === eventName).map(({ payload }) => payload.shotId),
      [1, 2],
      `${eventName} must preserve the unique ID of each resolved shot`,
    );
  }
  nova.dispose();
});

test('a rail ricochet is folded into the same impact and promotes a secondary kill', () => {
  const events = [];
  const enemyHitSounds = [];
  const sourceEnemy = { type: 'trooper', dead: false, root: { position: new THREE.Vector3(0, 0, -3) } };
  const targetEnemy = { type: 'hunter', dead: false, root: { position: new THREE.Vector3(2, 0, -4) } };
  const weapons = new WeaponSystem({
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    eventBus: { emit: (name, payload) => events.push({ name, payload }) },
    audioManager: { playUI() {}, playWeapon() {}, playEffect: (id) => enemyHitSounds.push(id) },
    effects: noopEffects,
    arena: { raycastWorld: () => null, hasLineOfSight: () => true },
    enemySystem: {
      enemies: [sourceEnemy, targetEnemy],
      raycast: () => ({
        enemy: sourceEnemy,
        distance: 2,
        point: new THREE.Vector3(0, 0, -2),
        zone: 'body',
      }),
      damage: (enemy, amount) => ({ applied: amount, killed: enemy === targetEnemy }),
    },
    random: () => 0.5,
  });
  weapons.switchTo(2);
  weapons.cooldown = 0;
  weapons.modifiers.railRicochet = 1;

  assert.equal(weapons.tryFire(false), true);
  const impacts = events.filter(({ name }) => name === 'combat:impact');
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].payload.hitCount, 2);
  assert.equal(impacts[0].payload.killed, true);
  assert.ok(impacts[0].payload.damage > WEAPON_CONFIGS.rail.damage);
  assert.equal(impacts[0].payload.hitStop, WEAPON_CONFIGS.rail.hitStop.kill);
  assert.deepEqual(enemyHitSounds, [], 'ricochets must fold into the aggregate confirmation instead of playing another hit cue');
  weapons.dispose();
});

test('hit-stop profiles promote headshots, critical hits and kills without exceeding the cap', () => {
  const weapons = createWeapons();

  for (const id of WEAPON_ORDER) {
    const config = WEAPON_CONFIGS[id];
    assert.equal(weapons.resolveHitStopDuration(config), config.hitStop.body);
    assert.equal(weapons.resolveHitStopDuration(config, { headshot: true }), Math.max(config.hitStop.body, config.hitStop.headshot));
    assert.equal(weapons.resolveHitStopDuration(config, { critical: true }), Math.max(config.hitStop.body, config.hitStop.critical));
    assert.equal(weapons.resolveHitStopDuration(config, { killed: true }), Math.max(config.hitStop.body, config.hitStop.kill));
    assert.ok(weapons.resolveHitStopDuration(config, { headshot: true, critical: true, killed: true, blastHits: 99 }) <= 0.075);
  }
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
  assert.equal(blast.totalDamage, WEAPON_CONFIGS.nova.impactBlast.damage * 2);
  assert.equal(blastCall[3].weapon, 'nova-blast');
  assert.equal(blastCall[3].returnSummary, true);

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
  assert.doesNotThrow(() => weapons.update(1 / 60, inputFor(null)));
  assert.equal(weapons.tryFire(false), false);
  assert.equal(weapons.switchTo(1), false);
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

test('a fired shot uses the current recoil aim and forwards the configured recovery exactly once', () => {
  const recoilCalls = [];
  let aimReads = 0;
  const player = {
    getViewBob: () => ({ x: 0, y: 0 }),
    setAiming() {},
    getAimDirection(target) {
      aimReads += 1;
      return target.set(0.18, 0.12, -0.976).normalize();
    },
    addRecoil(...args) { recoilCalls.push(args); },
  };
  const weapons = createWeapons(player, { random: () => 0.75 });

  assert.equal(weapons.tryFire(false), true);
  assert.equal(aimReads, 1);
  assert.equal(recoilCalls.length, 1);
  assert.equal(recoilCalls[0][2], weapons.currentConfig.recoil.recovery);
  assert.ok(recoilCalls[0][0] > 0);
  assert.ok(Math.abs(recoilCalls[0][1]) <= weapons.currentConfig.recoil.yaw);
  assert.ok(weapons.tempDirection.y > 0, 'the ballistic direction should include prior recoil offset');

  assert.equal(weapons.tryFire(false), false, 'cooldown must not create a second recoil impulse');
  assert.equal(recoilCalls.length, 1);
  weapons.dispose();
});

test('procedural recoil is deterministic with an injected random source', () => {
  const sequence = [0.91, 0.18, 0.73, 0.42, 0.64, 0.27, 0.55];
  const randomForRun = () => {
    let index = 0;
    const sample = () => {
      sample.calls += 1;
      return sequence[index++ % sequence.length];
    };
    sample.calls = 0;
    return sample;
  };
  const playerForRun = () => ({
    getViewBob: () => ({ x: 0, y: 0 }),
    setAiming() {},
    getAimDirection: (target) => target.set(0, 0, -1),
    addRecoil() {},
  });
  const firstRandom = randomForRun();
  const secondRandom = randomForRun();
  const first = createWeapons(playerForRun(), { random: firstRandom });
  const second = createWeapons(playerForRun(), { random: secondRandom });
  first.setEnabled(true);
  second.setEnabled(true);
  first.currentModel.userData.equipAmount = 0;
  second.currentModel.userData.equipAmount = 0;

  assert.equal(first.tryFire(false), true);
  assert.equal(second.tryFire(false), true);
  const randomReadsAfterShot = firstRandom.calls;
  assert.ok(randomReadsAfterShot > 0);
  assert.equal(secondRandom.calls, randomReadsAfterShot);
  first.update(1 / 60, { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 });
  second.update(1 / 60, { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 });
  assert.equal(firstRandom.calls, randomReadsAfterShot, 'frame updates must not sample new recoil noise');

  assert.deepEqual(first.getRecoilState(), second.getRecoilState());
  assert.ok(first.currentModel.position.distanceTo(second.currentModel.position) < 1e-12);
  const firstRotation = new THREE.Vector3(
    first.currentModel.rotation.x,
    first.currentModel.rotation.y,
    first.currentModel.rotation.z,
  );
  const secondRotation = new THREE.Vector3(
    second.currentModel.rotation.x,
    second.currentModel.rotation.y,
    second.currentModel.rotation.z,
  );
  assert.ok(firstRotation.distanceTo(secondRotation) < 1e-12);
  first.dispose();
  second.dispose();
});

test('opposite procedural samples produce opposite lateral recoil without bias', () => {
  const sample = (randomValue) => {
    const calls = [];
    const player = {
      getAimDirection: (target) => target.set(0, 0, -1),
      addRecoil: (...args) => calls.push(args),
    };
    const weapons = createWeapons(player, { random: () => randomValue });
    weapons.tryFire(false);
    const state = weapons.getRecoilState();
    weapons.dispose();
    return { calls, state };
  };

  const left = sample(0);
  const right = sample(1);
  assert.ok(left.calls[0][1] < 0);
  assert.ok(right.calls[0][1] > 0);
  assert.ok(left.state.modelSide < 0);
  assert.ok(right.state.modelSide > 0);
  assert.ok(left.state.modelRoll > 0);
  assert.ok(right.state.modelRoll < 0);
});

test('viewmodel recoil moves backward, stays bounded and settles at any frame rate', () => {
  const sample = (fps) => {
    const player = {
      getViewBob: () => ({ x: 0, y: 0 }),
      setAiming() {},
      getAimDirection: (target) => target.set(0, 0, -1),
      addRecoil() {},
    };
    const weapons = createWeapons(player, { random: () => 0.8 });
    weapons.setEnabled(true);
    const model = weapons.currentModel;
    model.userData.equipAmount = 0;
    model.position.copy(model.userData.basePosition);
    model.rotation.set(0, model.userData.baseYaw, 0);
    assert.equal(weapons.tryFire(false), true);
    const peak = weapons.getRecoilState();
    weapons.update(1 / fps, { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 });
    const firstPosition = model.position.clone();
    for (let frame = 1; frame < fps * 2; frame += 1) {
      weapons.update(1 / fps, { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 });
    }
    const result = {
      peak,
      firstPosition,
      position: model.position.clone(),
      rotation: new THREE.Vector3(model.rotation.x, model.rotation.y, model.rotation.z),
      base: model.userData.basePosition.clone(),
      baseYaw: model.userData.baseYaw,
      state: weapons.getRecoilState(),
    };
    weapons.dispose();
    return result;
  };

  const at60 = sample(60);
  const at144 = sample(144);
  assert.ok(at60.firstPosition.z > at60.base.z, 'the shot should push the weapon back toward the camera');
  assert.ok(at60.peak.modelKick > 0 && at60.peak.modelKick <= 2.2);
  assert.ok(Math.abs(at60.peak.modelSide) <= 1.35);
  assert.ok(Math.abs(at60.peak.modelRoll) <= 1);
  assert.ok(at60.position.distanceTo(at60.base) < 0.001);
  assert.ok(at144.position.distanceTo(at144.base) < 0.001);
  assert.ok(at60.position.distanceTo(at144.position) < 0.001);
  assert.ok(Math.abs(at60.rotation.y - at60.baseYaw) < 0.001);
  assert.ok(at60.state.modelKick < 0.0001);
  assert.ok(at144.state.modelKick < 0.0001);
});

test('mouse turns create mirrored bounded viewmodel sway without reading input twice', () => {
  const sample = (yaw, pitch, { ads = false, intensity = 1 } = {}) => {
    const look = new THREE.Vector2(yaw, pitch);
    let reads = 0;
    const player = {
      getLookDelta(target) {
        reads += 1;
        return target.copy(look);
      },
      getViewBob: (target) => target.set(0, 0),
      setAiming() {},
    };
    const weapons = createWeapons(player);
    weapons.setEnabled(true);
    weapons.setSwayIntensity(intensity);
    weapons.adsAmount = ads ? 1 : 0;
    const model = weapons.currentModel;
    model.userData.equipAmount = 0;
    model.position.copy(model.userData.basePosition);
    model.rotation.set(0, model.userData.baseYaw, 0);
    weapons.update(1 / 60, {
      wasPressed: () => false,
      isDown: (action) => ads && action === 'aim',
      consumeWheel: () => 0,
    });
    const result = {
      reads,
      state: weapons.getSwayState(),
      position: model.position.clone(),
      base: model.userData.basePosition.clone(),
    };
    weapons.dispose();
    return result;
  };

  const left = sample(0.08, -0.05);
  const right = sample(-0.08, 0.05);
  assert.equal(left.reads, 1);
  assert.equal(right.reads, 1);
  assert.ok(left.state.yaw < 0 && right.state.yaw > 0);
  assert.ok(left.state.pitch > 0 && right.state.pitch < 0);
  assert.ok(Math.abs(left.state.yaw + right.state.yaw) < 1e-12);
  assert.ok(Math.abs(left.state.pitch + right.state.pitch) < 1e-12);
  assert.ok(Math.abs(left.state.yaw) <= 0.072);
  assert.ok(Math.abs(left.state.pitch) <= 0.052);
  assert.ok(left.position.distanceTo(left.base) > 0.0001);

  const hip = sample(0.08, -0.05);
  const ads = sample(0.08, -0.05, { ads: true });
  assert.ok(Math.abs(ads.state.yaw) < Math.abs(hip.state.yaw));
  assert.ok(Math.abs(ads.state.pitch) < Math.abs(hip.state.pitch));
  assert.equal(Math.sign(ads.state.yaw), Math.sign(hip.state.yaw));
});

test('viewmodel sway follows and settles consistently at different frame rates', () => {
  const sample = (fps) => {
    const look = new THREE.Vector2();
    const player = {
      getLookDelta: (target) => target.copy(look),
      getViewBob: (target) => target.set(0, 0),
      setAiming() {},
    };
    const weapons = createWeapons(player);
    const idle = { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 };
    weapons.setEnabled(true);
    weapons.setSwayIntensity(1);
    const model = weapons.currentModel;
    model.userData.equipAmount = 0;
    model.position.copy(model.userData.basePosition);
    model.rotation.set(0, model.userData.baseYaw, 0);
    for (let frame = 0; frame < fps * 0.25; frame += 1) {
      look.set(1.8 / fps, -1.1 / fps);
      weapons.update(1 / fps, idle);
    }
    const moving = weapons.getSwayState();
    look.set(0, 0);
    for (let frame = 0; frame < fps * 1.5; frame += 1) weapons.update(1 / fps, idle);
    const result = {
      moving,
      settled: weapons.getSwayState(),
      position: model.position.clone(),
      base: model.userData.basePosition.clone(),
      rotation: new THREE.Vector3(model.rotation.x, model.rotation.y, model.rotation.z),
      baseYaw: model.userData.baseYaw,
    };
    weapons.dispose();
    return result;
  };

  const at60 = sample(60);
  const at144 = sample(144);
  assert.ok(Math.abs(at60.moving.yaw - at144.moving.yaw) < 0.001);
  assert.ok(Math.abs(at60.moving.pitch - at144.moving.pitch) < 0.001);
  assert.ok(at60.position.distanceTo(at60.base) < 0.001);
  assert.ok(at144.position.distanceTo(at144.base) < 0.001);
  assert.ok(at60.position.distanceTo(at144.position) < 0.001);
  assert.equal(at60.settled.yaw, 0);
  assert.equal(at60.settled.pitch, 0);
  assert.equal(at144.settled.yaw, 0);
  assert.equal(at144.settled.pitch, 0);
  assert.ok(Math.abs(at60.rotation.y - at60.baseYaw) < 0.001);
});

test('sway intensity, reduced motion and lifecycle clears leave no hidden viewmodel impulse', () => {
  const impulseAt = (intensity, reducedMotion = false) => {
    const look = new THREE.Vector2(0.08, -0.05);
    const player = {
      getLookDelta: (target) => target.copy(look),
      getViewBob: (target) => target.set(0, 0),
      setAiming() {},
    };
    const weapons = createWeapons(player);
    weapons.setEnabled(true);
    weapons.currentModel.userData.equipAmount = 0;
    weapons.currentModel.position.copy(weapons.currentModel.userData.basePosition);
    weapons.currentModel.rotation.set(0, weapons.currentModel.userData.baseYaw, 0);
    weapons.setSwayIntensity(intensity, reducedMotion);
    weapons.update(1 / 60, { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 });
    const state = weapons.getSwayState();
    const position = weapons.currentModel.position.clone();
    const base = weapons.currentModel.userData.basePosition.clone();
    return { weapons, look, state, position, base };
  };

  const full = impulseAt(1);
  const partial = impulseAt(0.4);
  const reduced = impulseAt(1, true);
  assert.ok(Math.abs(partial.state.yaw - full.state.yaw * 0.4) < 1e-12);
  assert.ok(Math.abs(partial.state.pitch - full.state.pitch * 0.4) < 1e-12);
  assert.equal(reduced.state.enabled, false);
  assert.equal(reduced.state.yaw, 0);
  assert.equal(reduced.state.pitch, 0);
  assert.ok(reduced.position.distanceTo(reduced.base) < 1e-12);

  full.weapons.clearViewmodelMotion();
  assert.equal(full.weapons.getSwayState().yaw, 0);
  assert.ok(full.weapons.currentModel.position.distanceTo(full.base) < 1e-12);
  full.look.set(0.08, -0.05);
  full.weapons.update(1 / 60, { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 });
  assert.notEqual(full.weapons.getSwayState().yaw, 0);
  full.weapons.switchTo(1);
  assert.equal(full.weapons.getSwayState().yaw, 0);
  full.weapons.setEnabled(false);
  assert.equal(full.weapons.getSwayState().yaw, 0);

  full.weapons.dispose();
  partial.weapons.dispose();
  reduced.weapons.dispose();
});

test('steady-state sway update reuses preallocated vectors', () => {
  const source = WeaponSystem.prototype.updateModelSway.toString();
  assert.doesNotMatch(source, /new\s+(?:THREE\.)?(?:Vector2|Vector3|Quaternion)\s*\(/);
  const weapons = createWeapons({
    getLookDelta: (target) => target.set(0, 0),
    getViewBob: (target) => target.set(0, 0),
    setAiming() {},
  });
  const lookTarget = weapons.tempLookDelta;
  const bobTarget = weapons.tempViewBob;
  for (let frame = 0; frame < 120; frame += 1) {
    weapons.updateModelSway(1 / 60);
    weapons.animateModel(1 / 60);
  }
  assert.equal(weapons.tempLookDelta, lookTarget);
  assert.equal(weapons.tempViewBob, bobTarget);
  weapons.dispose();
});

test('sliding tilts the complete weapon rig smoothly with FPS-stable intensity and ADS attenuation', () => {
  const sample = (fps, { intensity = 1, ads = 0 } = {}) => {
    const player = {
      isSliding: true,
      getLookDelta: (target) => target.set(0, 0),
      getViewBob: (target) => target.set(0, 0),
      setAiming() {},
    };
    const weapons = createWeapons(player);
    weapons.setEnabled(true);
    weapons.setSwayIntensity(1);
    weapons.setSlideTiltIntensity(intensity);
    weapons.adsAmount = ads;
    const model = weapons.currentModel;
    model.userData.equipAmount = 0;
    model.position.copy(model.userData.basePosition);
    model.rotation.set(0, model.userData.baseYaw, 0);
    const input = {
      wasPressed: () => false,
      isDown: (action) => ads > 0 && action === 'aim',
      consumeWheel: () => 0,
    };
    for (let frame = 0; frame < fps * 0.25; frame += 1) {
      weapons.update(1 / fps, input);
    }
    const state = weapons.getSlideTiltState();
    const livePosition = model.position.clone();
    const liveRotation = model.rotation.clone();
    weapons.animateModel(0, { snap: true });
    const position = model.position.clone();
    const rotation = model.rotation.clone();
    player.isSliding = false;
    for (let frame = 0; frame < fps * 0.25; frame += 1) weapons.update(1 / fps, input);
    const result = {
      state,
      exiting: weapons.getSlideTiltState(),
      livePosition,
      liveRotation,
      position,
      rotation,
      base: model.userData.basePosition.clone(),
      baseYaw: model.userData.baseYaw,
    };
    weapons.dispose();
    return result;
  };

  const at60 = sample(60);
  const at144 = sample(144);
  const partial = sample(60, { intensity: 0.4 });
  const ads = sample(60, { ads: 1 });
  assert.ok(at60.state.amount > 0 && at60.state.amount < 1);
  assert.ok(Math.abs(at60.state.amount - at144.state.amount) < 1e-12);
  assert.ok(Math.abs(at60.state.roll - at144.state.roll) < 1e-12);
  assert.ok(Math.abs(at60.exiting.amount - at144.exiting.amount) < 1e-12);
  assert.ok(Math.abs(at60.exiting.roll - at144.exiting.roll) < 1e-12);
  assert.ok(at60.livePosition.distanceTo(at144.livePosition) < 0.002);
  assert.ok(Math.abs(at60.liveRotation.z - at144.liveRotation.z) < 0.002);
  assert.ok(Math.abs(partial.state.roll - at60.state.roll * 0.4) < 1e-12);
  assert.ok(Math.abs(ads.state.roll) < Math.abs(at60.state.roll));
  assert.equal(Math.sign(ads.state.roll), Math.sign(at60.state.roll));

  assert.ok(at60.state.positionX < 0);
  assert.ok(at60.state.positionY < 0);
  assert.ok(at60.state.positionZ > 0);
  assert.ok(at60.state.yaw < 0);
  assert.ok(at60.state.roll < 0);
  assert.ok(at60.position.x < at60.base.x);
  assert.ok(at60.position.y < at60.base.y);
  assert.ok(at60.position.z > at60.base.z);
  assert.ok(at60.rotation.y < at60.baseYaw);
  assert.ok(at60.rotation.z < 0);
  assert.ok(Math.abs((at60.position.x - at60.base.x) - at60.state.positionX) < 1e-12);
  assert.ok(Math.abs((at60.position.y - at60.base.y) - at60.state.positionY) < 1e-12);
  assert.ok(Math.abs((at60.position.z - at60.base.z) - at60.state.positionZ) < 1e-12);
  assert.ok(Math.abs((at60.rotation.y - at60.baseYaw) - at60.state.yaw) < 1e-12);
  assert.ok(Math.abs(at60.rotation.z - at60.state.roll) < 1e-12);
});

test('slide viewmodel tilt polls the real slide state and clears on every lifecycle boundary', () => {
  const player = {
    isSliding: true,
    getLookDelta: (target) => target.set(0, 0),
    getViewBob: (target) => target.set(0, 0),
    setAiming() {},
  };
  const weapons = createWeapons(player);
  weapons.setEnabled(true);
  weapons.setSwayIntensity(1);
  weapons.setSlideTiltIntensity(1);
  weapons.currentModel.userData.equipAmount = 0;
  const enter = () => {
    player.isSliding = true;
    weapons.updateModelSlideTilt(1 / 60);
    assert.ok(weapons.getSlideTiltState().amount > 0);
  };

  for (let frame = 0; frame < 30; frame += 1) weapons.updateModelSlideTilt(1 / 60);
  player.isSliding = false; // jumping out of a slide emits no slideEnded event
  let previous = weapons.getSlideTiltState().amount;
  for (let frame = 0; frame < 120; frame += 1) {
    weapons.updateModelSlideTilt(1 / 60);
    const current = weapons.getSlideTiltState().amount;
    assert.ok(current >= 0 && current <= previous, 'viewmodel tilt must return without overshoot');
    previous = current;
  }
  weapons.animateModel(1 / 60, { snap: true });
  assert.equal(weapons.getSlideTiltState().amount, 0);
  assert.ok(weapons.currentModel.position.distanceTo(weapons.currentModel.userData.basePosition) < 1e-12);

  enter();
  weapons.clearViewmodelMotion();
  assert.equal(weapons.getSlideTiltState().amount, 0);
  enter();
  weapons.switchTo(1);
  assert.equal(weapons.getSlideTiltState().amount, 0);
  enter();
  weapons.setEnabled(false);
  assert.equal(weapons.getSlideTiltState().amount, 0);
  weapons.setEnabled(true);
  weapons.setSlideTiltIntensity(0);
  player.isSliding = true;
  weapons.updateModelSlideTilt(1 / 60);
  assert.deepEqual(weapons.getSlideTiltState(), {
    amount: 0,
    positionX: -0,
    positionY: -0,
    positionZ: 0,
    yaw: -0,
    roll: -0,
    intensity: 0,
    enabled: false,
  });
  weapons.setSlideTiltIntensity(1, true);
  assert.equal(weapons.getSlideTiltState().amount, 0);
  weapons.dispose();
});

test('jump, soft landing and hard landing create distinct bounded viewmodel air impulses', () => {
  const sample = (event, payload) => {
    const eventBus = new EventBus();
    const player = {
      getLookDelta: (target) => target.set(0, 0),
      getViewBob: (target) => target.set(0, 0),
      setAiming() {},
    };
    const weapons = createWeapons(player, { eventBus });
    weapons.setEnabled(true);
    weapons.setSwayIntensity(1);
    const model = weapons.currentModel;
    model.userData.equipAmount = 0;
    model.position.copy(model.userData.basePosition);
    model.rotation.set(0, model.userData.baseYaw, 0);
    eventBus.emit(event, payload);
    weapons.update(1 / 60, { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 });
    const result = {
      state: weapons.getAirMotionState(),
      position: model.position.clone(),
      base: model.userData.basePosition.clone(),
    };
    weapons.dispose();
    return result;
  };

  const jump = sample('player:jumped', { speed: 7.25 });
  const soft = sample('player:landed', { impact: 6, hard: false });
  const hard = sample('player:landed', { impact: 15, hard: true });
  for (const result of [jump, soft, hard]) {
    assert.ok(result.state.positionY < 0, 'air inertia should pull the complete rig downward');
    assert.ok(result.state.positionZ > 0, 'air inertia should lag the rig toward the camera');
    assert.ok(result.state.pitch < 0, 'air inertia should pitch the rig downward');
    assert.ok(result.position.y < result.base.y);
    assert.ok(result.position.z > result.base.z);
    assert.ok(result.state.positionY >= -0.085);
    assert.ok(result.state.positionZ <= 0.085 * 0.46);
    assert.ok(Math.abs(result.state.pitch) <= 0.085 * 0.62);
  }
  assert.ok(Math.abs(soft.state.offset) > Math.abs(jump.state.offset));
  assert.ok(Math.abs(hard.state.offset) > Math.abs(soft.state.offset));

  const eventBus = new EventBus();
  const capped = createWeapons({
    getLookDelta: (target) => target.set(0, 0),
    getViewBob: (target) => target.set(0, 0),
    setAiming() {},
  }, { eventBus });
  capped.setEnabled(true);
  capped.setSwayIntensity(1);
  for (let index = 0; index < 100; index += 1) {
    eventBus.emit('player:landed', { impact: 1000, hard: true });
    eventBus.emit('player:jumped', { speed: 1000 });
    capped.updateModelAirMotion(1 / 60);
  }
  assert.ok(capped.getAirMotionState().offset >= -0.085);
  assert.ok(Math.abs(capped.getAirMotionState().velocity) <= 2.4);
  capped.dispose();
});

test('viewmodel air spring is deterministic across frame rates and returns without overshoot', () => {
  const sample = (fps) => {
    const eventBus = new EventBus();
    const player = {
      getLookDelta: (target) => target.set(0, 0),
      getViewBob: (target) => target.set(0, 0),
      setAiming() {},
    };
    const weapons = createWeapons(player, { eventBus });
    weapons.setEnabled(true);
    weapons.setSwayIntensity(1);
    const model = weapons.currentModel;
    model.userData.equipAmount = 0;
    model.position.copy(model.userData.basePosition);
    model.rotation.set(0, model.userData.baseYaw, 0);
    const idle = { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 };
    eventBus.emit('player:landed', { impact: 15, hard: true });
    for (let frame = 0; frame < fps * 0.25; frame += 1) {
      weapons.update(1 / fps, idle);
      assert.ok(weapons.getAirMotionState().offset <= 0, 'critical return must not overshoot');
    }
    const quarterSecond = weapons.getAirMotionState();
    for (let frame = fps * 0.25; frame < fps * 2; frame += 1) weapons.update(1 / fps, idle);
    const result = {
      quarterSecond,
      settled: weapons.getAirMotionState(),
      position: model.position.clone(),
      base: model.userData.basePosition.clone(),
    };
    weapons.dispose();
    return result;
  };

  const at60 = sample(60);
  const at144 = sample(144);
  assert.ok(Math.abs(at60.quarterSecond.offset - at144.quarterSecond.offset) < 1e-9);
  assert.ok(Math.abs(at60.quarterSecond.velocity - at144.quarterSecond.velocity) < 1e-9);
  assert.equal(at60.settled.offset, 0);
  assert.equal(at60.settled.velocity, 0);
  assert.equal(at144.settled.offset, 0);
  assert.equal(at144.settled.velocity, 0);
  assert.ok(at60.position.distanceTo(at60.base) < 0.001);
  assert.ok(at144.position.distanceTo(at144.base) < 0.001);
});

test('air motion respects intensity, ADS, lifecycle clears and releases event listeners', () => {
  const impulseAt = (intensity, { ads = false, reducedMotion = false } = {}) => {
    const eventBus = new EventBus();
    const weapons = createWeapons({
      getLookDelta: (target) => target.set(0, 0),
      getViewBob: (target) => target.set(0, 0),
      setAiming() {},
    }, { eventBus });
    weapons.setEnabled(true);
    weapons.setSwayIntensity(intensity, reducedMotion);
    weapons.adsAmount = ads ? 1 : 0;
    eventBus.emit('player:jumped', { speed: 7.25 });
    return { eventBus, weapons, state: weapons.getAirMotionState() };
  };

  const full = impulseAt(1);
  const partial = impulseAt(0.4);
  const ads = impulseAt(1, { ads: true });
  const reduced = impulseAt(1, { reducedMotion: true });
  assert.ok(Math.abs(partial.state.velocity - full.state.velocity * 0.4) < 1e-12);
  assert.ok(Math.abs(ads.state.velocity) < Math.abs(full.state.velocity));
  assert.equal(reduced.state.enabled, false);
  assert.equal(reduced.state.offset, 0);
  assert.equal(reduced.state.velocity, 0);

  assert.equal(full.eventBus.listenerCount('player:jumped'), 1);
  assert.equal(full.eventBus.listenerCount('player:landed'), 1);
  full.weapons.clearViewmodelMotion();
  assert.equal(full.weapons.getAirMotionState().velocity, 0);
  full.eventBus.emit('player:landed', { impact: 2, hard: true });
  full.eventBus.emit('player:jumped', { speed: Number.POSITIVE_INFINITY });
  assert.equal(full.weapons.getAirMotionState().velocity, 0, 'micro and invalid events must be ignored');
  full.eventBus.emit('player:landed', { impact: 15, hard: true });
  assert.notEqual(full.weapons.getAirMotionState().velocity, 0);
  full.weapons.switchTo(1);
  assert.equal(full.weapons.getAirMotionState().velocity, 0);
  full.eventBus.emit('player:jumped', { speed: 7.25 });
  full.weapons.setEnabled(false);
  assert.equal(full.weapons.getAirMotionState().velocity, 0);
  full.eventBus.emit('player:landed', { impact: 24, hard: true });
  full.weapons.setEnabled(true);
  assert.equal(full.weapons.getAirMotionState().velocity, 0, 'disabled events must not replay later');
  full.weapons.dispose();
  assert.equal(full.eventBus.listenerCount('player:jumped'), 0);
  assert.equal(full.eventBus.listenerCount('player:landed'), 0);

  partial.weapons.dispose();
  ads.weapons.dispose();
  reduced.weapons.dispose();
});

test('viewmodel air-motion and slide-tilt updates use scalar state without constructor allocations', () => {
  for (const source of [
    WeaponSystem.prototype.updateModelAirMotion.toString(),
    WeaponSystem.prototype.updateModelSlideTilt.toString(),
  ]) {
    assert.doesNotMatch(source, /\bnew\s+/);
    assert.doesNotMatch(source, /(?:Vector2|Vector3|Quaternion)/);
  }
});

test('all five weapons expose distinct recoil impulses in the intended weight order', () => {
  const peaks = {};
  for (const id of WEAPON_ORDER) {
    const weapons = createWeapons(null, { random: () => 0.5 });
    const index = weapons.weaponOrder.indexOf(id);
    if (index > 0) weapons.switchTo(index);
    weapons.cooldown = 0;
    assert.equal(weapons.tryFire(false), true);
    peaks[id] = weapons.getRecoilState().modelKick;
    weapons.dispose();
  }

  assert.equal(new Set(Object.values(peaks)).size, WEAPON_ORDER.length);
  assert.ok(peaks.nova > peaks.rail);
  assert.ok(peaks.rail > peaks.scatter);
  assert.ok(peaks.scatter > peaks.carbine);
  assert.ok(peaks.carbine > peaks.plasma);
});

test('a long automatic burst stays capped and fully returns the model to rest', () => {
  const player = {
    getViewBob: () => ({ x: 0, y: 0 }),
    setAiming() {},
    getAimDirection: (target) => target.set(0, 0, -1),
    addRecoil() {},
  };
  const weapons = createWeapons(player, { random: () => 1 });
  const idle = { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 };
  weapons.setEnabled(true);
  weapons.setInfiniteAmmo(true);
  weapons.currentModel.userData.equipAmount = 0;
  for (let shot = 0; shot < 100; shot += 1) {
    weapons.cooldown = 0;
    assert.equal(weapons.tryFire(false), true);
  }
  const peak = weapons.getRecoilState();
  assert.equal(peak.modelKick, 2.2);
  assert.equal(peak.modelSide, 1.35);
  assert.equal(peak.modelRoll, -1);

  for (let frame = 0; frame < 180; frame += 1) weapons.update(1 / 60, idle);
  const model = weapons.currentModel;
  assert.ok(model.position.distanceTo(model.userData.basePosition) < 0.001);
  assert.ok(Math.abs(model.rotation.x) < 0.001);
  assert.ok(Math.abs(model.rotation.y - model.userData.baseYaw) < 0.001);
  assert.ok(Math.abs(model.rotation.z) < 0.001);
  for (const part of model.userData.motionParts) {
    assert.ok(part.mesh.position.distanceTo(part.basePosition) < 0.001);
  }
  weapons.dispose();
});

test('zero recoil intensity disables viewmodel motion without removing spread recovery', () => {
  const weapons = createWeapons(null, { random: () => 0.5 });
  weapons.setRecoilIntensity(0);
  assert.equal(weapons.tryFire(false), true);
  assert.deepEqual(weapons.getRecoilState(), {
    spread: 1,
    modelKick: 0,
    modelSide: 0,
    modelRoll: 0,
    intensity: 0,
  });
  weapons.dispose();
});

test('clearing recoil immediately recomposes the actual viewmodel pose', () => {
  const player = {
    getViewBob: () => ({ x: 0, y: 0 }),
    setAiming() {},
    getAimDirection: (target) => target.set(0, 0, -1),
    addRecoil() {},
  };
  const weapons = createWeapons(player, { random: () => 0.8 });
  const idle = { wasPressed: () => false, isDown: () => false, consumeWheel: () => 0 };
  weapons.setEnabled(true);
  const model = weapons.currentModel;
  model.userData.equipAmount = 0;
  model.position.copy(model.userData.basePosition);
  model.rotation.set(0, model.userData.baseYaw, 0);

  assert.equal(weapons.tryFire(false), true);
  weapons.update(1 / 60, idle);
  assert.ok(model.position.distanceTo(model.userData.basePosition) > 0.001);
  assert.ok(Math.abs(model.rotation.x) > 0.001);

  weapons.setRecoilIntensity(0);
  assert.ok(model.position.distanceTo(model.userData.basePosition) < 1e-12);
  assert.ok(Math.abs(model.rotation.x) < 1e-12);
  assert.ok(Math.abs(model.rotation.y - model.userData.baseYaw) < 1e-12);
  assert.ok(Math.abs(model.rotation.z) < 1e-12);
  for (const part of model.userData.motionParts) {
    assert.ok(part.mesh.position.distanceTo(part.basePosition) < 1e-12);
    assert.ok(part.mesh.quaternion.angleTo(part.baseQuaternion) < 1e-6);
  }

  weapons.update(0, idle);
  assert.ok(model.position.distanceTo(model.userData.basePosition) < 1e-12);
  weapons.dispose();
});

test('partial and reduced-motion intensity scale or suppress viewmodel recoil', () => {
  const impulseAt = (intensity, reducedMotion = false) => {
    const weapons = createWeapons(null, { random: () => 0.8 });
    weapons.setRecoilIntensity(intensity, reducedMotion);
    weapons.tryFire(false);
    const state = weapons.getRecoilState();
    weapons.dispose();
    return state;
  };

  const full = impulseAt(1);
  const partial = impulseAt(0.4);
  const reduced = impulseAt(1, true);
  assert.ok(Math.abs(partial.modelKick - full.modelKick * 0.4) < 1e-12);
  assert.ok(Math.abs(partial.modelSide - full.modelSide * 0.4) < 1e-12);
  assert.equal(reduced.modelKick, 0);
  assert.equal(reduced.modelSide, 0);
  assert.equal(reduced.modelRoll, 0);
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
