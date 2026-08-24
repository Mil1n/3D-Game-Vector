const DEFAULT_INTENSITY = 0.8;
const MAX_DURATION = 0.075;
const EPSILON = 0.000001;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function settingsSource(settings = {}) {
  return settings && typeof settings === 'object' ? settings : {};
}

/**
 * Owns short real-time simulation freezes caused by resolved weapon impacts.
 * Game remains responsible for applying the returned multiplier to its fixed-step accumulator.
 */
export class HitStopController {
  constructor({ eventBus = null, settings = {}, canTrigger = null } = {}) {
    this.eventBus = eventBus;
    this.canTrigger = typeof canTrigger === 'function' ? canTrigger : () => true;
    this.intensity = DEFAULT_INTENSITY;
    this.reducedMotion = false;
    this.enabled = true;
    this.remaining = 0;
    this.lastDuration = 0;
    this.lastMultiplier = 1;
    this.lastShotId = null;
    this.triggerCount = 0;
    this.disposed = false;
    this.unsubscribers = [];

    this.applySettings(settings);
    this._subscribe();
  }

  get active() {
    return !this.disposed && this.enabled && this.remaining > EPSILON;
  }

  applySettings(settings = {}) {
    if (this.disposed) return this.getState();
    const source = settingsSource(settings);
    const gameplay = source.gameplay && typeof source.gameplay === 'object'
      ? source.gameplay
      : source;
    const accessibility = source.accessibility && typeof source.accessibility === 'object'
      ? source.accessibility
      : {};
    if (Object.hasOwn(gameplay, 'hitStop')) {
      this.intensity = clamp(finite(gameplay.hitStop, this.intensity), 0, 1);
    }
    if (Object.hasOwn(accessibility, 'reducedMotion')) {
      this.reducedMotion = accessibility.reducedMotion === true;
    }
    this.enabled = this.intensity > 0 && !this.reducedMotion;
    if (!this.enabled) this.reset();
    return this.getState();
  }

  request(durationSeconds, { shotId = null } = {}) {
    if (this.disposed || !this.enabled || !this.canTrigger()) return false;
    if (shotId !== null && shotId !== undefined && shotId === this.lastShotId) return false;
    const duration = clamp(finite(durationSeconds), 0, MAX_DURATION) * this.intensity;
    if (duration <= EPSILON) return false;

    const previous = this.remaining;
    this.remaining = Math.max(previous, duration);
    if (shotId !== null && shotId !== undefined) this.lastShotId = shotId;
    if (this.remaining <= previous + EPSILON) return false;

    this.lastDuration = duration;
    this.lastMultiplier = 0;
    this.triggerCount += 1;
    this.eventBus?.emit?.('hitstop:triggered', {
      duration,
      remaining: this.remaining,
      shotId,
      triggerCount: this.triggerCount,
    });
    return true;
  }

  /** Returns the fraction of this rendered frame that may advance simulation. */
  update(deltaSeconds) {
    if (this.disposed || !this.enabled || this.remaining <= EPSILON) {
      this.remaining = 0;
      this.lastMultiplier = 1;
      return 1;
    }

    const dt = Math.max(0, finite(deltaSeconds));
    if (dt <= 0) {
      this.lastMultiplier = 0;
      return 0;
    }

    const frozenTime = Math.min(dt, this.remaining);
    this.remaining = Math.max(0, this.remaining - frozenTime);
    this.lastMultiplier = clamp(1 - frozenTime / dt, 0, 1);
    if (this.remaining <= EPSILON) {
      this.remaining = 0;
      this.eventBus?.emit?.('hitstop:ended', {
        duration: this.lastDuration,
        triggerCount: this.triggerCount,
      });
    }
    return this.lastMultiplier;
  }

  reset() {
    this.remaining = 0;
    this.lastDuration = 0;
    this.lastMultiplier = 1;
    this.lastShotId = null;
    this.triggerCount = 0;
    return this.getState();
  }

  getState() {
    return {
      active: this.active,
      enabled: this.enabled,
      intensity: this.intensity,
      remaining: this.remaining,
      lastDuration: this.lastDuration,
      multiplier: this.lastMultiplier,
      triggerCount: this.triggerCount,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers.length = 0;
  }

  _subscribe() {
    if (typeof this.eventBus?.on !== 'function') return;
    this.unsubscribers.push(this.eventBus.on('combat:impact', (event = {}) => {
      this.request(event.hitStop, { shotId: event.shotId });
    }));
  }
}

export default HitStopController;
