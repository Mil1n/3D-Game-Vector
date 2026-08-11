import * as THREE from 'three';
import { ENEMY_CONFIGS } from '../configs/enemyConfigs.js';
import {
  disposeEnemyVisual,
  getEnemyAnchorPosition,
  makeEnemyVisual,
  updateEnemyVisual,
} from './enemyVisuals.js';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const ENEMY_COLORS = Object.freeze({
  trooper: 0xffa43a,
  hunter: 0xff477e,
  warden: 0xb56cff,
});

function configFor(type) {
  const config = Array.isArray(ENEMY_CONFIGS)
    ? ENEMY_CONFIGS.find((entry) => entry.id === type)
    : ENEMY_CONFIGS[type];
  if (!config) throw new Error(`[EnemySystem] Missing enemy config: ${type}`);
  return config;
}

function createProjectilePool(scene, size = 46) {
  const geometry = new THREE.IcosahedronGeometry(0.12, 1);
  const items = Array.from({ length: size }, () => {
    const material = new THREE.MeshBasicMaterial({ color: 0xffa43a });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    scene.add(mesh);
    return {
      mesh,
      active: false,
      velocity: new THREE.Vector3(),
      previous: new THREE.Vector3(),
      damage: 0,
      radius: 0.2,
      life: 0,
      color: 0xffa43a,
    };
  });
  let cursor = 0;
  return {
    geometry,
    items,
    next() {
      const item = items[cursor];
      cursor = (cursor + 1) % items.length;
      item.active = true;
      item.mesh.visible = true;
      return item;
    },
  };
}

function createHazardPool(scene, size = 12) {
  const geometry = new THREE.RingGeometry(0.7, 1, 36);
  const items = Array.from({ length: size }, () => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xb56cff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, active: false, radius: 2.7, telegraph: 0, duration: 0, tick: 0, damage: 0 };
  });
  let cursor = 0;
  return {
    geometry,
    items,
    next() {
      const item = items[cursor];
      cursor = (cursor + 1) % items.length;
      item.active = true;
      item.mesh.visible = true;
      return item;
    },
  };
}

function createPickupPool(scene, size = 20) {
  const geometry = new THREE.OctahedronGeometry(0.3);
  const items = Array.from({ length: size }, () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x5ee7ff, emissive: 0x5ee7ff, emissiveIntensity: 1.5, roughness: 0.25 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, active: false, type: 'ammo', value: 0, age: 0 };
  });
  let cursor = 0;
  return {
    geometry,
    items,
    next() {
      const item = items[cursor];
      cursor = (cursor + 1) % items.length;
      item.active = true;
      item.mesh.visible = true;
      item.age = 0;
      return item;
    },
  };
}

export class EnemySystem {
  constructor({ scene, eventBus, audioManager, effects, arena, player, difficulty = 'normal', random = Math.random }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.audio = audioManager;
    this.effects = effects;
    this.arena = arena;
    this.player = player;
    this.difficulty = difficulty;
    this.random = random;
    this.group = new THREE.Group();
    this.group.name = 'Enemies';
    this.scene.add(this.group);
    this.enemies = [];
    this.hitMeshes = [];
    this.byId = new Map();
    this.sequence = 0;
    this.aiAccumulator = 0;
    this.attackTokenAccumulator = 0;
    this.maxAttackers = difficulty === 'easy' ? 2 : difficulty === 'hard' ? 4 : 3;
    this.aiFrozen = false;
    this.disposed = false;
    this.raycaster = new THREE.Raycaster();
    this.projectiles = createProjectilePool(scene);
    this.hazards = createHazardPool(scene);
    this.pickups = createPickupPool(scene);
    this.tempPlayer = new THREE.Vector3();
    this.tempDirection = new THREE.Vector3();
    this.tempMove = new THREE.Vector3();
    this.tempFrom = new THREE.Vector3();
    this.tempPrevious = new THREE.Vector3();
    this.tempProjectileToPlayer = new THREE.Vector3();
    this.tempProjectileClosest = new THREE.Vector3();
    this.unsubscribers = [
      this.eventBus?.on?.('combat:shot', (event) => this.onNoise(event)),
      this.eventBus?.on?.('debug:freeze-ai', ({ enabled }) => { this.aiFrozen = enabled; }),
    ].filter(Boolean);
  }

  setDifficulty(difficulty) {
    this.difficulty = difficulty;
    this.maxAttackers = difficulty === 'easy' ? 2 : difficulty === 'hard' ? 4 : 3;
  }

  spawn(type = 'trooper', position = null, options = {}) {
    const config = configFor(type);
    const spawnPosition = position?.clone?.()
      ?? this.arena?.getEnemySpawn?.(this.player.position, this.player.forward)
      ?? new THREE.Vector3((this.random() - 0.5) * 20, 0, (this.random() - 0.5) * 20);
    const visual = makeEnemyVisual(type, config);
    const id = `enemy-${++this.sequence}`;
    const difficultyHealth = this.difficulty === 'hard' ? 1.08 : 1;
    const maxHealth = (config.health ?? (type === 'warden' ? 650 : type === 'hunter' ? 90 : 120)) * difficultyHealth * (options.healthScale ?? 1);
    const enemy = {
      id,
      type,
      config,
      root: visual.root,
      hitMeshes: visual.hitMeshes,
      health: maxHealth,
      maxHealth,
      shield: config.shield ?? 0,
      maxShield: config.shield ?? 0,
      state: options.state ?? 'patrol',
      stateTime: 0,
      thinkIn: this.random() * 0.12,
      attackCooldown: 0.65 + this.random() * 0.5,
      telegraph: 0,
      pendingAttack: null,
      target: spawnPosition.clone(),
      lastKnown: spawnPosition.clone(),
      lastSeenAge: Infinity,
      lastHeardAge: Infinity,
      searchRemaining: 0,
      forward: new THREE.Vector3(0, 0, 1),
      velocity: new THREE.Vector3(),
      lastPosition: spawnPosition.clone(),
      stuckTime: 0,
      flankSign: this.random() < 0.5 ? -1 : 1,
      hasAttackToken: false,
      elitePhase: 1,
      visualTime: 0,
      visualRecovery: null,
      dead: false,
      deathTime: 0,
      bobOffset: this.random() * Math.PI * 2,
    };
    visual.root.position.copy(spawnPosition);
    visual.root.userData.enemyId = id;
    for (const mesh of visual.hitMeshes) {
      mesh.userData.enemyId = id;
      this.hitMeshes.push(mesh);
    }
    this.enemies.push(enemy);
    this.byId.set(id, enemy);
    this.group.add(visual.root);
    this.audio?.playEffect?.('spawn', { position: spawnPosition, pitch: type === 'warden' ? 0.55 : 0.9 + this.random() * 0.2 });
    this.eventBus?.emit?.('enemy:spawned', { id, type, position: spawnPosition.clone(), elite: type === 'warden' });
    return enemy;
  }

  update(dt) {
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updatePickups(dt);
    if (this.aiFrozen) return;

    this.attackTokenAccumulator -= dt;
    if (this.attackTokenAccumulator <= 0) {
      this.attackTokenAccumulator = 0.5;
      this.assignAttackTokens();
    }

    for (const enemy of this.enemies) {
      if (enemy.dead) {
        enemy.deathTime += dt;
        enemy.root.position.y -= dt * Math.min(1.5, enemy.deathTime * 2);
        enemy.root.rotation.z += dt * 1.8;
        if (enemy.deathTime > 0.7) enemy.root.visible = false;
        continue;
      }
      enemy.stateTime += dt;
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      enemy.lastSeenAge += dt;
      enemy.lastHeardAge += dt;
      enemy.thinkIn -= dt;
      if (enemy.thinkIn <= 0) {
        enemy.thinkIn = 0.09 + this.random() * 0.07;
        this.think(enemy);
      }
      this.moveEnemy(enemy, dt);
      this.updateAttack(enemy, dt);
      updateEnemyVisual(enemy, dt);
    }
  }

  think(enemy) {
    this.tempPlayer.copy(this.player.position);
    const eye = this.tempFrom.copy(enemy.root.position).add(new THREE.Vector3(0, enemy.type === 'warden' ? 2.2 : 1.5, 0));
    const toPlayer = this.tempDirection.subVectors(this.tempPlayer, eye);
    const distance = toPlayer.length();
    const perception = enemy.config.perception ?? {};
    const sightDistance = perception.distance ?? (enemy.type === 'hunter' ? 24 : 32);
    const fovCos = Math.cos(((perception.fov ?? 115) * Math.PI / 180) * 0.5);
    const facing = enemy.forward.dot(toPlayer.clone().setY(0).normalize());
    const lineOfSight = distance <= sightDistance
      && (facing >= fovCos || distance < 7)
      && (this.arena?.hasLineOfSight?.(eye, this.tempPlayer) ?? true);

    if (lineOfSight) {
      enemy.lastKnown.copy(this.tempPlayer);
      enemy.lastSeenAge = 0;
      enemy.searchRemaining = perception.searchTime ?? 5;
      if (enemy.state !== 'combat' && enemy.state !== 'flank' && enemy.state !== 'takeCover') this.setState(enemy, 'combat');
    } else if (enemy.lastSeenAge < (perception.memory ?? 3.5)) {
      if (enemy.state === 'patrol' || enemy.state === 'search') this.setState(enemy, 'investigate');
    } else if (enemy.lastHeardAge < 3) {
      this.setState(enemy, 'investigate');
    } else if (enemy.state === 'combat' || enemy.state === 'flank' || enemy.state === 'takeCover') {
      this.setState(enemy, 'search');
      enemy.searchRemaining = perception.searchTime ?? 4;
    }

    if (enemy.type === 'hunter') this.thinkHunter(enemy, distance, lineOfSight);
    else if (enemy.type === 'warden') this.thinkWarden(enemy, distance, lineOfSight);
    else this.thinkTrooper(enemy, distance, lineOfSight);

    if (enemy.state === 'investigate') {
      enemy.target.copy(this.navigate(enemy, enemy.lastKnown, 'investigate'));
      if (enemy.root.position.distanceToSquared(enemy.lastKnown) < 2.2) this.setState(enemy, 'search');
    } else if (enemy.state === 'search') {
      enemy.searchRemaining -= enemy.thinkIn;
      if (enemy.root.position.distanceToSquared(enemy.target) < 2 || enemy.stateTime > 1.5) {
        enemy.target.copy(enemy.lastKnown).add(new THREE.Vector3((this.random() - 0.5) * 8, 0, (this.random() - 0.5) * 8));
        enemy.stateTime = 0;
      }
      if (enemy.searchRemaining <= 0) this.setState(enemy, 'patrol');
    } else if (enemy.state === 'patrol') {
      if (enemy.root.position.distanceToSquared(enemy.target) < 2 || enemy.stateTime > 7) {
        const patrol = this.arena?.getNavigationTarget?.(enemy.root.position, null, 'patrol');
        enemy.target.copy(patrol?.position ?? patrol ?? enemy.root.position.clone().add(new THREE.Vector3((this.random() - 0.5) * 12, 0, (this.random() - 0.5) * 12)));
        enemy.stateTime = 0;
      }
    }
  }

  thinkTrooper(enemy, distance, visible) {
    if (!visible && enemy.state !== 'combat' && enemy.state !== 'flank' && enemy.state !== 'takeCover') return;
    const preferred = enemy.config.preferredRange ?? 13;
    if (distance < preferred * 0.55) {
      this.setState(enemy, 'retreat');
      const away = enemy.root.position.clone().sub(this.player.position).setY(0).normalize();
      enemy.target.copy(enemy.root.position).addScaledVector(away, 7);
    } else if (distance > preferred * 1.45) {
      this.setState(enemy, 'combat');
      enemy.target.copy(this.navigate(enemy, this.player.position, 'combat'));
    } else {
      if (enemy.stateTime > 2.2 && this.random() < 0.16) {
        this.setState(enemy, 'flank');
        const toPlayer = this.player.position.clone().sub(enemy.root.position).setY(0).normalize();
        const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(enemy.flankSign * 6);
        enemy.target.copy(this.player.position).add(side);
      } else if (enemy.state !== 'flank') {
        this.setState(enemy, 'takeCover');
        enemy.target.copy(enemy.root.position);
      }
      if (enemy.hasAttackToken && enemy.attackCooldown <= 0 && enemy.pendingAttack == null) {
        this.beginAttack(enemy, 'burst', this.difficulty === 'hard' ? 0.22 : 0.32);
      }
    }
  }

  thinkHunter(enemy, distance, visible) {
    if (!visible && enemy.lastSeenAge > 3) return;
    if (distance > 2.15) {
      this.setState(enemy, distance < 7 ? 'flank' : 'combat');
      const target = this.player.position.clone();
      if (distance < 7) {
        const toPlayer = target.clone().sub(enemy.root.position).normalize();
        target.add(new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(enemy.flankSign * 1.8));
      }
      enemy.target.copy(this.navigate(enemy, target, 'hunter'));
    } else {
      enemy.target.copy(enemy.root.position);
      if (enemy.hasAttackToken && enemy.attackCooldown <= 0 && enemy.pendingAttack == null) this.beginAttack(enemy, 'melee', 0.38);
    }
  }

  thinkWarden(enemy, distance, visible) {
    const healthRatio = enemy.health / enemy.maxHealth;
    const nextPhase = healthRatio < 0.34 ? 3 : healthRatio < 0.67 ? 2 : 1;
    if (nextPhase !== enemy.elitePhase) {
      enemy.elitePhase = nextPhase;
      enemy.shield = Math.min(enemy.maxShield * 0.55, enemy.shield + enemy.maxShield * 0.38);
      this.updateShieldVisual(enemy);
      this.effects.spawnShiftPulse(enemy.root.position, 9);
      this.eventBus?.emit?.('enemy:elite-phase', { phase: nextPhase, health: enemy.health, maxHealth: enemy.maxHealth });
    }
    if (!visible && enemy.lastSeenAge > 4) {
      enemy.target.copy(this.navigate(enemy, this.player.position, 'hunt'));
      return;
    }
    if (distance > 9) enemy.target.copy(this.navigate(enemy, this.player.position, 'hunt'));
    else if (distance < 5) enemy.target.copy(enemy.root.position).add(enemy.root.position.clone().sub(this.player.position).normalize().multiplyScalar(5));
    else enemy.target.copy(enemy.root.position);
    if (enemy.attackCooldown <= 0 && enemy.pendingAttack == null) {
      const attack = enemy.elitePhase >= 2 && this.random() < 0.5 ? 'hazard' : 'orbVolley';
      this.beginAttack(enemy, attack, attack === 'hazard' ? 1.1 : 0.55);
      if (attack === 'hazard') this.eventBus?.emit?.('enemy:warden-block', { position: this.player.position.clone(), duration: 5 });
    }
  }

  navigate(enemy, destination, mode) {
    const result = this.arena?.getNavigationTarget?.(enemy.root.position, destination, mode);
    return result?.position ?? result ?? destination;
  }

  moveEnemy(enemy, dt) {
    if (enemy.pendingAttack?.lockMovement) {
      enemy.velocity.multiplyScalar(Math.max(0, 1 - dt * 10));
      return;
    }
    const direction = this.tempMove.subVectors(enemy.target, enemy.root.position).setY(0);
    const distance = direction.length();
    if (distance < 0.1) {
      enemy.velocity.multiplyScalar(Math.max(0, 1 - dt * 9));
      return;
    }
    direction.normalize();
    const obstacle = this.arena?.raycastWorld?.(
      this.tempFrom.copy(enemy.root.position).add(new THREE.Vector3(0, 0.7, 0)),
      direction,
      1.2,
    );
    if (obstacle?.distance < 0.9) {
      const sign = enemy.flankSign;
      direction.set(-direction.z * sign, 0, direction.x * sign);
    }
    const baseSpeed = enemy.config.speed ?? (enemy.type === 'hunter' ? 7.4 : enemy.type === 'warden' ? 3.4 : 4.2);
    const stateMultiplier = enemy.state === 'retreat' ? 1.12 : enemy.state === 'flank' ? 1.15 : 1;
    const targetVelocity = direction.multiplyScalar(baseSpeed * stateMultiplier);
    enemy.velocity.lerp(targetVelocity, 1 - Math.exp(-dt * 7));
    enemy.root.position.addScaledVector(enemy.velocity, dt);
    enemy.root.position.x = THREE.MathUtils.clamp(enemy.root.position.x, -34, 34);
    enemy.root.position.z = THREE.MathUtils.clamp(enemy.root.position.z, -34, 34);
    enemy.forward.lerp(enemy.velocity.clone().setY(0).normalize(), 1 - Math.exp(-dt * 10)).normalize();
    enemy.root.rotation.y = Math.atan2(enemy.forward.x, enemy.forward.z);
    const moved = enemy.root.position.distanceToSquared(enemy.lastPosition);
    enemy.stuckTime = moved < 0.0004 ? enemy.stuckTime + dt : 0;
    if (enemy.stuckTime > 1) {
      enemy.flankSign *= -1;
      enemy.target.add(new THREE.Vector3(enemy.flankSign * 4, 0, -enemy.flankSign * 3));
      enemy.stuckTime = 0;
    }
    enemy.lastPosition.copy(enemy.root.position);
  }

  beginAttack(enemy, kind, telegraph) {
    enemy.pendingAttack = { kind, remaining: telegraph, duration: telegraph, lockMovement: kind === 'hazard' || kind === 'melee' };
    enemy.telegraph = telegraph;
    this.audio?.playEffect?.('enemyTelegraph', { position: enemy.root.position, pitch: kind === 'hazard' ? 0.58 : 1.05 });
    this.eventBus?.emit?.('enemy:telegraph', { id: enemy.id, type: enemy.type, attack: kind, duration: telegraph });
  }

  updateAttack(enemy, dt) {
    if (!enemy.pendingAttack) return;
    enemy.pendingAttack.remaining -= dt;
    enemy.telegraph = Math.max(0, enemy.pendingAttack.remaining);
    if (enemy.pendingAttack.remaining > 0) return;
    const kind = enemy.pendingAttack.kind;
    enemy.pendingAttack = null;
    const recoveryDuration = kind === 'melee' ? 0.26 : kind === 'hazard' ? 0.38 : 0.18;
    enemy.visualRecovery = { kind, duration: recoveryDuration, remaining: recoveryDuration };
    if (kind === 'melee') this.executeMelee(enemy);
    else if (kind === 'burst') this.executeBurst(enemy);
    else if (kind === 'orbVolley') this.executeOrbVolley(enemy);
    else if (kind === 'hazard') this.executeHazard(enemy);
  }

  executeMelee(enemy) {
    const distance = enemy.root.position.distanceTo(this.player.position);
    if (distance <= 2.55 && (this.arena?.hasLineOfSight?.(enemy.root.position, this.player.position) ?? true)) {
      this.player.damage?.(enemy.config.damage ?? 18, { source: enemy.type, position: enemy.root.position, cause: 'Клинки охотника' });
      this.eventBus?.emit?.('combat:player-hit', { damage: enemy.config.damage ?? 18, source: enemy.root.position.clone(), cause: 'Клинки охотника' });
    }
    enemy.attackCooldown = this.difficulty === 'hard' ? 0.85 : 1.15;
  }

  executeBurst(enemy) {
    const origin = getEnemyAnchorPosition(enemy, 'muzzle', 1.35);
    const target = this.player.position.clone().add(new THREE.Vector3(0, 1, 0));
    const accuracy = (enemy.config.accuracy ?? 0.78) * (this.difficulty === 'easy' ? 0.72 : this.difficulty === 'hard' ? 1.08 : 1);
    for (let shot = 0; shot < 3; shot += 1) {
      const direction = target.clone().sub(origin).normalize();
      direction.x += (this.random() - 0.5) * (1 - accuracy) * 0.24;
      direction.y += (this.random() - 0.5) * (1 - accuracy) * 0.18;
      direction.z += (this.random() - 0.5) * (1 - accuracy) * 0.24;
      this.spawnProjectile(origin, direction.normalize(), 19 + shot * 1.2, enemy.config.damage ?? 8, 0xffa43a, 0.16);
    }
    enemy.attackCooldown = this.difficulty === 'hard' ? 1.15 : 1.65;
  }

  executeOrbVolley(enemy) {
    const origin = getEnemyAnchorPosition(enemy, 'orbAnchor', 1.65);
    const base = this.player.position.clone().add(new THREE.Vector3(0, 0.9, 0)).sub(origin).normalize();
    const count = enemy.elitePhase >= 3 ? 7 : 5;
    for (let index = 0; index < count; index += 1) {
      const angle = (index - (count - 1) / 2) * 0.075;
      const direction = base.clone().applyAxisAngle(UP, angle);
      this.spawnProjectile(origin, direction, enemy.elitePhase >= 3 ? 13 : 10.5, enemy.config.damage ?? 13, 0xb56cff, 0.25);
    }
    enemy.attackCooldown = enemy.elitePhase >= 3 ? 1.05 : 1.55;
  }

  executeHazard(enemy) {
    const target = this.player.position.clone().add(this.player.velocity?.clone?.().multiplyScalar(0.45) ?? new THREE.Vector3());
    const hazard = this.hazards.next();
    hazard.mesh.position.set(target.x, 0.055, target.z);
    hazard.radius = enemy.elitePhase >= 3 ? 3.8 : 3.1;
    hazard.mesh.scale.setScalar(hazard.radius);
    hazard.mesh.material.color.set(0xb56cff);
    hazard.telegraph = 1.25;
    hazard.duration = 4.2;
    hazard.tick = 0;
    hazard.damage = enemy.config.hazardDamage ?? 13;
    enemy.attackCooldown = 2.4;
  }

  spawnProjectile(origin, direction, speed, damage, color, radius) {
    const projectile = this.projectiles.next();
    projectile.mesh.position.copy(origin);
    projectile.previous.copy(origin);
    projectile.velocity.copy(direction).multiplyScalar(speed);
    projectile.damage = damage;
    projectile.radius = radius;
    projectile.life = 4;
    projectile.color = color;
    projectile.mesh.material.color.set(color);
    projectile.mesh.scale.setScalar(radius / 0.12);
    this.audio?.playEffect?.('enemyShot', { position: origin, pitch: 0.9 + this.random() * 0.2 });
  }

  updateProjectiles(dt) {
    for (const projectile of this.projectiles.items) {
      if (!projectile.active) continue;
      projectile.life -= dt;
      projectile.previous.copy(projectile.mesh.position);
      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
      projectile.mesh.rotation.x += dt * 7;
      projectile.mesh.rotation.y += dt * 9;
      const delta = this.tempDirection.subVectors(projectile.mesh.position, projectile.previous);
      const distance = delta.length();
      const direction = distance > 0 ? delta.multiplyScalar(1 / distance) : delta;
      const worldHit = distance > 0 ? this.arena?.raycastWorld?.(projectile.previous, direction, distance + projectile.radius) : null;
      const playerPoint = this.tempPlayer.copy(this.player.position);
      playerPoint.y += 0.9;
      const playerAlongSegment = distance > 0
        ? THREE.MathUtils.clamp(this.tempProjectileToPlayer.subVectors(playerPoint, projectile.previous).dot(direction), 0, distance)
        : 0;
      const closestToPlayer = this.tempProjectileClosest.copy(direction).multiplyScalar(playerAlongSegment).add(projectile.previous);
      const playerHit = closestToPlayer.distanceToSquared(playerPoint) <= (projectile.radius + 0.55) ** 2;
      const playerHitDistance = playerHit ? Math.max(0, playerAlongSegment - projectile.radius) : Infinity;
      const worldHitDistance = worldHit?.distance ?? Infinity;

      if (worldHitDistance <= playerHitDistance && worldHitDistance <= distance + projectile.radius) {
        this.effects.spawnImpact(worldHit.point ?? projectile.mesh.position, worldHit.normal ?? UP, projectile.color, 6);
        this.deactivateProjectile(projectile);
        continue;
      }
      if (playerHit) {
        this.player.damage?.(projectile.damage, { source: 'enemyProjectile', position: projectile.previous, cause: 'Импульс противника' });
        this.eventBus?.emit?.('combat:player-hit', { damage: projectile.damage, source: projectile.previous.clone(), cause: 'Импульс противника' });
        this.effects.spawnImpact(closestToPlayer, projectile.velocity.clone().negate().normalize(), 0xff617c, 9);
        this.deactivateProjectile(projectile);
        continue;
      }
      if (projectile.life <= 0) this.deactivateProjectile(projectile);
    }
  }

  deactivateProjectile(projectile) {
    projectile.active = false;
    projectile.mesh.visible = false;
  }

  updateHazards(dt) {
    for (const hazard of this.hazards.items) {
      if (!hazard.active) continue;
      hazard.mesh.rotation.z += dt * 0.35;
      if (hazard.telegraph > 0) {
        hazard.telegraph -= dt;
        hazard.mesh.material.opacity = 0.18 + Math.sin(hazard.telegraph * 18) * 0.12;
        if (hazard.telegraph <= 0) {
          hazard.mesh.material.color.set(0xff446f);
          hazard.mesh.material.opacity = 0.55;
          this.effects.spawnExplosion(hazard.mesh.position, hazard.radius, 0xb56cff);
        }
        continue;
      }
      hazard.duration -= dt;
      hazard.tick -= dt;
      hazard.mesh.material.opacity = 0.32 + Math.sin(hazard.duration * 9) * 0.11;
      const dx = this.player.position.x - hazard.mesh.position.x;
      const dz = this.player.position.z - hazard.mesh.position.z;
      if (dx * dx + dz * dz <= hazard.radius * hazard.radius && hazard.tick <= 0) {
        hazard.tick = 0.72;
        this.player.damage?.(hazard.damage, { source: 'wardenHazard', position: hazard.mesh.position, cause: 'Фазовый разлом' });
        this.eventBus?.emit?.('combat:player-hit', { damage: hazard.damage, source: hazard.mesh.position.clone(), cause: 'Фазовый разлом' });
      }
      if (hazard.duration <= 0) {
        hazard.active = false;
        hazard.mesh.visible = false;
      }
    }
  }

  updatePickups(dt) {
    for (const pickup of this.pickups.items) {
      if (!pickup.active) continue;
      pickup.age += dt;
      pickup.mesh.rotation.y += dt * 1.8;
      pickup.mesh.position.y = pickup.mesh.userData.baseY + Math.sin(pickup.age * 3) * 0.12;
      if (pickup.mesh.position.distanceToSquared(this.player.position) < 1.75) {
        pickup.active = false;
        pickup.mesh.visible = false;
        this.audio?.playUI?.('pickup', { pitch: pickup.type === 'health' ? 1.15 : 0.92 });
        this.eventBus?.emit?.('pickup:collected', { type: pickup.type, value: pickup.value });
      } else if (pickup.age > 20) {
        pickup.active = false;
        pickup.mesh.visible = false;
      }
    }
  }

  spawnPickup(position, guaranteed = false) {
    if (!guaranteed && this.random() > 0.34) return;
    const pickup = this.pickups.next();
    const needsHealth = (this.player.health ?? 100) < (this.player.maxHealth ?? 100) * 0.55;
    pickup.type = needsHealth && this.random() < 0.58 ? 'health' : this.random() < 0.72 ? 'ammo' : 'armor';
    pickup.value = pickup.type === 'health' ? 24 : pickup.type === 'armor' ? 18 : 28;
    pickup.mesh.material.color.set(pickup.type === 'health' ? 0x55f29a : pickup.type === 'armor' ? 0x5ee7ff : 0xffd45b);
    pickup.mesh.material.emissive.set(pickup.mesh.material.color);
    pickup.mesh.position.copy(position).add(new THREE.Vector3(0, 0.55, 0));
    pickup.mesh.userData.baseY = pickup.mesh.position.y;
  }

  onNoise({ origin, loudness = 1 }) {
    if (!origin) return;
    const radiusSq = (24 * loudness) ** 2;
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.root.position.distanceToSquared(origin) > radiusSq) continue;
      enemy.lastKnown.copy(origin);
      enemy.lastHeardAge = 0;
      if (enemy.state === 'patrol' || enemy.state === 'search') this.setState(enemy, 'suspicious');
    }
  }

  assignAttackTokens() {
    const candidates = this.enemies
      .filter((enemy) => !enemy.dead && enemy.type !== 'warden' && ['combat', 'flank', 'takeCover'].includes(enemy.state))
      .sort((a, b) => a.root.position.distanceToSquared(this.player.position) - b.root.position.distanceToSquared(this.player.position));
    candidates.forEach((enemy, index) => { enemy.hasAttackToken = index < this.maxAttackers; });
    for (const enemy of this.enemies) if (enemy.type === 'warden' && !enemy.dead) enemy.hasAttackToken = true;
  }

  setState(enemy, state) {
    if (enemy.state === state) return;
    const previous = enemy.state;
    enemy.state = state;
    enemy.stateTime = 0;
    this.eventBus?.emit?.('enemy:state', { id: enemy.id, type: enemy.type, previous, state });
  }

  raycast(origin, direction, maxDistance = Infinity) {
    // Raycaster uses matrixWorld rather than local transforms. Enemies are moved
    // during fixed updates, so multiple simulation steps can happen before the
    // renderer gets a chance to refresh those matrices.
    this.group.updateMatrixWorld(true);
    this.raycaster.set(origin, direction);
    this.raycaster.far = maxDistance;
    const intersections = this.raycaster.intersectObjects(this.hitMeshes, false);
    for (const intersection of intersections) {
      const enemy = this.byId.get(intersection.object.userData.enemyId);
      if (!enemy || enemy.dead || !enemy.root.visible) continue;
      return {
        enemy,
        point: intersection.point,
        distance: intersection.distance,
        zone: intersection.object.userData.hitZone ?? 'body',
        normal: intersection.face?.normal?.clone?.(),
      };
    }
    return null;
  }

  updateShieldVisual(enemy) {
    const shield = enemy.root.userData.shield;
    if (!shield) return;
    const shieldMaterial = shield.material;
    const minOpacity = shieldMaterial.userData.minOpacity ?? 0.08;
    const maxOpacity = shieldMaterial.userData.maxOpacity ?? 0.37;
    const ratio = enemy.maxShield > 0 ? THREE.MathUtils.clamp(enemy.shield / enemy.maxShield, 0, 1) : 0;
    shieldMaterial.opacity = minOpacity + ratio * (maxOpacity - minOpacity);
    shield.visible = enemy.shield > 0;
  }

  damage(enemyOrId, amount, context = {}) {
    const enemy = typeof enemyOrId === 'string' ? this.byId.get(enemyOrId) : enemyOrId;
    if (!enemy || enemy.dead || !Number.isFinite(amount) || amount <= 0) return { applied: 0, killed: false };
    let remaining = amount;
    if (enemy.shield > 0) {
      const absorbed = Math.min(enemy.shield, remaining);
      enemy.shield -= absorbed;
      remaining -= absorbed;
      this.updateShieldVisual(enemy);
      this.effects.spawnImpact(context.point ?? enemy.root.position, context.direction?.clone?.().negate?.() ?? UP, 0xb56cff, 7);
    }
    if (remaining > 0) enemy.health -= remaining;
    this.setState(enemy, 'combat');
    enemy.lastKnown.copy(this.player.position);
    const killed = enemy.health <= 0;
    if (killed) this.kill(enemy, context);
    else this.eventBus?.emit?.('enemy:damaged', { id: enemy.id, type: enemy.type, amount, health: enemy.health, maxHealth: enemy.maxHealth, shield: enemy.shield });
    return { applied: amount, killed, health: Math.max(0, enemy.health), shield: enemy.shield };
  }

  kill(enemy, context = {}) {
    enemy.dead = true;
    enemy.state = 'dead';
    enemy.health = 0;
    enemy.pendingAttack = null;
    enemy.hasAttackToken = false;
    for (const mesh of enemy.hitMeshes) {
      const index = this.hitMeshes.indexOf(mesh);
      if (index >= 0) this.hitMeshes.splice(index, 1);
    }
    const position = enemy.root.position.clone().add(new THREE.Vector3(0, 1, 0));
    this.effects.spawnEnemyDeath(position, enemy.config.color ?? ENEMY_COLORS[enemy.type], enemy.type === 'warden' ? 1.8 : 1);
    this.audio?.playEffect?.('enemyDeath', { position, pitch: enemy.type === 'warden' ? 0.48 : 0.85 + this.random() * 0.3 });
    this.spawnPickup(enemy.root.position, enemy.type === 'warden');
    this.eventBus?.emit?.('enemy:killed', {
      id: enemy.id,
      type: enemy.type,
      elite: enemy.type === 'warden',
      headshot: context.zone === 'head',
      weapon: context.weapon,
      position: enemy.root.position.clone(),
      score: enemy.config.score ?? (enemy.type === 'warden' ? 2500 : enemy.type === 'hunter' ? 250 : 180),
    });
  }

  damageInRadius(position, radius, damage, context = {}) {
    const radiusSq = radius * radius;
    let hits = 0;
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.root.position.distanceToSquared(position) > radiusSq) continue;
      if (!(this.arena?.hasLineOfSight?.(position, enemy.root.position) ?? true)) continue;
      const distance = Math.sqrt(enemy.root.position.distanceToSquared(position));
      const amount = damage * (1 - THREE.MathUtils.clamp(distance / radius, 0, 1) * 0.72);
      this.damage(enemy, amount, { ...context, point: enemy.root.position.clone(), zone: 'body' });
      hits += 1;
    }
    return hits;
  }

  killAll() {
    for (const enemy of this.enemies) if (!enemy.dead) this.kill(enemy, { source: 'debug', zone: 'body' });
  }

  get activeCount() {
    return this.enemies.reduce((count, enemy) => count + Number(!enemy.dead), 0);
  }

  get eliteAlive() {
    return this.enemies.some((enemy) => !enemy.dead && enemy.type === 'warden');
  }

  getNearestAIState() {
    return this.enemies
      .filter((enemy) => !enemy.dead)
      .sort((a, b) => a.root.position.distanceToSquared(this.player.position) - b.root.position.distanceToSquared(this.player.position))[0]?.state ?? '—';
  }

  getDebugData() {
    return this.enemies.filter((enemy) => !enemy.dead).map((enemy) => ({
      id: enemy.id,
      type: enemy.type,
      state: enemy.state,
      position: enemy.root.position.clone(),
      target: enemy.target.clone(),
      lastKnown: enemy.lastKnown.clone(),
      attackToken: enemy.hasAttackToken,
    }));
  }

  reset() {
    for (const enemy of this.enemies) {
      this.group.remove(enemy.root);
      disposeEnemyVisual(enemy.root);
    }
    this.enemies.length = 0;
    this.hitMeshes.length = 0;
    this.byId.clear();
    for (const projectile of this.projectiles.items) this.deactivateProjectile(projectile);
    for (const hazard of this.hazards.items) {
      hazard.active = false;
      hazard.mesh.visible = false;
    }
    for (const pickup of this.pickups.items) {
      pickup.active = false;
      pickup.mesh.visible = false;
    }
    this.aiFrozen = false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.scene.remove(this.group);
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    for (const projectile of this.projectiles.items) {
      this.scene.remove(projectile.mesh);
      projectile.mesh.material.dispose();
    }
    this.projectiles.geometry.dispose();
    for (const hazard of this.hazards.items) {
      this.scene.remove(hazard.mesh);
      hazard.mesh.material.dispose();
    }
    this.hazards.geometry.dispose();
    for (const pickup of this.pickups.items) {
      this.scene.remove(pickup.mesh);
      pickup.mesh.material.dispose();
    }
    this.pickups.geometry.dispose();
  }
}

export default EnemySystem;
