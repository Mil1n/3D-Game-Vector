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
