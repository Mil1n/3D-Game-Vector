import { EventBus } from './EventBus.js';
import { DEFAULT_BINDINGS } from './InputManager.js';

export const SETTINGS_STORAGE_KEY = 'vector-null:settings:v1';

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const choice = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

const defaults = {
  audio: {
    master: 0.8,
    music: 0.45,
    weapons: 0.85,
    effects: 0.75,
    environment: 0.55,
    ui: 0.7,
    muted: false,
  },
  graphics: {
    quality: 'medium',
    exposure: 1.12,
    resolutionScale: 1,
    shadows: true,
    shadowQuality: 'medium',
    antialias: true,
    bloom: true,
    particles: 'medium',
    maxPixelRatio: 1.5,
    fpsLimit: 0,
  },
  controls: {
    mouseSensitivity: 0.55,
    invertY: false,
    rawInput: true,
    bindings: Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([key, value]) => [key, value[0]])),
  },
  gameplay: {
    difficulty: 'normal',
    aimMode: 'hold',
    crouchMode: 'hold',
    fov: 82,
    sprintFov: 92,
    headBob: 0.55,
    cameraShake: 0.65,
    subtitles: true,
    crosshairColor: '#67f7e3',
  },
  accessibility: {
    reducedMotion: false,
    highContrast: false,
    colorBlindMode: 'none',
    screenFlash: 0.65,
    uiScale: 1,
  },
};

const deepFreeze = (value) => {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
};

export const DEFAULT_SETTINGS = deepFreeze(defaults);

const validBindings = (source) => {
  const result = {};
  for (const [action, fallback] of Object.entries(DEFAULT_BINDINGS)) {
    const candidate = source?.[action];
    if (typeof candidate === 'string' && candidate.length > 0) result[action] = [candidate];
    else if (Array.isArray(candidate)) {
      const inputs = [...new Set(candidate.filter((input) => typeof input === 'string' && input.length > 0))];
      result[action] = inputs.length > 0 ? inputs : fallback[0];
    } else result[action] = fallback[0];
  }
  return result;
};

export function validateSettings(source = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    audio: {
      master: clamp(source.audio?.master, 0, 1, d.audio.master),
      music: clamp(source.audio?.music, 0, 1, d.audio.music),
      weapons: clamp(source.audio?.weapons, 0, 1, d.audio.weapons),
      effects: clamp(source.audio?.effects, 0, 1, d.audio.effects),
      environment: clamp(source.audio?.environment, 0, 1, d.audio.environment),
      ui: clamp(source.audio?.ui, 0, 1, d.audio.ui),
      muted: bool(source.audio?.muted, d.audio.muted),
    },
    graphics: {
      quality: choice(source.graphics?.quality, ['low', 'medium', 'high'], d.graphics.quality),
      exposure: clamp(source.graphics?.exposure, 0.7, 1.6, d.graphics.exposure),
      resolutionScale: clamp(source.graphics?.resolutionScale, 0.5, 1.25, d.graphics.resolutionScale),
      shadows: bool(source.graphics?.shadows, d.graphics.shadows),
      shadowQuality: choice(source.graphics?.shadowQuality, ['off', 'low', 'medium', 'high'], d.graphics.shadowQuality),
      antialias: bool(source.graphics?.antialias, d.graphics.antialias),
      bloom: bool(source.graphics?.bloom, d.graphics.bloom),
      particles: choice(source.graphics?.particles, ['low', 'medium', 'high'], d.graphics.particles),
      maxPixelRatio: clamp(source.graphics?.maxPixelRatio, 1, 2, d.graphics.maxPixelRatio),
      fpsLimit: [0, 30, 60, 90, 120, 144].includes(Number(source.graphics?.fpsLimit))
        ? Number(source.graphics.fpsLimit)
        : d.graphics.fpsLimit,
    },
    controls: {
      mouseSensitivity: clamp(source.controls?.mouseSensitivity, 0.1, 4, d.controls.mouseSensitivity),
      invertY: bool(source.controls?.invertY, d.controls.invertY),
      rawInput: bool(source.controls?.rawInput, d.controls.rawInput),
      bindings: validBindings(source.controls?.bindings),
    },
    gameplay: {
      difficulty: choice(source.gameplay?.difficulty, ['easy', 'normal', 'hard'], d.gameplay.difficulty),
      aimMode: choice(source.gameplay?.aimMode, ['hold', 'toggle'], d.gameplay.aimMode),
      crouchMode: choice(source.gameplay?.crouchMode, ['hold', 'toggle'], d.gameplay.crouchMode),
      fov: clamp(source.gameplay?.fov, 65, 110, d.gameplay.fov),
      sprintFov: clamp(source.gameplay?.sprintFov, 70, 115, d.gameplay.sprintFov),
      headBob: clamp(source.gameplay?.headBob, 0, 1, d.gameplay.headBob),
      cameraShake: clamp(source.gameplay?.cameraShake, 0, 1, d.gameplay.cameraShake),
      subtitles: bool(source.gameplay?.subtitles, d.gameplay.subtitles),
      crosshairColor: color(source.gameplay?.crosshairColor, d.gameplay.crosshairColor),
    },
    accessibility: {
      reducedMotion: bool(source.accessibility?.reducedMotion, d.accessibility.reducedMotion),
      highContrast: bool(source.accessibility?.highContrast, d.accessibility.highContrast),
      colorBlindMode: choice(source.accessibility?.colorBlindMode, ['none', 'protanopia', 'deuteranopia', 'tritanopia'], d.accessibility.colorBlindMode),
      screenFlash: clamp(source.accessibility?.screenFlash, 0, 1, d.accessibility.screenFlash),
      uiScale: clamp(source.accessibility?.uiScale, 0.8, 1.3, d.accessibility.uiScale),
    },
  };
}

const merge = (base, patch) => {
  const output = deepClone(base);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object') {
      output[key] = merge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
};

export class SettingsManager {
  constructor(options = {}) {
    if (options && typeof options.emit === 'function') options = { eventBus: options };
    this.eventBus = options.eventBus ?? new EventBus();
    this.storageKey = options.storageKey ?? SETTINGS_STORAGE_KEY;
    this.storage = Object.hasOwn(options, 'storage') ? options.storage : this.#globalStorage();
    this.settings = deepClone(DEFAULT_SETTINGS);
    if (options.autoLoad !== false) this.load();
  }

  load() {
    if (!this.storage) return this.getSettings();
    try {
      const serialized = this.storage.getItem(this.storageKey);
      if (!serialized) {
        this.save();
        return this.getSettings();
      }
      const parsed = JSON.parse(serialized);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Settings root is invalid');
      this.settings = validateSettings(parsed);
      return this.getSettings();
    } catch (error) {
      this.#backupCorruptValue();
      this.settings = deepClone(DEFAULT_SETTINGS);
      this.save();
      this.eventBus.emit('settings:error', { operation: 'load', error });
      return this.getSettings();
    }
  }

  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.settings));
      return true;
    } catch (error) {
      this.eventBus.emit('settings:error', { operation: 'save', error });
      return false;
    }
  }

  get(path, fallback) {
    if (!path) return this.getSettings();
    const value = String(path).split('.').reduce((current, key) => current?.[key], this.settings);
    return value === undefined ? fallback : deepClone(value);
  }

  getSettings() {
    return deepClone(this.settings);
  }

  set(path, value) {
    const keys = String(path).split('.').filter(Boolean);
    if (keys.length < 1) throw new TypeError('Setting path cannot be empty');
    const draft = this.getSettings();
    let target = draft;
    for (const key of keys.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
      target = target[key];
    }
    const previous = this.get(path);
    target[keys.at(-1)] = value;
    this.settings = validateSettings(draft);
    this.save();
    const validatedValue = this.get(path);
    this.eventBus.emit('settings:changed', {
      settings: this.getSettings(),
      path,
      value: validatedValue,
      previous,
    });
    return validatedValue;
  }

  setSetting(category, key, value) {
    return this.set(`${category}.${key}`, value);
  }

  update(patch) {
    const previous = this.getSettings();
    this.settings = validateSettings(merge(this.settings, patch));
    this.save();
    const settings = this.getSettings();
    this.eventBus.emit('settings:changed', { settings, previous });
    return settings;
  }

  patch(patch) {
    return this.update(patch);
  }

  reset() {
    const previous = this.getSettings();
    this.settings = deepClone(DEFAULT_SETTINGS);
    this.save();
    const settings = this.getSettings();
    this.eventBus.emit('settings:changed', { settings, previous, reset: true });
    return settings;
  }

  #backupCorruptValue() {
    if (!this.storage) return;
    try {
      const value = this.storage.getItem(this.storageKey);
      if (value !== null) this.storage.setItem(`${this.storageKey}:corrupt:${Date.now()}`, value);
    } catch {
      // Storage may be blocked; defaults still allow the game to start.
    }
  }

  #globalStorage() {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }
}

export default SettingsManager;
