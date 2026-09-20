import * as THREE from 'three';

import { DEFAULT_MAP_ID, resolveMapConfig } from '../configs/mapConfigs.js';

const HAZARD_STATES = Object.freeze({
  COOLDOWN: 'cooldown',
  WARNING: 'warning',
  ACTIVE: 'active',
});

const DEFAULT_ACTIVE_COLOR = 0xff456d;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function finitePosition(position) {
  return Boolean(position)
    && Number.isFinite(Number(position.x))
    && Number.isFinite(Number(position.y))
    && Number.isFinite(Number(position.z));
}

/**
 * Data-driven environmental danger zones with a readable warning phase.
 * The system owns presentation and damage timing, but never adds collision bodies.
 */
export class ArenaHazardSystem {
  constructor({
    scene,
    eventBus = null,
    player = null,
    map = DEFAULT_MAP_ID,
    mapConfig = null,
    reducedMotion = false,
  } = {}) {
    if (!scene?.add) throw new Error('[ArenaHazardSystem] A THREE.Scene is required.');
    this.scene = scene;
    this.eventBus = eventBus;
    this.player = player;
    this.reducedMotion = Boolean(reducedMotion);
    this.mapConfig = resolveMapConfig(mapConfig ?? map);
    this.mapId = this.mapConfig.id;
    this.elapsed = 0;
    this.disposed = false;
    this.zones = [];

    this.group = new THREE.Group();
    this.group.name = 'ARENA_HAZARDS';
    this.scene.add(this.group);

    this.geometries = {
      disc: new THREE.CylinderGeometry(1, 1, 1, 32, 1, false),
      ring: new THREE.TorusGeometry(1, 0.045, 6, 36),
      pylon: new THREE.BoxGeometry(1, 1, 1),
    };

    this._build();
  }

  _build() {
    const configs = this.mapConfig.hazards?.zones ?? [];
    for (let index = 0; index < configs.length; index += 1) {
      this._buildZone(configs[index], index);
    }
  }

  _buildZone(config, index) {
    const position = new THREE.Vector3().fromArray(config.position);
    const radius = Math.max(1, Number(config.radius) || 3.2);
    const idleColor = Number(config.idleColor ?? this.mapConfig.palette.hologramEmissive);
    const warningColor = Number(config.warningColor ?? this.mapConfig.palette.objectiveEmissive);
    const activeColor = Number(config.activeColor ?? DEFAULT_ACTIVE_COLOR);
    const visual = new THREE.Group();
    visual.name = `ARENA_HAZARD_${config.id}`;
    visual.position.copy(position);
    visual.userData.arenaHazard = { id: String(config.id), name: String(config.name ?? config.id) };

    const fillMaterial = new THREE.MeshBasicMaterial({
      color: idleColor,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const lineMaterial = new THREE.MeshBasicMaterial({
      color: idleColor,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const disc = new THREE.Mesh(this.geometries.disc, fillMaterial);
    disc.name = 'HAZARD_FIELD';
    disc.position.y = 0.035;
    disc.scale.set(radius, 0.025, radius);
    visual.add(disc);

    const ring = new THREE.Mesh(this.geometries.ring, lineMaterial);
    ring.name = 'HAZARD_RING';
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.085;
    ring.scale.setScalar(radius * 0.92);
    visual.add(ring);

    const pylons = new THREE.Group();
    pylons.name = 'HAZARD_MARKERS';
    const markerCount = 8;
    for (let marker = 0; marker < markerCount; marker += 1) {
      const angle = marker / markerCount * Math.PI * 2;
      const pylon = new THREE.Mesh(this.geometries.pylon, lineMaterial);
      pylon.name = `HAZARD_MARKER_${marker + 1}`;
      pylon.position.set(Math.sin(angle) * radius * 0.82, 0.16, Math.cos(angle) * radius * 0.82);
      pylon.scale.set(0.1, 0.28, 0.1);
      pylons.add(pylon);
    }
    visual.add(pylons);
    this.group.add(visual);

    const zone = {
      id: String(config.id ?? `hazard-${index + 1}`),
      name: String(config.name ?? 'Нестабильная зона'),
      cause: String(config.cause ?? config.name ?? 'Нестабильная зона'),
      position,
      radius,
      triggerHeight: Math.max(0.5, Number(config.triggerHeight) || 2.6),
      initialDelay: Math.max(0, Number(config.initialDelay) || 0),
      telegraphDuration: Math.max(0.35, Number(config.telegraphDuration) || 1.4),
      activeDuration: Math.max(0.35, Number(config.activeDuration) || 2.8),
      cooldown: Math.max(0.5, Number(config.cooldown) || 7),
      tickInterval: Math.max(0.2, Number(config.tickInterval) || 0.75),
      damage: Math.max(0, Number(config.damage) || 0),
      idleColor,
      warningColor,
      activeColor,
      state: HAZARD_STATES.COOLDOWN,
      remaining: Math.max(0, Number(config.initialDelay) || 0),
      damageRemaining: 0,
      inside: false,
      visual,
      disc,
      ring,
      pylons,
      materials: [fillMaterial, lineMaterial],
    };
    this.zones.push(zone);
    this._applyVisualState(zone, true);
  }

  _clearZones() {
    for (const zone of this.zones) {
      zone.visual.removeFromParent();
      for (const material of zone.materials) material.dispose();
    }
    this.group.clear();
    this.zones.length = 0;
  }

  _payload(zone, phase = zone.state) {
    const activePhase = phase === HAZARD_STATES.ACTIVE || phase === 'damage';
    return {
      id: zone.id,
      name: zone.name,
      cause: zone.cause,
      phase,
      position: zone.position.clone(),
      radius: zone.radius,
      damage: zone.damage,
      duration: phase === HAZARD_STATES.WARNING
        ? zone.telegraphDuration
        : activePhase
          ? zone.activeDuration
          : zone.cooldown,
      color: activePhase ? zone.activeColor : zone.warningColor,
    };
  }

  _transition(zone, state) {
    zone.state = state;
    zone.inside = false;
    if (state === HAZARD_STATES.WARNING) {
      zone.remaining = zone.telegraphDuration;
      zone.damageRemaining = 0;
      this._emit('arena:hazard-warning', this._payload(zone));
    } else if (state === HAZARD_STATES.ACTIVE) {
      zone.remaining = zone.activeDuration;
      zone.damageRemaining = 0;
      this._emit('arena:hazard-activated', this._payload(zone));
    } else {
      zone.remaining = zone.cooldown;
      zone.damageRemaining = 0;
      this._emit('arena:hazard-ended', this._payload(zone));
    }
    this._applyVisualState(zone, true);
  }

  _advanceState(zone, deltaSeconds) {
    zone.remaining -= deltaSeconds;
    let guard = 0;
    while (zone.remaining <= 0 && guard < 3) {
      const overshoot = -zone.remaining;
      if (zone.state === HAZARD_STATES.COOLDOWN) this._transition(zone, HAZARD_STATES.WARNING);
      else if (zone.state === HAZARD_STATES.WARNING) this._transition(zone, HAZARD_STATES.ACTIVE);
      else this._transition(zone, HAZARD_STATES.COOLDOWN);
      zone.remaining -= overshoot;
      guard += 1;
    }
  }

  _contains(zone, playerPosition) {
    if (!finitePosition(playerPosition)) return false;
    const relativeY = Number(playerPosition.y) - zone.position.y;
    if (relativeY < -0.35 || relativeY > zone.triggerHeight) return false;
    const dx = Number(playerPosition.x) - zone.position.x;
    const dz = Number(playerPosition.z) - zone.position.z;
    return dx * dx + dz * dz <= zone.radius * zone.radius;
  }

  _damagePlayer(zone, playerPosition, deltaSeconds) {
    if (zone.state !== HAZARD_STATES.ACTIVE) {
      zone.inside = false;
      zone.damageRemaining = 0;
      return 0;
    }
    zone.damageRemaining -= deltaSeconds;
    zone.inside = this._contains(zone, playerPosition);
    if (!zone.inside) return 0;
    if (zone.damageRemaining > 0 || zone.damage <= 0) return 0;
    zone.damageRemaining = zone.tickInterval;
    const result = this.player?.damage?.(zone.damage, {
      source: 'arenaHazard',
      position: zone.position,
      cause: zone.cause,
      type: 'environmental',
    });
    const appliedDamage = Math.max(0, Number(result?.healthDamage) || 0)
      + Math.max(0, Number(result?.armorDamage) || 0);
    if (appliedDamage <= 0) return 0;
    const payload = {
      ...this._payload(zone, 'damage'),
      damage: appliedDamage,
      result,
    };
    this._emit('arena:hazard-hit', payload);
    this._emit('combat:player-hit', {
      damage: appliedDamage,
      source: zone.position.clone(),
      cause: zone.cause,
    });
    return 1;
  }

  _applyVisualState(zone, immediate = false) {
    const warning = zone.state === HAZARD_STATES.WARNING;
    const active = zone.state === HAZARD_STATES.ACTIVE;
    const color = active ? zone.activeColor : warning ? zone.warningColor : zone.idleColor;
    const pulse = this.reducedMotion
      ? 1
      : 0.82 + Math.sin(this.elapsed * (active ? 11 : warning ? 7 : 2.4) + zone.radius) * 0.18;
    const fillOpacity = active
      ? 0.28 + pulse * 0.16
      : warning
        ? 0.13 + pulse * 0.11
        : 0.055 + pulse * 0.025;
    const lineOpacity = active
      ? 0.72 + pulse * 0.2
      : warning
        ? 0.5 + pulse * 0.22
        : 0.28 + pulse * 0.12;
    zone.disc.material.color.setHex(color);
    zone.disc.material.opacity = fillOpacity;
    zone.ring.material.color.setHex(color);
    zone.ring.material.opacity = lineOpacity;
    zone.ring.scale.setScalar(zone.radius * (this.reducedMotion ? 0.92 : 0.9 + pulse * 0.035));
    const markerHeight = active ? 0.75 : warning ? 0.48 : 0.28;
    const markerScale = this.reducedMotion || immediate ? markerHeight : markerHeight * (0.9 + pulse * 0.1);
    for (const marker of zone.pylons.children) {
      marker.material.color.setHex(color);
      marker.material.opacity = lineOpacity;
      marker.scale.y = markerScale;
      marker.position.y = markerScale * 0.5 + 0.04;
    }
  }

  update(deltaSeconds = 0, playerPosition = this.player?.position) {
    if (this.disposed) return 0;
    const dt = clamp(deltaSeconds, 0, 0.25);
    if (dt <= 0) return 0;
    this.elapsed += dt;
    let hits = 0;
    for (const zone of this.zones) {
      this._advanceState(zone, dt);
      this._applyVisualState(zone);
      hits += this._damagePlayer(zone, playerPosition, dt);
    }
    return hits;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = Boolean(enabled);
    for (const zone of this.zones) this._applyVisualState(zone, true);
    return this.reducedMotion;
  }

  setMap(map = DEFAULT_MAP_ID) {
    if (this.disposed) throw new Error('[ArenaHazardSystem] Cannot change a disposed system.');
    this._clearZones();
    this.mapConfig = resolveMapConfig(map);
    this.mapId = this.mapConfig.id;
    this.elapsed = 0;
    this._build();
    return this;
  }

  reset() {
    this.elapsed = 0;
    for (const zone of this.zones) {
      zone.state = HAZARD_STATES.COOLDOWN;
      zone.remaining = zone.initialDelay;
      zone.damageRemaining = 0;
      zone.inside = false;
      this._applyVisualState(zone, true);
    }
  }

  getDebugData() {
    return {
      mapId: this.mapId,
      zoneCount: this.zones.length,
      zones: this.zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        state: zone.state,
        remaining: zone.remaining,
        position: zone.position.clone(),
        radius: zone.radius,
        inside: zone.inside,
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
    this._clearZones();
    this.group.removeFromParent();
    Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    this.scene = null;
    this.eventBus = null;
    this.player = null;
  }
}

export { HAZARD_STATES };
export default ArenaHazardSystem;
