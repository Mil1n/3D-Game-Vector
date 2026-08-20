import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { MAP_ORDER } from '../src/configs/mapConfigs.js';
import { PlayerController } from '../src/player/PlayerController.js';
import { Arena } from '../src/world/Arena.js';

const FIXED_STEP = 1 / 60;
const HELD_FORWARD_INPUT = {
  isDown: (action) => action === 'forward',
  wasPressed: () => false,
  getAxis: (negative, positive) => Number(positive === 'forward') - Number(negative === 'forward'),
  consumeLook: () => ({ x: 0, y: 0 }),
};

function createJumpHarness() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
  const ground = new CANNON.Body({
    mass: 0,
    position: new CANNON.Vec3(0, -0.5, 0),
    collisionFilterGroup: 2,
  });
  ground.addShape(new CANNON.Box(new CANNON.Vec3(20, 0.5, 20)));
  world.addBody(ground);

  const events = [];
  let stepNumber = 0;
  const player = new PlayerController({
    world,
    spawn: new THREE.Vector3(0, 1.05, 0),
    eventBus: {
      emit(type, payload) {
        if (type === 'player:jumped' || type === 'player:landed') {
          events.push({ type, payload, step: stepNumber });
        }
      },
    },
  });
  const input = {
    jumpHeld: false,
    jumpPressed: false,
    isDown(action) {
      return action === 'jump' && this.jumpHeld;
    },
    wasPressed(action) {
      return action === 'jump' && this.jumpPressed;
    },
    getAxis: () => 0,
    consumeLook: () => ({ x: 0, y: 0 }),
    pressJump() {
      this.jumpHeld = true;
      this.jumpPressed = true;
    },
    releaseJump() {
      this.jumpHeld = false;
      this.jumpPressed = false;
    },
  };

  const step = () => {
    player.fixedUpdate(input, FIXED_STEP);
    input.jumpPressed = false;
    world.step(FIXED_STEP);
    stepNumber += 1;
  };
  const settle = () => {
    for (let count = 0; count < 180 && !player.grounded; count += 1) step();
    assert.equal(player.grounded, true, 'jump harness should settle the player on its floor');
    for (let count = 0; count < 30; count += 1) step();
    assert.equal(player.grounded, true, 'jump harness should retain a stable floor contact');
    events.length = 0;
  };

  return { events, input, player, settle, step };
}

test('held forward movement is not cancelled by arena contact friction', () => {
  for (const mapId of MAP_ORDER) {
    const scene = new THREE.Scene();
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    world.defaultContactMaterial.friction = 0.08;
    world.defaultContactMaterial.restitution = 0;

    const arena = new Arena({ scene, mapId }).build(world);
    const camera = new THREE.PerspectiveCamera();
    const player = new PlayerController({
      world,
      camera,
      spawn: arena.getSafePlayerSpawn(),
    });
    const startZ = player.body.position.z;
    player.update(camera, FIXED_STEP);
    const startCameraZ = camera.position.z;

    for (let step = 0; step < 120; step += 1) {
      player.fixedUpdate(HELD_FORWARD_INPUT, FIXED_STEP);
      world.step(FIXED_STEP);
      player.update(camera, FIXED_STEP);
    }

    assert.ok(
      startZ - player.body.position.z > 8,
      `${mapId}: held W should move the player across the arena`,
    );
    assert.ok(player.horizontalSpeed > 5, `${mapId}: walking speed should survive the physics step`);
    assert.ok(
      startCameraZ - camera.position.z > 8,
      `${mapId}: the first-person camera should follow the moving physics body`,
    );
    assert.ok(
      Math.abs(camera.position.z - player.body.position.z) < 0.001,
      `${mapId}: camera and physics body should agree on forward position`,
    );
    assert.ok(player.body.position.y > -8, `${mapId}: the player should remain on arena geometry`);

    player.dispose();
    arena.dispose();
  }
});

test('Overdrive accelerates movement and disable or reset restores the exact baseline', () => {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
  const camera = new THREE.PerspectiveCamera();
  const spawn = new THREE.Vector3(0, 2, 0);
  const player = new PlayerController({ world, camera, spawn });

  const sampleForwardSpeed = () => {
    player.teleport(spawn);
    for (let step = 0; step < 120; step += 1) player.fixedUpdate(HELD_FORWARD_INPUT, FIXED_STEP);
    return player.horizontalSpeed;
  };

  const baseline = sampleForwardSpeed();
  const enabled = player.setOverdrive(true, { playerSpeedMultiplier: 1.5 });
  const boosted = sampleForwardSpeed();

  assert.deepEqual(enabled, { active: true, speedMultiplier: 1.5 });
  assert.equal(player.getState().overdrive, true);
  assert.ok(boosted > baseline, 'Overdrive must accelerate the player');
  assert.ok(Math.abs(boosted / baseline - 1.5) < 0.001);

  player.setOverdrive(true, { playerSpeedMultiplier: 1.5 });
  assert.ok(
    Math.abs(sampleForwardSpeed() - boosted) < 0.000001,
    'repeated activation must replace the runtime scale instead of accumulating it',
  );

  assert.deepEqual(player.setOverdrive(false), { active: false, speedMultiplier: 1 });
  assert.ok(Math.abs(sampleForwardSpeed() - baseline) < 0.000001);

  player.setOverdrive(true, { playerSpeedMultiplier: 1.8 });
  player.reset(spawn);
  assert.equal(player.getState().overdrive, false);
  assert.ok(Math.abs(sampleForwardSpeed() - baseline) < 0.000001);

  player.dispose();
});

test('held Space jumps immediately and repeats exactly once after each landing', () => {
  const harness = createJumpHarness();
  harness.settle();
  harness.input.pressJump();
  harness.step();

  assert.equal(harness.events.filter(({ type }) => type === 'player:jumped').length, 1);
  assert.ok(harness.player.body.velocity.y > 0, 'the initial held Space should launch the player');

  for (let count = 0; count < 10; count += 1) harness.step();
  assert.equal(
    harness.events.filter(({ type }) => type === 'player:jumped').length,
    1,
    'holding Space in the air must not emit extra jump events',
  );

  for (let count = 0; count < 240; count += 1) {
    harness.step();
    if (harness.events.filter(({ type }) => type === 'player:jumped').length === 3) break;
  }

  const jumpEvents = harness.events.filter(({ type }) => type === 'player:jumped');
  const landingEvents = harness.events.filter(({ type }) => type === 'player:landed');
  assert.equal(jumpEvents.length, 3, 'held Space should continue jumping after landings');
  assert.equal(landingEvents.length, 2, 'each repeated jump should have one preceding landing');
  assert.deepEqual(
    harness.events.map(({ type }) => type),
    [
      'player:jumped',
      'player:landed',
      'player:jumped',
      'player:landed',
      'player:jumped',
    ],
  );
  assert.ok(jumpEvents[1].step - jumpEvents[0].step > 20, 'the repeat must wait for a real landing');
  assert.ok(jumpEvents[2].step - jumpEvents[1].step > 20, 'only one jump is allowed per landing');

  harness.player.dispose();
});

test('releasing Space in the air stops the automatic jump on landing', () => {
  const harness = createJumpHarness();
  harness.settle();
  harness.input.pressJump();
  harness.step();
  for (let count = 0; count < 8; count += 1) harness.step();
  harness.input.releaseJump();
  for (let count = 0; count < 120; count += 1) harness.step();

  assert.equal(harness.events.filter(({ type }) => type === 'player:jumped').length, 1);
  assert.equal(harness.events.filter(({ type }) => type === 'player:landed').length, 1);
  assert.equal(harness.player.grounded, true, 'the player should remain grounded after Space is released');

  harness.player.dispose();
});
