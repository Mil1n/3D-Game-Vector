import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { PlayerController } from '../src/player/PlayerController.js';

const FRAME = 1 / 60;
const IDLE_INPUT = Object.freeze({
  isDown: () => false,
  wasPressed: () => false,
  getAxis: () => 0,
  consumeLook: () => ({ x: 0, y: 0 }),
});

function createHarness() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  const camera = new THREE.PerspectiveCamera();
  const player = new PlayerController({ world, camera, spawn: new THREE.Vector3(0, 2, 0) });
  player.update(camera, FRAME);
  return { camera, player };
}

function settle(player, seconds = 2, fps = 60) {
  for (let frame = 0; frame < seconds * fps; frame += 1) {
    player.fixedUpdate(IDLE_INPUT, 1 / fps);
  }
}

test('weapon recoil offsets the rendered aim without mutating the player look', () => {
  const { camera, player } = createHarness();
  player.setLook(0.3, 0.12);
  assert.equal(player.addRecoil(0.08, -0.025, 8), true);
  player.update(camera, 0);

  assert.equal(player.pitch, 0.12);
  assert.equal(player.yaw, 0.3);
  assert.ok(camera.rotation.x > player.pitch, 'positive pitch recoil should kick the view upward');
  assert.ok(camera.rotation.y < player.yaw, 'signed yaw recoil should be preserved');

  const direction = player.getAimDirection(new THREE.Vector3());
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);
  assert.ok(direction.distanceTo(cameraDirection) < 1e-9, 'ballistics and the visible reticle must agree');
  player.dispose();
});

test('recoil recovery is bounded, monotonic and fixed-step independent', () => {
  const sixty = createHarness();
  const oneTwenty = createHarness();
  for (let shot = 0; shot < 1000; shot += 1) {
    sixty.player.addRecoil(1, shot % 2 ? 1 : -1, 7);
  }
  const capped = sixty.player.getRecoilState();
  assert.ok(capped.pitch <= 0.22);
  assert.ok(Math.abs(capped.yaw) <= 0.1);

  sixty.player.resetRecoil();
  sixty.player.addRecoil(0.12, 0.04, 7);
  oneTwenty.player.addRecoil(0.12, 0.04, 7);
  let previous = sixty.player.getRecoilState().pitch;
  for (let frame = 0; frame < 60; frame += 1) {
    sixty.player.fixedUpdate(IDLE_INPUT, 1 / 60);
    sixty.player.update(sixty.camera, 1 / 60);
    const current = sixty.player.getRecoilState().pitch;
    assert.ok(current <= previous, 'recoil must return without overshoot');
    previous = current;
  }
  for (let frame = 0; frame < 120; frame += 1) {
    oneTwenty.player.fixedUpdate(IDLE_INPUT, 1 / 120);
    oneTwenty.player.update(oneTwenty.camera, 1 / 120);
  }

  const at60 = sixty.player.getRecoilState();
  const at120 = oneTwenty.player.getRecoilState();
  assert.ok(Math.abs(at60.pitch - at120.pitch) < 1e-9);
  assert.ok(Math.abs(at60.yaw - at120.yaw) < 1e-9);
  settle(sixty.player, 2);
  sixty.player.update(sixty.camera, 0);
  assert.equal(sixty.player.getRecoilState().pitch, 0);
  assert.equal(sixty.player.getRecoilState().yaw, 0);
  const settledPitch = sixty.camera.rotation.x;
  const settledYaw = sixty.camera.rotation.y;
  for (let frame = 0; frame < 1000; frame += 1) {
    sixty.player.fixedUpdate(IDLE_INPUT, FRAME);
    sixty.player.update(sixty.camera, FRAME);
  }
  assert.equal(sixty.camera.rotation.x, settledPitch, 'idle frames must not accumulate pitch drift');
  assert.equal(sixty.camera.rotation.y, settledYaw, 'idle frames must not accumulate yaw drift');
  sixty.player.dispose();
  oneTwenty.player.dispose();
});

test('mouse input changes the base look while recoil returns around the new aim', () => {
  const { camera, player } = createHarness();
  player.addRecoil(0.1, 0.03, 6);
  player.fixedUpdate({
    ...IDLE_INPUT,
    consumeLook: () => ({ x: 40, y: -24 }),
  }, FRAME);
  const correctedYaw = player.yaw;
  const correctedPitch = player.pitch;

  settle(player, 3);
  player.update(camera, 0);
  assert.equal(player.yaw, correctedYaw, 'recovery must not erase horizontal mouse correction');
  assert.equal(player.pitch, correctedPitch, 'recovery must not erase vertical mouse correction');
  assert.ok(Math.abs(camera.rotation.y - correctedYaw) < 1e-9);
  assert.ok(Math.abs(camera.rotation.x - correctedPitch) < 1e-9);
  player.dispose();
});

test('applied mouse look is exposed once per fixed step without a second input read', () => {
  const { player } = createHarness();
  let lookReads = 0;
  const beforeYaw = player.yaw;
  const beforePitch = player.pitch;
  player.fixedUpdate({
    ...IDLE_INPUT,
    consumeLook() {
      lookReads += 1;
      return { x: 40, y: -24 };
    },
  }, FRAME);

  const target = new THREE.Vector2();
  const delta = player.getLookDelta(target);
  assert.equal(lookReads, 1);
  assert.equal(delta, target, 'the caller-provided target must be reused');
  assert.ok(Math.abs(delta.x - (player.yaw - beforeYaw)) < 1e-12);
  assert.ok(Math.abs(delta.y - (player.pitch - beforePitch)) < 1e-12);

  player.fixedUpdate(IDLE_INPUT, FRAME);
  assert.equal(player.getLookDelta(target).lengthSq(), 0);

  player.setLook(0, player.config.maxPitch - 0.001);
  const pitchBeforeClamp = player.pitch;
  player.fixedUpdate({
    ...IDLE_INPUT,
    consumeLook: () => ({ x: 0, y: -10000 }),
  }, FRAME);
  assert.equal(player.pitch, player.config.maxPitch);
  assert.ok(Math.abs(player.getLookDelta(target).y - (player.config.maxPitch - pitchBeforeClamp)) < 1e-12);
  player.dispose();
});

test('recoil settings, setLook, reset and dispose clear active offsets without replay', () => {
  const { camera, player } = createHarness();
  player.addRecoil(0.1, 0.04, 8);
  player.update(camera, 0);
  player.setRecoilIntensity(0);
  assert.equal(camera.rotation.x, player.pitch);
  assert.deepEqual(player.getRecoilState(), {
    pitch: 0,
    yaw: 0,
    recovery: 12,
    intensity: 0,
    enabled: false,
  });
  assert.equal(player.addRecoil(0.2, 0.1, 2), false);

  player.setRecoilIntensity(1);
  player.addRecoil(0.06, -0.02, 9);
  player.setLook(-0.4, 0.2);
  assert.equal(player.getRecoilState().pitch, 0);
  player.addRecoil(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN);
  assert.equal(player.getRecoilState().pitch, 0);

  player.setLook(0.25, 0.14);
  player.addRecoil(0.05, 0.01, 9);
  player.update(camera, 0);
  player.resetRecoil();
  assert.ok(Math.abs(camera.rotation.x - 0.14) < 1e-12);
  assert.ok(Math.abs(camera.rotation.y - 0.25) < 1e-12);
  player.addRecoil(0.05, 0.01, 9);
  player.update(camera, 0);
  player.reset();
  player.update(camera, 0);
  assert.equal(player.getRecoilState().pitch, 0);
  assert.equal(camera.rotation.x, 0);
  assert.equal(camera.rotation.y, 0);

  player.setLook(0.25, 0.14);
  player.addRecoil(0.05, 0.01, 9);
  player.update(camera, 0);
  player.dispose();
  assert.ok(Math.abs(camera.rotation.x - 0.14) < 1e-12);
  assert.ok(Math.abs(camera.rotation.y - 0.25) < 1e-12);
  assert.equal(player.getRecoilState().pitch, 0);
  assert.equal(player.addRecoil(0.1, 0.1, 9), false);
});

test('partial intensity scales recoil and reduced motion suppresses it', () => {
  const full = createHarness();
  const partial = createHarness();
  const reduced = createHarness();
  partial.player.setRecoilIntensity(0.4);
  reduced.player.setRecoilIntensity(1, true);

  full.player.addRecoil(0.1, -0.05, 8);
  partial.player.addRecoil(0.1, -0.05, 8);
  assert.equal(reduced.player.addRecoil(0.1, -0.05, 8), false);
  assert.ok(Math.abs(partial.player.getRecoilState().pitch - full.player.getRecoilState().pitch * 0.4) < 1e-12);
  assert.ok(Math.abs(partial.player.getRecoilState().yaw - full.player.getRecoilState().yaw * 0.4) < 1e-12);
  assert.equal(reduced.player.getRecoilState().pitch, 0);

  full.player.dispose();
  partial.player.dispose();
  reduced.player.dispose();
});

test('the fixed-step recoil recovery path performs no constructor allocations', () => {
  const source = PlayerController.prototype._recoverRecoil.toString();
  assert.doesNotMatch(source, /\bnew\s+/, '_recoverRecoil() must operate on scalar state only');
});
