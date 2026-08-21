const DEFAULT_INTENSITY = 0.65;
const MAX_DELTA = 0.1;
const TRAUMA_DECAY = 4.6;
const BIAS_DECAY = 6.5;
const MAX_PITCH = 0.028;
const MAX_YAW = 0.018;
const MAX_ROLL = 0.032;
const MAX_POSITION_X = 0.026;
const MAX_POSITION_Y = 0.032;
const MAX_LANDING_PITCH = 0.018;
const MAX_LANDING_POSITION_Y = 0.018;
const LANDING_KICK_DECAY = 8;
const REST_EPSILON = 0.0005;
const HARD_LANDING_IMPACT = 9;

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

/** Applies bounded, deterministic camera impulses after the player has authored its base pose. */
export class CameraShakeController {
  constructor({ camera, eventBus = null, positionProvider = null, settings = {} } = {}) {
    if (!camera?.position || !camera?.rotation) {
      throw new Error('[CameraShakeController] A camera with position and rotation is required.');
    }
    this.camera = camera;
    this.eventBus = eventBus;
    this.positionProvider = typeof positionProvider === 'function' ? positionProvider : null;
    this.intensity = DEFAULT_INTENSITY;
    this.reducedMotion = false;
    this.enabled = true;
    this.trauma = 0;
    this.phase = 0;
    this.pitchBias = 0;
    this.yawBias = 0;
    this.rollBias = 0;
    this.landingPitchKick = 0;
    this.landingVerticalKick = 0;
    this.offsetPitch = 0;
    this.offsetYaw = 0;
    this.offsetRoll = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.offsetApplied = false;
    this.disposed = false;
    this.unsubscribers = [];

    this.applySettings(settings);
    this._subscribe();
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
    if (Object.hasOwn(gameplay, 'cameraShake')) {
      this.intensity = clamp(finite(gameplay.cameraShake, this.intensity), 0, 1);
    }
    if (Object.hasOwn(accessibility, 'reducedMotion')) {
      this.reducedMotion = accessibility.reducedMotion === true;
    }
    this.enabled = this.intensity > 0 && !this.reducedMotion;
    if (!this.enabled) this.reset();
    return this.getState();
  }

  impulse(strength, { pitch = 0, yaw = 0, roll = 0 } = {}) {
    if (this.disposed || !this.enabled) return false;
    const amount = clamp(finite(strength), 0, 1);
    if (amount <= 0) return false;
    this.trauma = clamp(this.trauma + amount, 0, 1);
    this.pitchBias = clamp(this.pitchBias + finite(pitch) * amount, -1, 1);
    this.yawBias = clamp(this.yawBias + finite(yaw) * amount, -1, 1);
    this.rollBias = clamp(this.rollBias + finite(roll) * amount, -1, 1);
    this.phase += 0.61 + amount * 0.37;
    return true;
  }

  restoreCamera() {
    if (!this.offsetApplied) return false;
    this.camera.position.x -= this.offsetX;
    this.camera.position.y -= this.offsetY;
    this.camera.rotation.x -= this.offsetPitch;
    this.camera.rotation.y -= this.offsetYaw;
    this.camera.rotation.z -= this.offsetRoll;
    this._clearOffset();
    this.camera.updateMatrixWorld?.();
    return true;
  }

  update(deltaSeconds) {
    if (this.disposed || !this.enabled || this.trauma <= 0) return this.trauma;
    const rawDelta = Number(deltaSeconds);
    const dt = Number.isFinite(rawDelta) ? clamp(rawDelta, 0, MAX_DELTA) : 0;
    if (dt <= 0) return this.trauma;

    this.phase += dt * (21 + this.trauma * 8);
    const envelope = this.trauma * this.trauma * this.intensity;
    const waveA = Math.sin(this.phase);
    const waveB = Math.sin(this.phase * 1.71 + 0.83);
    const waveC = Math.sin(this.phase * 2.37 + 1.91);
    const landingPitch = this.landingPitchKick * MAX_LANDING_PITCH * this.intensity;
    const landingY = this.landingVerticalKick * MAX_LANDING_POSITION_Y * this.intensity;
    this.offsetPitch = (waveA * 0.55 + this.pitchBias) * MAX_PITCH * envelope + landingPitch;
    this.offsetYaw = (waveB * 0.65 + this.yawBias) * MAX_YAW * envelope;
    this.offsetRoll = (waveC * 0.7 + this.rollBias) * MAX_ROLL * envelope;
    this.offsetX = waveB * MAX_POSITION_X * envelope;
    this.offsetY = waveA * MAX_POSITION_Y * envelope + landingY;

    this.camera.position.x += this.offsetX;
    this.camera.position.y += this.offsetY;
    this.camera.rotation.x += this.offsetPitch;
    this.camera.rotation.y += this.offsetYaw;
    this.camera.rotation.z += this.offsetRoll;
    this.offsetApplied = true;
    this.camera.updateMatrixWorld?.();

    this.trauma *= Math.exp(-TRAUMA_DECAY * dt);
    const biasDamping = Math.exp(-BIAS_DECAY * dt);
    this.pitchBias *= biasDamping;
    this.yawBias *= biasDamping;
    this.rollBias *= biasDamping;
    const landingDamping = Math.exp(-LANDING_KICK_DECAY * dt);
    this.landingPitchKick *= landingDamping;
    this.landingVerticalKick *= landingDamping;
    if (this.trauma < REST_EPSILON) {
      this.trauma = 0;
      this.landingPitchKick = 0;
      this.landingVerticalKick = 0;
    }
    return this.trauma;
  }

  reset() {
    this.restoreCamera();
    this.trauma = 0;
    this.phase = 0;
    this.pitchBias = 0;
    this.yawBias = 0;
    this.rollBias = 0;
    this.landingPitchKick = 0;
    this.landingVerticalKick = 0;
    this._clearOffset();
    return this.getState();
  }

  getState() {
    return {
      trauma: this.trauma,
      intensity: this.intensity,
      enabled: this.enabled,
      offset: {
        pitch: this.offsetPitch,
        yaw: this.offsetYaw,
        roll: this.offsetRoll,
        x: this.offsetX,
        y: this.offsetY,
      },
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
    this.unsubscribers.push(
      this.eventBus.on('player:damaged', (event = {}) => this._onPlayerDamaged(event)),
      this.eventBus.on('effects:explosion', (event = {}) => this._onExplosion(event)),
      this.eventBus.on('player:landed', (event = {}) => this._onPlayerLanded(event)),
    );
  }

  _onPlayerDamaged(event) {
    const amount = clamp(finite(event.amount), 0, 100);
    if (amount <= 0) return;
    const strength = clamp(0.08 + amount / 62, 0.1, 0.82);
    const directionX = clamp(finite(event.direction?.x), -1, 1);
    const directionY = clamp(finite(event.direction?.y), -1, 1);
    this.impulse(strength, {
      pitch: 0.45 + directionY * 0.18,
      yaw: -directionX * 0.72,
      roll: directionX * 0.9,
    });
  }

  _onExplosion({ position, radius } = {}) {
    const playerPosition = this.positionProvider?.();
    if (!position || !playerPosition) return;
    if (![position.x, position.y, position.z, playerPosition.x, playerPosition.y, playerPosition.z]
      .every((value) => Number.isFinite(Number(value)))) return;
    const dx = finite(position.x) - finite(playerPosition.x);
    const dy = finite(position.y) - finite(playerPosition.y);
    const dz = finite(position.z) - finite(playerPosition.z);
    const distance = Math.hypot(dx, dy, dz);
    const blastRadius = clamp(finite(radius, 3), 0.1, 30);
    const effectiveRange = Math.max(4, blastRadius * 3);
    const falloff = clamp(1 - distance / effectiveRange, 0, 1);
    if (falloff <= 0) return;
    const strength = clamp(falloff * (0.28 + blastRadius / 9), 0, 0.9);
    this.impulse(strength, { pitch: 0.4, roll: 0.18 });
  }

  _onPlayerLanded(event) {
    const impact = clamp(finite(event.impact), 0, 30);
    if (impact <= HARD_LANDING_IMPACT) return;
    const severity = clamp((impact - HARD_LANDING_IMPACT) / 11, 0, 1);
    const strength = 0.3 + severity * 0.48;
    if (!this.impulse(strength)) return;
    const landingKick = 0.35 + severity * 0.65;
    this.landingPitchKick = clamp(this.landingPitchKick - landingKick, -1, 0);
    this.landingVerticalKick = clamp(this.landingVerticalKick - landingKick, -1, 0);
  }

  _clearOffset() {
    this.offsetPitch = 0;
    this.offsetYaw = 0;
    this.offsetRoll = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.offsetApplied = false;
  }
}

export default CameraShakeController;
