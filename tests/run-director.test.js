import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GAME_CONFIG } from '../src/configs/gameConfig.js';
import { PHASES, RunDirector } from '../src/systems/RunDirector.js';

const idleInput = { isDown: () => false };

function createHarness({ choices = [], runConfig = GAME_CONFIG.run, random = () => 0.9 } = {}) {
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
    random,
    runConfig,
  });

  return { director, enemySystem, events, spawned, shifts, upgradeSystem, weaponState };
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
