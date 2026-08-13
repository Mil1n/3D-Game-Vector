import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GAME_CONFIG } from '../src/configs/gameConfig.js';
import { PHASES, RunDirector } from '../src/systems/RunDirector.js';

const idleInput = { isDown: () => false };

function createHarness({ choices = [], runConfig = GAME_CONFIG.run, random = () => 0.9, momentumSystem = null } = {}) {
  const events = [];
  const spawned = [];
  const shifts = [];
  const eventBus = {
    on: () => () => {},
    emit: (name, payload) => {
      events.push({ name, payload });
    },
  };
  const player = {
    position: new THREE.Vector3(),
    health: 100,
    maxHealth: 100,
    armor: 25,
    heal() {},
    setAnomaly() {},
    getDashState: () => ({ progress: 1 }),
  };
  const weaponState = {
    ammo: 30,
    reserve: 120,
    magazine: 30,
    name: 'Test weapon',
    id: 'test',
    reload: false,
    reloadProgress: 0,
  };
  const weaponSystem = {
    modifiers: {},
    shotsFired: 0,
    shotsHit: 0,
    addAmmo() {},
    getAccuracy: () => 0,
    getState: () => ({ ...weaponState }),
  };
  const enemySystem = {
    activeCount: 0,
    eliteAlive: false,
    spawn(type, position) {
      spawned.push({ type, position: position?.clone?.() ?? null });
      this.activeCount += 1;
      if (type === 'warden') this.eliteAlive = true;
    },
    spawnPickup() {},
    damageInRadius: () => 0,
  };
  const upgradeSystem = {
    applied: [],
    rollChoices: () => choices,
    apply(id) {
      this.applied.push(id);
      return true;
    },
    getActive: () => [],
    onKill: () => 0,
  };
  const arena = {
    objectivePoints: Array.from({ length: 5 }, (_, index) => new THREE.Vector3(index * 3, 0, index * -2)),
    beginShift(id) {
      shifts.push({ action: 'begin', id });
    },
    applyShift(id) {
      shifts.push({ action: 'apply', id });
      return true;
    },
  };
  const scene = new THREE.Scene();
  const director = new RunDirector({
    scene,
    eventBus,
    arena,
    player,
    weaponSystem,
    enemySystem,
    effects: { spawnShiftPulse() {}, spawnExplosion() {} },
    audioManager: { playUI() {}, playEnvironment() {} },
    upgradeSystem,
    momentumSystem,
    random,
    runConfig,
  });

  return { director, enemySystem, events, spawned, shifts, upgradeSystem, weaponState };
}

function createMomentumStub({ state = {}, stats = {} } = {}) {
  const actions = [];
  const currentState = {
    momentum: 0,
    rank: 'D',
    bestRank: 'D',
    multiplier: 1,
    scoreMultiplier: 1,
    xpMultiplier: 1,
    styleScore: 0,
    overdrive: { ready: false, active: false, remaining: 0 },
    ...state,
  };
  return {
    actions,
    state: currentState,
    recordAction(action, context) {
      actions.push({ action, context });
      return { action, accepted: true };
    },
    getState: () => ({ ...currentState, overdrive: { ...currentState.overdrive } }),
    getStats: () => ({
      bestRank: currentState.bestRank,
      peakMomentum: currentState.momentum,
      styleScore: currentState.styleScore,
      overdriveActivations: 0,
      overdriveTime: 0,
      ...stats,
    }),
  };
}

test('periodic HUD refresh publishes the currently selected weapon', (t) => {
  const harness = createHarness();
  const { director, events, weaponState } = harness;
  t.after(() => director.dispose());
  director.start();
  events.length = 0;

  Object.assign(weaponState, { id: 'plasma', name: 'PX-7 Поток', ammo: 48, reserve: 288, magazine: 48 });
  director.update(0.081, idleInput);

  const hud = events.filter((event) => event.name === 'director:hud').at(-1)?.payload;
  assert.equal(hud?.weaponId, 'plasma');
  assert.equal(hud?.weapon, 'PX-7 Поток');
  assert.equal(hud?.ammo, 48);
});

test('Momentum multipliers replace combo reward scaling while combo tracking remains intact', (t) => {
  const momentumSystem = createMomentumStub({
    state: { momentum: 82, rank: 'SS', multiplier: 2.5, scoreMultiplier: 2.5, xpMultiplier: 1.4 },
  });
  const { director } = createHarness({ momentumSystem });
  t.after(() => director.dispose());
  director.start();

  director.onEnemyKilled({ type: 'trooper', score: 100 });
  director.onEnemyKilled({ type: 'trooper', score: 100 });

  assert.equal(director.combo, 2);
  assert.equal(director.stats.bestCombo, 2);
  assert.equal(director.stats.score, 500, 'the second kill must not multiply Momentum by the old combo bonus');
  assert.equal(director.stats.experience, 50);
});

test('objective completion records style before applying current Momentum rewards', (t) => {
  const momentumSystem = createMomentumStub();
  momentumSystem.recordAction = (action, context) => {
    momentumSystem.actions.push({ action, context });
    Object.assign(momentumSystem.state, {
      momentum: 60,
      rank: 'S',
      multiplier: 2,
      scoreMultiplier: 2,
      xpMultiplier: 1.5,
    });
    return { action, accepted: true };
  };
  const { director, events } = createHarness({ momentumSystem });
  t.after(() => director.dispose());
  director.start();
  director.forceCompleteObjective();

  assert.deepEqual(momentumSystem.actions, [{
    action: 'challengeComplete',
    context: { objective: 'activate', phase: PHASES.RECON },
  }]);
  assert.equal(director.stats.score, 800);
  assert.equal(director.stats.experience, 96);
  const completion = events.find(({ name }) => name === 'director:objective-complete')?.payload;
  assert.equal(completion?.reward, 400, 'the existing event reward keeps its base-value contract');
  assert.equal(completion?.scoreReward, 800);
  assert.equal(completion?.experienceReward, 96);
});

test('HUD and results expose canonical Momentum and Overdrive state', (t) => {
  const momentumSystem = createMomentumStub({
    state: {
      momentum: 73,
      rank: 'S',
      bestRank: 'SS',
      multiplier: 2,
      scoreMultiplier: 2,
      xpMultiplier: 1.28,
      styleScore: 4321,
      lastAction: 'AIR SUPERIORITY',
      overdrive: { ready: false, active: true, remaining: 6.4 },
    },
    stats: {
      bestRank: 'SS',
      peakMomentum: 100,
      styleScore: 4321,
      overdriveActivations: 2,
      overdriveTime: 13.75,
    },
  });
  const { director, events } = createHarness({ momentumSystem });
  t.after(() => director.dispose());
  director.start();

  const hud = events.filter(({ name }) => name === 'director:hud').at(-1)?.payload;
  assert.equal(hud?.momentum.momentum, 73);
  assert.equal(hud?.momentum.rank, 'S');
  assert.equal(hud?.momentum.styleScore, 4321);
  assert.deepEqual(hud?.overdrive, { ready: false, active: true, remaining: 6.4 });

  const results = director.getStats();
  assert.equal(results.bestStyleRank, 'SS');
  assert.equal(results.peakMomentum, 100);
  assert.equal(results.styleScore, 4321);
  assert.equal(results.overdriveActivations, 2);
  assert.equal(results.overdriveTime, 13.75);
});

test('RunDirector keeps neutral rewards and canonical defaults without MomentumSystem', (t) => {
  const { director, events } = createHarness();
  t.after(() => director.dispose());
  director.start();
  director.onEnemyKilled({ type: 'trooper', score: 125 });

  assert.equal(director.stats.score, 125);
  assert.equal(director.stats.experience, 18);
  const hud = events.filter(({ name }) => name === 'director:hud').at(-1)?.payload;
  assert.equal(hud?.momentum.momentum, 0);
  assert.equal(hud?.momentum.rank, 'D');
  assert.deepEqual(hud?.overdrive, { ready: false, active: false, remaining: 0 });
  assert.deepEqual(
    Object.fromEntries(Object.entries(director.getStats()).filter(([key]) => [
      'bestStyleRank', 'peakMomentum', 'styleScore', 'overdriveActivations', 'overdriveTime',
    ].includes(key))),
    {
      bestStyleRank: 'D',
      peakMomentum: 0,
      styleScore: 0,
      overdriveActivations: 0,
      overdriveTime: 0,
    },
  );
});

test('early objectives become spawning survive interludes and respect every phase gate', (t) => {
  const harness = createHarness();
  const { director, spawned } = harness;
  t.after(() => director.dispose());

  assert.equal(director.getPhaseStart(PHASES.ESCALATION), 70);
  assert.equal(director.getPhaseStart(PHASES.SHIFT), 160);
  assert.equal(director.getPhaseStart(PHASES.HUNT), 240);
  assert.equal(director.getPhaseStart(PHASES.FINAL), 340);

  director.start();
  director.forceCompleteObjective();
  assert.equal(director.phase, PHASES.RECON);
  assert.equal(director.objective.type, 'survive');
  assert.equal(director.objective.nextPhase, PHASES.ESCALATION);
  assert.match(director.objective.detail, /70 с/);

  const initialSpawns = spawned.length;
  director.spawnTimer = 0;
  director.update(1, idleInput);
  assert.ok(spawned.length > initialSpawns, 'survive interlude must keep spawning enemies');
  assert.ok(director.objective.progress > 0 && director.objective.progress < 1);

  director.matchTime = 69.9;
  director.update(0.09, idleInput);
  assert.equal(director.phase, PHASES.RECON);
  director.update(0.01, idleInput);
  assert.equal(director.phase, PHASES.ESCALATION);
  assert.equal(director.objective.type, 'hold');

  director.forceCompleteObjective();
  assert.equal(director.phase, PHASES.ESCALATION);
  assert.equal(director.objective.type, 'survive');
  assert.equal(director.objective.nextPhase, PHASES.SHIFT);

  director.matchTime = 159.9;
  assert.ok(director.getShiftCountdown() > 0 && director.getShiftCountdown() < 1);
  director.update(0.09, idleInput);
  assert.equal(director.phase, PHASES.ESCALATION);
  assert.equal(director.shift, null);
  director.update(0.01, idleInput);
  assert.equal(director.phase, PHASES.SHIFT);
  assert.equal(director.shift.required, true);

  director.update(5, idleInput);
  director.update(1.25, idleInput);
  assert.equal(director.phase, PHASES.SHIFT);
  assert.equal(director.objective.type, 'survive');
  assert.equal(director.objective.nextPhase, PHASES.HUNT);
  assert.equal(spawned.some(({ type }) => type === 'warden'), false);

  director.matchTime = 239.9;
  director.update(0.09, idleInput);
  assert.equal(spawned.some(({ type }) => type === 'warden'), false);
  director.update(0.01, idleInput);
  assert.equal(director.phase, PHASES.HUNT);
  assert.equal(director.objective.type, 'boss');
  assert.equal(director.getShiftCountdown(), null);
  assert.equal(spawned.filter(({ type }) => type === 'warden').length, 1);

  director.forceCompleteObjective();
  assert.equal(director.phase, PHASES.HUNT);
  assert.equal(director.objective.type, 'survive');
  assert.equal(director.objective.nextPhase, PHASES.FINAL);
  director.matchTime = 339.9;
  director.update(0.09, idleInput);
  assert.equal(director.phase, PHASES.HUNT);
  director.update(0.02, idleInput);
  assert.equal(director.phase, PHASES.FINAL);
  assert.equal(director.objective.type, 'extract');
  assert.ok(director.nextAmbientShift > director.matchTime);
  assert.ok(director.getShiftCountdown() > 0);
  director.update(1, idleInput);
  assert.equal(director.shift, null, 'final must not replay overdue ambient shifts');
});

test('late objective completion advances immediately instead of adding an interlude', (t) => {
  const { director } = createHarness();
  t.after(() => director.dispose());

  director.start();
  director.matchTime = 75;
  director.forceCompleteObjective();
  assert.equal(director.phase, PHASES.ESCALATION);
  assert.equal(director.objective.type, 'hold');

  director.matchTime = 170;
  director.forceCompleteObjective();
  assert.equal(director.phase, PHASES.SHIFT);
  assert.equal(director.shift.required, true);

  director.matchTime = 250;
  director.update(5, idleInput);
  director.update(1.25, idleInput);
  assert.equal(director.phase, PHASES.HUNT);
  assert.equal(director.objective.type, 'boss');

  director.matchTime = 350;
  director.forceCompleteObjective();
  assert.equal(director.phase, PHASES.FINAL);
  assert.equal(director.objective.type, 'extract');
});

test('an ambient shift crossing the required gate is promoted and cannot strand progression', (t) => {
  const { director, spawned } = createHarness();
  t.after(() => director.dispose());

  director.start();
  director.forceCompleteObjective();
  director.forceCompleteObjective();
  assert.equal(director.matchTime, 70);
  assert.equal(director.phase, PHASES.ESCALATION);
  director.forceCompleteObjective();
  assert.equal(director.objective.nextPhase, PHASES.SHIFT);

  director.matchTime = 158;
  director.beginRealityShift(false);
  assert.equal(director.shift.required, false);
  director.update(2, idleInput);
  assert.equal(director.phase, PHASES.SHIFT);
  assert.equal(director.shift.required, true);

  director.update(3, idleInput);
  director.update(1.25, idleInput);
  assert.equal(director.objective.type, 'survive');
  assert.equal(director.objective.nextPhase, PHASES.HUNT);
  director.forceCompleteObjective();
  assert.equal(director.phase, PHASES.HUNT);
  assert.equal(spawned.filter(({ type }) => type === 'warden').length, 1);
});

test('upgrade selection pauses match time and resumes the queued gate afterwards', (t) => {
  const runConfig = {
    ...GAME_CONFIG.run,
    maxDurationSeconds: 10,
    phases: [
      { id: 'recon', start: 0 },
      { id: 'escalation', start: 2 },
      { id: 'shift', start: 4 },
      { id: 'hunt', start: 6 },
      { id: 'finale', start: 8 },
    ],
  };
  const { director, upgradeSystem } = createHarness({ choices: [{ id: 'test-upgrade' }], runConfig });
  t.after(() => director.dispose());

  director.start();
  director.forceCompleteObjective();
  assert.equal(director.pendingUpgrade, true);
  assert.equal(director.objective, null);
  director.update(5, idleInput);
  assert.equal(director.matchTime, 0);

  assert.equal(director.selectUpgrade('test-upgrade'), true);
  assert.deepEqual(upgradeSystem.applied, ['test-upgrade']);
  assert.equal(director.pendingUpgrade, false);
  assert.equal(director.objective.type, 'survive');
  assert.equal(director.objective.gateTime, 2);
  director.update(2, idleInput);
  assert.equal(director.phase, PHASES.ESCALATION);
});

test('the 600 second overtime cap emits one defeat and ignores later updates', (t) => {
  const { director, events } = createHarness();
  t.after(() => director.dispose());

  director.start();
  director.matchTime = 599.75;
  director.update(0.25, idleInput);
  director.update(10, idleInput);

  const ended = events.filter(({ name }) => name === 'director:ended');
  assert.equal(GAME_CONFIG.run.maxDurationSeconds, 600);
  assert.equal(director.matchTime, 600);
  assert.equal(director.running, false);
  assert.equal(director.phase, PHASES.COMPLETE);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].payload.victory, false);
  assert.equal(ended[0].payload.cause, 'Окно эвакуации закрыто');
  assert.equal(ended[0].payload.stats.duration, 600);
});
