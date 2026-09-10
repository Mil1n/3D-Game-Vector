import * as THREE from 'three';

import { DEFAULT_MAP_ID, resolveMapConfig } from '../configs/mapConfigs.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function finitePosition(position) {
  return Boolean(position)
    && Number.isFinite(Number(position.x))
    && Number.isFinite(Number(position.y))
    && Number.isFinite(Number(position.z));
}

function horizontalDirection(value) {
  const direction = new THREE.Vector3().fromArray(value ?? [0, 0, -1]);
  direction.y = 0;
  if (direction.lengthSq() < 1e-8) direction.set(0, 0, -1);
  return direction.normalize();
}

/**
 * Data-driven, non-physical traversal triggers and their procedural visuals.
 * Arena owns solid map geometry; this focused system owns launch/boost volumes.
 */
export class TraversalPadSystem {
  constructor({ scene, eventBus = null, map = DEFAULT_MAP_ID, mapConfig = null, reducedMotion = false } = {}) {
    if (!scene?.add) throw new Error('[TraversalPadSystem] A THREE.Scene is required.');
    this.scene = scene;
    this.eventBus = eventBus;
    this.reducedMotion = Boolean(reducedMotion);
    this.mapConfig = resolveMapConfig(mapConfig ?? map);
    this.mapId = this.mapConfig.id;
    this.elapsed = 0;
    this.disposed = false;
    this.devices = [];

    this.group = new THREE.Group();
    this.group.name = 'TRAVERSAL_DEVICES';
    this.scene.add(this.group);

    this.geometries = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 16, 1, false),
      ring: new THREE.TorusGeometry(1, 0.09, 6, 24),
      arrow: new THREE.ConeGeometry(1, 1, 3),
    };
    this.materials = {
      launch: new THREE.MeshStandardMaterial({
        roughness: 0.38,
        metalness: 0.34,
        emissiveIntensity: 1.15,
      }),
      boost: new THREE.MeshStandardMaterial({
        roughness: 0.42,
        metalness: 0.3,
        emissiveIntensity: 1.05,
      }),
      accent: new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.86,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    };

    this._applyPalette();
    this._build();
  }

  _applyPalette() {
    const palette = this.mapConfig.palette;
    this.materials.launch.color.setHex(palette.objective);
    this.materials.launch.emissive.setHex(palette.objectiveEmissive);
    this.materials.boost.color.setHex(palette.hologram);
    this.materials.boost.emissive.setHex(palette.hologramEmissive);
    this.materials.accent.color.setHex(palette.hologramEmissive);
  }

  _build() {
    const traversal = this.mapConfig.traversal ?? {};
    for (const config of traversal.launchPads ?? []) this._buildLaunchPad(config);
    for (const config of traversal.speedBoosters ?? []) this._buildSpeedBooster(config);
  }

  _buildLaunchPad(config) {
    const position = new THREE.Vector3().fromArray(config.position);
    const direction = horizontalDirection(config.direction);
    const radius = Math.max(0.5, Number(config.radius) || 2);
    const visual = new THREE.Group();
    visual.name = `TRAVERSAL_LAUNCH_${config.id}`;
    visual.position.copy(position);
    visual.rotation.y = Math.atan2(direction.x, direction.z);
    visual.userData.traversalDevice = { id: config.id, type: 'launch' };

    const base = new THREE.Mesh(this.geometries.cylinder, this.materials.launch);
    base.name = 'LAUNCH_BASE';
    base.scale.set(radius, 0.06, radius);
    base.position.y = 0.025;
    base.receiveShadow = true;
    visual.add(base);

    const ring = new THREE.Mesh(this.geometries.ring, this.materials.accent);
    ring.name = 'LAUNCH_RING';
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.16;
    ring.scale.setScalar(radius * 0.7);
    visual.add(ring);

    const arrow = new THREE.Mesh(this.geometries.arrow, this.materials.accent);
    arrow.name = 'LAUNCH_ARROW';
    arrow.rotation.x = Math.PI / 2;
    arrow.position.y = 0.72;
    arrow.scale.set(0.4, 0.86, 0.4);
    visual.add(arrow);
    this.group.add(visual);

    this.devices.push({
      id: String(config.id),
      type: 'launch',
      position,
      direction,
      radius,
      triggerHeight: Math.max(0.5, Number(config.triggerHeight) || 2.4),
      verticalSpeed: Math.max(0, Number(config.verticalSpeed) || 0),
      forwardSpeed: Math.max(0, Number(config.forwardSpeed) || 0),
      sustain: Math.max(0, Number(config.sustain) || 0),
      landingTarget: config.landingTarget ? {
        position: new THREE.Vector3().fromArray(config.landingTarget.position),
        radius: Math.max(0.5, Number(config.landingTarget.radius) || 3),
      } : null,
      cooldown: Math.max(0.05, Number(config.cooldown) || 0.6),
      cooldownRemaining: 0,
      activeRemaining: 0,
      occupied: false,
      visual,
      ring,
      arrow,
      arrows: [],
      color: this.mapConfig.palette.objectiveEmissive,
    });
  }

  _buildSpeedBooster(config) {
    const position = new THREE.Vector3().fromArray(config.position);
    const direction = horizontalDirection(config.direction);
    const width = Math.max(0.5, Number(config.size?.[0]) || 3);
    const length = Math.max(0.5, Number(config.size?.[1]) || 7);
    const visual = new THREE.Group();
    visual.name = `TRAVERSAL_BOOST_${config.id}`;
    visual.position.copy(position);
    visual.rotation.y = Math.atan2(direction.x, direction.z);
    visual.userData.traversalDevice = { id: config.id, type: 'boost' };

    const base = new THREE.Mesh(this.geometries.box, this.materials.boost);
    base.name = 'BOOST_BASE';
    base.scale.set(width, 0.05, length);
    base.position.y = 0.02;
    base.receiveShadow = true;
    visual.add(base);

    const arrows = [];
    for (let index = -1; index <= 1; index += 1) {
      const arrow = new THREE.Mesh(this.geometries.arrow, this.materials.accent);
      arrow.name = `BOOST_ARROW_${index + 1}`;
      arrow.rotation.x = Math.PI / 2;
      arrow.position.set(0, 0.18, index * length * 0.27);
      arrow.scale.set(width * 0.18, length * 0.12, 0.08);
      arrow.userData.baseY = arrow.position.y;
      arrow.userData.phase = (index + 1) / 3;
      visual.add(arrow);
      arrows.push(arrow);
    }
    this.group.add(visual);

    this.devices.push({
      id: String(config.id),
      type: 'boost',
      position,
      direction,
      width,
      length,
      triggerHeight: Math.max(0.5, Number(config.triggerHeight) || 2.4),
      speed: Math.max(0, Number(config.speed) || 0),
      verticalSpeed: Math.max(0, Number(config.verticalSpeed) || 0),
      sustain: Math.max(0, Number(config.sustain) || 0),
      cooldown: Math.max(0.05, Number(config.cooldown) || 0.5),
      cooldownRemaining: 0,
      activeRemaining: 0,
      occupied: false,
      visual,
      ring: null,
      arrow: null,
      arrows,
      color: this.mapConfig.palette.hologramEmissive,
    });
  }

  _contains(device, playerPosition) {
    const relativeY = Number(playerPosition.y) - device.position.y;
    if (relativeY < -0.35 || relativeY > device.triggerHeight) return false;
    const dx = Number(playerPosition.x) - device.position.x;
    const dz = Number(playerPosition.z) - device.position.z;
    if (device.type === 'launch') return dx * dx + dz * dz <= device.radius * device.radius;
    const forward = dx * device.direction.x + dz * device.direction.z;
    const side = dx * -device.direction.z + dz * device.direction.x;
    return Math.abs(forward) <= device.length * 0.5 && Math.abs(side) <= device.width * 0.5;
  }

  _animateDevice(device, dt) {
    const activation = device.activeRemaining > 0
      ? clamp(device.activeRemaining / 0.34, 0, 1)
      : 0;
    if (device.type === 'launch') {
      if (this.reducedMotion) {
        device.arrow.rotation.y = 0;
        device.arrow.position.y = 0.72;
        device.ring.scale.setScalar(device.radius * 0.7);
        return;
      }
      if (!this.reducedMotion) device.arrow.rotation.y += dt * (1.8 + activation * 4);
      const bob = Math.sin(this.elapsed * 3.4) * 0.06;
      device.arrow.position.y = 0.72 + bob + activation * 0.18;
      const pulse = 0.7 + Math.sin(this.elapsed * 4.2) * 0.035 + activation * 0.14;
      device.ring.scale.setScalar(device.radius * pulse);
      return;
    }
    if (this.reducedMotion) {
      for (const arrow of device.arrows) arrow.position.y = arrow.userData.baseY;
      return;
    }
    for (const arrow of device.arrows) {
      const wave = Math.sin((this.elapsed + arrow.userData.phase) * 7) * 0.035;
      arrow.position.y = arrow.userData.baseY + wave + activation * 0.07;
    }
  }

  _activate(device) {
    device.cooldownRemaining = device.cooldown;
    device.activeRemaining = 0.34;
    const payload = {
      id: device.id,
      type: device.type,
      position: device.position.clone(),
      direction: device.direction.clone(),
      speed: device.speed ?? device.forwardSpeed,
      forwardSpeed: device.forwardSpeed ?? device.speed,
      verticalSpeed: device.verticalSpeed,
      sustain: device.sustain,
      cooldown: device.cooldown,
      color: device.color,
    };
    this._emit('arena:traversal-activated', payload);
    return payload;
  }

  update(deltaSeconds = 0, playerPosition = null) {
    if (this.disposed) return 0;
    const dt = clamp(deltaSeconds, 0, 0.25);
    this.elapsed += dt;
    const tracksPlayer = finitePosition(playerPosition);
    let activated = 0;
    for (const device of this.devices) {
      device.cooldownRemaining = Math.max(0, device.cooldownRemaining - dt);
      device.activeRemaining = Math.max(0, device.activeRemaining - dt);
      this._animateDevice(device, dt);
      if (!tracksPlayer) continue;
      const inside = this._contains(device, playerPosition);
      if (!inside) {
        device.occupied = false;
        continue;
      }
      if (device.occupied) continue;
      device.occupied = true;
      if (device.cooldownRemaining > 0) continue;
      this._activate(device);
      activated += 1;
    }
    return activated;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = Boolean(enabled);
    for (const device of this.devices) this._animateDevice(device, 0);
    return this.reducedMotion;
  }

  setMap(map = DEFAULT_MAP_ID) {
    if (this.disposed) throw new Error('[TraversalPadSystem] Cannot change a disposed system.');
    this.group.clear();
    this.devices.length = 0;
    this.mapConfig = resolveMapConfig(map);
    this.mapId = this.mapConfig.id;
    this.elapsed = 0;
    this._applyPalette();
    this._build();
    return this;
  }

  reset() {
    this.elapsed = 0;
    for (const device of this.devices) {
      device.cooldownRemaining = 0;
      device.activeRemaining = 0;
      device.occupied = false;
      this._animateDevice(device, 0);
    }
  }

  getDebugData() {
    return {
      mapId: this.mapId,
      deviceCount: this.devices.length,
      devices: this.devices.map((device) => ({
        id: device.id,
        type: device.type,
        position: device.position.clone(),
        direction: device.direction.clone(),
        landingTarget: device.landingTarget ? {
          position: device.landingTarget.position.clone(),
          radius: device.landingTarget.radius,
        } : null,
        cooldownRemaining: device.cooldownRemaining,
        occupied: device.occupied,
      })),
    };
  }

  _emit(type, payload) {
    if (typeof this.eventBus?.emit === 'function') this.eventBus.emit(type, payload);
    else if (typeof this.eventBus?.dispatchEvent === 'function') this.eventBus.dispatchEvent({ type, ...payload });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.group.clear();
    this.devices.length = 0;
    Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
    this.scene = null;
    this.eventBus = null;
  }
}

export default TraversalPadSystem;
