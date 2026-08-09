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
