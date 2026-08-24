import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/EventBus.js';
import { GAME_STATES, GameStateManager, STATE_TRANSITIONS } from '../src/core/GameStateManager.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { SaveManager } from '../src/core/SaveManager.js';
import { AssetManager } from '../src/core/AssetManager.js';
import { ObjectPool } from '../src/core/ObjectPool.js';

test('EventBus supports priority, once, unsubscribe, off and clear', () => {
  const bus = new EventBus();
  const calls = [];
  const normal = (value) => calls.push(`normal:${value}`);
  const unsubscribe = bus.on('pulse', normal);
  bus.once('pulse', (value) => calls.push(`once:${value}`), { priority: 10 });

  assert.equal(bus.emit('pulse', 1), 2);
  assert.equal(bus.emit('pulse', 2), 1);
  assert.deepEqual(calls, ['once:1', 'normal:1', 'normal:2']);
  assert.equal(unsubscribe(), true);
  assert.equal(bus.listenerCount('pulse'), 0);

  bus.on('a', () => {});
  bus.on('b', () => {});
  assert.equal(bus.off('a'), true);
  assert.deepEqual(bus.eventNames(), ['b']);
  assert.equal(bus.clear(), true);
  assert.deepEqual(bus.eventNames(), []);
});

test('EventBus removes listeners through AbortSignal', () => {
  const bus = new EventBus();
  const controller = new AbortController();
  let calls = 0;
  bus.on('tick', () => { calls += 1; }, { signal: controller.signal });
  controller.abort();
  bus.emit('tick');
  assert.equal(calls, 0);
});

test('GameStateManager follows the complete valid run path', () => {
  const bus = new EventBus();
  const changes = [];
  bus.on('state:changed', (change) => changes.push(`${change.from}->${change.to}`));
  const states = new GameStateManager({ eventBus: bus });

  assert.equal(states.state, GAME_STATES.BOOT);
  assert.equal(states.transition(GAME_STATES.LOADING), true);
  states.transition(GAME_STATES.MAIN_MENU);
  states.transition(GAME_STATES.TUTORIAL);
  states.transition(GAME_STATES.PLAYING);
  states.transition(GAME_STATES.UPGRADE_SELECTION);
  states.transition(GAME_STATES.PLAYING);
  states.transition(GAME_STATES.VICTORY);
  states.transition(GAME_STATES.MAIN_MENU);

  assert.equal(states.state, GAME_STATES.MAIN_MENU);
  assert.equal(changes.length, 8);
  assert.equal(states.getHistory().at(-1).to, GAME_STATES.MAIN_MENU);
});

test('GameStateManager rejects unknown and disallowed transitions', () => {
  const states = new GameStateManager();
  assert.equal(states.canTransition(GAME_STATES.PLAYING), false);
  assert.throws(() => states.transition(GAME_STATES.PLAYING), /Invalid game-state transition/);
  assert.throws(() => states.transition('Credits'), /Unknown game state/);
  assert.equal(states.state, GAME_STATES.BOOT);
  assert.equal(states.transition(GAME_STATES.BOOT), false);
});

test('pause resumes the state that initiated it', () => {
  const states = new GameStateManager();
  states.transition(GAME_STATES.LOADING);
  states.transition(GAME_STATES.MAIN_MENU);
  states.transition(GAME_STATES.TUTORIAL);
  assert.equal(states.pause(), true);
  assert.equal(states.state, GAME_STATES.PAUSED);
  assert.equal(states.resume(), true);
  assert.equal(states.state, GAME_STATES.TUTORIAL);

  states.transition(GAME_STATES.PLAYING);
  states.transition(GAME_STATES.UPGRADE_SELECTION);
  states.pause();
  states.resume();
  assert.equal(states.state, GAME_STATES.UPGRADE_SELECTION);
});

test('transition table only contains known states', () => {
  const known = new Set(Object.values(GAME_STATES));
  assert.deepEqual(new Set(Object.keys(STATE_TRANSITIONS)), known);
  for (const destinations of Object.values(STATE_TRANSITIONS)) {
    assert.ok(destinations.length > 0);
    destinations.forEach((state) => assert.ok(known.has(state)));
  }
});

test('SettingsManager validates and persists a string key rebind', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const settings = new SettingsManager({ storage });
  settings.set('controls.bindings.forward', 'KeyZ');
  assert.deepEqual(settings.get('controls.bindings.forward'), ['KeyZ']);
  assert.equal(JSON.parse(values.get(settings.storageKey)).controls.bindings.forward[0], 'KeyZ');
});

test('SettingsManager persists a bounded weapon recoil intensity', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const settings = new SettingsManager({ storage });
  assert.equal(settings.set('gameplay.weaponRecoil', 0.4), 0.4);
  assert.equal(settings.set('gameplay.weaponRecoil', -9), 0);
  assert.equal(settings.set('gameplay.weaponRecoil', 9), 1);
  assert.equal(JSON.parse(values.get(settings.storageKey)).gameplay.weaponRecoil, 1);
});

test('SettingsManager persists a bounded hit-stop intensity', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const settings = new SettingsManager({ storage });
  assert.equal(settings.set('gameplay.hitStop', 0.35), 0.35);
  assert.equal(settings.set('gameplay.hitStop', -3), 0);
  assert.equal(settings.set('gameplay.hitStop', 8), 1);
  assert.equal(JSON.parse(values.get(settings.storageKey)).gameplay.hitStop, 1);
});

test('legacy settings without weapon recoil receive the current default', () => {
  const values = new Map([
    ['vector-null:settings:v1', JSON.stringify({ gameplay: { cameraShake: 0.2 } })],
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const settings = new SettingsManager({ storage });

  assert.equal(settings.get('gameplay.cameraShake'), 0.2);
  assert.equal(settings.get('gameplay.weaponRecoil'), 0.85);
  assert.equal(settings.get('gameplay.hitStop'), 0.8);
});

test('SaveManager fallback keeps root and nested progression aliases synchronized', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const saves = new SaveManager({ indexedDB: null, storage });
  await saves.load();
  const profile = await saves.updateProfile({ totalXp: 750, bestScore: 1200 });
  assert.equal(profile.totalXp, 750);
  assert.equal(profile.progression.totalExperience, 750);
  assert.equal(profile.bestScore, 1200);
  assert.equal(profile.stats.bestScore, 1200);
  assert.equal(profile.version, 3);
  const saved = await saves.save({
    ...profile,
    achievements: [{ id: 'first_contact', name: 'First Contact' }],
    stats: { ...profile.stats, victories: 2, headshots: 8 },
  });
  assert.equal(saved.achievements[0].id, 'first_contact');
  assert.equal(saved.stats.wins, 2);
  assert.equal(saved.stats.headshots, 8);
});

test('AssetManager loads registered procedures and uses explicit fallbacks', async () => {
  const assets = new AssetManager();
  assets.register('generated', async () => ({ kind: 'generated' }));
  assets.register('recoverable', async () => { throw new Error('missing'); }, { fallback: { kind: 'fallback' } });
  const summary = await assets.loadAll();
  assert.equal(summary.loaded, 2);
  assert.equal(summary.failed, 0);
  assert.equal(assets.get('generated').kind, 'generated');
  assert.equal(assets.get('recoverable').kind, 'fallback');
});

test('ObjectPool reuses and resets released objects', () => {
  const pool = new ObjectPool({
    factory: () => ({ active: false }),
    activate: (item) => { item.active = true; },
    deactivate: (item) => { item.active = false; },
    initialSize: 2,
  });
  const item = pool.acquire();
  assert.equal(item.active, true);
  assert.equal(pool.release(item), true);
  assert.equal(item.active, false);
  assert.equal(pool.acquire(), item);
  assert.equal(pool.stats.reused, 2);
});
