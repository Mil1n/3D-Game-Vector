import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/EventBus.js';
import { MomentumSystem } from '../src/systems/MomentumSystem.js';

const STYLE_ACTIONS = Object.freeze([
  'kill',
  'headshot',
  'airKill',
  'slideKill',
  'wallRunKill',
  'multiKill',
  'explosiveKill',
  'weaponSwitch',
  'projectileDeflect',
  'noDamageKill',
  'eliteKill',
]);

function createSystem(options = {}) {
  const eventBus = options.eventBus ?? new EventBus();
  const externalOptions = { ...options };
  delete externalOptions.eventBus;
  const events = [];
  for (const name of ['momentum:changed', 'overdrive:ready', 'overdrive:activated', 'overdrive:ended']) {
    eventBus.on(name, (payload) => events.push({ name, payload }));
  }
  const system = new MomentumSystem({ eventBus, ...externalOptions });
  return { system, eventBus, events };
}

function fillMomentum(system) {
  for (let index = 0; index < 200 && !system.getState().overdrive.ready; index += 1) {
    system.recordAction(STYLE_ACTIONS[index % STYLE_ACTIONS.length], {
      count: index % 4 === 0 ? 3 : 1,
      enemyType: `target-${index % 5}`,
      weapon: `weapon-${index % 4}`,
    });
  }
  return system.getState();
}

test('MomentumSystem starts from a finite, serializable baseline and reset restores it', () => {
  const { system } = createSystem();

  const initial = system.getState();
  assert.equal(initial.momentum, 0);
  assert.equal(initial.rank, 'D');
  assert.equal(initial.bestRank, 'D');
  assert.equal(initial.styleScore, 0);
  assert.ok(initial.multiplier >= 1);
  assert.equal(initial.overdrive.ready, false);
  assert.equal(initial.overdrive.active, false);
  assert.equal(initial.overdrive.remaining, 0);
  assert.doesNotThrow(() => JSON.stringify(initial));

  system.recordAction('eliteKill', { enemyType: 'elite', weapon: 'rail' });
  assert.ok(system.getState().momentum > 0);
  system.reset();
  assert.deepEqual(system.getState(), initial);
  system.dispose();
});

test('style actions build clamped Momentum and stronger feats are worth more than a basic kill', () => {
  const basic = createSystem().system;
  const advanced = createSystem().system;

  basic.recordAction('kill', { enemyType: 'trooper', weapon: 'carbine' });
  advanced.recordAction('eliteKill', { enemyType: 'warden', weapon: 'rail' });
  const killState = basic.getState();
  const eliteState = advanced.getState();

  assert.ok(killState.momentum > 0);
  assert.ok(eliteState.momentum > killState.momentum);
  assert.ok(eliteState.styleScore > killState.styleScore);

  const filled = fillMomentum(advanced);
  assert.equal(filled.momentum, 100);
  assert.equal(filled.overdrive.ready, true);
  const beforeAirKill = advanced.getState().styleScore;
  advanced.recordAction('airKill');
  assert.ok(advanced.getState().styleScore > beforeAirKill);

  basic.dispose();
  advanced.dispose();
});

test('rank and multiplier progress monotonically and remember the best achieved rank', () => {
  const { system } = createSystem();
  const rankOrder = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
  let previousRankIndex = 0;
  let previousMultiplier = 1;

  for (let index = 0; index < 160; index += 1) {
    system.recordAction(STYLE_ACTIONS[index % STYLE_ACTIONS.length], {
      enemyType: `type-${index % 6}`,
      weapon: `weapon-${index % 5}`,
    });
    const state = system.getState();
    const rankIndex = rankOrder.indexOf(state.rank);
    assert.ok(rankIndex >= previousRankIndex, 'positive style actions must not lower rank');
    assert.ok(state.multiplier >= previousMultiplier, 'positive style actions must not lower multiplier');
    previousRankIndex = rankIndex;
    previousMultiplier = state.multiplier;
    if (state.momentum === 100) break;
  }

  const peak = system.getState();
  assert.ok(rankOrder.indexOf(peak.rank) > 0);
  system.update(30, { moving: false, dealtDamage: false });
  const decayed = system.getState();
  assert.ok(decayed.momentum < peak.momentum);
  assert.equal(decayed.bestRank, peak.bestRank);
  system.dispose();
});

test('anti-exploit applies diminishing returns to repeated style and restores value after variation', () => {
  const { system } = createSystem();

  const deltas = [];
  for (let index = 0; index < 3; index += 1) {
    const before = system.getState().momentum;
    system.recordAction('kill', { enemyType: 'trooper', weapon: 'carbine' });
    deltas.push(system.getState().momentum - before);
  }
  assert.ok(deltas[1] < deltas[0]);
  assert.ok(deltas[2] <= deltas[1]);

  system.recordAction('headshot', { enemyType: 'hunter', weapon: 'scatter' });
  system.recordAction('weaponSwitch', { weapon: 'rail' });
  const beforeVariedKill = system.getState().momentum;
  system.recordAction('kill', { enemyType: 'hunter', weapon: 'rail' });
  const variedDelta = system.getState().momentum - beforeVariedKill;
  assert.ok(variedDelta > deltas[2], 'changing target, weapon and action should recover style value');
  system.dispose();
});

test('style chain history expires with its visible feedback window', () => {
  const { system } = createSystem();
  const first = system.recordAction('kill', { enemyType: 'trooper', weapon: 'carbine' });
  const repeated = system.recordAction('kill', { enemyType: 'trooper', weapon: 'carbine' });
  assert.ok(repeated.delta < first.delta);

  system.update(system.config.feedback.actionDuration + 0.01, { moving: true, dealtDamage: true });
  assert.equal(system.getState().lastAction, null);
  assert.equal(system.getState().lastActionRemaining, 0);
  const fresh = system.recordAction('kill', { enemyType: 'trooper', weapon: 'carbine' });
  assert.equal(fresh.delta, first.delta);
  system.dispose();
});

test('inactivity and heavy damage drain Momentum without underflow', () => {
  const { system, eventBus } = createSystem();
  for (const action of STYLE_ACTIONS.slice(0, 7)) system.recordAction(action, { enemyType: action, weapon: action });
  const earned = system.getState().momentum;
  assert.ok(earned > 0);

  system.update(1, { moving: true, dealtDamage: true });
  assert.equal(system.getState().momentum, earned, 'active combat should preserve Momentum during the grace window');

  system.update(12, { moving: false, dealtDamage: false });
  const inactive = system.getState().momentum;
  assert.ok(inactive < earned, 'standing safely without dealing damage must decay Momentum');

  eventBus.emit('player:damaged', { amount: 60 });
  assert.ok(system.getState().momentum < inactive, 'heavy damage must apply an immediate penalty');
  system.update(600, { moving: false, dealtDamage: false });
  assert.equal(system.getState().momentum, 0);
  system.dispose();
});

test('Overdrive requires full Momentum, consumes charge and rejects duplicate activation', () => {
  const { system, events } = createSystem();

  assert.equal(system.activateOverdrive(), false);
  const full = fillMomentum(system);
  assert.equal(full.overdrive.ready, true);
  assert.equal(events.filter(({ name }) => name === 'overdrive:ready').length, 1);

  system.update(30, { moving: false, dealtDamage: false });
  const decayedReady = system.getState();
  assert.equal(decayedReady.overdrive.ready, true, 'earned readiness should remain latched');
  assert.ok(decayedReady.multiplier < full.multiplier, 'ready state must not preserve the peak reward multiplier');

  assert.equal(system.activateOverdrive(), true);
  const active = system.getState();
  assert.equal(active.momentum, 0);
  assert.equal(active.overdrive.ready, false);
  assert.equal(active.overdrive.active, true);
  assert.ok(active.overdrive.remaining > 0);
  assert.equal(active.rank, full.rank, 'Overdrive must retain the rank that unlocked it');
  assert.equal(active.multiplier, full.multiplier, 'Overdrive must retain its peak reward multiplier');
  assert.equal(system.activateOverdrive(), false);
  assert.equal(events.filter(({ name }) => name === 'overdrive:activated').length, 1);
  system.dispose();
});

test('kills extend active Overdrive up to a cap and update eventually ends it', () => {
  const { system, events } = createSystem();
  fillMomentum(system);
  assert.equal(system.activateOverdrive(), true);

  const initialDuration = system.getState().overdrive.remaining;
  system.update(initialDuration / 2, { moving: true, dealtDamage: true });
  const beforeKill = system.getState().overdrive.remaining;
  system.recordAction('kill', { enemyType: 'trooper', weapon: 'carbine' });
  const extended = system.getState().overdrive.remaining;
  assert.ok(extended > beforeKill);

  for (let index = 0; index < 200; index += 1) {
    system.recordAction('kill', { enemyType: `type-${index % 5}`, weapon: `weapon-${index % 4}` });
  }
  const capped = system.getState().overdrive.remaining;
  assert.ok(Number.isFinite(capped));
  assert.ok(capped <= initialDuration * 3, 'kill extensions must have a bounded maximum');

  system.update(capped + 1, { moving: true, dealtDamage: true });
  assert.equal(system.getState().overdrive.active, false);
  assert.equal(system.getState().overdrive.remaining, 0);
  assert.equal(events.filter(({ name }) => name === 'overdrive:ended').length, 1);
  system.dispose();
});

test('EventBus combat integration enriches style and dispose removes owned listeners', () => {
  const eventBus = new EventBus();
  const observedEvents = ['enemy:killed', 'player:damaged', 'weapon:changed', 'combat:shot'];
  const listenerCountsBefore = Object.fromEntries(observedEvents.map((name) => [name, eventBus.listenerCount(name)]));
  const { system } = createSystem({ eventBus });

  for (const name of observedEvents) {
    assert.ok(eventBus.listenerCount(name) > listenerCountsBefore[name], `${name} should be integrated`);
  }

  eventBus.emit('weapon:changed', { id: 'scatter' });
  assert.equal(system.getState().momentum, 0, 'switching without a kill must not farm Momentum');
  eventBus.emit('combat:shot', { weapon: 'scatter', hit: true, headshot: true });
  eventBus.emit('enemy:killed', { type: 'hunter', weapon: 'scatter', headshot: true, elite: false });
  const firstKillMomentum = system.getState().momentum;
  eventBus.emit('weapon:changed', { id: 'rail' });
  assert.equal(system.getState().momentum, firstKillMomentum, 'cycling weapons alone must remain neutral');
  eventBus.emit('enemy:killed', { type: 'trooper', weapon: 'rail', headshot: false, elite: false });
  const earned = system.getState();
  assert.ok(earned.momentum > firstKillMomentum, 'a kill with a different weapon earns variety style');
  assert.ok(earned.styleScore > 0);

  system.dispose();
  for (const name of observedEvents) {
    assert.equal(eventBus.listenerCount(name), listenerCountsBefore[name], `${name} listener must be released`);
  }

  const snapshot = system.getState();
  eventBus.emit('enemy:killed', { type: 'warden', weapon: 'rail', headshot: true, elite: true });
  assert.deepEqual(system.getState(), snapshot, 'disposed systems must stop reacting to gameplay events');
});
