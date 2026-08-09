import * as THREE from 'three';
import { WEAPON_CONFIGS, WEAPON_ORDER } from '../configs/weaponConfigs.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function resolveConfig(id) {
  const config = Array.isArray(WEAPON_CONFIGS)
    ? WEAPON_CONFIGS.find((entry) => entry.id === id)
    : WEAPON_CONFIGS[id];
  if (!config) throw new Error(`[WeaponSystem] Missing weapon config: ${id}`);
  return config;
}

function createWeaponModel(config) {
  const group = new THREE.Group();
  group.name = `Viewmodel ${config.id}`;
  const shell = new THREE.MeshStandardMaterial({ color: 0x17252b, roughness: 0.34, metalness: 0.82 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x05090c, roughness: 0.5, metalness: 0.65 });
  const glow = new THREE.MeshBasicMaterial({ color: config.color ?? 0x5ee7ff });
  const details = [];
  const addBox = (size, position, material = shell, rotation = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    group.add(mesh);
    details.push(mesh);
    return mesh;
  };
  const addTorus = (radius, tube, position, material = glow, rotation = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 7, 18), material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    group.add(mesh);
    details.push(mesh);
    return mesh;
  };

  const modelStyle = config.model ?? config.id;
  if (modelStyle === 'scatter') {
    addBox([0.18, 0.19, 0.92], [0.02, -0.01, -0.4]);
    addBox([0.08, 0.08, 0.72], [-0.07, 0.08, -0.74], dark);
    addBox([0.08, 0.08, 0.72], [0.07, 0.08, -0.74], dark);
    addBox([0.22, 0.08, 0.29], [0, -0.13, -0.18], dark, [-0.28, 0, 0]);
    addBox([0.24, 0.018, 0.42], [0, 0.12, -0.49], glow);
  } else if (modelStyle === 'rail') {
    addBox([0.16, 0.2, 1.24], [0, 0, -0.56]);
    addBox([0.28, 0.05, 0.92], [0, 0.13, -0.68], dark);
    addBox([0.035, 0.035, 1.1], [-0.12, 0.13, -0.72], glow);
    addBox([0.035, 0.035, 1.1], [0.12, 0.13, -0.72], glow);
    addBox([0.17, 0.2, 0.27], [0, -0.17, -0.18], dark, [-0.2, 0, 0]);
  } else if (modelStyle === 'plasma-smg') {
    addBox([0.22, 0.18, 0.62], [0, 0.01, -0.34]);
    addBox([0.12, 0.1, 0.46], [0, 0.055, -0.68], dark);
    addBox([0.035, 0.12, 0.48], [-0.135, 0.055, -0.42], glow);
    addBox([0.035, 0.12, 0.48], [0.135, 0.055, -0.42], glow);
    addBox([0.15, 0.25, 0.16], [0, -0.17, -0.2], glow, [-0.2, 0, 0]);
    addTorus(0.09, 0.018, [0, 0.055, -0.81], glow);
  } else if (modelStyle === 'nova-cannon') {
    addBox([0.28, 0.25, 0.92], [0, -0.005, -0.45]);
    addBox([0.2, 0.17, 0.5], [0, 0.045, -0.93], dark);
    addBox([0.3, 0.08, 0.72], [0, 0.15, -0.55], dark);
    addBox([0.22, 0.3, 0.24], [0, -0.2, -0.2], dark, [-0.18, 0, 0]);
    addTorus(0.15, 0.026, [0, 0.045, -0.76], glow);
    addTorus(0.14, 0.024, [0, 0.045, -0.93], glow);
    addTorus(0.12, 0.021, [0, 0.045, -1.09], glow);
  } else {
    addBox([0.17, 0.21, 0.82], [0, 0, -0.36]);
    addBox([0.075, 0.075, 0.62], [0, 0.06, -0.82], dark);
    addBox([0.18, 0.28, 0.18], [0, -0.19, -0.18], dark, [-0.18, 0, 0]);
    addBox([0.2, 0.025, 0.5], [0, 0.125, -0.42], glow);
    addBox([0.12, 0.1, 0.14], [0, 0.19, -0.12], dark);
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(
    0,
    0.06,
    config.viewModel?.muzzleZ ?? (config.id === 'rail' ? -1.22 : config.id === 'scatter' ? -0.83 : -0.91),
  );
  group.add(muzzle);
  group.userData.muzzle = muzzle;
  group.userData.materials = [shell, dark, glow];
  group.userData.basePosition = new THREE.Vector3(...(config.viewModel?.basePosition ?? [0.43, -0.36, -0.72]));
  group.userData.adsPosition = new THREE.Vector3(...(config.viewModel?.adsPosition ?? [0, -0.245, -0.62]));
  group.position.copy(group.userData.basePosition);
  group.scale.setScalar(config.viewModel?.scale ?? 0.92);
  group.traverse((child) => {
    child.frustumCulled = false;
    child.renderOrder = 10;
    if (child.isMesh) child.material.depthTest = false;
  });
  return group;
}

export class WeaponSystem {
  constructor({ camera, scene, eventBus, audioManager, effects, arena, player, enemySystem = null }) {
    this.camera = camera;
    this.scene = scene;
    this.eventBus = eventBus;
    this.audio = audioManager;
    this.effects = effects;
    this.arena = arena;
    this.player = player;
    this.enemySystem = enemySystem;
    this.enabled = false;
    this.weaponOrder = [...WEAPON_ORDER];
    this.index = 0;
    this.cooldown = 0;
    this.reloadRemaining = 0;
    this.recoilKick = 0;
    this.modelKick = 0;
    this.adsAmount = 0;
    this.triggerReleased = true;
    this.infiniteAmmo = false;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.modifiers = this.defaultModifiers();
    this.ammo = new Map();
    this.models = new Map();
    this.tempOrigin = new THREE.Vector3();
    this.tempDirection = new THREE.Vector3();
    this.tempRight = new THREE.Vector3();
    this.tempUp = new THREE.Vector3();
    this.tempEnd = new THREE.Vector3();
    this.tempMuzzle = new THREE.Vector3();

    for (const id of this.weaponOrder) {
      const config = resolveConfig(id);
      this.ammo.set(id, { magazine: config.magazine, reserve: config.reserve });
      const model = createWeaponModel(config);
      model.visible = false;
      this.camera.add(model);
      this.models.set(id, model);
    }
    this.currentModel.visible = true;
  }

  defaultModifiers() {
    return {
      damage: 1,
      reloadMultiplier: 1,
      shotgunPellets: 0,
      railRicochet: 0,
      critChance: 0,
      headshotExplosion: 0,
      lowHealthDamage: 0,
      railAnomalyMultiplier: 1,
    };
  }

  setEnemySystem(enemySystem) {
    this.enemySystem = enemySystem;
  }

  get currentId() {
    return this.weaponOrder[this.index];
  }

  get currentConfig() {
    return resolveConfig(this.currentId);
  }

  get currentAmmo() {
    return this.ammo.get(this.currentId);
  }

  get currentModel() {
    return this.models.get(this.currentId);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.currentModel.visible = enabled;
  }

  reset() {
    this.cooldown = 0;
    this.reloadRemaining = 0;
    this.recoilKick = 0;
    this.modelKick = 0;
    this.adsAmount = 0;
    this.index = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.modifiers = this.defaultModifiers();
    for (const id of this.weaponOrder) {
      const config = resolveConfig(id);
      this.ammo.set(id, { magazine: config.magazine, reserve: config.reserve });
      this.models.get(id).visible = false;
    }
    this.currentModel.visible = this.enabled;
    this.emitState();
  }

  applyModifiers(effects) {
    if (effects.reloadMultiplier) this.modifiers.reloadMultiplier *= effects.reloadMultiplier;
    if (effects.damageMultiplier) this.modifiers.damage *= effects.damageMultiplier;
    if (effects.shotgunPellets) this.modifiers.shotgunPellets += effects.shotgunPellets;
    if (effects.railRicochet) this.modifiers.railRicochet += effects.railRicochet;
    if (effects.critChance) this.modifiers.critChance += effects.critChance;
    if (effects.headshotExplosion) this.modifiers.headshotExplosion = Math.max(this.modifiers.headshotExplosion, effects.headshotExplosion);
    if (effects.lowHealthDamage) this.modifiers.lowHealthDamage += effects.lowHealthDamage;
  }

  update(dt, input) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.modelKick = THREE.MathUtils.damp(this.modelKick, 0, 18, dt);
    this.recoilKick = THREE.MathUtils.damp(this.recoilKick, 0, this.currentConfig.recoil?.recovery ?? 12, dt);

    if (!this.enabled) return;
    if (input.wasPressed?.('weapon1')) this.switchTo(0);
    if (input.wasPressed?.('weapon2')) this.switchTo(1);
    if (input.wasPressed?.('weapon3')) this.switchTo(2);
    if (input.wasPressed?.('weapon4')) this.switchTo(3);
    if (input.wasPressed?.('weapon5')) this.switchTo(4);
    const wheel = input.consumeWheel?.() ?? 0;
    if (wheel) this.switchTo((this.index + Math.sign(wheel) + this.weaponOrder.length) % this.weaponOrder.length);

    if (this.reloadRemaining > 0) {
      this.reloadRemaining -= dt;
      if (this.reloadRemaining <= 0) this.finishReload();
    } else if (input.wasPressed?.('reload')) {
      this.startReload();
    }

    const aiming = Boolean(input.isDown?.('aim'));
    this.adsAmount = THREE.MathUtils.damp(this.adsAmount, aiming ? 1 : 0, 14, dt);
    this.player?.setAiming?.(this.adsAmount);
    const trigger = Boolean(input.isDown?.('fire'));
    const config = this.currentConfig;
    const canTrigger = config.automatic ? trigger : trigger && this.triggerReleased;
    if (canTrigger && this.reloadRemaining <= 0) this.tryFire(aiming);
    if (!trigger) this.triggerReleased = true;
    else if (!config.automatic) this.triggerReleased = false;

    this.animateModel(dt, aiming);
  }

  animateModel(dt) {
    const model = this.currentModel;
    const target = this.adsAmount > 0.01 ? model.userData.adsPosition : model.userData.basePosition;
    const blended = model.userData.basePosition.clone().lerp(model.userData.adsPosition, this.adsAmount);
    model.position.lerp(blended, 1 - Math.exp(-dt * 15));
    const bob = this.player?.getViewBob?.() ?? { x: 0, y: 0 };
    model.position.x += (bob.x ?? 0) * (1 - this.adsAmount * 0.75);
    model.position.y += (bob.y ?? 0) * (1 - this.adsAmount * 0.75) - this.modelKick * 0.025;
    model.rotation.x = -this.modelKick * 0.055;
    model.rotation.y = this.modelKick * 0.018;
    model.visible = this.enabled;
    void target;
  }

  switchTo(index) {
    if (index < 0 || index >= this.weaponOrder.length || index === this.index) return false;
    this.currentModel.visible = false;
    this.index = index;
    this.currentModel.visible = this.enabled;
    this.reloadRemaining = 0;
    this.cooldown = Math.max(this.cooldown, 0.18);
    this.audio?.playUI?.('switch');
    this.eventBus?.emit?.('weapon:changed', this.getState());
    this.emitState();
    return true;
  }

  tryFire(aiming) {
    const config = this.currentConfig;
    const ammo = this.currentAmmo;
    if (this.cooldown > 0) return false;
    if (ammo.magazine <= 0) {
      this.cooldown = 0.2;
      this.audio?.playWeapon?.('empty', { pitch: 0.95 + Math.random() * 0.08 });
      this.eventBus?.emit?.('weapon:empty', { weapon: config.id });
      return false;
    }

    if (!this.infiniteAmmo) ammo.magazine -= 1;
    this.cooldown = 1 / config.fireRate;
    const configuredKick = config.viewModel?.kick;
    const modelKick = configuredKick ?? (config.id === 'scatter' ? 1.4 : config.id === 'rail' ? 1.65 : 0.48);
    this.modelKick = Math.min(2.2, this.modelKick + modelKick);
    this.recoilKick = Math.min(3, this.recoilKick + 1);
    this.shotsFired += 1;
    this.camera.getWorldPosition(this.tempOrigin);
    this.camera.getWorldDirection(this.tempDirection);
    this.currentModel.userData.muzzle.getWorldPosition(this.tempMuzzle);
    const movement = this.player?.speedNormalized ?? 0;
    const baseSpread = aiming ? config.adsSpread : config.spread;
    const spread = baseSpread + movement * (config.moveSpread ?? config.spread * 0.8) + Math.max(0, this.recoilKick - 1) * (config.spreadGrowth ?? 0.0015);
    const pellets = (config.pellets ?? 1) + (config.id === 'scatter' ? this.modifiers.shotgunPellets : 0);
    let anyHit = false;
    let headshot = false;
    let lastPoint = null;
    let lastResult = null;
    const traceThisShot = (config.tracerEvery ?? 1) <= 1 || this.shotsFired % config.tracerEvery === 0;
    for (let pellet = 0; pellet < pellets; pellet += 1) {
      const direction = this.spreadDirection(this.tempDirection, spread, pellet, pellets);
      const result = this.traceShot(this.tempOrigin, direction, config);
      lastResult = result;
      if (result.enemyHit) {
        anyHit = true;
        headshot ||= result.zone === 'head';
      }
      lastPoint = result.point;
      if (traceThisShot && (pellet < 5 || config.id !== 'scatter')) {
        const tracerWidth = config.vfx?.tracerWidth ?? (config.id === 'rail' ? 1.8 : 1);
        this.effects.spawnTracer(this.tempMuzzle, result.point, config.color, tracerWidth);
      }
    }
    if (config.impactBlast && lastResult?.point) {
      const blast = this.applyImpactBlast(lastResult.point, config);
      anyHit ||= blast.hits > 0;
    }
    if (anyHit) this.shotsHit += 1;
    const muzzleIntensity = config.vfx?.muzzleIntensity ?? (config.id === 'rail' ? 1.5 : 1);
    this.effects.spawnMuzzle(this.tempMuzzle, this.tempDirection, config.color, muzzleIntensity);
    this.player?.addRecoil?.(
      (config.recoil?.pitch ?? 0.012) * (0.85 + Math.random() * 0.3),
      (config.recoil?.yaw ?? 0.004) * (Math.random() - 0.5) * 2,
    );
    this.audio?.playWeapon?.(config.sound ?? config.id, { position: this.tempOrigin, pitch: 0.96 + Math.random() * 0.08 });
    this.eventBus?.emit?.('combat:shot', {
      weapon: config.id,
      origin: this.tempOrigin.clone(),
      direction: this.tempDirection.clone(),
      loudness: config.loudness ?? (config.id === 'rail' ? 1.35 : 1),
      hit: anyHit,
      headshot,
      point: lastPoint?.clone?.(),
    });
    this.eventBus?.emit?.('weapon:fired', this.getState());
    this.emitState();
    return true;
  }

  spreadDirection(base, spread, pellet, pellets) {
    const direction = base.clone();
    this.tempRight.crossVectors(direction, WORLD_UP).normalize();
    if (this.tempRight.lengthSq() < 0.1) this.tempRight.set(1, 0, 0);
    this.tempUp.crossVectors(this.tempRight, direction).normalize();
    const ring = pellets > 1 ? Math.sqrt((pellet + Math.random()) / pellets) : Math.random();
    const angle = Math.random() * Math.PI * 2;
    direction
      .addScaledVector(this.tempRight, Math.cos(angle) * spread * ring)
      .addScaledVector(this.tempUp, Math.sin(angle) * spread * ring)
      .normalize();
    return direction;
  }

  traceShot(origin, direction, config) {
    const worldHit = this.arena?.raycastWorld?.(origin, direction, config.range);
    const worldDistance = Number.isFinite(worldHit?.distance) ? worldHit.distance : config.range;
    const enemyHit = this.enemySystem?.raycast?.(origin, direction, worldDistance);
    const hit = enemyHit && enemyHit.distance <= worldDistance ? enemyHit : null;
    const distance = hit?.distance ?? worldDistance;
    const point = hit?.point?.clone?.() ?? origin.clone().addScaledVector(direction, distance);
    if (hit) {
      const falloffRange = Math.max(1, config.falloffEnd - config.falloffStart);
      const falloff = 1 - THREE.MathUtils.clamp((distance - config.falloffStart) / falloffRange, 0, 1) * (1 - (config.minDamageMultiplier ?? 0.45));
      const zoneMultiplier = hit.zone === 'head' ? (config.headMultiplier ?? 1.8) : hit.zone === 'limb' ? 0.78 : 1;
      const randomCrit = Math.random() < this.modifiers.critChance ? 1.65 : 1;
      const lowHealthBonus = (this.player?.health ?? 100) / (this.player?.maxHealth ?? 100) < 0.35 ? 1 + this.modifiers.lowHealthDamage : 1;
      const anomalyMultiplier = config.id === 'rail' ? this.modifiers.railAnomalyMultiplier : 1;
      const damage = config.damage * falloff * zoneMultiplier * randomCrit * lowHealthBonus * this.modifiers.damage * anomalyMultiplier;
      const outcome = this.enemySystem.damage(hit.enemy, damage, {
        source: 'player', weapon: config.id, zone: hit.zone, point, direction,
      });
      if (hit.zone === 'head' && this.player?.modifiers?.shieldOnHit > 0) {
        this.player.addArmor?.(this.player.modifiers.shieldOnHit);
      }
      this.effects.spawnImpact(
        point,
        direction.clone().negate(),
        hit.zone === 'head' ? 0xffdc78 : config.color,
        hit.zone === 'head' ? Math.max(12, config.vfx?.impactCount ?? 0) : (config.vfx?.impactCount ?? 6),
      );
      this.audio?.playEffect?.(hit.zone === 'head' ? 'headshot' : 'hit', { position: point });
      this.eventBus?.emit?.('combat:hit', {
        damage,
        zone: hit.zone,
        killed: Boolean(outcome?.killed),
        critical: randomCrit > 1,
        point: point.clone(),
      });
      if (config.id === 'rail' && this.modifiers.railRicochet > 0) {
        this.applyRailRicochet(hit.enemy, point, damage * 0.48, config);
      }
      return { point, enemyHit: true, enemy: hit.enemy, zone: hit.zone, killed: Boolean(outcome?.killed) };
    }
    if (worldHit) {
      this.effects.spawnImpact(
        point,
        worldHit.normal ?? direction.clone().negate(),
        worldHit.material === 'energy' ? 0xd36bff : config.color ?? 0x7fe5f0,
        config.vfx?.impactCount ?? 4,
      );
      this.audio?.playEffect?.('impact', { position: point, material: worldHit.material ?? 'metal' });
    }
    return { point, enemyHit: false, zone: null, killed: false };
  }

  applyImpactBlast(point, config) {
    const blast = config.impactBlast;
    if (!blast || !point) return { hits: 0, radius: 0, damage: 0 };
    const lowHealthBonus = (this.player?.health ?? 100) / (this.player?.maxHealth ?? 100) < 0.35
      ? 1 + this.modifiers.lowHealthDamage
      : 1;
    const damage = blast.damage * this.modifiers.damage * lowHealthBonus;
    const radius = blast.radius;
    const hits = this.enemySystem?.damageInRadius?.(point, radius, damage, {
      source: 'player',
      weapon: `${config.id}-blast`,
      zone: 'body',
      direction: this.tempDirection.clone(),
    }) ?? 0;
    this.effects.spawnExplosion?.(point, radius, blast.color ?? config.color);
    this.audio?.playEffect?.('explosion', { position: point, pitch: 0.78, volume: 0.92 });
    this.eventBus?.emit?.('combat:blast', { weapon: config.id, point: point.clone(), radius, damage, hits });
    return { hits, radius, damage };
  }

  applyRailRicochet(sourceEnemy, sourcePoint, damage, config) {
    const target = this.enemySystem?.enemies
      ?.filter((enemy) => !enemy.dead && enemy !== sourceEnemy)
      .filter((enemy) => enemy.root.position.distanceToSquared(sourcePoint) <= 14 ** 2)
      .filter((enemy) => this.arena?.hasLineOfSight?.(sourcePoint, enemy.root.position.clone().add(new THREE.Vector3(0, 1, 0))) ?? true)
      .sort((a, b) => a.root.position.distanceToSquared(sourcePoint) - b.root.position.distanceToSquared(sourcePoint))[0];
    if (!target) return false;
    const targetPoint = target.root.position.clone().add(new THREE.Vector3(0, target.type === 'warden' ? 1.45 : 1.05, 0));
    const direction = targetPoint.clone().sub(sourcePoint).normalize();
    const outcome = this.enemySystem.damage(target, damage, {
      source: 'player', weapon: `${config.id}-ricochet`, zone: 'body', point: targetPoint, direction,
    });
    this.effects.spawnTracer(sourcePoint, targetPoint, config.color, 1.45);
    this.effects.spawnImpact(targetPoint, direction.clone().negate(), config.color, 8);
    this.audio?.playEffect?.('hit', { position: targetPoint, pitch: 1.24 });
    this.eventBus?.emit?.('combat:hit', { damage, zone: 'body', killed: Boolean(outcome?.killed), ricochet: true, point: targetPoint.clone() });
    return true;
  }

  startReload() {
    const config = this.currentConfig;
    const ammo = this.currentAmmo;
    if (this.reloadRemaining > 0 || ammo.magazine >= config.magazine || ammo.reserve <= 0) return false;
    this.reloadRemaining = config.reloadTime * this.modifiers.reloadMultiplier;
    this.audio?.playWeapon?.('reload', { duration: this.reloadRemaining, variant: config.id });
    this.eventBus?.emit?.('weapon:reload-start', { weapon: config.id, duration: this.reloadRemaining });
    return true;
  }

  finishReload() {
    const config = this.currentConfig;
    const ammo = this.currentAmmo;
    const required = config.magazine - ammo.magazine;
    const moved = Math.min(required, ammo.reserve);
    ammo.magazine += moved;
    ammo.reserve -= moved;
    this.reloadRemaining = 0;
    this.eventBus?.emit?.('weapon:reload-complete', this.getState());
    this.emitState();
  }

  addAmmo(amount = 20, weaponId = this.currentId) {
    const config = resolveConfig(weaponId);
    const ammo = this.ammo.get(weaponId);
    ammo.reserve = Math.min(config.maxReserve ?? config.reserve * 2, ammo.reserve + amount);
    this.emitState();
  }

  setInfiniteAmmo(enabled) {
    this.infiniteAmmo = Boolean(enabled);
    this.emitState();
    return this.infiniteAmmo;
  }

  getState() {
    const config = this.currentConfig;
    const ammo = this.currentAmmo;
    return {
      id: config.id,
      weapon: config.shortName ?? config.name,
      name: config.name,
      ammo: ammo.magazine,
      reserve: ammo.reserve,
      magazine: config.magazine,
      reload: this.reloadRemaining > 0,
      reloadProgress: this.reloadRemaining > 0
        ? 1 - this.reloadRemaining / (config.reloadTime * this.modifiers.reloadMultiplier)
        : 0,
      ads: this.adsAmount,
    };
  }

  emitState() {
    this.eventBus?.emit?.('weapon:state', this.getState());
  }

  getAccuracy() {
    return this.shotsFired > 0 ? this.shotsHit / this.shotsFired : 0;
  }

  dispose() {
    for (const model of this.models.values()) {
      this.camera.remove(model);
      model.traverse((object) => {
        if (object.isMesh) object.geometry.dispose();
      });
      for (const material of model.userData.materials ?? []) material.dispose();
    }
    this.models.clear();
  }
}

export default WeaponSystem;
