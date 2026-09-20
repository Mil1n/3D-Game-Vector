import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { DEFAULT_MAP_ID, resolveMapConfig } from '../configs/mapConfigs.js';
import { ARENA_COLLISION_GROUP } from './Arena.js';

const HALF_SIZE = new CANNON.Vec3(0.55, 0.8, 0.55);
const COLOR = 0xffa837;
const WARNING_COLOR = 0xff493f;

/** Shootable physical containers. All timers use the paused/Overdrive world clock. */
export class ExplosivePropSystem {
  constructor({ scene, world, arena, player = null, enemySystem = null, eventBus = null,
    map = DEFAULT_MAP_ID, mapConfig = null, reducedMotion = false }) {
    this.scene = scene;
    this.world = world;
    this.arena = arena;
    this.player = player;
    this.enemySystem = enemySystem;
    this.eventBus = eventBus;
    this.reducedMotion = Boolean(reducedMotion);
    this.disposed = false;
    this.props = [];
    this.byBody = new Map();
    this.direction = new THREE.Vector3();
    this.group = new THREE.Group();
    this.group.name = 'EXPLOSIVE_CONTAINERS';
    scene.add(this.group);
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.ringGeometry = new THREE.TorusGeometry(1, 0.025, 4, 48);
    this.shellMaterial = new THREE.MeshStandardMaterial({ color: 0x273342, metalness: 0.7, roughness: 0.4 });
    this.trimMaterial = new THREE.MeshStandardMaterial({ color: COLOR, metalness: 0.35, roughness: 0.5 });
    this.setMap(mapConfig ?? map);
  }

  setMap(map) {
    if (this.disposed) throw new Error('Cannot rebuild a disposed system.');
    this._clear();
    this.mapConfig = resolveMapConfig(map);
    for (const config of this.mapConfig.explosives ?? []) {
      const position = new THREE.Vector3().fromArray(config.position);
      position.y += HALF_SIZE.y;
      const visual = new THREE.Group();
      visual.name = `EXPLOSIVE_${config.id}`;
      visual.position.copy(position);
      const coreMaterial = new THREE.MeshStandardMaterial({
        color: COLOR, emissive: COLOR, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.3,
      });
      const mesh = (size, offset, material) => {
        const part = new THREE.Mesh(this.geometry, material);
        part.scale.set(...size);
        part.position.set(...offset);
        visual.add(part);
      };
      mesh([0.88, 1.2, 0.88], [0, 0, 0], coreMaterial);
      for (const y of [-0.68, 0.68]) mesh([1.1, 0.24, 1.1], [0, y, 0], this.shellMaterial);
      for (const x of [-0.46, 0.46]) mesh([0.13, 1.25, 1.05], [x, 0, 0], this.trimMaterial);
      const ringMaterial = new THREE.MeshBasicMaterial({ color: WARNING_COLOR, transparent: true,
        opacity: 0.85, depthWrite: false, toneMapped: false });
      const ring = new THREE.Mesh(this.ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -HALF_SIZE.y + 0.06;
      const radius = config.radius ?? 6;
      ring.scale.setScalar(radius);
      visual.add(ring);
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(HALF_SIZE.clone()),
        position: new CANNON.Vec3(position.x, position.y, position.z),
        collisionFilterGroup: ARENA_COLLISION_GROUP, collisionFilterMask: -1 });
      const prop = { id: config.id, position, visual, body, ring, coreMaterial, ringMaterial,
        radius, maxHealth: config.health ?? 32, fuse: config.fuse ?? 1,
        damage: config.damage ?? 140, playerDamage: config.playerDamage ?? 42,
        state: 'idle', health: 0, remaining: 0 };
      this.props.push(prop);
      this.byBody.set(body, prop);
      this.group.add(visual);
    }
    this.reset();
  }

  damageBody(body, amount) {
    const prop = this.byBody.get(body);
    if (this.disposed || !prop || prop.state !== 'idle' || !Number.isFinite(amount) || amount <= 0) return false;
    prop.health = Math.max(0, prop.health - amount);
    if (prop.health === 0) {
      prop.state = 'armed';
      prop.remaining = prop.fuse;
      this._visual(prop);
      this.eventBus?.emit?.('arena:prop-armed', this._payload(prop));
    }
    return true;
  }

  damageInRadius(position, radius, damage) {
    if (this.disposed || !(radius > 0) || !Number.isFinite(damage) || damage <= 0) return 0;
    let hits = 0;
    for (const prop of this.props) {
      if (prop.state !== 'idle') continue;
      const distance = prop.position.distanceTo(position);
      if (distance > radius) continue;
      this.direction.subVectors(prop.position, position).normalize();
      const obstruction = this.arena?.raycastWorld?.(position, this.direction, distance);
      // Hitting the target container's own collider is not an obstruction.
      if (obstruction?.hit && obstruction.body !== prop.body) continue;
      if (this.damageBody(prop.body, damage * (1 - distance / radius * 0.72))) hits += 1;
    }
    return hits;
  }

  update(delta) {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    // Separate timer and detonation passes: a chain always receives its full fuse,
    // regardless of the order of containers in the map configuration.
    for (const prop of this.props) {
      if (prop.state !== 'armed') continue;
      prop.remaining -= delta;
      this._visual(prop);
    }
    for (const prop of this.props) {
      if (prop.state === 'armed' && prop.remaining <= 0) this._explode(prop);
    }
  }

  _explode(prop) {
    prop.state = 'spent';
    prop.visual.visible = false;
    this.world.removeBody(prop.body); // The source must not shield its own blast.
    const summary = this.enemySystem?.damageInRadius?.(prop.position, prop.radius, prop.damage, {
      source: 'player', weapon: 'container-explosion', zone: 'body', returnSummary: true,
    }) ?? { hits: 0, kills: 0, damage: 0 };
    this.damageInRadius(prop.position, prop.radius, prop.damage);
    const position = this.player?.position;
    if (position && !this.player.dead) {
      const distance = prop.position.distanceTo(position);
      if (distance <= prop.radius && (this.arena?.hasLineOfSight?.(prop.position, position) ?? true)) {
        const result = this.player.damage?.(prop.playerDamage * (1 - distance / prop.radius * 0.72), {
          source: 'explosiveProp', position: prop.position, cause: 'Взрыв энергоконтейнера', type: 'environmental',
        });
        const applied = Math.max(0, Number(result?.healthDamage) || 0) + Math.max(0, Number(result?.armorDamage) || 0);
        if (applied > 0) this.eventBus?.emit?.('combat:player-hit', {
          damage: applied, source: prop.position.clone(), cause: 'Взрыв энергоконтейнера',
        });
      }
    }
    this.eventBus?.emit?.('arena:prop-exploded', { ...this._payload(prop), ...summary });
  }

  _payload(prop) {
    return { id: prop.id, position: prop.position.clone(), radius: prop.radius, color: COLOR };
  }

  _visual(prop) {
    const armed = prop.state === 'armed';
    prop.ring.visible = armed;
    prop.coreMaterial.color.setHex(armed ? WARNING_COLOR : COLOR);
    prop.coreMaterial.emissive.setHex(armed ? WARNING_COLOR : COLOR);
    // A gradual increase in glow, not a strobe; Reduced Motion is completely static.
    prop.coreMaterial.emissiveIntensity = armed && !this.reducedMotion
      ? 0.65 + Math.max(0, 1 - prop.remaining / prop.fuse) * 0.85 : 0.55;
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
    for (const prop of this.props) this._visual(prop);
  }

  reset() {
    if (this.disposed) return;
    for (const prop of this.props) {
      prop.state = 'idle';
      prop.health = prop.maxHealth;
      prop.remaining = 0;
      prop.visual.visible = true;
      if (prop.body.world !== this.world) this.world.addBody(prop.body);
      this._visual(prop);
    }
  }

  _clear() {
    for (const prop of this.props) {
      if (prop.body.world === this.world) this.world.removeBody(prop.body);
      prop.coreMaterial.dispose();
      prop.ringMaterial.dispose();
    }
    this.group.clear();
    this.props.length = 0;
    this.byBody.clear();
  }

  dispose() {
    if (this.disposed) return;
    this._clear();
    this.geometry.dispose();
    this.ringGeometry.dispose();
    this.shellMaterial.dispose();
    this.trimMaterial.dispose();
    this.scene.remove(this.group);
    this.disposed = true;
  }
}
