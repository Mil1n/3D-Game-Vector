import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/Game.js';
import { GAME_STATES } from '../src/core/GameStateManager.js';

function createStartMatchHarness() {
  const input = {
    pausePressed: true,
    clearCalls: 0,
    clear() {
      this.clearCalls += 1;
      this.pausePressed = false;
    },
    requestPointerLock: async () => false,
    focusElement: () => true,
    wasPressed(action) {
      return action === 'pause' && this.pausePressed;
    },
    endFrame() {},
    isFallbackActive: true,
    isPointerLocked: false,
  };
  const state = {
    state: GAME_STATES.MAIN_MENU,
    transition(next) {
      this.state = next;
      return true;
    },
  };
  const noOp = () => {};
  const game = {
    disposed: false,
    input,
    state,
    pointerLockWarningShown: true,
    matchDifficulty: 'normal',
    matchTutorial: false,
    matchMapId: 'null-grid',
    timeScale: 1,
    physicsAccumulator: 0,
    adaptiveQualityReduced: false,
    lowFpsTime: 0,
    gameplayInput: { reset: noOp, beginStepBatch: noOp },
    audio: {
      stopAll: noOp,
      unlock: async () => false,
      startAmbience: noOp,
      startMusic: noOp,
    },
    settings: { get: (_path, fallback) => fallback },
    clearDebugVisuals: noOp,
    arena: {
      mapId: 'null-grid',
      reset: noOp,
      update: noOp,
      getSafePlayerSpawn: () => ({ x: 0, y: 1, z: 0 }),
      getMapInfo: () => ({ name: 'Нулевая решётка', description: '' }),
    },
    player: {
      position: { y: 1 },
      horizontalSpeed: 0,
      reset: noOp,
      fixedUpdate: noOp,
      setOverdrive: noOp,
    },
    effects: { reset: noOp, update: noOp },
    enemies: { reset: noOp, setDifficulty: noOp, update: noOp },
    weapons: { setEnabled: noOp, reset: noOp, update: noOp, setOverdrive: noOp },
    upgrades: { reset: noOp },
    momentum: {
      reset: noOp,
      activateOverdrive: () => false,
      getState: () => ({ momentum: 0, rank: 'D', overdrive: { ready: false, active: false, remaining: 0 } }),
      update: noOp,
      config: { overdrive: { duration: 8, effects: { worldTimeScale: 0.86 } } },
    },
    director: { reset: noOp, start: noOp, update: noOp },
    achievements: { beginRun: noOp },
    world: { step: noOp },
    ui: {
      showHUD: noOp,
      showInputActivation: noOp,
      hideInputActivation: noOp,
      showToast: noOp,
    },
    lastHud: {},
    tutorialStep: 0,
    tutorialMovement: 0,
    tutorialComplete: false,
  };
  game.setOverdriveEffects = Game.prototype.setOverdriveEffects;
  return { game, input, state };
}

function createGameplayHarness() {
  const calls = { player: [], weapons: [], enemies: [], director: [], arena: [], momentum: [], activations: 0 };
  const game = {
    input: { wasPressed: () => false, endFrame() {} },
    gameplayInput: {
      beginStepBatch() {},
      wasPressed(action) { return action === 'overdrive'; },
    },
    physicsAccumulator: 0,
    state: { state: GAME_STATES.PLAYING },
    player: {
      horizontalSpeed: 2,
      position: { y: 1 },
      fixedUpdate(_input, dt) { calls.player.push(dt); },
    },
    world: { step() {} },
    weapons: { update(dt) { calls.weapons.push(dt); } },
    enemies: { update(dt) { calls.enemies.push(dt); } },
    director: { update(dt) { calls.director.push(dt); } },
    effects: { update() {} },
    arena: { update(dt) { calls.arena.push(dt); } },
    momentum: {
      config: { overdrive: { effects: { worldTimeScale: 0.8 } } },
      getState: () => ({ overdrive: { active: true } }),
      activateOverdrive() { calls.activations += 1; return true; },
      update(dt) { calls.momentum.push(dt); },
    },
    matchTutorial: false,
    tutorialComplete: true,
  };
  return { game, calls };
}

test('starting a match clears stale Escape input before the first gameplay frame', async () => {
  const { game, input, state } = createStartMatchHarness();
  let paused = false;
  game.pause = () => { paused = true; };

  await Game.prototype.startMatch.call(game);
  Game.prototype.updateGameplay.call(game, 0);

  assert.equal(input.clearCalls, 1);
  assert.equal(input.pausePressed, false);
  assert.equal(state.state, GAME_STATES.PLAYING);
  assert.equal(paused, false);
});

test('Overdrive activates once and slows only the world-facing fixed-step systems', () => {
  const { game, calls } = createGameplayHarness();

  Game.prototype.updateGameplay.call(game, 1 / 60);

  assert.equal(calls.activations, 1);
  assert.equal(calls.player[0], 1 / 60);
  assert.equal(calls.weapons[0], 1 / 60);
  assert.equal(calls.momentum[0], 1 / 60);
  assert.equal(calls.enemies[0], (1 / 60) * 0.8);
  assert.equal(calls.director[0], (1 / 60) * 0.8);
  assert.equal(calls.arena[0], (1 / 60) * 0.8);
});

test('runtime failure explicitly ends Overdrive before stopping the frame loop', () => {
  const calls = [];
  const game = {
    running: true,
    raf: 7,
    momentum: {
      endOverdrive(reason) {
        calls.push(`end:${reason}`);
        game.setOverdriveEffects(false, {}, reason);
        return true;
      },
    },
    setOverdriveEffects(active, _effects, reason) { calls.push(`effects:${active}:${reason}`); },
    ui: { showError() { calls.push('error-ui'); } },
  };
  const previousCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => calls.push('cancel-raf');
  const previousConsoleError = console.error;
  console.error = () => {};
  try {
    Game.prototype.handleRuntimeError.call(game, new Error('test failure'));
  } finally {
    console.error = previousConsoleError;
    globalThis.cancelAnimationFrame = previousCancel;
  }

  assert.deepEqual(calls, ['end:runtime-error', 'effects:false:runtime-error', 'cancel-raf', 'error-ui']);
  assert.equal(game.running, false);
});

test('playing frame restores shake before the player pose and applies it after the audio listener', (t) => {
  const calls = [];
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 7;
  t.after(() => {
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  const game = {
    running: true,
    disposed: false,
    _frame() {},
    raf: 0,
    lastTimestamp: 1000,
    timeScale: 1,
    settings: { get: () => 0 },
    state: { state: GAME_STATES.PLAYING },
    cameraShake: {
      restoreCamera: () => calls.push('restore-shake'),
      update: () => calls.push('apply-shake'),
    },
    updateGameplay: () => calls.push('gameplay'),
    player: { update: () => calls.push('player-pose') },
    updateCameraFov: () => calls.push('fov'),
    updateAudioListener: () => calls.push('audio-listener'),
    updateDebug: () => calls.push('debug'),
    sceneManager: {
      camera: {},
      render: () => {
        calls.push('render');
        return { fps: 60 };
      },
    },
    updateAdaptiveQuality: () => calls.push('adaptive-quality'),
    handleRuntimeError: (error) => { throw error; },
  };

  Game.prototype.frame.call(game, 1000 + 1000 / 60);

  assert.deepEqual(calls, [
    'restore-shake',
    'gameplay',
    'player-pose',
    'fov',
    'audio-listener',
    'apply-shake',
    'debug',
    'render',
    'adaptive-quality',
  ]);
});

test('resetCameraPresentation clears both shake and dynamic FOV state', () => {
  const calls = [];
  const game = {
    cameraShake: { reset: () => calls.push('shake') },
    cameraFov: { reset: () => { calls.push('fov'); return 'fov-reset'; } },
  };

  const result = Game.prototype.resetCameraPresentation.call(game);

  assert.deepEqual(calls, ['shake', 'fov']);
  assert.equal(result, 'fov-reset');
});
