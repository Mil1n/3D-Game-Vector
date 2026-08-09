import * as THREE from 'three';

const DEFAULT_SETTINGS = Object.freeze({
  antialias: true,
  shadows: true,
  shadowMapSize: 1024,
  pixelRatio: 1,
  maxPixelRatio: 1.75,
  fov: 76,
  near: 0.06,
  far: 180,
  exposure: 1.12,
  fogNear: 54,
  fogFar: 142,
  clearColor: 0x172536,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function disposeMaterial(material) {
  if (!material) return;
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    for (const value of Object.values(entry)) {
      if (value?.isTexture) value.dispose();
    }
    entry.dispose?.();
  }
}

/** Owns the render-facing half of VECTOR//NULL. Physics and gameplay stay elsewhere. */
export class SceneManager {
  constructor(canvasOrOptions = {}, legacySettings = {}) {
    const options = canvasOrOptions?.getContext
      ? { canvas: canvasOrOptions, settings: legacySettings }
      : canvasOrOptions;

    const { canvas, eventBus = null } = options ?? {};
    if (!canvas) throw new Error('[SceneManager] A canvas is required.');

    this.canvas = canvas;
    this.eventBus = eventBus;
    const providedSettings = options?.settings ?? {};
    const flattenedSettings = providedSettings.graphics
      ? {
          ...providedSettings.graphics,
          ...(providedSettings.gameplay?.fov != null ? { fov: providedSettings.gameplay.fov } : {}),
        }
      : providedSettings;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...flattenedSettings,
    };
    if (flattenedSettings.resolutionScale != null && flattenedSettings.pixelRatio == null) {
      this.settings.pixelRatio = flattenedSettings.resolutionScale;
    }
    if (typeof flattenedSettings.shadowQuality === 'string' && flattenedSettings.shadowMapSize == null) {
      this.settings.shadowMapSize = { off: 256, low: 512, medium: 1024, high: 2048 }[flattenedSettings.shadowQuality] ?? 1024;
      if (flattenedSettings.shadowQuality === 'off') this.settings.shadows = false;
    }
    this._disposed = false;
    this._elapsed = 0;
    this._frameAccumulator = 0;
    this._frameSamples = 0;
    this._resizeObserver = null;

    this.stats = {
      fps: 0,
      frameTime: 0,
      drawCalls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
      width: 1,
      height: 1,
      pixelRatio: 1,
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: Boolean(this.settings.antialias),
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.settings.exposure;
    this.renderer.shadowMap.enabled = Boolean(this.settings.shadows);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;

    this.scene = new THREE.Scene();
    this.scene.name = 'VECTOR_NULL_WORLD';
    this.scene.background = new THREE.Color(this.settings.clearColor);
    this.scene.fog = new THREE.Fog(
      this.settings.clearColor,
      this.settings.fogNear,
      this.settings.fogFar,
    );

    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      1,
      this.settings.near,
      this.settings.far,
    );
    this.camera.name = 'PLAYER_CAMERA';
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.environment = new THREE.Group();
    this.environment.name = 'SCENE_LIGHTING';
    this.scene.add(this.environment);
    this._createLighting();

    this._onResize = () => this.resize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onResize, { passive: true });
    }
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(canvas);
    }
    this.resize();
  }

  _createLighting() {
    // Broad cool daylight is the arena's readability layer.  The brighter
    // ground colour deliberately fills ramp undersides and cover faces that
    // the directional key cannot reach, without adding another shadow pass.
    const hemisphere = new THREE.HemisphereLight(0xc9e8ff, 0x46566b, 2.25);
    hemisphere.name = 'LATTICE_SKYLIGHT';
    this.environment.add(hemisphere);

    const key = new THREE.DirectionalLight(0xf4f8ff, 3.1);
    key.name = 'LATTICE_KEY';
    key.position.set(-28, 46, 22);
    key.target.position.set(0, 0, 0);
    key.castShadow = Boolean(this.settings.shadows);
    const shadowSize = clamp(Number(this.settings.shadowMapSize) || 1024, 256, 2048);
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.left = -52;
    key.shadow.camera.right = 52;
    key.shadow.camera.top = 52;
    key.shadow.camera.bottom = -52;
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 105;
    key.shadow.bias = -0.00018;
    key.shadow.normalBias = 0.025;
    this.environment.add(key, key.target);

    // A shadowless counter-key separates silhouettes on the far side of the
    // spire.  Directional fill is cheaper and more even than a field of lamps.
    const fill = new THREE.DirectionalLight(0x78b8dd, 1.05);
    fill.name = 'LATTICE_FILL';
    fill.position.set(31, 19, -28);
    fill.target.position.set(0, 2, 0);
    this.environment.add(fill, fill.target);

    // Phase lights remain accents rather than the arena's primary exposure.
    // Their lower energy prevents cyan/magenta VFX from clipping into white.
    const cyan = new THREE.PointLight(0x20dce5, 18, 58, 2);
    cyan.name = 'PHASE_CYAN';
    cyan.position.set(16, 11, -17);
    this.environment.add(cyan);

    const magenta = new THREE.PointLight(0xa83cff, 14, 50, 2);
    magenta.name = 'PHASE_MAGENTA';
    magenta.position.set(-20, 8, 14);
    this.environment.add(magenta);

    this.lights = { hemisphere, key, fill, cyan, magenta };
  }

  resize(width, height, pixelRatio) {
    if (this._disposed) return this.stats;
    const rect = this.canvas.getBoundingClientRect?.();
    const nextWidth = Math.max(1, Math.floor(width ?? rect?.width ?? this.canvas.clientWidth ?? 1));
    const nextHeight = Math.max(1, Math.floor(height ?? rect?.height ?? this.canvas.clientHeight ?? 1));
    const deviceRatio = pixelRatio ?? (
      (typeof window !== 'undefined' ? window.devicePixelRatio : 1) * this.settings.pixelRatio
    );
    const ratio = clamp(deviceRatio || 1, 0.5, this.settings.maxPixelRatio);

    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(nextWidth, nextHeight, false);
    this.camera.aspect = nextWidth / nextHeight;
    this.camera.updateProjectionMatrix();

    Object.assign(this.stats, {
      width: nextWidth,
      height: nextHeight,
      pixelRatio: ratio,
    });
    return this.stats;
  }

  applySettings(partial = {}) {
    if (this._disposed) return this.settings;
    if (partial.graphics) {
      partial = {
        ...partial.graphics,
        ...(partial.gameplay?.fov != null ? { fov: partial.gameplay.fov } : {}),
      };
    }
    if (partial.resolutionScale != null && partial.pixelRatio == null) {
      partial = { ...partial, pixelRatio: partial.resolutionScale };
    }
    if (typeof partial.shadowQuality === 'string' && partial.shadowMapSize == null) {
      partial = {
        ...partial,
        shadowMapSize: { off: 256, low: 512, medium: 1024, high: 2048 }[partial.shadowQuality] ?? 1024,
        ...(partial.shadowQuality === 'off' ? { shadows: false } : {}),
      };
    }
    Object.assign(this.settings, partial);

    this.renderer.toneMappingExposure = clamp(Number(this.settings.exposure) || 1, 0.25, 2.5);
    this.renderer.shadowMap.enabled = Boolean(this.settings.shadows);
    this.lights.key.castShadow = Boolean(this.settings.shadows);
    const shadowSize = clamp(Number(this.settings.shadowMapSize) || 1024, 256, 2048);
    this.lights.key.shadow.mapSize.set(shadowSize, shadowSize);
    this.lights.key.shadow.map?.dispose();
    this.lights.key.shadow.map = null;

    this.camera.fov = clamp(Number(this.settings.fov) || DEFAULT_SETTINGS.fov, 55, 110);
    this.camera.near = Math.max(0.01, Number(this.settings.near) || DEFAULT_SETTINGS.near);
    this.camera.far = Math.max(this.camera.near + 1, Number(this.settings.far) || DEFAULT_SETTINGS.far);
    this.camera.updateProjectionMatrix();

    const clearColor = new THREE.Color(this.settings.clearColor);
    this.scene.background.copy(clearColor);
    if (this.scene.fog) {
      this.scene.fog.color.copy(clearColor);
      this.scene.fog.near = Math.max(0, Number(this.settings.fogNear) || 0);
      this.scene.fog.far = Math.max(
        this.scene.fog.near + 1,
        Number(this.settings.fogFar) || DEFAULT_SETTINGS.fogFar,
      );
    }
    this.resize();
    this._emit('graphics:changed', { ...this.settings });
    return this.settings;
  }

  setSettings(partial = {}) {
    return this.applySettings(partial);
  }

  render(deltaSeconds = 0) {
    if (this._disposed) return this.stats;
    const dt = clamp(Number(deltaSeconds) || 0, 0, 0.25);
    this._elapsed += dt;

    // A nearly imperceptible phase-light drift keeps the procedural scene alive.
    this.lights.cyan.intensity = 18 + Math.sin(this._elapsed * 1.7) * 2.5;
    this.lights.magenta.intensity = 14 + Math.sin(this._elapsed * 1.17 + 1.8) * 2;

    const started = typeof performance !== 'undefined' ? performance.now() : 0;
    this.renderer.render(this.scene, this.camera);
    const elapsedMs = typeof performance !== 'undefined' ? performance.now() - started : 0;
    this._frameAccumulator += dt;
    this._frameSamples += 1;
    if (this._frameAccumulator >= 0.5) {
      this.stats.fps = this._frameAccumulator > 0
        ? this._frameSamples / this._frameAccumulator
        : 0;
      this._frameAccumulator = 0;
      this._frameSamples = 0;
    }

    const info = this.renderer.info;
    Object.assign(this.stats, {
      frameTime: elapsedMs,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    });
    return this.stats;
  }

  getStats() {
    return { ...this.stats };
  }

  add(...objects) {
    this.scene.add(...objects);
    return objects.length === 1 ? objects[0] : objects;
  }

  remove(...objects) {
    this.scene.remove(...objects);
  }

  _emit(type, payload) {
    if (typeof this.eventBus?.emit === 'function') this.eventBus.emit(type, payload);
    else if (typeof this.eventBus?.dispatchEvent === 'function') {
      this.eventBus.dispatchEvent({ type, ...payload });
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (typeof window !== 'undefined') window.removeEventListener('resize', this._onResize);
    this._resizeObserver?.disconnect();

    this.scene.traverse((object) => {
      object.geometry?.dispose?.();
      disposeMaterial(object.material);
    });
    this.renderer.renderLists?.dispose?.();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.scene.clear();
  }
}

export { DEFAULT_SETTINGS as SCENE_DEFAULT_SETTINGS };
export default SceneManager;
