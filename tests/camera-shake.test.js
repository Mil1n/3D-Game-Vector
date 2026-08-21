import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CameraShakeController } from '../src/core/CameraShakeController.js';
import { EventBus } from '../src/core/EventBus.js';

const FRAME = 1 / 60;
const ENABLED_SETTINGS = Object.freeze({
  gameplay: { cameraShake: 1 },
  accessibility: { reducedMotion: false },
});

function closeTo(actual, expected, tolerance = 1e-9, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message || `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function assertCameraTransform(camera, expected) {
  closeTo(camera.position.x, expected.position.x);
  closeTo(camera.position.y, expected.position.y);
  closeTo(camera.position.z, expected.position.z);
  closeTo(camera.rotation.x, expected.rotation.x);
  closeTo(camera.rotation.y, expected.rotation.y);
  closeTo(camera.rotation.z, expected.rotation.z);
}

function snapshotCamera(camera) {
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
  };
}

function createHarness({ settings = ENABLED_SETTINGS, playerPosition = new THREE.Vector3() } = {}) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(5, 3, -2);
  camera.rotation.set(0.2, -0.35, 0.08, 'YXZ');
  const eventBus = new EventBus();
  let positionReads = 0;
  const controller = new CameraShakeController({
    camera,
    eventBus,
    settings,
    positionProvider: () => {
      positionReads += 1;
      return playerPosition;
    },
  });
  return {
    camera,
    controller,
    eventBus,
    get positionReads() {
      return positionReads;
    },
  };
}

function offsetMagnitude(state) {
  const { pitch, yaw, roll, x, y } = state.offset;
  return Math.abs(pitch) + Math.abs(yaw) + Math.abs(roll) + Math.abs(x) + Math.abs(y);
}

test('damage events add a bounded impulse that scales with received damage', () => {
  const harness = createHarness();

  assert.deepEqual(harness.controller.getState(), {
    trauma: 0,
    intensity: 1,
    enabled: true,
    offset: { pitch: 0, yaw: 0, roll: 0, x: 0, y: 0 },
  });

  harness.eventBus.emit('player:damaged', { amount: 12 });
  const lightTrauma = harness.controller.getState().trauma;
  assert.ok(lightTrauma > 0 && lightTrauma <= 1);

  harness.controller.reset();
  harness.eventBus.emit('player:damaged', { amount: 60 });
  const heavyTrauma = harness.controller.getState().trauma;
  assert.ok(heavyTrauma > lightTrauma, 'heavier damage should produce a stronger camera impulse');
  assert.ok(heavyTrauma <= 1, 'stacked shake trauma must remain bounded');

  for (let hit = 0; hit < 20; hit += 1) harness.eventBus.emit('player:damaged', { amount: 1000 });
  assert.equal(harness.controller.getState().trauma, 1);

  harness.controller.dispose();
});

test('nearby explosion shake uses player distance and ignores explosions outside its effective range', () => {
  const playerPosition = new THREE.Vector3(0, 1, 0);
  const harness = createHarness({ playerPosition });

  harness.eventBus.emit('effects:explosion', {
    position: new THREE.Vector3(20, 1, 0),
    radius: 2,
  });
  assert.equal(harness.controller.getState().trauma, 0, 'radius 2 should not shake from 20 units away');

  harness.eventBus.emit('effects:explosion', {
    position: new THREE.Vector3(3, 1, 0),
    radius: 2,
  });
  assert.ok(harness.controller.getState().trauma > 0, 'radius 2 has an effective range of 6 units');
  assert.equal(harness.positionReads, 2, 'proximity should be sampled once per explosion event');

  const readsBeforeFrames = harness.positionReads;
  for (let frame = 0; frame < 120; frame += 1) {
    harness.controller.restoreCamera();
    harness.controller.update(FRAME);
  }
  assert.equal(
    harness.positionReads,
    readsBeforeFrames,
    'the hot update path must not perform redundant world-position queries',
  );

  harness.controller.dispose();
});

test('restoreCamera removes the previous frame offset before a new player transform is applied', () => {
  const harness = createHarness();
  const firstBase = snapshotCamera(harness.camera);
  harness.controller.impulse(0.8);
  harness.controller.update(FRAME);

  assert.ok(offsetMagnitude(harness.controller.getState()) > 0);
  assert.notDeepEqual(snapshotCamera(harness.camera), firstBase);

  harness.controller.restoreCamera();
  assertCameraTransform(harness.camera, firstBase);

  harness.camera.position.set(-4, 7, 11);
  harness.camera.rotation.set(-0.15, 0.6, -0.04, 'YXZ');
  const nextPlayerBase = snapshotCamera(harness.camera);
  harness.controller.update(FRAME);
  assert.notDeepEqual(snapshotCamera(harness.camera), nextPlayerBase);

  harness.controller.restoreCamera();
  assertCameraTransform(harness.camera, nextPlayerBase);
  harness.controller.dispose();
});

test('shake damping is deterministic and frame-rate independent', () => {
  const sixtyFps = createHarness();
  const oneTwentyFps = createHarness();
  sixtyFps.controller.impulse(0.9);
  oneTwentyFps.controller.impulse(0.9);
  const initialTrauma = sixtyFps.controller.getState().trauma;

  for (let frame = 0; frame < 60; frame += 1) {
    sixtyFps.controller.restoreCamera();
    sixtyFps.controller.update(1 / 60);
  }
  for (let frame = 0; frame < 120; frame += 1) {
    oneTwentyFps.controller.restoreCamera();
    oneTwentyFps.controller.update(1 / 120);
  }

  const sixtyState = sixtyFps.controller.getState();
  const oneTwentyState = oneTwentyFps.controller.getState();
  assert.ok(sixtyState.trauma < initialTrauma, 'trauma should decay over time');
  closeTo(sixtyState.trauma, oneTwentyState.trauma, 1e-6);

  const deterministicA = createHarness();
  const deterministicB = createHarness();
  deterministicA.controller.impulse(0.72);
  deterministicB.controller.impulse(0.72);
  for (const dt of [1 / 60, 1 / 47, 1 / 120, 0.035, 1 / 60]) {
    deterministicA.controller.restoreCamera();
    deterministicB.controller.restoreCamera();
    deterministicA.controller.update(dt);
    deterministicB.controller.update(dt);
    assert.deepEqual(deterministicA.controller.getState(), deterministicB.controller.getState());
    assertCameraTransform(deterministicA.camera, snapshotCamera(deterministicB.camera));
  }

  sixtyFps.controller.dispose();
  oneTwentyFps.controller.dispose();
  deterministicA.controller.dispose();
  deterministicB.controller.dispose();
});

test('cameraShake intensity and reducedMotion can fully disable and safely re-enable shake', () => {
  const harness = createHarness();
  const base = snapshotCamera(harness.camera);
  harness.eventBus.emit('player:damaged', { amount: 50 });
  harness.controller.update(FRAME);
  assert.notDeepEqual(snapshotCamera(harness.camera), base);

  harness.controller.applySettings({
    gameplay: { cameraShake: 0 },
    accessibility: { reducedMotion: false },
  });
  assertCameraTransform(harness.camera, base);
  assert.deepEqual(harness.controller.getState(), {
    trauma: 0,
    intensity: 0,
    enabled: false,
    offset: { pitch: 0, yaw: 0, roll: 0, x: 0, y: 0 },
  });
  harness.eventBus.emit('player:damaged', { amount: 100 });
  harness.controller.update(FRAME);
  assertCameraTransform(harness.camera, base);

  harness.controller.applySettings({
    gameplay: { cameraShake: 1 },
    accessibility: { reducedMotion: true },
  });
  assert.equal(harness.controller.getState().enabled, false);
  harness.eventBus.emit('effects:explosion', { position: new THREE.Vector3(), radius: 10 });
  assert.equal(harness.controller.getState().trauma, 0);

  harness.controller.applySettings(ENABLED_SETTINGS);
  harness.eventBus.emit('player:damaged', { amount: 30 });
  harness.controller.update(FRAME);
  assert.equal(harness.controller.getState().enabled, true);
  assert.ok(offsetMagnitude(harness.controller.getState()) > 0);

  harness.controller.dispose();
});

test('reset and dispose restore the camera and release all event listeners', () => {
  const harness = createHarness();
  const base = snapshotCamera(harness.camera);
  assert.equal(harness.eventBus.listenerCount('player:damaged'), 1);
  assert.equal(harness.eventBus.listenerCount('effects:explosion'), 1);

  harness.controller.impulse(1);
  harness.controller.update(FRAME);
  harness.controller.reset();
  assertCameraTransform(harness.camera, base);
  assert.equal(harness.controller.getState().trauma, 0);
  assert.equal(offsetMagnitude(harness.controller.getState()), 0);

  harness.eventBus.emit('player:damaged', { amount: 40 });
  harness.controller.update(FRAME);
  assert.notDeepEqual(snapshotCamera(harness.camera), base);
  harness.controller.dispose();
  assertCameraTransform(harness.camera, base);
  assert.equal(harness.eventBus.listenerCount('player:damaged'), 0);
  assert.equal(harness.eventBus.listenerCount('effects:explosion'), 0);

  const stateAfterDispose = harness.controller.getState();
  harness.eventBus.emit('player:damaged', { amount: 100 });
  harness.controller.update(FRAME);
  assert.deepEqual(harness.controller.getState(), stateAfterDispose);
  assertCameraTransform(harness.camera, base);
});

test('the per-frame update path declares no constructor allocations', () => {
  const source = CameraShakeController.prototype.update.toString();
  assert.doesNotMatch(source, /\bnew\s+/, 'update() must reuse controller-owned scratch state');
});
