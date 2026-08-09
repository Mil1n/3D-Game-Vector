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
      reset: noOp,
      fixedUpdate: noOp,
    },
    effects: { reset: noOp, update: noOp },
    enemies: { reset: noOp, setDifficulty: noOp, update: noOp },
    weapons: { setEnabled: noOp, reset: noOp, update: noOp },
    upgrades: { reset: noOp },
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
  return { game, input, state };
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
