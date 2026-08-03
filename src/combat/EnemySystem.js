import * as THREE from 'three';
import { ENEMY_CONFIGS } from '../configs/enemyConfigs.js';

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

function makeEnemyVisual(type, config) {
  const root = new THREE.Group();
  root.name = `${config.name ?? type}`;
  const accentColor = config.color ?? ENEMY_COLORS[type] ?? 0xff684d;
  const armor = new THREE.MeshStandardMaterial({
    color: type === 'warden' ? 0x241d35 : 0x171f24,
    emissive: accentColor,
    emissiveIntensity: type === 'hunter' ? 0.22 : 0.12,
    roughness: 0.42,
    metalness: 0.78,
  });
  const glow = new THREE.MeshBasicMaterial({ color: accentColor });
  const dark = new THREE.MeshStandardMaterial({ color: 0x05080a, roughness: 0.7, metalness: 0.4 });
  const scale = type === 'warden' ? 1.35 : type === 'hunter' ? 0.88 : 1;
  const body = new THREE.Mesh(
    type === 'hunter' ? new THREE.ConeGeometry(0.52, 1.3, 7) : new THREE.BoxGeometry(0.82, 1.2, 0.48),
    armor,
  );
  body.position.y = 1.08 * scale;
  body.scale.setScalar(scale);
  body.userData.hitZone = 'body';
  root.add(body);

  const head = new THREE.Mesh(
    type === 'warden' ? new THREE.OctahedronGeometry(0.34) : new THREE.BoxGeometry(0.45, 0.38, 0.42),
    glow,
  );
  head.position.y = 1.92 * scale;
  head.scale.setScalar(scale);
  head.userData.hitZone = 'head';
  root.add(head);

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.82, 0.26), dark);
  leftLeg.position.set(-0.24 * scale, 0.42 * scale, 0);
  leftLeg.scale.setScalar(scale);
  leftLeg.userData.hitZone = 'limb';
  root.add(leftLeg);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x *= -1;
  rightLeg.userData.hitZone = 'limb';
  root.add(rightLeg);

  if (type !== 'hunter') {
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(type === 'warden' ? 1.15 : 0.78, 0.16, 0.18), dark);
    weapon.position.set(0.35 * scale, 1.15 * scale, 0.36 * scale);
    weapon.rotation.y = -0.15;
    weapon.scale.setScalar(scale);
    weapon.userData.hitZone = 'limb';
    root.add(weapon);
  } else {
    for (const side of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.78, 5), glow);
      blade.position.set(side * 0.55, 1.05, 0.23);
      blade.rotation.z = side * -0.7;
      blade.userData.hitZone = 'limb';
      root.add(blade);
    }
  }

  let shield = null;
  if (type === 'warden') {
    shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xae63ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    );
    shield.position.y = 1.2;
    root.add(shield);
  }

  root.userData.materials = [armor, glow, dark, shield?.material].filter(Boolean);
  root.userData.shield = shield;
  return { root, hitMeshes: [body, head, leftLeg, rightLeg, ...root.children.filter((child) => child.userData.hitZone && ![body, head, leftLeg, rightLeg].includes(child))] };
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
      shield: type === 'warden' ? (config.shield ?? 140) : 0,
      maxShield: type === 'warden' ? (config.shield ?? 140) : 0,
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
      enemy.root.children.forEach((child, index) => {
        if (child.userData.hitZone === 'limb') child.rotation.x = Math.sin(enemy.stateTime * 7 + index) * 0.14 * Math.min(1, enemy.velocity.length());
      });
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
      const target = this.player.positÛ]¹¶‰žËkºwµç@ÀìÍ¡½Ð€ð€ÌìÍ¡½Ð€¬ô€Ä¤ì(€€€€€½¹ÍÐ‘¥É•Ñ¥½¸€ôÑ…É•Ð¹±½¹” ¤¹ÍÕˆ¡½É¥¥¸¤¹¹½Éµ…±¥é” ¤ì(€€€€€‘¥É•Ñ¥½¸¹à€¬ô€¡Ñ¡¥Ì¹É…¹‘½´ ¤€´€À¸Ô¤€¨€ Ä€´…ÕÉ…ä¤€¨€À¸ÈÐì(€€€€€‘¥É•Ñ¥½¸¹ä€¬ô€¡Ñ¡¥Ì¹É…¹‘½´ ¤€´€À¸Ô¤€¨€ Ä€´…ÕÉ…ä¤€¨€À¸Äàì(€€€€€‘¥É•Ñ¥½¸¹è€¬ô€¡Ñ¡¥Ì¹É…¹‘½´ ¤€´€À¸Ô¤€¨€ Ä€´…ÕÉ…ä¤€¨€À¸ÈÐì(€€€€€Ñ¡¥Ì¹ÍÁ…Ý¹AÉ½©•Ñ¥±”¡½É¥¥¸°‘¥É•Ñ¥½¸¹¹½Éµ…±¥é” ¤°€Ää€¬Í¡½Ð€¨€Ä¸È°•¹•µä¹½¹™¥œ¹‘…µ…”€üü€à°€Áá™™„ÐÍ„°€À¸ÄØ¤ì(€€€ô(€€€•¹•µä¹…ÑÑ…­½½±‘½Ý¸€ôÑ¡¥Ì¹‘¥™™¥Õ±Ñä€ôôô€¡…Éœ€ü€Ä¸ÄÔ€è€Ä¸ØÔì(€ô((€•á•ÕÑ•=É‰Y½±±•ä¡•¹•µä¤ì(€€€½¹ÍÐ½É¥¥¸€ô•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸¹±½¹” ¤¹…‘¡¹•ÜQ!I¹Y•Ñ½ÈÌ À°€Ä¸ØÔ°€À¤¤ì(€€€½¹ÍÐ‰…Í”€ôÑ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¹±½¹” ¤¹…‘¡¹•ÜQ!I¹Y•Ñ½ÈÌ À°€À¸ä°€À¤¤¹ÍÕˆ¡½É¥¥¸¤¹¹½Éµ…±¥é” ¤ì(€€€½¹ÍÐ½Õ¹Ð€ô•¹•µä¹•±¥Ñ•A¡…Í”€øô€Ì€ü€Ü€è€Ôì(€€€™½È€¡±•Ð¥¹‘•à€ô€Àì¥¹‘•à€ð½Õ¹Ðì¥¹‘•à€¬ô€Ä¤ì(€€€€€½¹ÍÐ…¹±”€ô€¡¥¹‘•à€´€¡½Õ¹Ð€´€Ä¤€¼€È¤€¨€À¸ÀÜÔì(€€€€€½¹ÍÐ‘¥É•Ñ¥½¸€ô‰…Í”¹±½¹” ¤¹…ÁÁ±åá¥Í¹±”¡U@°…¹±”¤ì(€€€€€Ñ¡¥Ì¹ÍÁ…Ý¹AÉ½©•Ñ¥±”¡½É¥¥¸°‘¥É•Ñ¥½¸°•¹•µä¹•±¥Ñ•A¡…Í”€øô€Ì€ü€ÄÌ€è€ÄÀ¸Ô°•¹•µä¹½¹™¥œ¹‘…µ…”€üü€ÄÌ°€ÁáˆÔÙ™˜°€À¸ÈÔ¤ì(€€€ô(€€€•¹•µä¹…ÑÑ…­½½±‘½Ý¸€ô•¹•µä¹•±¥Ñ•A¡…Í”€øô€Ì€ü€Ä¸ÀÔ€è€Ä¸ÔÔì(€ô((€•á•ÕÑ•!…é…É¡•¹•µä¤ì(€€€½¹ÍÐÑ…É•Ð€ôÑ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¹±½¹” ¤¹…‘¡Ñ¡¥Ì¹Á±…å•È¹Ù•±½¥Ñäü¹±½¹”ü¸ ¤¹µÕ±Ñ¥Á±åM…±…È À¸ÐÔ¤€üü¹•ÜQ!I¹Y•Ñ½ÈÌ ¤¤ì(€€€½¹ÍÐ¡…é…É€ôÑ¡¥Ì¹¡…é…É‘Ì¹¹•áÐ ¤ì(€€€¡…é…É¹µ•Í ¹Á½Í¥Ñ¥½¸¹Í•Ð¡Ñ…É•Ð¹à°€À¸ÀÔÔ°Ñ…É•Ð¹è¤ì(€€€¡…é…É¹É…‘¥ÕÌ€ô•¹•µä¹•±¥Ñ•A¡…Í”€øô€Ì€ü€Ì¸à€è€Ì¸Äì(€€€¡…é…É¹µ•Í ¹Í…±”¹Í•ÑM…±…È¡¡…é…É¹É…‘¥ÕÌ¤ì(€€€¡…é…É¹µ•Í ¹µ…Ñ•É¥…°¹½±½È¹Í•Ð ÁáˆÔÙ™˜¤ì(€€€¡…é…É¹Ñ•±•É…Á €ô€Ä¸ÈÔì(€€€¡…é…É¹‘ÕÉ…Ñ¥½¸€ô€Ð¸Èì(€€€¡…é…É¹Ñ¥¬€ô€Àì(€€€¡…é…É¹‘…µ…”€ô•¹•µä¹½¹™¥œ¹¡…é…É‘…µ…”€üü€ÄÌì(€€€•¹•µä¹…ÑÑ…­½½±‘½Ý¸€ô€È¸Ðì(€ô((€ÍÁ…Ý¹AÉ½©•Ñ¥±”¡½É¥¥¸°‘¥É•Ñ¥½¸°ÍÁ••°‘…µ…”°½±½È°É…‘¥ÕÌ¤ì(€€€½¹ÍÐÁÉ½©•Ñ¥±”€ôÑ¡¥Ì¹ÁÉ½©•Ñ¥±•Ì¹¹•áÐ ¤ì(€€€ÁÉ½©•Ñ¥±”¹µ•Í ¹Á½Í¥Ñ¥½¸¹½Áä¡½É¥¥¸¤ì(€€€ÁÉ½©•Ñ¥±”¹ÁÉ•Ù¥½ÕÌ¹½Áä¡½É¥¥¸¤ì(€€€ÁÉ½©•Ñ¥±”¹Ù•±½¥Ñä¹½Áä¡‘¥É•Ñ¥½¸¤¹µÕ±Ñ¥Á±åM…±…È¡ÍÁ••¤ì(€€€ÁÉ½©•Ñ¥±”¹‘…µ…”€ô‘…µ…”ì(€€€ÁÉ½©•Ñ¥±”¹É…‘¥ÕÌ€ôÉ…‘¥ÕÌì(€€€ÁÉ½©•Ñ¥±”¹±¥™”€ô€Ðì(€€€ÁÉ½©•Ñ¥±”¹½±½È€ô½±½Èì(€€€ÁÉ½©•Ñ¥±”¹µ•Í ¹µ…Ñ•É¥…°¹½±½È¹Í•Ð¡½±½È¤ì(€€€ÁÉ½©•Ñ¥±”¹µ•Í ¹Í…±”¹Í•ÑM…±…È¡É…‘¥ÕÌ€¼€À¸ÄÈ¤ì(€€€Ñ¡¥Ì¹…Õ‘¥¼ü¹Á±…å™™•Ðü¸ •¹•µåM¡½Ðœ°ìÁ½Í¥Ñ¥½¸è½É¥¥¸°Á¥Ñ è€À¸ä€¬Ñ¡¥Ì¹É…¹‘½´ ¤€¨€À¸Èô¤ì(€ô((€ÕÁ‘…Ñ•AÉ½©•Ñ¥±•Ì¡‘Ð¤ì(€€€™½È€¡½¹ÍÐÁÉ½©•Ñ¥±”½˜Ñ¡¥Ì¹ÁÉ½©•Ñ¥±•Ì¹¥Ñ•µÌ¤ì(€€€€€¥˜€ …ÁÉ½©•Ñ¥±”¹…Ñ¥Ù”¤½¹Ñ¥¹Õ”ì(€€€€€ÁÉ½©•Ñ¥±”¹±¥™”€´ô‘Ðì(€€€€€ÁÉ½©•Ñ¥±”¹ÁÉ•Ù¥½ÕÌ¹½Áä¡ÁÉ½©•Ñ¥±”¹µ•Í ¹Á½Í¥Ñ¥½¸¤ì(€€€€€ÁÉ½©•Ñ¥±”¹µ•Í ¹Á½Í¥Ñ¥½¸¹…‘‘M…±•‘Y•Ñ½È¡ÁÉ½©•Ñ¥±”¹Ù•±½¥Ñä°‘Ð¤ì(€€€€€ÁÉ½©•Ñ¥±”¹µ•Í ¹É½Ñ…Ñ¥½¸¹à€¬ô‘Ð€¨€Üì(€€€€€ÁÉ½©•Ñ¥±”¹µ•Í ¹É½Ñ…Ñ¥½¸¹ä€¬ô‘Ð€¨€äì(€€€€€½¹ÍÐ‘•±Ñ„€ôÑ¡¥Ì¹Ñ•µÁ¥É•Ñ¥½¸¹ÍÕ‰Y•Ñ½ÉÌ¡ÁÉ½©•Ñ¥±”¹µ•Í ¹Á½Í¥Ñ¥½¸°ÁÉ½©•Ñ¥±”¹ÁÉ•Ù¥½ÕÌ¤ì(€€€€€½¹ÍÐ‘¥ÍÑ…¹”€ô‘•±Ñ„¹±•¹Ñ  ¤ì(€€€€€½¹ÍÐ‘¥É•Ñ¥½¸€ô‘¥ÍÑ…¹”€ø€À€ü‘•±Ñ„¹µÕ±Ñ¥Á±åM…±…È Ä€¼‘¥ÍÑ…¹”¤€è‘•±Ñ„ì(€€€€€½¹ÍÐÝ½É±‘!¥Ð€ô‘¥ÍÑ…¹”€ø€À€üÑ¡¥Ì¹…É•¹„ü¹É…å…ÍÑ]½É±ü¸¡ÁÉ½©•Ñ¥±”¹ÁÉ•Ù¥½ÕÌ°‘¥É•Ñ¥½¸°‘¥ÍÑ…¹”€¬ÁÉ½©•Ñ¥±”¹É…‘¥ÕÌ¤€è¹Õ±°ì(€€€€€½¹ÍÐÁ±…å•ÉA½¥¹Ð€ôÑ¡¥Ì¹Ñ•µÁA±…å•È¹½Áä¡Ñ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¤ì(€€€€€Á±…å•ÉA½¥¹Ð¹ä€¬ô€À¸äì(€€€€€½¹ÍÐÁ±…å•É±½¹M•µ•¹Ð€ô‘¥ÍÑ…¹”€ø€À(€€€€€€€€üQ!I¹5…Ñ¡UÑ¥±Ì¹±…µÀ¡Ñ¡¥Ì¹Ñ•µÁAÉ½©•Ñ¥±•Q½A±…å•È¹ÍÕ‰Y•Ñ½ÉÌ¡Á±…å•ÉA½¥¹Ð°ÁÉ½©•Ñ¥±”¹ÁÉ•Ù¥½ÕÌ¤¹‘½Ð¡‘¥É•Ñ¥½¸¤°€À°‘¥ÍÑ…¹”¤(€€€€€€€€è€Àì(€€€€€½¹ÍÐ±½Í•ÍÑQ½A±…å•È€ôÑ¡¥Ì¹Ñ•µÁAÉ½©•Ñ¥±•±½Í•ÍÐ¹½Áä¡‘¥É•Ñ¥½¸¤¹µÕ±Ñ¥Á±åM…±…È¡Á±…å•É±½¹M•µ•¹Ð¤¹…‘¡ÁÉ½©•Ñ¥±”¹ÁÉ•Ù¥½ÕÌ¤ì(€€€€€½¹ÍÐÁ±…å•É!¥Ð€ô±½Í•ÍÑQ½A±…å•È¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Á±…å•ÉA½¥¹Ð¤€ðô€¡ÁÉ½©•Ñ¥±”¹É…‘¥ÕÌ€¬€À¸ÔÔ¤€¨¨€Èì(€€€€€½¹ÍÐÁ±…å•É!¥Ñ¥ÍÑ…¹”€ôÁ±…å•É!¥Ð€ü5…Ñ ¹µ…à À°Á±…å•É±½¹M•µ•¹Ð€´ÁÉ½©•Ñ¥±”¹É…‘¥ÕÌ¤€è%¹™¥¹¥Ñäì(€€€€€½¹ÍÐÝ½É±‘!¥Ñ¥ÍÑ…¹”€ôÝ½É±‘!¥Ðü¹‘¥ÍÑ…¹”€üü%¹™¥¹¥Ñäì((€€€€€¥˜€¡Ý½É±‘!¥Ñ¥ÍÑ…¹”€ðôÁ±…å•É!¥Ñ¥ÍÑ…¹”€˜˜Ý½É±‘!¥Ñ¥ÍÑ…¹”€ðô‘¥ÍÑ…¹”€¬ÁÉ½©•Ñ¥±”¹É…‘¥ÕÌ¤ì(€€€€€€€Ñ¡¥Ì¹•™™•ÑÌ¹ÍÁ…Ý¹%µÁ…Ð¡Ý½É±‘!¥Ð¹Á½¥¹Ð€üüÁÉ½©•Ñ¥±”¹µ•Í ¹Á½Í¥Ñ¥½¸°Ý½É±‘!¥Ð¹¹½Éµ…°€üüU@°ÁÉ½©•Ñ¥±”¹½±½È°€Ø¤ì(€€€€€€€Ñ¡¥Ì¹‘•…Ñ¥Ù…Ñ•AÉ½©•Ñ¥±”¡ÁÉ½©•Ñ¥±”¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€¥˜€¡Á±…å•É!¥Ð¤ì(€€€€€€€Ñ¡¥Ì¹Á±…å•È¹‘…µ…”ü¸¡ÁÉ½©•Ñ¥±”¹‘…µ…”°ìÍ½ÕÉ”è€•¹•µåAÉ½©•Ñ¥±”œ°Á½Í¥Ñ¥½¸èÁÉ½©•Ñ¥±”¹ÁÉ•Ù¥½ÕÌ°…ÕÍ”è€ŸBcBóBÿFBïF3FƒBÿFBûFBãBËB÷BãBëBÀœô¤ì(€€€€€€€Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌü¹•µ¥Ðü¸ ½µ‰…ÐéÁ±…å•Èµ¡¥Ðœ°ì‘…µ…”èÁÉ½©•Ñ¥±”¹‘…µ…”°Í½ÕÉ”èÁÉ½©•Ñ¥±”¹ÁÉ•Ù¥½ÕÌ¹±½¹” ¤°…ÕÍ”è€ŸBcBóBÿFBïF3FƒBÿFBûFBãBËB÷BãBëBÀœô¤ì(€€€€€€€Ñ¡¥Ì¹•™™•ÑÌ¹ÍÁ…Ý¹%µÁ…Ð¡±½Í•ÍÑQ½A±…å•È°ÁÉ½©•Ñ¥±”¹Ù•±½¥Ñä¹±½¹” ¤¹¹•…Ñ” ¤¹¹½Éµ…±¥é” ¤°€Áá™˜ØÄÝŒ°€ä¤ì(€€€€€€€Ñ¡¥Ì¹‘•…Ñ¥Ù…Ñ•AÉ½©•Ñ¥±”¡ÁÉ½©•Ñ¥±”¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€¥˜€¡ÁÉ½©•Ñ¥±”¹±¥™”€ðô€À¤Ñ¡¥Ì¹‘•…Ñ¥Ù…Ñ•AÉ½©•Ñ¥±”¡ÁÉ½©•Ñ¥±”¤ì(€€€ô(€ô((€‘•…Ñ¥Ù…Ñ•AÉ½©•Ñ¥±”¡ÁÉ½©•Ñ¥±”¤ì(€€€ÁÉ½©•Ñ¥±”¹…Ñ¥Ù”€ô™…±Í”ì(€€€ÁÉ½©•Ñ¥±”¹µ•Í ¹Ù¥Í¥‰±”€ô™…±Í”ì(€ô((€ÕÁ‘…Ñ•!…é…É‘Ì¡‘Ð¤ì(€€€™½È€¡½¹ÍÐ¡…é…É½˜Ñ¡¥Ì¹¡…é…É‘Ì¹¥Ñ•µÌ¤ì(€€€€€¥˜€ …¡…é…É¹…Ñ¥Ù”¤½¹Ñ¥¹Õ”ì(€€€€€¡…é…É¹µ•Í ¹É½Ñ…Ñ¥½¸¹è€¬ô‘Ð€¨€À¸ÌÔì(€€€€€¥˜€¡¡…é…É¹Ñ•±•É…Á €ø€À¤ì(€€€€€€€¡…é…É¹Ñ•±•É…Á €´ô‘Ðì(€€€€€€€¡…é…É¹µ•Í ¹µ…Ñ•É¥…°¹½Á…¥Ñä€ô€À¸Äà€¬5…Ñ ¹Í¥¸¡¡…é…É¹Ñ•±•É…Á €¨€Äà¤€¨€À¸ÄÈì(€€€€€€€¥˜€¡¡…é…É¹Ñ•±•É…Á €ðô€À¤ì(€€€€€€€€€¡…é…É¹µ•Í ¹µ…Ñ•É¥…°¹½±½È¹Í•Ð Áá™˜ÐÐÙ˜¤ì(€€€€€€€€€¡…é…É¹µ•Í ¹µ…Ñ•É¥…°¹½Á…¥Ñä€ô€À¸ÔÔì(€€€€€€€€€Ñ¡¥Ì¹•™™•ÑÌ¹ÍÁ…Ý¹áÁ±½Í¥½¸¡¡…é…É¹µ•Í ¹Á½Í¥Ñ¥½¸°¡…é…É¹É…‘¥ÕÌ°€ÁáˆÔÙ™˜¤ì(€€€€€€€ô(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€¡…é…É¹‘ÕÉ…Ñ¥½¸€´ô‘Ðì(€€€€€¡…é…É¹Ñ¥¬€´ô‘Ðì(€€€€€¡…é…É¹µ•Í ¹µ…Ñ•É¥…°¹½Á…¥Ñä€ô€À¸ÌÈ€¬5…Ñ ¹Í¥¸¡¡…é…É¹‘ÕÉ…Ñ¥½¸€¨€ä¤€¨€À¸ÄÄì(€€€€€½¹ÍÐ‘à€ôÑ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¹à€´¡…é…É¹µ•Í ¹Á½Í¥Ñ¥½¸¹àì(€€€€€½¹ÍÐ‘è€ôÑ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¹è€´¡…é…É¹µ•Í ¹Á½Í¥Ñ¥½¸¹èì(€€€€€¥˜€¡‘à€¨‘à€¬‘è€¨‘è€ðô¡…é…É¹É…‘¥ÕÌ€¨¡…é…É¹É…‘¥ÕÌ€˜˜¡…é…É¹Ñ¥¬€ðô€À¤ì(€€€€€€€¡…é…É¹Ñ¥¬€ô€À¸ÜÈì(€€€€€€€Ñ¡¥Ì¹Á±…å•È¹‘…µ…”ü¸¡¡…é…É¹‘…µ…”°ìÍ½ÕÉ”è€Ý…É‘•¹!…é…Éœ°Á½Í¥Ñ¥½¸è¡…é…É¹µ•Í ¹Á½Í¥Ñ¥½¸°…ÕÍ”è€ŸB“BÃBßBûBËF/BäƒFBÃBßBïBûBðœô¤ì(€€€€€€€Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌü¹•µ¥Ðü¸ ½µ‰…ÐéÁ±…å•Èµ¡¥Ðœ°ì‘…µ…”è¡…é…É¹‘…µ…”°Í½ÕÉ”è¡…é…É¹µ•Í ¹Á½Í¥Ñ¥½¸¹±½¹” ¤°…ÕÍ”è€ŸB“BÃBßBûBËF/BäƒFBÃBßBïBûBðœô¤ì(€€€€€ô(€€€€€¥˜€¡¡…é…É¹‘ÕÉ…Ñ¥½¸€ðô€À¤ì(€€€€€€€¡…é…É¹…Ñ¥Ù”€ô™…±Í”ì(€€€€€€€¡…é…É¹µ•Í ¹Ù¥Í¥‰±”€ô™…±Í”ì(€€€€€ô(€€€ô(€ô((€ÕÁ‘…Ñ•A¥­ÕÁÌ¡‘Ð¤ì(€€€™½È€¡½¹ÍÐÁ¥­ÕÀ½˜Ñ¡¥Ì¹Á¥­ÕÁÌ¹¥Ñ•µÌ¤ì(€€€€€¥˜€ …Á¥­ÕÀ¹…Ñ¥Ù”¤½¹Ñ¥¹Õ”ì(€€€€€Á¥­ÕÀ¹…”€¬ô‘Ðì(€€€€€Á¥­ÕÀ¹µ•Í ¹É½Ñ…Ñ¥½¸¹ä€¬ô‘Ð€¨€Ä¸àì(€€€€€Á¥­ÕÀ¹µ•Í ¹Á½Í¥Ñ¥½¸¹ä€ôÁ¥­ÕÀ¹µ•Í ¹ÕÍ•É…Ñ„¹‰…Í•d€¬5…Ñ ¹Í¥¸¡Á¥­ÕÀ¹…”€¨€Ì¤€¨€À¸ÄÈì(€€€€€¥˜€¡Á¥­ÕÀ¹µ•Í ¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Ñ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¤€ð€Ä¸ÜÔ¤ì(€€€€€€€Á¥­ÕÀ¹…Ñ¥Ù”€ô™…±Í”ì(€€€€€€€Á¥­ÕÀ¹µ•Í ¹Ù¥Í¥‰±”€ô™…±Í”ì(€€€€€€€Ñ¡¥Ì¹…Õ‘¥¼ü¹Á±…åU$ü¸ Á¥­ÕÀœ°ìÁ¥Ñ èÁ¥­ÕÀ¹ÑåÁ”€ôôô€¡•…±Ñ œ€ü€Ä¸ÄÔ€è€À¸äÈô¤ì(€€€€€€€Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌü¹•µ¥Ðü¸ Á¥­ÕÀé½±±•Ñ•œ°ìÑåÁ”èÁ¥­ÕÀ¹ÑåÁ”°Ù…±Õ”èÁ¥­ÕÀ¹Ù…±Õ”ô¤ì(€€€€€ô•±Í”¥˜€¡Á¥­ÕÀ¹…”€ø€ÈÀ¤ì(€€€€€€€Á¥­ÕÀ¹…Ñ¥Ù”€ô™…±Í”ì(€€€€€€€Á¥­ÕÀ¹µ•Í ¹Ù¥Í¥‰±”€ô™…±Í”ì(€€€€€ô(€€€ô(€ô((€ÍÁ…Ý¹A¥­ÕÀ¡Á½Í¥Ñ¥½¸°Õ…É…¹Ñ••€ô™…±Í”¤ì(€€€¥˜€ …Õ…É…¹Ñ••€˜˜Ñ¡¥Ì¹É…¹‘½´ ¤€ø€À¸ÌÐ¤É•ÑÕÉ¸ì(€€€½¹ÍÐÁ¥­ÕÀ€ôÑ¡¥Ì¹Á¥­ÕÁÌ¹¹•áÐ ¤ì(€€€½¹ÍÐ¹••‘Í!•…±Ñ €ô€¡Ñ¡¥Ì¹Á±…å•È¹¡•…±Ñ €üü€ÄÀÀ¤€ð€¡Ñ¡¥Ì¹Á±…å•È¹µ…á!•…±Ñ €üü€ÄÀÀ¤€¨€À¸ÔÔì(€€€Á¥­ÕÀ¹ÑåÁ”€ô¹••‘Í!•…±Ñ €˜˜Ñ¡¥Ì¹É…¹‘½´ ¤€ð€À¸Ôà€ü€¡•…±Ñ œ€èÑ¡¥Ì¹É…¹‘½´ ¤€ð€À¸ÜÈ€ü€…µµ¼œ€è€…Éµ½Èœì(€€€Á¥­ÕÀ¹Ù…±Õ”€ôÁ¥­ÕÀ¹ÑåÁ”€ôôô€¡•…±Ñ œ€ü€ÈÐ€èÁ¥­ÕÀ¹ÑåÁ”€ôôô€…Éµ½Èœ€ü€Äà€è€Èàì(€€€Á¥­ÕÀ¹µ•Í ¹µ…Ñ•É¥…°¹½±½È¹Í•Ð¡Á¥­ÕÀ¹ÑåÁ”€ôôô€¡•…±Ñ œ€ü€ÁàÔÕ˜Èå„€èÁ¥­ÕÀ¹ÑåÁ”€ôôô€…Éµ½Èœ€ü€ÁàÕ•”Ý™˜€è€Áá™™ÐÕˆ¤ì(€€€Á¥­ÕÀ¹µ•Í ¹µ…Ñ•É¥…°¹•µ¥ÍÍ¥Ù”¹Í•Ð¡Á¥­ÕÀ¹µ•Í ¹µ…Ñ•É¥…°¹½±½È¤ì(€€€Á¥­ÕÀ¹µ•Í ¹Á½Í¥Ñ¥½¸¹½Áä¡Á½Í¥Ñ¥½¸¤¹…‘¡¹•ÜQ!I¹Y•Ñ½ÈÌ À°€À¸ÔÔ°€À¤¤ì(€€€Á¥­ÕÀ¹µ•Í ¹ÕÍ•É…Ñ„¹‰…Í•d€ôÁ¥­ÕÀ¹µ•Í ¹Á½Í¥Ñ¥½¸¹äì(€ô((€½¹9½¥Í”¡ì½É¥¥¸°±½Õ‘¹•ÍÌ€ô€Äô¤ì(€€€¥˜€ …½É¥¥¸¤É•ÑÕÉ¸ì(€€€½¹ÍÐÉ…‘¥ÕÍMÄ€ô€ ÈÐ€¨±½Õ‘¹•ÍÌ¤€¨¨€Èì(€€€™½È€¡½¹ÍÐ•¹•µä½˜Ñ¡¥Ì¹•¹•µ¥•Ì¤ì(€€€€€¥˜€¡•¹•µä¹‘•…ñð•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡½É¥¥¸¤€øÉ…‘¥ÕÍMÄ¤½¹Ñ¥¹Õ”ì(€€€€€•¹•µä¹±…ÍÑ-¹½Ý¸¹½Áä¡½É¥¥¸¤ì(€€€€€•¹•µä¹±…ÍÑ!•…É‘”€ô€Àì(€€€€€¥˜€¡•¹•µä¹ÍÑ…Ñ”€ôôô€Á…ÑÉ½°œñð•¹•µä¹ÍÑ…Ñ”€ôôô€Í•…É œ¤Ñ¡¥Ì¹Í•ÑMÑ…Ñ”¡•¹•µä°€ÍÕÍÁ¥¥½ÕÌœ¤ì(€€€ô(€ô((€…ÍÍ¥¹ÑÑ…­Q½­•¹Ì ¤ì(€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôÑ¡¥Ì¹•¹•µ¥•Ì(€€€€€€¹™¥±Ñ•È ¡•¹•µä¤€ôø€…•¹•µä¹‘•…€˜˜•¹•µä¹ÑåÁ”€„ôô€Ý…É‘•¸œ€˜˜l½µ‰…Ðœ°€™±…¹¬œ°€Ñ…­•½Ù•Èt¹¥¹±Õ‘•Ì¡•¹•µä¹ÍÑ…Ñ”¤¤(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø„¹É½½Ð¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Ñ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¤€´ˆ¹É½½Ð¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Ñ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¤¤ì(€€€…¹‘¥‘…Ñ•Ì¹™½É…  ¡•¹•µä°¥¹‘•à¤€ôøì•¹•µä¹¡…ÍÑÑ…­Q½­•¸€ô¥¹‘•à€ðÑ¡¥Ì¹µ…áÑÑ…­•ÉÌìô¤ì(€€€™½È€¡½¹ÍÐ•¹•µä½˜Ñ¡¥Ì¹•¹•µ¥•Ì¤¥˜€¡•¹•µä¹ÑåÁ”€ôôô€Ý…É‘•¸œ€˜˜€…•¹•µä¹‘•…¤•¹•µä¹¡…ÍÑÑ…­Q½­•¸€ôÑÉÕ”ì(€ô((€Í•ÑMÑ…Ñ”¡•¹•µä°ÍÑ…Ñ”¤ì(€€€¥˜€¡•¹•µä¹ÍÑ…Ñ”€ôôôÍÑ…Ñ”¤É•ÑÕÉ¸ì(€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ô•¹•µä¹ÍÑ…Ñ”ì(€€€•¹•µä¹ÍÑ…Ñ”€ôÍÑ…Ñ”ì(€€€•¹•µä¹ÍÑ…Ñ•Q¥µ”€ô€Àì(€€€Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌü¹•µ¥Ðü¸ •¹•µäéÍÑ…Ñ”œ°ì¥è•¹•µä¹¥°ÑåÁ”è•¹•µä¹ÑåÁ”°ÁÉ•Ù¥½ÕÌ°ÍÑ…Ñ”ô¤ì(€ô((€É…å…ÍÐ¡½É¥¥¸°‘¥É•Ñ¥½¸°µ…á¥ÍÑ…¹”€ô%¹™¥¹¥Ñä¤ì(€€€€¼¼I…å…ÍÑ•ÈÕÍ•Ìµ…ÑÉ¥á]½É±É…Ñ¡•ÈÑ¡…¸±½…°ÑÉ…¹Í™½ÉµÌ¸¹•µ¥•Ì…É”µ½Ù•(€€€€¼¼‘ÕÉ¥¹œ™¥á•ÕÁ‘…Ñ•Ì°Í¼µÕ±Ñ¥Á±”Í¥µÕ±…Ñ¥½¸ÍÑ•ÁÌ…¸¡…ÁÁ•¸‰•™½É”Ñ¡”(€€€€¼¼É•¹‘•É•È•ÑÌ„¡…¹”Ñ¼É•™É•Í Ñ¡½Í”µ…ÑÉ¥•Ì¸(€€€Ñ¡¥Ì¹É½ÕÀ¹ÕÁ‘…Ñ•5…ÑÉ¥á]½É±¡ÑÉÕ”¤ì(€€€Ñ¡¥Ì¹É…å…ÍÑ•È¹Í•Ð¡½É¥¥¸°‘¥É•Ñ¥½¸¤ì(€€€Ñ¡¥Ì¹É…å…ÍÑ•È¹™…È€ôµ…á¥ÍÑ…¹”ì(€€€½¹ÍÐ¥¹Ñ•ÉÍ•Ñ¥½¹Ì€ôÑ¡¥Ì¹É…å…ÍÑ•È¹¥¹Ñ•ÉÍ•Ñ=‰©•ÑÌ¡Ñ¡¥Ì¹¡¥Ñ5•Í¡•Ì°™…±Í”¤ì(€€€™½È€¡½¹ÍÐ¥¹Ñ•ÉÍ•Ñ¥½¸½˜¥¹Ñ•ÉÍ•Ñ¥½¹Ì¤ì(€€€€€½¹ÍÐ•¹•µä€ôÑ¡¥Ì¹‰å%¹•Ð¡¥¹Ñ•ÉÍ•Ñ¥½¸¹½‰©•Ð¹ÕÍ•É…Ñ„¹•¹•µå%¤ì(€€€€€¥˜€ …•¹•µäñð•¹•µä¹‘•…ñð€…•¹•µä¹É½½Ð¹Ù¥Í¥‰±”¤½¹Ñ¥¹Õ”ì(€€€€€É•ÑÕÉ¸ì(€€€€€€€•¹•µä°(€€€€€€€Á½¥¹Ðè¥¹Ñ•ÉÍ•Ñ¥½¸¹Á½¥¹Ð°(€€€€€€€‘¥ÍÑ…¹”è¥¹Ñ•ÉÍ•Ñ¥½¸¹‘¥ÍÑ…¹”°(€€€€€€€é½¹”è¥¹Ñ•ÉÍ•Ñ¥½¸¹½‰©•Ð¹ÕÍ•É…Ñ„¹¡¥Ñi½¹”€üü€‰½‘äœ°(€€€€€€€¹½Éµ…°è¥¹Ñ•ÉÍ•Ñ¥½¸¹™…”ü¹¹½Éµ…°ü¹±½¹”ü¸ ¤°(€€€€€ôì(€€€ô(€€€É•ÑÕÉ¸¹Õ±°ì(€ô((€‘…µ…”¡•¹•µå=É%°…µ½Õ¹Ð°½¹Ñ•áÐ€ôíô¤ì(€€€½¹ÍÐ•¹•µä€ôÑåÁ•½˜•¹•µå=É%€ôôô€ÍÑÉ¥¹œœ€üÑ¡¥Ì¹‰å%¹•Ð¡•¹•µå=É%¤€è•¹•µå=É%ì(€€€¥˜€ …•¹•µäñð•¹•µä¹‘•…ñð€…9Õµ‰•È¹¥Í¥¹¥Ñ”¡…µ½Õ¹Ð¤ñð…µ½Õ¹Ð€ðô€À¤É•ÑÕÉ¸ì…ÁÁ±¥•è€À°­¥±±•è™…±Í”ôì(€€€±•ÐÉ•µ…¥¹¥¹œ€ô…µ½Õ¹Ðì(€€€¥˜€¡•¹•µä¹Í¡¥•±€ø€À¤ì(€€€€€½¹ÍÐ…‰Í½É‰•€ô5…Ñ ¹µ¥¸¡•¹•µä¹Í¡¥•±°É•µ…¥¹¥¹œ¤ì(€€€€€•¹•µä¹Í¡¥•±€´ô…‰Í½É‰•ì(€€€€€É•µ…¥¹¥¹œ€´ô…‰Í½É‰•ì(€€€€€¥˜€¡•¹•µä¹É½½Ð¹ÕÍ•É…Ñ„¹Í¡¥•±¤ì(€€€€€€€•¹•µä¹É½½Ð¹ÕÍ•É…Ñ„¹Í¡¥•±¹µ…Ñ•É¥…°¹½Á…¥Ñä€ô€À¸ÄÔ€¬€¡•¹•µä¹Í¡¥•±€¼•¹•µä¹µ…áM¡¥•±¤€¨€À¸ÈÈì(€€€€€€€•¹•µä¹É½½Ð¹ÕÍ•É…Ñ„¹Í¡¥•±¹Ù¥Í¥‰±”€ô•¹•µä¹Í¡¥•±€ø€Àì(€€€€€ô(€€€€€Ñ¡¥Ì¹•™™•ÑÌ¹ÍÁ…Ý¹%µÁ…Ð¡½¹Ñ•áÐ¹Á½¥¹Ð€üü•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸°½¹Ñ•áÐ¹‘¥É•Ñ¥½¸ü¹±½¹”ü¸ ¤¹¹•…Ñ”ü¸ ¤€üüU@°€ÁáˆÔÙ™˜°€Ü¤ì(€€€ô(€€€¥˜€¡É•µ…¥¹¥¹œ€ø€À¤•¹•µä¹¡•…±Ñ €´ôÉ•µ…¥¹¥¹œì(€€€Ñ¡¥Ì¹Í•ÑMÑ…Ñ”¡•¹•µä°€½µ‰…Ðœ¤ì(€€€•¹•µä¹±…ÍÑ-¹½Ý¸¹½Áä¡Ñ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¤ì(€€€½¹ÍÐ­¥±±•€ô•¹•µä¹¡•…±Ñ €ðô€Àì(€€€¥˜€¡­¥±±•¤Ñ¡¥Ì¹­¥±°¡•¹•µä°½¹Ñ•áÐ¤ì(€€€•±Í”Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌü¹•µ¥Ðü¸ •¹•µäé‘…µ…•œ°ì¥è•¹•µä¹¥°ÑåÁ”è•¹•µä¹ÑåÁ”°…µ½Õ¹Ð°¡•…±Ñ è•¹•µä¹¡•…±Ñ °µ…á!•…±Ñ è•¹•µä¹µ…á!•…±Ñ °Í¡¥•±è•¹•µä¹Í¡¥•±ô¤ì(€€€É•ÑÕÉ¸ì…ÁÁ±¥•è…µ½Õ¹Ð°­¥±±•°¡•…±Ñ è5…Ñ ¹µ…à À°•¹•µä¹¡•…±Ñ ¤°Í¡¥•±è•¹•µä¹Í¡¥•±ôì(€ô((€­¥±°¡•¹•µä°½¹Ñ•áÐ€ôíô¤ì(€€€•¹•µä¹‘•…€ôÑÉÕ”ì(€€€•¹•µä¹ÍÑ…Ñ”€ô€‘•…œì(€€€•¹•µä¹¡•…±Ñ €ô€Àì(€€€•¹•µä¹Á•¹‘¥¹ÑÑ…¬€ô¹Õ±°ì(€€€•¹•µä¹¡…ÍÑÑ…­Q½­•¸€ô™…±Í”ì(€€€™½È€¡½¹ÍÐµ•Í ½˜•¹•µä¹¡¥Ñ5•Í¡•Ì¤ì(€€€€€½¹ÍÐ¥¹‘•à€ôÑ¡¥Ì¹¡¥Ñ5•Í¡•Ì¹¥¹‘•á=˜¡µ•Í ¤ì(€€€€€¥˜€¡¥¹‘•à€øô€À¤Ñ¡¥Ì¹¡¥Ñ5•Í¡•Ì¹ÍÁ±¥”¡¥¹‘•à°€Ä¤ì(€€€ô(€€€½¹ÍÐÁ½Í¥Ñ¥½¸€ô•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸¹±½¹” ¤¹…‘¡¹•ÜQ!I¹Y•Ñ½ÈÌ À°€Ä°€À¤¤ì(€€€Ñ¡¥Ì¹•™™•ÑÌ¹ÍÁ…Ý¹¹•µå•…Ñ ¡Á½Í¥Ñ¥½¸°•¹•µä¹½¹™¥œ¹½±½È€üü95e}=1=IMm•¹•µä¹ÑåÁ•t°•¹•µä¹ÑåÁ”€ôôô€Ý…É‘•¸œ€ü€Ä¸à€è€Ä¤ì(€€€Ñ¡¥Ì¹…Õ‘¥¼ü¹Á±…å™™•Ðü¸ •¹•µå•…Ñ œ°ìÁ½Í¥Ñ¥½¸°Á¥Ñ è•¹•µä¹ÑåÁ”€ôôô€Ý…É‘•¸œ€ü€À¸Ðà€è€À¸àÔ€¬Ñ¡¥Ì¹É…¹‘½´ ¤€¨€À¸Ìô¤ì(€€€Ñ¡¥Ì¹ÍÁ…Ý¹A¥­ÕÀ¡•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸°•¹•µä¹ÑåÁ”€ôôô€Ý…É‘•¸œ¤ì(€€€Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌü¹•µ¥Ðü¸ •¹•µäé­¥±±•œ°ì(€€€€€¥è•¹•µä¹¥°(€€€€€ÑåÁ”è•¹•µä¹ÑåÁ”°(€€€€€•±¥Ñ”è•¹•µä¹ÑåÁ”€ôôô€Ý…É‘•¸œ°(€€€€€¡•…‘Í¡½Ðè½¹Ñ•áÐ¹é½¹”€ôôô€¡•…œ°(€€€€€Ý•…Á½¸è½¹Ñ•áÐ¹Ý•…Á½¸°(€€€€€Á½Í¥Ñ¥½¸è•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸¹±½¹” ¤°(€€€€€Í½É”è•¹•µä¹½¹™¥œ¹Í½É”€üü€¡•¹•µä¹ÑåÁ”€ôôô€Ý…É‘•¸œ€ü€ÈÔÀÀ€è•¹•µä¹ÑåÁ”€ôôô€¡Õ¹Ñ•Èœ€ü€ÈÔÀ€è€ÄàÀ¤°(€€€ô¤ì(€ô((€‘…µ…•%¹I…‘¥ÕÌ¡Á½Í¥Ñ¥½¸°É…‘¥ÕÌ°‘…µ…”°½¹Ñ•áÐ€ôíô¤ì(€€€½¹ÍÐÉ…‘¥ÕÍMÄ€ôÉ…‘¥ÕÌ€¨É…‘¥ÕÌì(€€€±•Ð¡¥ÑÌ€ô€Àì(€€€™½È€¡½¹ÍÐ•¹•µä½˜Ñ¡¥Ì¹•¹•µ¥•Ì¤ì(€€€€€¥˜€¡•¹•µä¹‘•…ñð•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Á½Í¥Ñ¥½¸¤€øÉ…‘¥ÕÍMÄ¤½¹Ñ¥¹Õ”ì(€€€€€¥˜€ „¡Ñ¡¥Ì¹…É•¹„ü¹¡…Í1¥¹•=™M¥¡Ðü¸¡Á½Í¥Ñ¥½¸°•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸¤€üüÑÉÕ”¤¤½¹Ñ¥¹Õ”ì(€€€€€½¹ÍÐ‘¥ÍÑ…¹”€ô5…Ñ ¹ÍÅÉÐ¡•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Á½Í¥Ñ¥½¸¤¤ì(€€€€€½¹ÍÐ…µ½Õ¹Ð€ô‘…µ…”€¨€ Ä€´Q!I¹5…Ñ¡UÑ¥±Ì¹±…µÀ¡‘¥ÍÑ…¹”€¼É…‘¥ÕÌ°€À°€Ä¤€¨€À¸ÜÈ¤ì(€€€€€Ñ¡¥Ì¹‘…µ…”¡•¹•µä°…µ½Õ¹Ð°ì€¸¸¹½¹Ñ•áÐ°Á½¥¹Ðè•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸¹±½¹” ¤°é½¹”è€‰½‘äœô¤ì(€€€€€¡¥ÑÌ€¬ô€Äì(€€€ô(€€€É•ÑÕÉ¸¡¥ÑÌì(€ô((€­¥±±±° ¤ì(€€€™½È€¡½¹ÍÐ•¹•µä½˜Ñ¡¥Ì¹•¹•µ¥•Ì¤¥˜€ …•¹•µä¹‘•…¤Ñ¡¥Ì¹­¥±°¡•¹•µä°ìÍ½ÕÉ”è€‘•‰Õœœ°é½¹”è€‰½‘äœô¤ì(€ô((€•Ð…Ñ¥Ù•½Õ¹Ð ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹•¹•µ¥•Ì¹É•‘Õ” ¡½Õ¹Ð°•¹•µä¤€ôø½Õ¹Ð€¬9Õµ‰•È …•¹•µä¹‘•…¤°€À¤ì(€ô((€•Ð•±¥Ñ•±¥Ù” ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹•¹•µ¥•Ì¹Í½µ” ¡•¹•µä¤€ôø€…•¹•µä¹‘•…€˜˜•¹•µä¹ÑåÁ”€ôôô€Ý…É‘•¸œ¤ì(€ô((€•Ñ9•…É•ÍÑ%MÑ…Ñ” ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹•¹•µ¥•Ì(€€€€€€¹™¥±Ñ•È ¡•¹•µä¤€ôø€…•¹•µä¹‘•…¤(€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôø„¹É½½Ð¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Ñ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¤€´ˆ¹É½½Ð¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Ñ¡¥Ì¹Á±…å•È¹Á½Í¥Ñ¥½¸¤¥lÁtü¹ÍÑ…Ñ”€üü€ŸŠPœì(€ô((€•Ñ•‰Õ…Ñ„ ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹•¹•µ¥•Ì¹™¥±Ñ•È ¡•¹•µä¤€ôø€…•¹•µä¹‘•…¤¹µ…À ¡•¹•µä¤€ôø€¡ì(€€€€€¥è•¹•µä¹¥°(€€€€€ÑåÁ”è•¹•µä¹ÑåÁ”°(€€€€€ÍÑ…Ñ”è•¹•µä¹ÍÑ…Ñ”°(€€€€€Á½Í¥Ñ¥½¸è•¹•µä¹É½½Ð¹Á½Í¥Ñ¥½¸¹±½¹” ¤°(€€€€€Ñ…É•Ðè•¹•µä¹Ñ…É•Ð¹±½¹” ¤°(€€€€€±…ÍÑ-¹½Ý¸è•¹•µä¹±…ÍÑ-¹½Ý¸¹±½¹” ¤°(€€€€€…ÑÑ…­Q½­•¸è•¹•µä¹¡…ÍÑÑ…­Q½­•¸°(€€€ô¤¤ì(€ô((€É•Í•Ð ¤ì(€€€™½È€¡½¹ÍÐ•¹•µä½˜Ñ¡¥Ì¹•¹•µ¥•Ì¤ì(€€€€€Ñ¡¥Ì¹É½ÕÀ¹É•µ½Ù”¡•¹•µä¹É½½Ð¤ì(€€€€€•¹•µä¹É½½Ð¹ÑÉ…Ù•ÉÍ” ¡½‰©•Ð¤€ôø½‰©•Ð¹•½µ•ÑÉäü¹‘¥ÍÁ½Í”ü¸ ¤¤ì(€€€€€™½È€¡½¹ÍÐµ…Ñ•É¥…°½˜•¹•µä¹É½½Ð¹ÕÍ•É…Ñ„¹µ…Ñ•É¥…±Ì€üümt¤µ…Ñ•É¥…°¹‘¥ÍÁ½Í”ü¸ ¤ì(€€€ô(€€€Ñ¡¥Ì¹•¹•µ¥•Ì¹±•¹Ñ €ô€Àì(€€€Ñ¡¥Ì¹¡¥Ñ5•Í¡•Ì¹±•¹Ñ €ô€Àì(€€€Ñ¡¥Ì¹‰å%¹±•…È ¤ì(€€€™½È€¡½¹ÍÐÁÉ½©•Ñ¥±”½˜Ñ¡¥Ì¹ÁÉ½©•Ñ¥±•Ì¹¥Ñ•µÌ¤Ñ¡¥Ì¹‘•…Ñ¥Ù…Ñ•AÉ½©•Ñ¥±”¡ÁÉ½©•Ñ¥±”¤ì(€€€™½È€¡½¹ÍÐ¡…é…É½˜Ñ¡¥Ì¹¡…é…É‘Ì¹¥Ñ•µÌ¤ì(€€€€€¡…é…É¹…Ñ¥Ù”€ô™…±Í”ì(€€€€€¡…é…É¹µ•Í ¹Ù¥Í¥‰±”€ô™…±Í”ì(€€€ô(€€€™½È€¡½¹ÍÐÁ¥­ÕÀ½˜Ñ¡¥Ì¹Á¥­ÕÁÌ¹¥Ñ•µÌ¤ì(€€€€€Á¥­ÕÀ¹…Ñ¥Ù”€ô™…±Í”ì(€€€€€Á¥­ÕÀ¹µ•Í ¹Ù¥Í¥‰±”€ô™…±Í”ì(€€€ô(€€€Ñ¡¥Ì¹…¥É½é•¸€ô™…±Í”ì(€ô((€‘¥ÍÁ½Í” ¤ì(€€€Ñ¡¥Ì¹É•Í•Ð ¤ì(€€€Ñ¡¥Ì¹Í•¹”¹É•µ½Ù”¡Ñ¡¥Ì¹É½ÕÀ¤ì(€€€™½È€¡½¹ÍÐÕ¹ÍÕ‰ÍÉ¥‰”½˜Ñ¡¥Ì¹Õ¹ÍÕ‰ÍÉ¥‰•ÉÌ¤Õ¹ÍÕ‰ÍÉ¥‰”ü¸ ¤ì(€€€™½È€¡½¹ÍÐÁÉ½©•Ñ¥±”½˜Ñ¡¥Ì¹ÁÉ½©•Ñ¥±•Ì¹¥Ñ•µÌ¤ì(€€€€€Ñ¡¥Ì¹Í•¹”¹É•µ½Ù”¡ÁÉ½©•Ñ¥±”¹µ•Í ¤ì(€€€€€ÁÉ½©•Ñ¥±”¹µ•Í ¹µ…Ñ•É¥…°¹‘¥ÍÁ½Í” ¤ì(€€€ô(€€€Ñ¡¥Ì¹ÁÉ½©•Ñ¥±•Ì¹•½µ•ÑÉä¹‘¥ÍÁ½Í” ¤ì(€€€™½È€¡½¹ÍÐ¡…é…É½˜Ñ¡¥Ì¹¡…é…É‘Ì¹¥Ñ•µÌ¤ì(€€€€€Ñ¡¥Ì¹Í•¹”¹É•µ½Ù”¡¡…é…É¹µ•Í ¤ì(€€€€€¡…é…É¹µ•Í ¹µ…Ñ•É¥…°¹‘¥ÍÁ½Í” ¤ì(€€€ô(€€€Ñ¡¥Ì¹¡…é…É‘Ì¹•½µ•ÑÉä¹‘¥ÍÁ½Í” ¤ì(€€€™½È€¡½¹ÍÐÁ¥­ÕÀ½˜Ñ¡¥Ì¹Á¥­ÕÁÌ¹¥Ñ•µÌ¤ì(€€€€€Ñ¡¥Ì¹Í•¹”¹É•µ½Ù”¡Á¥­ÕÀ¹µ•Í ¤ì(€€€€€Á¥­ÕÀ¹µ•Í ¹µ…Ñ•É¥…°¹‘¥ÍÁ½Í” ¤ì(€€€ô(€€€Ñ¡¥Ì¹Á¥­ÕÁÌ¹•½µ•ÑÉä¹‘¥ÍÁ½Í” ¤ì(€ô)ô()•áÁ½ÉÐ‘•™…Õ±Ð¹•µåMåÍÑ•´ì(