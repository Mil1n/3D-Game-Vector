import test from 'node:test';
import assert from 'node:assert/strict';

import { CameraFovController } from '../src/core/CameraFovController.js';
import { Game } from '../src/core/Game.js';
import { WEAPON_CONFIGS } from '../src/configs/weaponConfigs.js';

const FRAME = 1 / 60;

function closeTo(actual, expected, tolerance = 0.02, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message || `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function createHarness({ fov = 82, sprintFov = 97, cameraFov = 45 } = {}) {
  const camera = {
    fov: cameraFov,
    projectionUpdates: 0,
    updateProjectionMatrix() {
      this.projectionUpdates += 1;
    },
  };
  const controller = new CameraFovController({
    camera,
    settings: { gameplay: { fov, sprintFov } },
  });
  return { camera, controller };
}

function settle(controller, context, frames = 360) {
  for (let frame = 0; frame < frames; frame += 1) controller.update(FRAME, context);
}

test('dynamic FOV starts at the configured base and uses the configured sprint FOV', () => {
  const { camera, controller } = createHarness({ fov: 82, sprintFov: 97 });

  assert.equal(camera.fov, 82);
  assert.deepEqual(controller.getState(), {
    currentFov: 82,
    targetFov: 82,
    baseFov: 82,
    sprintFov: 97,
  });

  const projectionUpdatesBeforeSprint = camera.projectionUpdates;
  controller.update(FRAME, { sprinting: true, adsAmount: 0, adsFovMultiplier: 0.72 });
  assert.equal(controller.getState().targetFov, 97);
  assert.ok(camera.fov > 82 && camera.fov < 97);

  settle(controller, { sprinting: true, adsAmount: 0, adsFovMultiplier: 0.72 });
  closeTo(camera.fov, 97);
  assert.ok(camera.projectionUpdates > projectionUpdatesBeforeSprint);

  controller.dispose();
});

test('sprint never narrows the configured base FOV', () => {
  const { camera, controller } = createHarness({ fov: 100, sprintFov: 90 });

  controller.update(FRAME, { sprinting: true, adsAmount: 0, adsFovMultiplier: 1 });

  assert.equal(controller.getState().targetFov, 100);
  assert.equal(camera.fov, 100);
  controller.dispose();
});

test('weapon-specific ADS FOV blends continuously and takes priority over sprint', () => {
  const { camera, controller } = createHarness({ fov: 82, sprintFov: 98 });
  const railMultiplier = WEAPON_CONFIGS.rail.adsFovMultiplier;
  const scatterMultiplier = WEAPON_CONFIGS.scatter.adsFovMultiplier;
  const railTarget = 82 * railMultiplier;

  controller.update(FRAME, {
    sprinting: true,
    adsAmount: 0.5,
    adsFovMultiplier: railMultiplier,
  });
  closeTo(controller.getState().targetFov, (98 + railTarget) / 2, 0.000001);

  settle(controller, {
    sprinting: true,
    adsAmount: 1,
    adsFovMultiplier: railMultiplier,
  });
  closeTo(controller.getState().targetFov, railTarget, 0.000001);
  closeTo(camera.fov, railTarget);

  const beforeWeaponChange = camera.fov;
  controller.update(FRAME, {
    sprinting: true,
    adsAmount: 1,
    adsFovMultiplier: scatterMultiplier,
  });
  closeTo(controller.getState().targetFov, 82 * scatterMultiplier, 0.000001);
  assert.ok(camera.fov > beforeWeaponChange, 'switching ADS multiplier should move toward the new weapon FOV');

  controller.dispose();
});

test('dynamic FOV converges smoothly without overshoot and rejects non-finite state', () => {
  const { camera, controller } = createHarness({ fov: 80, sprintFov: 104 });
  let previous = camera.fov;

  for (let frame = 0; frame < 300; frame += 1) {
    controller.update(FRAME, { sprinting: true, adsAmount: 0, adsFovMultiplier: 1 });
    assert.ok(Number.isFinite(camera.fov), `frame ${frame} produced a non-finite FOV`);
    assert.ok(camera.fov >= previous, `frame ${frame} moved away from sprint FOV`);
    assert.ok(camera.fov <= 104, `frame ${frame} overshot sprint FOV`);
    previous = camera.fov;
  }
  closeTo(camera.fov, 104);

  for (const [dt, context] of [
    [Number.NaN, { sprinting: true, adsAmount: Number.NaN, adsFovMultiplier: Number.NaN }],
    [Number.POSITIVE_INFINITY, { sprinting: false, adsAmount: Number.POSITIVE_INFINITY, adsFovMultiplier: -4 }],
    [-1, { sprinting: true, adsAmount: -12, adsFovMultiplier: Number.POSITIVE_INFINITY }],
  ]) {
    controller.update(dt, context);
    const state = controller.getState();
    assert.ok(Number.isFinite(camera.fov));
    assert.ok(Number.isFinite(state.currentFov));
    assert.ok(Number.isFinite(state.targetFov));
  }

  controller.dispose();
});

test('settings changes retarget dynamic FOV and reset snaps back to the new base', () => {
  const { camera, controller } = createHarness({ fov: 82, sprintFov: 96 });
  settle(controller, { sprinting: true, adsAmount: 0, adsFovMultiplier: 1 });
  closeTo(camera.fov, 96);

  controller.applySettings(
    { gameplay: { fov: 90, sprintFov: 104 } },
    { immediate: false },
  );
  assert.equal(controller.getState().baseFov, 90);
  assert.equal(controller.getState().sprintFov, 104);
  const beforeRetarget = camera.fov;
  controller.update(FRAME, { sprinting: true, adsAmount: 0, adsFovMultiplier: 1 });
  assert.equal(controller.getState().targetFov, 104);
  assert.ok(camera.fov > beforeRetarget && camera.fov < 104);

  const projectionUpdatesBeforeReset = camera.projectionUpdates;
  controller.reset();
  assert.equal(camera.fov, 90);
  assert.deepEqual(controller.getState(), {
    currentFov: 90,
    targetFov: 90,
    baseFov: 90,
    sprintFov: 104,
  });
  assert.ok(camera.projectionUpdates > projectionUpdatesBeforeReset);

  controller.applySettings(
    { gameplay: { fov: 88, sprintFov: 101 } },
    { immediate: true },
  );
  assert.equal(camera.fov, 88);
  assert.deepEqual(controller.getState(), {
    currentFov: 88,
    targetFov: 88,
    baseFov: 88,
    sprintFov: 101,
  });

  controller.dispose();
});

test('Game maps live sprint and current weapon ADS state into the FOV controller', () => {
  const updates = [];
  const expectedResult = { targetFov: 59.04 };
  const game = {
    player: { isSprinting: true },
    weapons: {
      adsAmount: 0.75,
      currentConfig: WEAPON_CONFIGS.rail,
    },
    cameraFov: {
      update(deltaSeconds, context) {
        updates.push({ deltaSeconds, context });
        return expectedResult;
      },
    },
  };

  const result = Game.prototype.updateCameraFov.call(game, FRAME);

  assert.equal(result, expectedResult);
  assert.deepEqual(updates, [{
    deltaSeconds: FRAME,
    context: {
      sprinting: true,
      adsAmount: 0.75,
      adsFovMultiplier: WEAPON_CONFIGS.rail.adsFovMultiplier,
    },
  }]);
});

test('Game ignores stale sprint and ADS state after lifecycle input is cleared', () => {
  const updates = [];
  const game = {
    player: { isSprinting: true },
    gameplayInput: { isDown: () => false },
    weapons: {
      adsAmount: 1,
      currentConfig: WEAPON_CONFIGS.rail,
    },
    cameraFov: {
      update(deltaSeconds, context) {
        updates.push({ deltaSeconds, context: { ...context } });
        return context;
      },
    },
  };

  Game.prototype.updateCameraFov.call(game, FRAME);

  assert.deepEqual(updates, [{
    deltaSeconds: FRAME,
    context: {
      sprinting: false,
      adsAmount: 0,
      adsFovMultiplier: WEAPON_CONFIGS.rail.adsFovMultiplier,
    },
  }]);
});

test('dynamic FOV repairs an invalid camera projection and accepts null settings', () => {
  const { camera, controller } = createHarness({ fov: 82, sprintFov: 96 });
  camera.fov = Number.NaN;
  const projectionUpdates = camera.projectionUpdates;

  controller.applySettings(null, { immediate: false });
  controller.reset();

  assert.equal(camera.fov, 82);
  assert.ok(camera.projectionUpdates > projectionUpdates);
  controller.dispose();
});
