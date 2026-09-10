import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { AudioManager } from '../src/core/AudioManager.js';
import { EffectsSystem } from '../src/combat/EffectsSystem.js';

function audioHarness() {
  const manager = Object.create(AudioManager.prototype);
  const calls = [];
  manager.play = (id, options = {}) => {
    const handle = {
      id,
      options,
      stopped: false,
      stop() {
        if (this.stopped) return false;
        this.stopped = true;
        return true;
      },
    };
    calls.push(handle);
    return handle;
  };
  return { manager, calls };
}

function fakeAudioContext() {
  const parameter = () => ({
    value: 1,
    setValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
    cancelScheduledValues() {},
  });
  const node = () => ({ connect() {}, disconnect() {} });
  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 32,
    destination: node(),
    listener: {},
    createGain: () => ({ ...node(), gain: parameter() }),
    createOscillator: () => ({ ...node(), frequency: parameter(), start() {}, stop() {}, addEventListener() {} }),
    createBufferSource: () => ({ ...node(), loop: false, start() {}, stop() {}, addEventListener() {} }),
    createBiquadFilter: () => ({ ...node(), frequency: parameter(), type: 'lowpass' }),
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    resume: async () => {},
    suspend: async () => {},
    close: async () => {},
  };
}

test('Momentum rank cue uses a stable pitch ladder', () => {
  const { manager, calls } = audioHarness();

  manager.playMomentumRank('C');
  manager.playMomentumRank('SSS');

  assert.equal(calls[0].id, 'momentumRank');
  assert.equal(calls[0].options.group, 'ui');
  assert.ok(calls[1].options.pitch > calls[0].options.pitch);
  assert.equal(calls[1].options.variation, false);
});

test('combat confirmations use one non-spatial cue with kill-first priority', async () => {
  const { manager, calls } = audioHarness();

  manager.playCombatConfirmation({ hitCount: 1 });
  manager.playCombatConfirmation({ headshot: true, hitCount: 2 });
  manager.playCombatConfirmation({ critical: true });
  manager.playCombatConfirmation({ killed: true, headshot: true, hitCount: 8 });

  assert.deepEqual(calls.map(({ id }) => id), ['hitConfirm', 'headshotConfirm', 'headshotConfirm', 'killConfirm']);
  assert.ok(calls.every(({ options }) => options.group === 'weapons'));
  assert.ok(calls.every(({ options }) => options.variation === false));
  assert.ok(calls.every(({ options }) => !Object.hasOwn(options, 'position')));
  assert.ok(calls[3].options.gain > calls[1].options.gain);
  assert.ok(calls[1].options.gain > calls[0].options.gain);

  const events = [];
  const real = new AudioManager({
    autoUnlock: false,
    eventBus: { emit: (name, payload) => events.push({ name, payload }) },
    contextFactory: fakeAudioContext,
  });
  await real.unlock();
  assert.ok(real.playCombatConfirmation({ hitCount: 1 }));
  assert.ok(real.playCombatConfirmation({ headshot: true }));
  assert.ok(real.playCombatConfirmation({ killed: true }));
  assert.equal(events.some(({ name }) => name === 'audio:missing'), false);
  await real.dispose();
});

test('Overdrive one-shot helpers select the dedicated procedural cues', () => {
  const { manager, calls } = audioHarness();

  manager.playOverdriveStart();
  manager.playOverdriveEnd();

  assert.deepEqual(calls.map(({ id }) => id), ['overdriveStart', 'overdriveEnd']);
  assert.ok(calls.every(({ options }) => options.group === 'music' && options.variation === false));
});

test('Overdrive loop start and stop are idempotent', async () => {
  const manager = new AudioManager({
    autoUnlock: false,
    eventBus: { emit() {} },
    contextFactory: fakeAudioContext,
  });
  await manager.unlock();

  const first = manager.startOverdriveLoop();
  const duplicate = manager.startOverdriveLoop();
  assert.ok(first);
  assert.equal(duplicate, first);
  assert.equal(manager.stopOverdriveLoop(), true);
  assert.equal(manager.stopOverdriveLoop(), false);

  const active = manager.setOverdriveActive(true, { cue: false });
  assert.ok(active);
  assert.equal(manager.setOverdriveActive(false, { cue: false }), true);
  await manager.dispose();
});

test('Overdrive pulses reuse the existing ring pool and restore role-specific state', () => {
  const scene = new THREE.Scene();
  const events = [];
  const effects = new EffectsSystem({
    scene,
    camera: new THREE.PerspectiveCamera(),
    quality: 'low',
    eventBus: { emit: (name, payload) => events.push({ name, payload }), on: () => () => {} },
  });

  const before = effects.rings.items.length;
  const start = effects.spawnOverdrivePulse(new THREE.Vector3(2, 1, -3), 'start', 1.5);
  assert.equal(effects.rings.items.length, before);
  assert.equal(start.visible, true);
  assert.equal(start.userData.duration, 0.82);
  assert.equal(start.material.color.getHex(), 0xff48c7);

  const end = effects.spawnOverdrivePulse(new THREE.Vector3(), 'end');
  assert.equal(effects.rings.items.length, before);
  assert.equal(end.userData.duration, 0.48);
  assert.equal(end.material.color.getHex(), 0x64f4ff);
  assert.deepEqual(events.map(({ name }) => name), ['effects:overdrive-pulse', 'effects:overdrive-pulse']);

  effects.dispose();
});

test('traversal cues are procedural and pulses stay separate from combat explosions', async () => {
  const audioEvents = [];
  const audio = new AudioManager({
    autoUnlock: false,
    eventBus: { emit: (name, payload) => audioEvents.push({ name, payload }) },
    contextFactory: fakeAudioContext,
  });
  await audio.unlock();
  assert.ok(audio.play('launchPad', { variation: false }));
  assert.ok(audio.play('speedPad', { variation: false }));
  assert.equal(audioEvents.some(({ name }) => name === 'audio:missing'), false);
  await audio.dispose();

  const effectEvents = [];
  const effects = new EffectsSystem({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    quality: 'low',
    eventBus: { emit: (name, payload) => effectEvents.push({ name, payload }), on: () => () => {} },
  });
  const poolSize = effects.rings.items.length;
  const launch = effects.spawnTraversalPulse(
    new THREE.Vector3(1, 0, 2),
    new THREE.Vector3(0, 0, -1),
    0xff8844,
    'launch',
  );
  const boost = effects.spawnTraversalPulse(
    new THREE.Vector3(-2, 0, 3),
    new THREE.Vector3(1, 0, 0),
    0x44ddff,
    'boost',
  );
  assert.equal(effects.rings.items.length, poolSize);
  assert.equal(launch.userData.duration, 0.42);
  assert.equal(boost.userData.duration, 0.3);
  assert.equal(launch.material.color.getHex(), 0xff8844);
  assert.equal(boost.material.color.getHex(), 0x44ddff);
  assert.equal(effectEvents.some(({ name }) => name === 'effects:explosion'), false);
  effects.dispose();
});
