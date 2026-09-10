import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { EventBus } from '../src/core/EventBus.js';
import { GAME_CONFIG } from '../src/configs/gameConfig.js';
import { MAP_CONFIGS, MAP_ORDER } from '../src/configs/mapConfigs.js';
import { PlayerController } from '../src/player/PlayerController.js';
import { Arena } from '../src/world/Arena.js';
import { TraversalPadSystem } from '../src/world/TraversalPadSystem.js';

const STEP = 1 / 60;
const IDLE_INPUT = Object.freeze({
  isDown: () => false,
  wasPressed: () => false,
  getAxis: () => 0,
  consumeLook: () => ({ x: 0, y: 0 }),
});

function playerOn(device) {
  return device.position.clone().add(new THREE.Vector3(0, 1, 0));
}

function playerOutside(device) {
  const distance = device.radius ?? Math.max(device.width, device.length);
  return device.position.clone().add(new THREE.Vector3(distance + 2, 1, distance + 2));
}

function simulateLaunch(mapId, { along = 0, side = 0 } = {}) {
  const scene = new THREE.Scene();
  const world = new CANNON.World({ gravity: new CANNON.Vec3(...GAME_CONFIG.physics.gravity) });
  world.solver.iterations = GAME_CONFIG.physics.solverIterations;
  const arena = new Arena({ scene, mapId });
  arena.build(world);
  const eventBus = new EventBus();
  const padConfig = MAP_CONFIGS[mapId].traversal.launchPads[0];
  const direction = new THREE.Vector3().fromArray(padConfig.direction).setY(0).normalize();
  const sideDirection = new THREE.Vector3(-direction.z, 0, direction.x);
  const start = new THREE.Vector3().fromArray(padConfig.position)
    .addScaledVector(direction, padConfig.radius * along)
    .addScaledVector(sideDirection, padConfig.radius * side)
    .add(new THREE.Vector3(0, 1, 0));
  const player = new PlayerController({
    world,
    eventBus,
    spawn: start,
    config: GAME_CONFIG.player,
  });
  const traversal = new TraversalPadSystem({ scene, eventBus, map: mapId });
  let activationCount = 0;
  let launchSeen = false;
  let peakY = player.body.position.y;
  eventBus.on('arena:traversal-activated', (effect) => {
    activationCount += 1;
    player.applyTraversalBoost(effect);
  });

  for (let frame = 0; frame < 30; frame += 1) {
    player.fixedUpdate(IDLE_INPUT, STEP);
    world.step(STEP);
  }

  let settledFrames = 0;
  for (let frame = 0; frame < 600; frame += 1) {
    player.fixedUpdate(IDLE_INPUT, STEP);
    world.step(STEP);
    traversal.update(STEP, player.position);
    peakY = Math.max(peakY, player.body.position.y);
    launchSeen ||= player.body.velocity.y > 2;
    if (launchSeen && player.grounded && player.horizontalSpeed < 0.08) settledFrames += 1;
    else settledFrames = 0;
    if (settledFrames >= 12) break;
  }

  const target = new THREE.Vector3().fromArray(padConfig.landingTarget.position);
  const result = {
    activationCount,
    launchSeen,
    peakY,
    startY: start.y,
    settledFrames,
    position: player.position.clone(),
    target,
    targetRadius: padConfig.landingTarget.radius,
    horizontalDistance: Math.hypot(
      player.body.position.x - target.x,
      player.body.position.z - target.z,
    ),
  };
  traversal.dispose();
  player.dispose();
  arena.dispose();
  return result;
}

function simulateBooster(mapId, { along = 0, side = 0, coverShift = false } = {}) {
  const scene = new THREE.Scene();
  const world = new CANNON.World({ gravity: new CANNON.Vec3(...GAME_CONFIG.physics.gravity) });
  world.solver.iterations = GAME_CONFIG.physics.solverIterations;
  const arena = new Arena({ scene, mapId });
  arena.build(world);
  if (coverShift) arena.applyShift('cover');
  const eventBus = new EventBus();
  const padConfig = MAP_CONFIGS[mapId].traversal.speedBoosters[0];
  const direction = new THREE.Vector3().fromArray(padConfig.direction).setY(0).normalize();
  const sideDirection = new THREE.Vector3(-direction.z, 0, direction.x);
  const start = new THREE.Vector3().fromArray(padConfig.position)
    .addScaledVector(direction, padConfig.size[1] * 0.5 * along)
    .addScaledVector(sideDirection, padConfig.size[0] * 0.5 * side)
    .add(new THREE.Vector3(0, 1, 0));
  const player = new PlayerController({
    world,
    eventBus,
    spawn: start,
    config: GAME_CONFIG.player,
  });
  const traversal = new TraversalPadSystem({ scene, eventBus, map: mapId });
  let activationCount = 0;
  eventBus.on('arena:traversal-activated', (effect) => {
    activationCount += 1;
    player.applyTraversalBoost(effect);
  });

  for (let frame = 0; frame < 30; frame += 1) {
    player.fixedUpdate(IDLE_INPUT, STEP);
    world.step(STEP);
  }
  const activatedFrom = player.position.clone();

  let settledFrames = 0;
  for (let frame = 0; frame < 360; frame += 1) {
    player.fixedUpdate(IDLE_INPUT, STEP);
    world.step(STEP);
    traversal.update(STEP, player.position);
    if (activationCount > 0 && player.grounded && player.horizontalSpeed < 0.08) settledFrames += 1;
    else settledFrames = 0;
    if (settledFrames >= 12) break;
  }

  const position = player.position.clone();
  const displacement = position.clone().sub(activatedFrom);
  const surfaceY = arena.getSurfaceHeight(position, {
    currentY: position.y,
    above: 1.5,
    below: 2,
  });
  const result = {
    activationCount,
    settledFrames,
    position,
    directedDistance: displacement.dot(direction),
    lateralDistance: Math.abs(displacement.dot(sideDirection)),
    surfaceY,
  };
  traversal.dispose();
  player.dispose();
  arena.dispose();
  return result;
}

function staysInsideMap(map, position, margin = 1) {
  if (map.foundation.shape === 'box') {
    return Math.abs(position.x) <= map.foundation.size[0] * 0.5 - margin
      && Math.abs(position.z) <= map.foundation.size[2] * 0.5 - margin;
  }
  const innerBoundary = map.foundation.boundary.radius - map.foundation.boundary.size[2] * 0.5;
  return Math.hypot(position.x, position.z) <= innerBoundary - margin;
}

test('every map builds distinct procedural launch and boost devices', () => {
  const scene = new THREE.Scene();
  const system = new TraversalPadSystem({ scene, map: MAP_ORDER[0] });

  for (const mapId of MAP_ORDER) {
    system.setMap(mapId);
    const expected = MAP_CONFIGS[mapId].traversal.launchPads.length
      + MAP_CONFIGS[mapId].traversal.speedBoosters.length;
    const debug = system.getDebugData();
    assert.equal(system.mapId, mapId);
    assert.equal(system.devices.length, expected);
    assert.equal(debug.deviceCount, expected);
    assert.deepEqual(new Set(debug.devices.map(({ type }) => type)), new Set(['launch', 'boost']));
    assert.equal(system.group.children.length, expected);
    for (const device of system.devices) {
      assert.equal(device.visual.userData.traversalDevice.id, device.id);
      assert.equal(device.visual.userData.traversalDevice.type, device.type);
      assert.ok(device.visual.getObjectByName(device.type === 'launch' ? 'LAUNCH_BASE' : 'BOOST_BASE'));
      if (device.type === 'launch') assert.ok(device.visual.getObjectByName('LAUNCH_ARROW'));
      else assert.equal(device.arrows.length, 3);
    }
  }

  system.dispose();
  assert.equal(scene.children.includes(system.group), false);
  assert.equal(system.devices.length, 0);
});

test('traversal devices fire once per entry and require both exit and cooldown to rearm', () => {
  const eventBus = new EventBus();
  const events = [];
  eventBus.on('arena:traversal-activated', (event) => events.push(event));
  const system = new TraversalPadSystem({ scene: new THREE.Scene(), eventBus, map: 'null-grid' });
  const launch = system.devices.find(({ type }) => type === 'launch');
  const inside = playerOn(launch);
  const outside = playerOutside(launch);

  assert.equal(system.update(STEP, inside), 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, launch.id);
  assert.equal(events[0].type, 'launch');
  assert.ok(events[0].position.equals(launch.position));
  assert.ok(events[0].direction.equals(launch.direction));

  for (let frame = 0; frame < 90; frame += 1) system.update(STEP, inside);
  assert.equal(events.length, 1, 'remaining inside must never retrigger after cooldown');

  system.reset();
  system.update(STEP, inside);
  system.update(0.1, outside);
  system.update(0.1, inside);
  assert.equal(events.length, 2, 'a quick re-entry during cooldown must be rejected');
  for (let frame = 0; frame < 60; frame += 1) system.update(STEP, inside);
  assert.equal(events.length, 2, 'cooldown expiry while occupied must not retrigger');
  system.update(STEP, outside);
  system.update(STEP, inside);
  assert.equal(events.length, 3, 'a fresh entry after cooldown should activate again');

  system.dispose();
});

test('reset and map changes clear traversal runtime state', () => {
  const eventBus = new EventBus();
  let activations = 0;
  eventBus.on('arena:traversal-activated', () => { activations += 1; });
  const system = new TraversalPadSystem({ scene: new THREE.Scene(), eventBus, map: 'null-grid' });
  const first = system.devices[0];
  system.update(STEP, playerOn(first));
  assert.equal(activations, 1);
  assert.ok(first.cooldownRemaining > 0);
  assert.equal(first.occupied, true);

  system.reset();
  assert.equal(first.cooldownRemaining, 0);
  assert.equal(first.occupied, false);
  system.update(STEP, playerOn(first));
  assert.equal(activations, 2, 'a restarted run should reactivate pads immediately');

  system.setMap('sky-foundry');
  assert.ok(system.devices.every(({ cooldownRemaining, occupied }) => cooldownRemaining === 0 && !occupied));
  const replacement = system.devices[0];
  assert.notEqual(replacement.id, first.id);
  system.update(STEP, playerOn(replacement));
  assert.equal(activations, 3);
  system.dispose();
});

test('horizontal booster trigger uses its oriented width and length', () => {
  const system = new TraversalPadSystem({ scene: new THREE.Scene(), map: 'sky-foundry' });
  const booster = system.devices.find(({ type }) => type === 'boost');
  const along = booster.position.clone().addScaledVector(booster.direction, booster.length * 0.45);
  along.y += 1;
  const sideDirection = new THREE.Vector3(-booster.direction.z, 0, booster.direction.x);
  const beside = booster.position.clone().addScaledVector(sideDirection, booster.width * 0.6);
  beside.y += 1;

  assert.equal(system.update(STEP, along), 1);
  system.reset();
  assert.equal(system.update(STEP, beside), 0);
  system.dispose();
});

test('every traversal arrow points along its authored world-space direction', () => {
  const system = new TraversalPadSystem({ scene: new THREE.Scene(), map: MAP_ORDER[0] });
  const localArrowAxis = new THREE.Vector3(0, 1, 0);
  const worldQuaternion = new THREE.Quaternion();
  const worldDirection = new THREE.Vector3();

  for (const mapId of MAP_ORDER) {
    system.setMap(mapId);
    system.group.updateMatrixWorld(true);
    for (const device of system.devices) {
      const arrows = device.type === 'launch' ? [device.arrow] : device.arrows;
      for (const arrow of arrows) {
        arrow.getWorldQuaternion(worldQuaternion);
        worldDirection.copy(localArrowAxis).applyQuaternion(worldQuaternion).setY(0).normalize();
        assert.ok(
          worldDirection.distanceTo(device.direction) < 1e-7,
          `${mapId}/${device.id}: visual arrow must match the gameplay direction`,
        );
      }
    }
  }

  system.dispose();
});

test('reduced motion clears animated traversal poses immediately and keeps activations static', () => {
  const system = new TraversalPadSystem({ scene: new THREE.Scene(), map: 'null-grid' });
  const launch = system.devices.find(({ type }) => type === 'launch');
  const booster = system.devices.find(({ type }) => type === 'boost');

  system.update(0.2, null);
  assert.notEqual(launch.arrow.rotation.y, 0);
  assert.notEqual(launch.arrow.position.y, 0.72);
  assert.ok(booster.arrows.some((arrow) => arrow.position.y !== arrow.userData.baseY));

  assert.equal(system.setReducedMotion(true), true);
  assert.equal(launch.arrow.rotation.y, 0);
  assert.equal(launch.arrow.position.y, 0.72);
  assert.equal(launch.ring.scale.x, launch.radius * 0.7);
  assert.ok(booster.arrows.every((arrow) => arrow.position.y === arrow.userData.baseY));

  system.update(STEP, playerOn(launch));
  const staticPose = {
    rotation: launch.arrow.rotation.y,
    arrowY: launch.arrow.position.y,
    ringScale: launch.ring.scale.x,
  };
  for (let frame = 0; frame < 45; frame += 1) system.update(STEP, playerOn(launch));
  assert.deepEqual({
    rotation: launch.arrow.rotation.y,
    arrowY: launch.arrow.position.y,
    ringScale: launch.ring.scale.x,
  }, staticPose);

  system.update(STEP, playerOn(booster));
  const boosterPose = booster.arrows.map((arrow) => arrow.position.y);
  for (let frame = 0; frame < 45; frame += 1) system.update(STEP, playerOn(booster));
  assert.deepEqual(
    booster.arrows.map((arrow) => arrow.position.y),
    boosterPose,
    'booster activation must not animate with reduced motion enabled',
  );

  assert.equal(system.setReducedMotion(false), false);
  system.update(STEP, null);
  assert.notEqual(launch.arrow.rotation.y, 0, 'live re-enable must resume animation');
  system.dispose();
});

test('every launch pad carries the real player onto its declared route and settles there', () => {
  const entries = [
    ['back edge', { along: -0.75 }],
    ['center', {}],
    ['front edge', { along: 0.75 }],
    ['left edge', { side: -0.65 }],
    ['right edge', { side: 0.65 }],
  ];
  for (const mapId of MAP_ORDER) {
    for (const [entryName, entry] of entries) {
      const result = simulateLaunch(mapId, entry);
      const label = `${mapId}/${entryName}`;
      assert.equal(result.activationCount, 1, `${label}: launch should activate exactly once`);
      assert.equal(result.launchSeen, true, `${label}: player must become airborne`);
      assert.ok(result.peakY > result.startY + 2, `${label}: launch must have a visible arc`);
      assert.ok(result.settledFrames >= 12, `${label}: player must finish grounded and stopped`);
      assert.ok(
        result.horizontalDistance <= result.targetRadius,
        `${label}: settled ${result.horizontalDistance.toFixed(2)}m from landing target`,
      );
      assert.ok(
        Math.abs(result.position.y - result.target.y) < 0.2,
        `${label}: expected route height ${result.target.y}, got ${result.position.y.toFixed(2)}`,
      );
    }
  }
});

test('every speed booster has a clear lane from its center and four entry edges', () => {
  const entries = [
    ['back edge', { along: -0.75 }],
    ['center', {}],
    ['front edge', { along: 0.75 }],
    ['left edge', { side: -0.65 }],
    ['right edge', { side: 0.65 }],
  ];
  const layouts = [
    ...MAP_ORDER.map((mapId) => ({ mapId, coverShift: false })),
    { mapId: 'sky-foundry', coverShift: true },
  ];
  for (const { mapId, coverShift } of layouts) {
    for (const [entryName, entry] of entries) {
      const result = simulateBooster(mapId, { ...entry, coverShift });
      const label = `${mapId}${coverShift ? '/shifted-cover' : ''}/${entryName}`;
      assert.equal(result.activationCount, 1, `${label}: booster should activate exactly once`);
      assert.ok(result.settledFrames >= 12, `${label}: player must finish grounded and stopped`);
      assert.ok(result.directedDistance >= 6, `${label}: lane blocked after ${result.directedDistance.toFixed(2)}m`);
      assert.ok(result.lateralDistance < 2.5, `${label}: collision deflected player sideways`);
      assert.ok(staysInsideMap(MAP_CONFIGS[mapId], result.position), `${label}: boost left the arena`);
      assert.ok(Number.isFinite(result.surfaceY), `${label}: boost must end on a physical surface`);
      assert.ok(
        Math.abs(result.position.y - (result.surfaceY + GAME_CONFIG.player.height * 0.5)) < 0.2,
        `${label}: player must settle on top of the route`,
      );
    }
  }
});
