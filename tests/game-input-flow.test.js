import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/Game.js';
import { GAME_STATES } from '../src/core/GameStateManager.js';
import { HitStopController } from '../src/core/HitStopController.js';

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

test('frame composes debug time scale and hit-stop once while presentation systems keep real time', (t) => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 11;
  t.after(() => {
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });

  const observed = {};
  const game = {
    running: true,
    disposed: false,
    _frame() {},
    raf: 0,
    lastTimestamp: 1000,
    timeScale: 0.5,
    settings: { get: () => 0 },
    state: { state: GAME_STATES.PLAYING },
    hitStop: {
      update(dt) {
        observed.hitStopDelta = dt;
        return 0.2;
      },
    },
    gameplayInput: { consumeLook() { throw new Error('look input must remain buffered'); } },
    cameraShake: {
      restoreCamera() {},
      update(dt) { observed.shakeDelta = dt; },
    },
    updateGameplay(delta, options) { observed.gameplay = { delta, options }; },
    player: { update(_camera, dt) { observed.playerDelta = dt; } },
    updateCameraFov(dt) { observed.fovDelta = dt; },
    updateAudioListener() {},
    updateDebug(dt) { observed.debugDelta = dt; },
    sceneManager: {
      camera: {},
      render(dt) {
        observed.renderDelta = dt;
        return { fps: 60 };
      },
    },
    updateAdaptiveQuality(dt) { observed.adaptiveDelta = dt; },
    handleRuntimeError(error) { throw error; },
  };

  Game.prototype.frame.call(game, 1020);

  assert.ok(Math.abs(observed.hitStopDelta - 0.02) < 1e-12);
  assert.ok(Math.abs(observed.gameplay.delta - 0.002) < 1e-12);
  assert.deepEqual(observed.gameplay.options, { hitStopped: true });
  assert.ok(Math.abs(observed.playerDelta - 0.004) < 1e-12);
  assert.ok(Math.abs(observed.fovDelta - 0.004) < 1e-12);
  assert.equal(observed.shakeDelta, 0.02);
  assert.equal(observed.renderDelta, 0.02);
  assert.equal(observed.debugDelta, 0.02);
  assert.equal(observed.adaptiveDelta, 0.02);
  assert.equal(game.timeScale, 0.5);
});

test('a fully stopped frame clears fixed-step debt without consuming buffered actions', () => {
  let endedFrames = 0;
  const game = {
    input: { wasPressed: () => false, endFrame: () => { endedFrames += 1; } },
    physicsAccumulator: 1,
    player: { position: { y: 1 }, fixedUpdate() { throw new Error('simulation advanced'); } },
  };

  Game.prototype.updateGameplay.call(game, 0, { hitStopped: true });

  assert.equal(game.physicsAccumulator, 0);
  assert.equal(endedFrames, 0);
});

test('pause remains responsive during a full hit-stop frame', () => {
  const calls = [];
  const game = {
    input: {
      wasPressed: (action) => action === 'pause',
      endFrame: () => calls.push('end-frame'),
    },
    pause: (reason) => calls.push(`pause:${reason}`),
    physicsAccumulator: 0.04,
  };

  Game.prototype.updateGameplay.call(game, 0, { hitStopped: true });

  assert.deepEqual(calls, ['pause:manual', 'end-frame']);
});

test('Game.pause clears an active hit-stop and fixed-step debt through lifecycle wiring', () => {
  const calls = [];
  const hitStop = new HitStopController({ settings: { gameplay: { hitStop: 1 } } });
  hitStop.request(0.05, { shotId: 1 });
  const game = {
    state: {
      state: GAME_STATES.PLAYING,
      pause() {
        this.state = GAME_STATES.PAUSED;
        return true;
      },
    },
    physicsAccumulator: 0.04,
    hitStop,
    weapons: { clearInputBuffer: () => calls.push('weapon-input') },
    resetSimulationTiming: Game.prototype.resetSimulationTiming,
    input: {
      exitPointerLock: () => calls.push('pointer-lock'),
      clear: () => calls.push('input'),
    },
    ui: { showPause: () => calls.push('ui') },
    resetCameraPresentation: () => calls.push('presentation'),
    audio: { setVolume: () => calls.push('audio') },
    settings: { get: () => 0.8 },
  };

  assert.equal(Game.prototype.pause.call(game), true);
  assert.equal(game.state.state, GAME_STATES.PAUSED);
  assert.equal(game.physicsAccumulator, 0);
  assert.equal(hitStop.active, false);
  assert.equal(hitStop.getState().triggerCount, 0);
  assert.deepEqual(calls, ['weapon-input', 'pointer-lock', 'input', 'ui', 'presentation', 'audio']);
  hitStop.dispose();
});

test('upgrade selection clears a queued shot before gameplay resumes', () => {
  const weapons = {
    fireBufferRemaining: 0.08,
    firePressConsumed: true,
    triggerReleased: false,
    shotsFired: 0,
    clearInputBuffer() {
      this.fireBufferRemaining = 0;
      this.firePressConsumed = false;
      this.triggerReleased = true;
    },
    update() {
      if (this.fireBufferRemaining <= 0) return;
      this.shotsFired += 1;
      this.fireBufferRemaining = 0;
    },
  };
  const input = {
    wasPressed: () => false,
    endFrame() {},
    clear() {},
    exitPointerLock: async () => false,
    requestPointerLock: async () => false,
    focusElement: () => true,
    isFallbackActive: false,
    isPointerLocked: false,
  };
  const state = {
    state: GAME_STATES.PLAYING,
    transition(next) {
      this.state = next;
      return true;
    },
    is(expected) {
      return this.state === expected;
    },
  };
  const game = {
    state,
    input,
    gameplayInput: {
      beginStepBatch() {},
      wasPressed: () => false,
    },
    physicsAccumulator: 0.04,
    hitStop: { reset: () => true },
    weapons,
    resetSimulationTiming: Game.prototype.resetSimulationTiming,
    resetCameraPresentation() {},
    ui: {
      showUpgrade() {},
      showHUD() {},
      showInputActivation() {},
      hideInputActivation() {},
    },
    audio: { setVolume() {}, unlock: async () => true },
    settings: { get: (_path, fallback) => fallback },
    director: {
      selectUpgrade: () => true,
      update() {},
    },
    matchTutorial: false,
    tutorialComplete: true,
    player: {
      horizontalSpeed: 0,
      position: { y: 1 },
      fixedUpdate() {},
    },
    world: { step() {} },
    enemies: { update() {} },
    effects: { update() {} },
    arena: { update() {} },
    momentum: {
      getState: () => ({ overdrive: { active: false } }),
      update() {},
    },
  };

  Game.prototype.openUpgrade.call(game, [{ id: 'test-upgrade' }]);
  assert.equal(state.state, GAME_STATES.UPGRADE_SELECTION);
  assert.equal(game.physicsAccumulator, 0);
  assert.equal(weapons.fireBufferRemaining, 0);
  assert.equal(weapons.firePressConsumed, false);
  assert.equal(weapons.triggerReleased, true);

  assert.equal(Game.prototype.selectUpgrade.call(game, 'test-upgrade'), true);
  assert.equal(state.state, GAME_STATES.PLAYING);
  Game.prototype.updateGameplay.call(game, 1 / 60);
  assert.equal(weapons.shotsFired, 0);
});

test('an impact in the first low-FPS substep freezes exact debt and preserves only its playable tail', () => {
  const { game, calls } = createGameplayHarness();
  game.timeScale = 0.1;
  game.hitStop = new HitStopController({ settings: { gameplay: { hitStop: 1 } } });
  game.weapons.update = (dt) => {
    calls.weapons.push(dt);
    game.hitStop.request(0.01, { shotId: 1 });
  };

  Game.prototype.updateGameplay.call(game, (1 / 60) * 2);

  assert.equal(calls.player.length, 1);
  assert.equal(calls.weapons.length, 1);
  assert.equal(calls.enemies.length, 1);
  assert.equal(calls.director.length, 1);
  assert.equal(calls.arena.length, 1);
  assert.equal(calls.momentum.length, 1);
  assert.ok(Math.abs(game.physicsAccumulator - ((1 / 60) - 0.01 * game.timeScale)) < 1e-12);
  assert.equal(game.hitStop.active, false);
  game.hitStop.dispose();
});

test('a state transition inside a fixed step cannot leave negative simulation debt', () => {
  const { game } = createGameplayHarness();
  game.hitStop = { active: false };
  game.director.update = () => {
    game.physicsAccumulator = 0;
    game.state.state = GAME_STATES.UPGRADE_SELECTION;
  };

  Game.prototype.updateGameplay.call(game, 1 / 60);

  assert.equal(game.physicsAccumulator, 0);
});

test('resetSimulationTiming clears hit-stop, weapon input and accumulated simulation time', () => {
  let clearedWeaponInput = 0;
  const game = {
    physicsAccumulator: 0.07,
    timeScale: 0.4,
    hitStop: { reset: () => 'reset' },
    weapons: { clearInputBuffer: () => { clearedWeaponInput += 1; } },
  };

  assert.equal(Game.prototype.resetSimulationTiming.call(game), 'reset');
  assert.equal(game.physicsAccumulator, 0);
  assert.equal(clearedWeaponInput, 1);
  assert.equal(game.timeScale, 0.4);
});

test('resetCameraPresentation clears shake, recoil, slide tilt, viewmodel motion and dynamic FOV state', () => {
  const calls = [];
  const game = {
    cameraShake: { reset: () => calls.push('shake') },
    player: {
      resetRecoil: () => calls.push('camera-recoil'),
      resetSlideTilt: () => calls.push('camera-slide'),
    },
    weapons: { clearViewmodelMotion: () => calls.push('viewmodel-motion') },
    cameraFov: { reset: () => { calls.push('fov'); return 'fov-reset'; } },
  };

  const result = Game.prototype.resetCameraPresentation.call(game);

  assert.deepEqual(calls, ['shake', 'camera-recoil', 'camera-slide', 'viewmodel-motion', 'fov']);
  assert.equal(result, 'fov-reset');
});

test('applySettings sends recoil, sway, slide tilt and hit-stop accessibility settings to their owners', (t) => {
  const calls = [];
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { style: { setProperty() {} } } };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const settings = {
    gameplay: {
      weaponRecoil: 0.4,
      weaponSway: 0.55,
      slideTilt: 0.65,
      hitStop: 0.6,
      enemyHitReaction: 0.75,
      headBob: 0.6,
      crosshairColor: '#67f7e3',
    },
    accessibility: { reducedMotion: true, uiScale: 1 },
    controls: { bindings: {}, mouseSensitivity: 0.55, invertY: false },
    audio: { muted: false },
  };
  const game = {
    sceneManager: { applySettings() {} },
    cameraFov: { applySettings() {} },
    cameraShake: { applySettings() {} },
    hitStop: { applySettings: (value) => calls.push(['hit-stop', value.gameplay.hitStop, value.accessibility.reducedMotion]) },
    enemies: { setHitReactionIntensity: (...args) => calls.push(['enemies', ...args]) },
    player: {
      setRecoilIntensity: (...args) => calls.push(['player', ...args]),
      setSlideTiltIntensity: (...args) => calls.push(['player-slide', ...args]),
      setHeadBobEnabled() {},
    },
    weapons: {
      setRecoilIntensity: (...args) => calls.push(['weapons', ...args]),
      setSwayIntensity: (...args) => calls.push(['sway', ...args]),
      setSlideTiltIntensity: (...args) => calls.push(['weapon-slide', ...args]),
    },
    input: { setBindings() {}, setMouseOptions() {} },
    audio: { setVolumes() {}, setMuted() {} },
  };

  Game.prototype.applySettings.call(game, settings);

  assert.deepEqual(calls, [
    ['hit-stop', 0.6, true],
    ['enemies', 0.75, true],
    ['player', 0.4, true],
    ['weapons', 0.4, true],
    ['sway', 0.55, true],
    ['player-slide', 0.65, true],
    ['weapon-slide', 0.65, true],
  ]);
});
