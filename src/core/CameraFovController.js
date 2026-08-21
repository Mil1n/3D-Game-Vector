const DEFAULT_BASE_FOV = 82;
const DEFAULT_SPRINT_FOV = 92;
const MIN_BASE_FOV = 55;
const MAX_BASE_FOV = 110;
const MIN_RENDER_FOV = 42;
const MAX_RENDER_FOV = 120;
const MIN_ADS_MULTIPLIER = 0.45;
const MAX_ADS_MULTIPLIER = 1;
const RESPONSE_SPEED = 12;
const MAX_DELTA = 0.25;
const EPSILON = 0.0001;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function gameplaySettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return source.gameplay && typeof source.gameplay === 'object'
    ? source.gameplay
    : source;
}

/** Smoothly owns gameplay FOV without coupling the camera to input or weapon models. */
export class CameraFovController {
  constructor({ camera, settings = {} } = {}) {
    if (!camera) throw new Error('[CameraFovController] A camera is required.');
    this.camera = camera;
    this.disposed = false;
    this.baseFov = clamp(finite(camera.fov, DEFAULT_BASE_FOV), MIN_BASE_FOV, MAX_BASE_FOV);
    this.sprintFov = DEFAULT_SPRINT_FOV;
    this.currentFov = this.baseFov;
    this.targetFov = this.baseFov;
    this.lastContext = { sprinting: false, adsAmount: 0, adsFovMultiplier: 1 };
    this.applySettings(settings, { immediate: true });
  }

  applySettings(settings = {}, { immediate = true } = {}) {
    if (this.disposed) return this.getState();
    const gameplay = gameplaySettings(settings);
    if (Object.hasOwn(gameplay, 'fov')) {
      this.baseFov = clamp(finite(gameplay.fov, this.baseFov), MIN_BASE_FOV, MAX_BASE_FOV);
    }
    if (Object.hasOwn(gameplay, 'sprintFov')) {
      this.sprintFov = clamp(
        finite(gameplay.sprintFov, this.sprintFov),
        MIN_BASE_FOV,
        MAX_RENDER_FOV,
      );
    }
    this.targetFov = this._resolveTarget(this.lastContext);
    if (immediate) this.reset();
    return this.getState();
  }

  update(deltaSeconds, context = {}) {
    if (this.disposed) return this.currentFov;
    this._normalizeContext(context);
    this.targetFov = this._resolveTarget(this.lastContext);

    const rawDelta = Number(deltaSeconds);
    const dt = Number.isFinite(rawDelta) ? clamp(rawDelta, 0, MAX_DELTA) : 0;
    if (dt <= 0) return this.currentFov;

    const alpha = 1 - Math.exp(-RESPONSE_SPEED * dt);
    const nextFov = this.currentFov + (this.targetFov - this.currentFov) * alpha;
    this._setCameraFov(Math.abs(nextFov - this.targetFov) <= EPSILON ? this.targetFov : nextFov);
    return this.currentFov;
  }

  reset() {
    if (this.disposed) return this.getState();
    this.lastContext = { sprinting: false, adsAmount: 0, adsFovMultiplier: 1 };
    this.targetFov = this.baseFov;
    this._setCameraFov(this.baseFov);
    return this.getState();
  }

  getState() {
    return {
      currentFov: this.currentFov,
      targetFov: this.targetFov,
      baseFov: this.baseFov,
      sprintFov: this.sprintFov,
    };
  }

  dispose() {
    this.disposed = true;
  }

  _normalizeContext(context = {}) {
    this.lastContext.sprinting = Boolean(context.sprinting);
    this.lastContext.adsAmount = clamp(finite(context.adsAmount, 0), 0, 1);
    this.lastContext.adsFovMultiplier = clamp(
      finite(context.adsFovMultiplier, 1),
      MIN_ADS_MULTIPLIER,
      MAX_ADS_MULTIPLIER,
    );
  }

  _resolveTarget(context) {
    const movementFov = context.sprinting ? Math.max(this.baseFov, this.sprintFov) : this.baseFov;
    const adsFov = clamp(
      this.baseFov * context.adsFovMultiplier,
      MIN_RENDER_FOV,
      MAX_RENDER_FOV,
    );
    return clamp(
      movementFov + (adsFov - movementFov) * context.adsAmount,
      MIN_RENDER_FOV,
      MAX_RENDER_FOV,
    );
  }

  _setCameraFov(value) {
    const next = clamp(finite(value, this.baseFov), MIN_RENDER_FOV, MAX_RENDER_FOV);
    this.currentFov = next;
    const cameraFov = Number(this.camera.fov);
    if (Number.isFinite(cameraFov) && Math.abs(cameraFov - next) <= EPSILON) return;
    this.camera.fov = next;
    this.camera.updateProjectionMatrix?.();
  }
}

export default CameraFovController;
