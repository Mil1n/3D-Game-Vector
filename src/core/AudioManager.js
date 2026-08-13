import { EventBus } from './EventBus.js';

export const AUDIO_GROUPS = Object.freeze(['master', 'music', 'weapons', 'effects', 'environment', 'ui']);

export const DEFAULT_AUDIO_VOLUMES = Object.freeze({
  master: 0.8,
  music: 0.45,
  weapons: 0.85,
  effects: 0.75,
  environment: 0.55,
  ui: 0.7,
});

const SOUND_PRESETS = Object.freeze({
  carbineShot: { group: 'weapons', duration: 0.13, gain: 0.42, noise: 0.45, filter: 1800, layers: [['sawtooth', 145, 72, 0.5], ['square', 82, 42, 0.2]] },
  scatterShot: { group: 'weapons', duration: 0.28, gain: 0.58, noise: 0.85, filter: 1050, layers: [['sawtooth', 94, 38, 0.5], ['triangle', 58, 28, 0.3]] },
  railShot: { group: 'weapons', duration: 0.52, gain: 0.48, noise: 0.2, filter: 4200, layers: [['sine', 1380, 120, 0.42], ['sawtooth', 310, 72, 0.22]] },
  plasmaShot: { group: 'weapons', duration: 0.09, gain: 0.3, noise: 0.1, filter: 5200, layers: [['square', 1650, 520, 0.2], ['sine', 790, 240, 0.34]] },
  novaShot: { group: 'weapons', duration: 0.72, gain: 0.56, noise: 0.72, filter: 1350, layers: [['sawtooth', 180, 38, 0.42], ['sine', 62, 24, 0.5], ['triangle', 980, 105, 0.14]] },
  enemyShot: { group: 'effects', duration: 0.2, gain: 0.26, noise: 0.22, filter: 2200, layers: [['square', 380, 120, 0.34]] },
  dryFire: { group: 'weapons', duration: 0.055, gain: 0.2, noise: 0.35, filter: 3900, layers: [['square', 180, 120, 0.14]] },
  reload: { group: 'weapons', duration: 0.16, gain: 0.17, noise: 0.2, filter: 2600, layers: [['triangle', 240, 410, 0.18]] },
  hit: { group: 'effects', duration: 0.07, gain: 0.2, noise: 0.22, filter: 5200, layers: [['sine', 920, 620, 0.25]] },
  criticalHit: { group: 'effects', duration: 0.12, gain: 0.25, noise: 0.16, filter: 6200, layers: [['sine', 1450, 740, 0.3]] },
  kill: { group: 'effects', duration: 0.2, gain: 0.25, noise: 0.18, filter: 3800, layers: [['triangle', 220, 760, 0.28]] },
  explosion: { group: 'effects', duration: 0.62, gain: 0.55, noise: 1, filter: 720, layers: [['sine', 72, 28, 0.45]] },
  dash: { group: 'effects', duration: 0.24, gain: 0.26, noise: 0.52, filter: 1600, layers: [['sawtooth', 130, 520, 0.18]] },
  jump: { group: 'effects', duration: 0.13, gain: 0.11, noise: 0.16, filter: 1400, layers: [['sine', 150, 245, 0.12]] },
  land: { group: 'effects', duration: 0.18, gain: 0.2, noise: 0.58, filter: 420, layers: [['sine', 82, 42, 0.2]] },
  step: { group: 'effects', duration: 0.095, gain: 0.1, noise: 0.6, filter: 620, layers: [] },
  uiClick: { group: 'ui', duration: 0.065, gain: 0.16, noise: 0, layers: [['sine', 520, 690, 0.22]] },
  uiHover: { group: 'ui', duration: 0.04, gain: 0.08, noise: 0, layers: [['sine', 720, 790, 0.15]] },
  pickup: { group: 'ui', duration: 0.28, gain: 0.18, noise: 0.04, layers: [['sine', 360, 940, 0.24]] },
  objective: { group: 'ui', duration: 0.42, gain: 0.2, noise: 0, layers: [['triangle', 330, 880, 0.24], ['sine', 495, 1320, 0.12]] },
  shiftWarning: { group: 'environment', duration: 0.55, gain: 0.24, noise: 0.08, filter: 1700, layers: [['sawtooth', 92, 145, 0.22], ['sine', 440, 320, 0.12]] },
  realityShift: { group: 'environment', duration: 1.5, gain: 0.38, noise: 0.65, filter: 2400, layers: [['sawtooth', 58, 580, 0.2], ['sine', 760, 65, 0.18]] },
  victory: { group: 'music', duration: 1.6, gain: 0.28, noise: 0, layers: [['triangle', 220, 880, 0.24], ['sine', 330, 1320, 0.15]] },
  defeat: { group: 'music', duration: 1.8, gain: 0.24, noise: 0.12, filter: 900, layers: [['sawtooth', 196, 48, 0.18], ['sine', 98, 42, 0.2]] },
  momentumRank: { group: 'ui', duration: 0.34, gain: 0.2, noise: 0.03, filter: 5200, layers: [['triangle', 330, 990, 0.2], ['sine', 660, 1320, 0.12]] },
  overdriveStart: { group: 'music', duration: 0.72, gain: 0.34, noise: 0.18, filter: 3200, layers: [['sawtooth', 82, 660, 0.22], ['sine', 220, 880, 0.28], ['triangle', 440, 1320, 0.12]] },
  overdriveLoop: { group: 'music', duration: 4, gain: 0.12, noise: 0.035, filter: 2600, loop: true, layers: [['sawtooth', 82, 86, 0.1], ['triangle', 164, 172, 0.15], ['sine', 328, 344, 0.08]] },
  overdriveEnd: { group: 'music', duration: 0.58, gain: 0.24, noise: 0.08, filter: 1800, layers: [['triangle', 880, 220, 0.22], ['sine', 440, 110, 0.18]] },
  ambience: { group: 'environment', duration: 8, gain: 0.12, noise: 0.12, filter: 440, loop: true, layers: [['sine', 46, 49, 0.3], ['triangle', 69, 73, 0.14]] },
  music: { group: 'music', duration: 8, gain: 0.1, noise: 0, loop: true, layers: [['sine', 55, 82.5, 0.22], ['triangle', 110, 165, 0.1]] },
});

const ALIASES = Object.freeze({
  carbine: 'carbineShot',
  scatter: 'scatterShot',
  rail: 'railShot',
  plasma: 'plasmaShot',
  nova: 'novaShot',
  gunshot: 'carbineShot',
  shotgun: 'scatterShot',
  footstep: 'step',
  shift: 'realityShift',
  warning: 'shiftWarning',
  click: 'uiClick',
  hover: 'uiHover',
  switch: 'uiClick',
  empty: 'dryFire',
  headshot: 'criticalHit',
  impact: 'hit',
  spawn: 'realityShift',
  enemyTelegraph: 'shiftWarning',
  enemyDeath: 'kill',
  momentum: 'momentumRank',
  momentumRankUp: 'momentumRank',
  overdrive: 'overdriveStart',
  overdriveActivate: 'overdriveStart',
  overdriveActive: 'overdriveLoop',
  overdriveDeactivate: 'overdriveEnd',
});

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

export class AudioManager {
  #active = new Set();
  #loops = new Map();
  #noiseBuffer = null;
  #unlockTarget = null;
  #unlockHandler = null;

  constructor(options = {}) {
    if (options && typeof options.emit === 'function') options = { eventBus: options };
    this.eventBus = options.eventBus ?? new EventBus();
    this.context = null;
    this.contextFactory = options.contextFactory ?? (() => {
      const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio API is unavailable');
      return new AudioContextClass({ latencyHint: 'interactive' });
    });
    const suppliedAudio = options.volumes?.audio ?? options.settings?.audio ?? options.volumes ?? {};
    this.volumes = { ...DEFAULT_AUDIO_VOLUMES, ...suppliedAudio };
    this.muted = options.muted === true || suppliedAudio.muted === true;
    this.groups = {};
    this.ready = false;
    if (options.autoUnlock !== false) this.installUnlockListeners(options.unlockTarget ?? globalThis.document ?? null);
  }

  async unlock() {
    try {
      if (!this.context) {
        this.context = this.contextFactory();
        this.#buildGraph();
      }
      if (this.context.state === 'suspended') await this.context.resume();
      this.ready = this.context.state !== 'closed';
      if (this.ready) {
        this.removeUnlockListeners();
        this.eventBus.emit('audio:ready', { context: this.context });
      }
      return this.ready;
    } catch (error) {
      this.ready = false;
      this.eventBus.emit('audio:error', { operation: 'unlock', error });
      return false;
    }
  }

  init() {
    return this.unlock();
  }

  async resume() {
    if (!this.context) return this.unlock();
    if (this.context.state === 'suspended') await this.context.resume();
    this.ready = this.context.state !== 'closed';
    return this.ready;
  }

  async suspend() {
    if (!this.context || this.context.state !== 'running') return false;
    await this.context.suspend();
    return true;
  }

  installUnlockListeners(target = globalThis.document ?? null) {
    if (!target?.addEventListener || this.#unlockHandler) return false;
    this.#unlockTarget = target;
    this.#unlockHandler = () => void this.unlock();
    target.addEventListener('pointerdown', this.#unlockHandler, { capture: true, passive: true });
    target.addEventListener('keydown', this.#unlockHandler, { capture: true });
    target.addEventListener('touchstart', this.#unlockHandler, { capture: true, passive: true });
    return true;
  }

  removeUnlockListeners() {
    if (!this.#unlockTarget || !this.#unlockHandler) return false;
    this.#unlockTarget.removeEventListener('pointerdown', this.#unlockHandler, { capture: true });
    this.#unlockTarget.removeEventListener('keydown', this.#unlockHandler, { capture: true });
    this.#unlockTarget.removeEventListener('touchstart', this.#unlockHandler, { capture: true });
    this.#unlockTarget = null;
    this.#unlockHandler = null;
    return true;
  }

  play(soundId, options = {}) {
    if (!this.context || !this.ready || this.context.state === 'closed') {
      this.eventBus.emit('audio:blocked', { soundId });
      return null;
    }
    if (this.context.state === 'suspended') void this.context.resume();

    const resolvedId = ALIASES[soundId] ?? soundId;
    const preset = SOUND_PRESETS[resolvedId];
    if (!preset) {
      this.eventBus.emit('audio:missing', { soundId });
      return null;
    }

    const group = options.group ?? preset.group;
    if (!this.groups[group]) throw new RangeError(`Unknown audio group: ${group}`);
    const start = this.context.currentTime + Math.max(0, Number(options.delay) || 0);
    const duration = Math.max(0.015, Number(options.duration) || preset.duration);
    const variation = options.variation === false ? 0 : (Math.random() * 2 - 1);
    const pitch = Math.max(0.25, Number(options.pitch) || 1) * (1 + variation * 0.035);
    const volume = clamp01(options.volume ?? options.gain ?? 1) * preset.gain * (1 + variation * 0.06);

    const output = this.context.createGain();
    output.gain.setValueAtTime(0.0001, start);
    output.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + Math.min(0.012, duration * 0.15));
    if (!preset.loop) output.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    const spatial = this.#connectOutput(output, group, options.position, options);
    const sources = [];
    for (const [waveform, from, to, layerGain] of preset.layers) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = waveform;
      oscillator.frequency.setValueAtTime(Math.max(1, from * pitch), start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to * pitch), start + duration);
      gain.gain.value = layerGain;
      oscillator.connect(gain);
      gain.connect(output);
      oscillator.start(start);
      if (!preset.loop) oscillator.stop(start + duration + 0.015);
      sources.push(oscillator);
    }

    if (preset.noise > 0) {
      const noise = this.context.createBufferSource();
      const noiseGain = this.context.createGain();
      noise.buffer = this.#getNoiseBuffer();
      noise.loop = preset.loop === true;
      noiseGain.gain.value = preset.noise;
      noise.connect(noiseGain);
      if (preset.filter) {
        const filter = this.context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(preset.filter * pitch, start);
        noiseGain.connect(filter);
        filter.connect(output);
      } else {
        noiseGain.connect(output);
      }
      noise.start(start, Math.random() * 0.5);
      if (!preset.loop) noise.stop(start + duration + 0.015);
      sources.push(noise);
    }

    let stopped = false;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      stopped = true;
      this.#active.delete(handle);
      if (this.#loops.get(resolvedId) === handle) this.#loops.delete(resolvedId);
      try { output.disconnect(); } catch { /* The output can already be disconnected. */ }
      try { spatial?.disconnect(); } catch { /* The panner can already be disconnected. */ }
    };
    const handle = {
      id: resolvedId,
      group,
      stop: (fadeSeconds = 0.03) => {
        if (stopped) return false;
        stopped = true;
        const time = this.context?.currentTime ?? 0;
        const fade = Math.max(0.005, Number(fadeSeconds) || 0.03);
        try {
          output.gain.cancelScheduledValues(time);
          output.gain.setTargetAtTime(0.0001, time, fade / 3);
          sources.forEach((source) => source.stop(time + fade));
        } catch {
          // Sources can already be stopped by their envelope.
        }
        this.#active.delete(handle);
        if (this.#loops.get(resolvedId) === handle) this.#loops.delete(resolvedId);
        return true;
      },
      setPosition: (position) => this.#setPannerPosition(spatial, position),
    };

    this.#active.add(handle);
    if (preset.loop) this.#loops.set(resolvedId, handle);
    if (!preset.loop) {
      const lastSource = sources.at(-1);
      if (lastSource?.addEventListener) lastSource.addEventListener('ended', cleanup, { once: true });
      else if (lastSource) lastSource.onended = cleanup;
    }
    return handle;
  }

  playAt(soundId, position, options = {}) {
    return this.play(soundId, { ...options, position });
  }

  playWeapon(weaponId, options = {}) {
    return this.play({
      carbine: 'carbineShot',
      scatter: 'scatterShot',
      rail: 'railShot',
      plasma: 'plasmaShot',
      nova: 'novaShot',
      empty: 'dryFire',
    }[weaponId] ?? weaponId, {
      group: 'weapons',
      ...options,
    });
  }

  playEffect(effectId, options = {}) {
    return this.play(effectId, { group: 'effects', ...options });
  }

  playEnvironment(soundId, options = {}) {
    return this.play(soundId, { group: 'environment', ...options });
  }

  playUI(soundId, options = {}) {
    return this.play(soundId, { group: 'ui', ...options });
  }

  playMomentumRank(rank = 'C', options = {}) {
    const order = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
    const index = Math.max(0, order.indexOf(String(rank).toUpperCase()));
    return this.play('momentumRank', {
      group: 'ui',
      pitch: 0.88 + index * 0.08,
      gain: 0.72 + index * 0.045,
      variation: false,
      ...options,
    });
  }

  playOverdriveStart(options = {}) {
    return this.play('overdriveStart', { group: 'music', variation: false, ...options });
  }

  playOverdriveEnd(options = {}) {
    return this.play('overdriveEnd', { group: 'music', variation: false, ...options });
  }

  startOverdriveLoop(options = {}) {
    return this.#loops.get('overdriveLoop')
      ?? this.play('overdriveLoop', { group: 'music', variation: false, ...options });
  }

  stopOverdriveLoop(fadeSeconds = 0.32) {
    return this.#loops.get('overdriveLoop')?.stop(fadeSeconds) ?? false;
  }

  setOverdriveActive(active, options = {}) {
    if (active) {
      const alreadyActive = Boolean(this.#loops.get('overdriveLoop'));
      if (!alreadyActive && options.cue !== false) this.playOverdriveStart(options.start ?? {});
      return this.startOverdriveLoop(options.loop ?? {});
    }
    const stopped = this.stopOverdriveLoop(options.fadeSeconds);
    if (stopped && options.cue !== false) this.playOverdriveEnd(options.end ?? {});
    return stopped;
  }

  startAmbience(options = {}) {
    return this.#loops.get('ambience') ?? this.play('ambience', options);
  }

  stopAmbience() {
    return this.#loops.get('ambience')?.stop(0.4) ?? false;
  }

  startMusic(options = {}) {
    return this.#loops.get('music') ?? this.play('music', options);
  }

  stopMusic() {
    return this.#loops.get('music')?.stop(0.6) ?? false;
  }

  setVolume(group, value) {
    if (!AUDIO_GROUPS.includes(group)) throw new RangeError(`Unknown audio group: ${group}`);
    const volume = clamp01(value);
    this.volumes[group] = volume;
    const node = this.groups[group];
    if (node && this.context) node.gain.setTargetAtTime(group === 'master' && this.muted ? 0 : volume, this.context.currentTime, 0.015);
    this.eventBus.emit('audio:volume', { group, value: volume });
    return volume;
  }

  setVolumes(volumes = {}) {
    const supplied = volumes.audio ?? volumes;
    for (const [group, value] of Object.entries(supplied)) {
      if (AUDIO_GROUPS.includes(group)) this.setVolume(group, value);
    }
    if (typeof supplied.muted === 'boolean') this.setMuted(supplied.muted);
    return { ...this.volumes, muted: this.muted };
  }

  applySettings(settings) {
    return this.setVolumes(settings?.audio ?? settings ?? {});
  }

  getVolume(group) {
    if (!AUDIO_GROUPS.includes(group)) throw new RangeError(`Unknown audio group: ${group}`);
    return this.volumes[group];
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.groups.master && this.context) {
      this.groups.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, this.context.currentTime, 0.015);
    }
    this.eventBus.emit('audio:muted', { muted: this.muted });
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setListener(position, forward = { x: 0, y: 0, z: -1 }, up = { x: 0, y: 1, z: 0 }) {
    if (!this.context) return false;
    const listener = this.context.listener;
    const time = this.context.currentTime;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(position.x ?? 0, time);
      listener.positionY.setValueAtTime(position.y ?? 0, time);
      listener.positionZ.setValueAtTime(position.z ?? 0, time);
      listener.forwardX.setValueAtTime(forward.x ?? 0, time);
      listener.forwardY.setValueAtTime(forward.y ?? 0, time);
      listener.forwardZ.setValueAtTime(forward.z ?? -1, time);
      listener.upX.setValueAtTime(up.x ?? 0, time);
      listener.upY.setValueAtTime(up.y ?? 1, time);
      listener.upZ.setValueAtTime(up.z ?? 0, time);
    } else {
      listener.setPosition(position.x ?? 0, position.y ?? 0, position.z ?? 0);
      listener.setOrientation(forward.x ?? 0, forward.y ?? 0, forward.z ?? -1, up.x ?? 0, up.y ?? 1, up.z ?? 0);
    }
    return true;
  }

  stopAll(group) {
    let count = 0;
    for (const handle of [...this.#active]) {
      if (!group || handle.group === group) count += Number(handle.stop());
    }
    return count;
  }

  async dispose() {
    this.removeUnlockListeners();
    this.stopAll();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this.groups = {};
    this.ready = false;
  }

  #buildGraph() {
    const master = this.context.createGain();
    master.gain.value = this.muted ? 0 : clamp01(this.volumes.master);
    master.connect(this.context.destination);
    this.groups.master = master;
    for (const group of AUDIO_GROUPS.slice(1)) {
      const node = this.context.createGain();
      node.gain.value = clamp01(this.volumes[group]);
      node.connect(master);
      this.groups[group] = node;
    }
  }

  #connectOutput(output, group, position, options) {
    if (!position || !this.context.createPanner) {
      output.connect(this.groups[group]);
      return null;
    }
    const panner = this.context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = Number(options.refDistance) || 2;
    panner.maxDistance = Number(options.maxDistance) || 70;
    panner.rolloffFactor = Number(options.rolloffFactor) || 1.35;
    this.#setPannerPosition(panner, position);
    output.connect(panner);
    panner.connect(this.groups[group]);
    return panner;
  }

  #setPannerPosition(panner, position) {
    if (!panner || !position) return false;
    const time = this.context?.currentTime ?? 0;
    if (panner.positionX) {
      panner.positionX.setValueAtTime(position.x ?? 0, time);
      panner.positionY.setValueAtTime(position.y ?? 0, time);
      panner.positionZ.setValueAtTime(position.z ?? 0, time);
    } else {
      panner.setPosition(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    }
    return true;
  }

  #getNoiseBuffer() {
    if (this.#noiseBuffer) return this.#noiseBuffer;
    const length = Math.max(1, Math.floor(this.context.sampleRate * 2));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.72 + white * 0.28;
      data[index] = previous;
    }
    this.#noiseBuffer = buffer;
    return buffer;
  }
}

export default AudioManager;
