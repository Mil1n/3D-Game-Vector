import * as THREE from 'three';
import { GAME_CONFIG } from '../configs/gameConfig.js';

const PHASES = Object.freeze({
  RECON: 'recon',
  ESCALATION: 'escalation',
  SHIFT: 'shift',
  HUNT: 'hunt',
  FINAL: 'final',
  COMPLETE: 'complete',
});

const PHASE_LABELS = Object.freeze({
  recon: '01 // РАЗВЕДКА',
  escalation: '02 // ЭСКАЛАЦИЯ',
  shift: '03 // СДВИГ',
  hunt: '04 // ОХОТА',
  final: '05 // ЭВАКУАЦИЯ',
  complete: 'ПРОГОН ЗАВЕРШЁН',
});

const PHASE_CONFIG_IDS = Object.freeze({
  [PHASES.RECON]: ['recon'],
  [PHASES.ESCALATION]: ['escalation'],
  [PHASES.SHIFT]: ['shift'],
  [PHASES.HUNT]: ['hunt'],
  [PHASES.FINAL]: ['final', 'finale'],
});

const INTERLUDE_COPY = Object.freeze({
  [PHASES.ESCALATION]: {
    title: 'ВЫЖИТЬ // ПЕРИМЕТР НЕСТАБИЛЕН',
    countdown: 'Эскалация через',
  },
  [PHASES.SHIFT]: {
    title: 'ВЫЖИТЬ // НАРАСТАНИЕ РАЗЛОМА',
    countdown: 'Сдвиг реальности через',
  },
  [PHASES.HUNT]: {
    title: 'ВЫЖИТЬ // ЭЛИТНАЯ СИГНАТУРА',
    countdown: 'Страж материализуется через',
  },
  [PHASES.FINAL]: {
    title: 'ВЫЖИТЬ // КАНАЛ ФОРМИРУЕТСЯ',
    countdown: 'Эвакуация через',
  },
});

const AMBIENT_SHIFT_DELAY = 76;
const AMBIENT_SHIFT_JITTER = 12;

const ANOMALIES = Object.freeze([
  {
    id: 'lowGravity',
    name: 'РАЗРЕЖЕННАЯ МАССА',
    description: 'Гравитация ослаблена. Прыжки выше, воздух подчиняется медленнее.',
    gravityScale: 0.48,
    speedScale: 1,
    color: 0x73d8ff,
  },
  {
    id: 'kineticSurge',
    name: 'КИНЕТИЧЕСКИЙ РЕЗОНАНС',
    description: 'Скорость перемещения и восстановление рывка усилены.',
    gravityScale: 1,
    speedScale: 1.16,
    dashScale: 0.72,
    color: 0x58ffc7,
  },
  {
    id: 'storm',
    name: 'ЭНЕРГЕТИЧЕСКИЙ ШТОРМ',
    description: 'Опасные разломы активны. Энергетическое оружие усилено.',
    gravityScale: 1,
    speedScale: 1,
    railDamage: 1.3,
    color: 0xd66cff,
  },
  {
    id: 'supply',
    name: 'КАРМАН СНАБЖЕНИЯ',
    description: 'Открыт резервный сектор с лечением и боеприпасами.',
    gravityScale: 1,
    speedScale: 1,
    color: 0xffd45b,
  },
]);

function makeObjectiveVisual() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 2.86, 48),
    new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  group.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.18, 7, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  beam.position.y = 3.5;
  group.add(beam);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.46, 0),
    new THREE.MeshStandardMaterial({ color: 0x3b2b12, emissive: 0xffb638, emissiveIntensity: 2.6, metalness: 0.72, roughness: 0.28 }),
  );
  core.position.y = 1.05;
  group.add(core);
  group.userData.ring = ring;
  group.userData.beam = beam;
  group.userData.core = core;
  group.visible = false;
  return group;
}

function makeFragmentVisual() {
  const group = new THREE.Group();
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.055, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0x67f5ff, transparent: true, opacity: 0.75 }),
  );
  halo.rotation.x = Math.PI / 2;
  group.add(halo);
  const shard = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.32, 0),
    new THREE.MeshStandardMaterial({ color: 0x143945, emissive: 0x67f5ff, emissiveIntensity: 2.4, metalness: 0.58, roughness: 0.25 }),
  );
  group.add(shard);
  group.userData.halo = halo;
  group.userData.shard = shard;
  return group;
}

export class RunDirector {
  constructor({
    scene,
    eventBus,
    arena,
    player,
    weaponSystem,
    enemySystem,
    effects,
    audioManager,
    upgradeSystem,
    random = Math.random,
    runConfig = GAME_CONFIG.run,
  }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.arena = arena;
    this.player = player;
    this.weaponSystem = weaponSystem;
    this.enemySystem = enemySystem;
    this.effects = effects;
    this.audio = audioManager;
    this.upgradeSystem = upgradeSystem;
    this.random = random;
    this.runConfig = runConfig ?? GAME_CONFIG.run;
    this.maxDurationSeconds = Number.isFinite(this.runConfig.maxDurationSeconds)
      ? this.runConfig.maxDurationSeconds
      : (GAME_CONFIG.run.maxDurationSeconds ?? 600);
    this.objectiveVisual = makeObjectiveVisual();
    this.scene.add(this.objectiveVisual);
    this.fragments = Array.from({ length: 3 }, () => {
      const fragment = makeFragmentVisual();
      fragment.visible = false;
      this.scene.add(fragment);
      return fragment;
    });
    this.temp = new THREE.Vector3();
    this.unsubscribers = [
      this.eventBus?.on?.('enemy:killed', (event) => this.onEnemyKilled(event)),
      this.eventBus?.on?.('combat:player-hit', (event) => this.onPlayerHit(event)),
      this.eventBus?.on?.('pickup:collected', (event) => this.onPickup(event)),
    ].filter(Boolean);
    this.reset();
  }

  reset({ difficulty = 'normal', tutorial = false } = {}) {
    this.difficulty = difficulty;
    this.tutorial = tutorial;
    this.running = false;
    this.phase = PHASES.RECON;
    this.phaseTime = 0;
    this.matchTime = 0;
    this.spawnTimer = 1.3;
    this.hudTimer = 0;
    this.scheduleNextAmbientShift(0);
    this.shift = null;
    this.pendingTransition = null;
    this.pendingUpgrade = false;
    this.afterUpgrade = null;
    this.shiftCount = 0;
    this.intensity = 0.28;
    this.objective = null;
    this.comboTimer = 0;
    this.combo = 0;
    this.stats = {
      kills: 0,
      headshots: 0,
      damageTaken: 0,
      score: 0,
      bestCombo: 0,
      experience: 0,
      objectives: 0,
    };
    this.objectiveVisual.visible = false;
    for (const fragment of this.fragments) fragment.visible = false;
    this.setAnomaly(null);
  }

  start() {
    this.running = true;
    this.phase = PHASES.RECON;
    this.phaseTime = 0;
    this.matchTime = 0;
    this.setObjective({
      type: 'activate',
      title: 'АКТИВИРОВАТЬ ФАЗОВЫЙ УЗЕЛ',
      detail: 'Доберитесь до янтарного маркера и удерживайте E',
      duration: 1.4,
      position: this.getObjectivePoint(0),
    });
    this.enemySystem.spawn('trooper');
    this.enemySystem.spawn('trooper');
    this.eventBus?.emit?.('director:phase', { phase: this.phase, label: PHASE_LABELS[this.phase] });
    this.eventBus?.emit?.('director:announcement', { title: 'ВХОД В НУЛЕВУЮ РЕШЁТКУ', detail: 'Стабилизируйте узлы. Выживите. Эвакуируйтесь.', duration: 4 });
    this.pushHUD(true);
  }

  update(dt, input) {
    if (!this.running || this.phase === PHASES.COMPLETE || this.pendingUpgrade) return;
    this.matchTime += dt;
    this.phaseTime += dt;
    if (this.matchTime >= this.maxDurationSeconds) {
      this.matchTime = this.maxDurationSeconds;
      this.end(false, 'Окно эвакуации закрыто');
      return;
    }
    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && this.combo > 1) this.combo = 1;
    this.updateObjective(dt, input);
    this.updateShift(dt);
    this.updateSpawning(dt);
    this.animateObjective(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.pushHUD();
      this.hudTimer = 0.08;
    }
    if ((this.player.health ?? 1) <= 0) this.end(false, this.player.lastDamageCause ?? 'Критическое повреждение');
  }

  updateObjective(dt, input) {
    if (!this.objective) return;
    const objective = this.objective;
    if (objective.type === 'activate') {
      const inRange = this.horizontalDistance(this.player.position, objective.position) <= 2.9
        && Math.abs(this.player.position.y - objective.position.y) <= 2.6;
      const interacting = inRange && Boolean(input.isDown?.('interact'));
      if (interacting) objective.progress = Math.min(1, objective.progress + dt / objective.duration);
      else objective.progress = Math.max(0, objective.progress - dt * 0.42);
      this.eventBus?.emit?.('director:interact', inRange ? { text: 'УДЕРЖИВАЙТЕ E // СТАБИЛИЗАЦИЯ', active: interacting, progress: objective.progress } : null);
      if (objective.progress >= 1) this.completeObjective();
    } else if (objective.type === 'survive') {
      const remaining = Math.max(0, objective.gateTime - this.matchTime);
      const elapsed = Math.max(0, this.matchTime - objective.startedAt);
      objective.progress = THREE.MathUtils.clamp(elapsed / objective.duration, 0, 1);
      objective.detail = `${objective.countdown}: ${Math.ceil(remaining)} с`;
      if (remaining <= 0) this.executeTransition(objective.nextPhase);
    } else if (objective.type === 'hold') {
      const inside = this.horizontalDistance(this.player.position, objective.position) <= objective.radius
        && Math.abs(this.player.position.y - objective.position.y) <= 3;
      objective.progress = THREE.MathUtils.clamp(objective.progress + dt * (inside ? 1 / objective.duration : -0.18 / objective.duration), 0, 1);
      this.eventBus?.emit?.('director:interact', inside ? { text: 'СИНХРОНИЗАЦИЯ ЗОНЫ', active: true, progress: objective.progress } : { text: 'ВЕРНИТЕСЬ В ЗОНУ', active: false, progress: objective.progress });
      if (objective.progress >= 1) this.completeObjective();
    } else if (objective.type === 'collect') {
      let collected = 0;
      this.fragments.forEach((fragment, index) => {
        if (!fragment.visible) {
          collected += 1;
          return;
        }
        fragment.rotation.y += dt * 1.4;
        fragment.userData.halo.rotation.z += dt * 0.8;
        fragment.position.y = fragment.userData.baseY + Math.sin(this.matchTime * 3 + index) * 0.12;
        if (fragment.position.distanceToSquared(this.player.position) < 2.1) {
          fragment.visible = false;
          collected += 1;
          this.audio?.playUI?.('pickup', { pitch: 1.1 + index * 0.09 });
          this.effects.spawnShiftPulse(fragment.position, 2.4);
          this.eventBus?.emit?.('director:announcement', { title: `ОСКОЛОК ${collected}/3`, detail: 'Фазовая сигнатура сохранена', duration: 1.6 });
        }
      });
      objective.progress = collected / this.fragments.length;
      objective.detail = `Собрано осколков: ${collected}/${this.fragments.length}`;
      if (collected >= this.fragments.length) this.completeObjective();
    } else if (objective.type === 'boss') {
      objective.progress = this.enemySystem.eliteAlive ? objective.progress : 1;
      if (objective.progress >= 1) this.completeObjective();
    } else if (objective.type === 'extract') {
      const inside = this.horizontalDistance(this.player.position, objective.position) <= objective.radius
        && Math.abs(this.player.position.y - objective.position.y) <= 3;
      objective.progress = THREE.MathUtils.clamp(objective.progress + dt * (inside ? 1 / objective.duration : -0.12 / objective.duration), 0, 1);
      objective.detail = inside ? `Канал эвакуации: ${Math.round(objective.progress * 100)}%` : 'Вернитесь в канал эвакуации';
      this.eventBus?.emit?.('director:interact', inside ? { text: 'ЭВАКУАЦИОННЫЙ КАНАЛ АКТИВЕН', active: true, progress: objective.progress } : { text: 'КАНАЛ ПРЕРВАН', active: false, progress: objective.progress });
      if (objective.progress >= 1) this.completeObjective();
    }
  }

  completeObjective() {
    const completed = this.objective;
    if (!completed || completed.type === 'survive') return;
    this.stats.objectives += 1;
    const reward = this.phase === PHASES.RECON ? 400 : this.phase === PHASES.FINAL ? 1800 : 750;
    this.stats.score += reward;
    this.stats.experience += Math.round(reward * 0.16);
    this.player.heal?.(this.phase === PHASES.RECON ? 18 : 10);
    this.weaponSystem.addAmmo?.(this.phase === PHASES.RECON ? 35 : 22);
    this.audio?.playUI?.('objective');
    this.effects.spawnShiftPulse(completed.position, 6);
    this.eventBus?.emit?.('director:objective-complete', { objective: completed, reward });
    this.eventBus?.emit?.('director:announcement', { title: 'ЗАДАЧА ВЫПОЛНЕНА', detail: `+${reward} // ресурсный импульс`, duration: 2.4 });
    this.objectiveVisual.visible = false;
    this.objective = null;
    this.eventBus?.emit?.('director:interact', null);

    if (this.phase === PHASES.RECON) {
      this.requestUpgrade('ПЕРВАЯ АДАПТАЦИЯ', () => this.scheduleTransition(PHASES.ESCALATION));
    } else if (this.phase === PHASES.ESCALATION) {
      this.scheduleTransition(PHASES.SHIFT);
    } else if (this.phase === PHASES.HUNT) {
      this.scheduleTransition(PHASES.FINAL);
    } else if (this.phase === PHASES.FINAL) {
      this.end(true);
    }
  }

  getPhaseStart(phase) {
    const ids = PHASE_CONFIG_IDS[phase] ?? [phase];
    const configured = this.runConfig.phases?.find((entry) => ids.includes(entry.id));
    if (Number.isFinite(configured?.start)) return Math.max(0, configured.start);
    const fallback = GAME_CONFIG.run.phases.find((entry) => ids.includes(entry.id));
    return Number.isFinite(fallback?.start) ? Math.max(0, fallback.start) : 0;
  }

  scheduleTransition(nextPhase) {
    if (!this.running) return false;
    const gateTime = this.getPhaseStart(nextPhase);
    if (this.matchTime >= gateTime) return this.executeTransition(nextPhase);
    this.beginInterlude(nextPhase, gateTime);
    return false;
  }

  beginInterlude(nextPhase, gateTime) {
    const copy = INTERLUDE_COPY[nextPhase] ?? {
      title: 'ВЫЖИТЬ // СИНХРОНИЗАЦИЯ',
      countdown: 'Следующая фаза через',
    };
    const remaining = Math.max(0, gateTime - this.matchTime);
    this.pendingTransition = nextPhase;
    this.objective = {
      type: 'survive',
      title: copy.title,
      detail: `${copy.countdown}: ${Math.ceil(remaining)} с`,
      countdown: copy.countdown,
      progress: 0,
      position: this.player.position?.clone?.() ?? new THREE.Vector3(),
      radius: 0,
      duration: Math.max(remaining, 0.001),
      startedAt: this.matchTime,
      gateTime,
      nextPhase,
    };
    this.objectiveVisual.visible = false;
    this.eventBus?.emit?.('director:interact', null);
    this.eventBus?.emit?.('director:announcement', {
      title: copy.title,
      detail: this.objective.detail,
      duration: 2.2,
    });
    this.pushHUD(true);
  }

  executeTransition(nextPhase) {
    if (!this.running) return false;
    this.pendingTransition = null;
    this.objective = null;
    this.objectiveVisual.visible = false;
    this.eventBus?.emit?.('director:interact', null);

    if (nextPhase === PHASES.ESCALATION) this.beginEscalation();
    else if (nextPhase === PHASES.SHIFT) this.beginRequiredShift();
    else if (nextPhase === PHASES.HUNT) this.beginHunt();
    else if (nextPhase === PHASES.FINAL) this.beginFinal();
    else return false;
    return true;
  }

  beginEscalation() {
    this.phase = PHASES.ESCALATION;
    this.phaseTime = 0;
    const collect = this.random() < 0.5;
    if (collect) this.beginCollectObjective();
    else this.setObjective({
      type: 'hold',
      title: 'УДЕРЖИВАТЬ РЕЗОНАТОР',
      detail: 'Стабилизируйте зону под давлением противника',
      duration: this.difficulty === 'easy' ? 24 : this.difficulty === 'hard' ? 34 : 29,
      radius: 4.2,
      position: this.getObjectivePoint(1),
    });
    this.eventBus?.emit?.('director:phase', { phase: this.phase, label: PHASE_LABELS[this.phase] });
  }

  beginRequiredShift() {
    this.phase = PHASES.SHIFT;
    this.phaseTime = 0;
    this.scheduleNextAmbientShift();
    if (this.shift) this.shift.required = true;
    else this.beginRealityShift(true);
    this.eventBus?.emit?.('director:phase', { phase: this.phase, label: PHASE_LABELS[this.phase] });
  }

  beginFinal() {
    this.phase = PHASES.FINAL;
    this.phaseTime = 0;
    this.scheduleNextAmbientShift();
    this.setObjective({
      type: 'extract',
      title: 'УДЕРЖИВАТЬ КАНАЛ ЭВАКУАЦИИ',
      detail: 'Доберитесь до выхода и удерживайте позицию',
      duration: this.difficulty === 'easy' ? 24 : this.difficulty === 'hard' ? 38 : 31,
      radius: 4.5,
      position: this.getObjectivePoint(3),
    });
    this.eventBus?.emit?.('director:phase', { phase: this.phase, label: PHASE_LABELS[this.phase] });
    this.eventBus?.emit?.('director:announcement', { title: 'ЭВАКУАЦИЯ ДОСТУПНА', detail: 'Оранжевый сектор // финальная синхронизация', duration: 3.2 });
  }

  beginCollectObjective() {
    const points = [this.getObjectivePoint(1), this.getObjectivePoint(2), this.getObjectivePoint(4)];
    points.forEach((point, index) => {
      const fragment = this.fragments[index];
      fragment.position.copy(point).add(new THREE.Vector3(0, 0.8, 0));
      fragment.userData.baseY = fragment.position.y;
      fragment.visible = true;
    });
    this.objective = {
      type: 'collect',
      title: 'СОБРАТЬ ФАЗОВЫЕ ОСКОЛКИ',
      detail: 'Собрано осколков: 0/3',
      progress: 0,
      position: points[0].clone(),
      radius: 2,
      duration: 1,
    };
    this.objectiveVisual.visible = false;
  }

  setObjective({ type, title, detail, duration, radius = 3, position }) {
    this.objective = { type, title, detail, duration, radius, position: position.clone(), progress: 0 };
    this.objectiveVisual.position.copy(position);
    this.objectiveVisual.visible = true;
    const color = type === 'extract' ? 0xff7a43 : type === 'boss' ? 0xd66cff : 0xffc857;
    this.objectiveVisual.userData.ring.material.color.set(color);
    this.objectiveVisual.userData.beam.material.color.set(color);
    this.objectiveVisual.userData.core.material.emissive.set(color);
  }

  beginRealityShift(required = false) {
    if (this.shift || this.pendingUpgrade) return;
    const candidates = ANOMALIES.filter((anomaly) => anomaly.id !== this.currentAnomaly?.id);
    const anomaly = candidates[Math.floor(this.random() * candidates.length)];
    this.shift = { stage: 'warning', remaining: 5, anomaly, required };
    this.arena?.beginShift?.(anomaly.id);
    this.audio?.playEnvironment?.('shiftWarning');
    this.eventBus?.emit?.('director:shift-warning', { title: 'СДВИГ РЕАЛЬНОСТИ', detail: anomaly.name, seconds: 5, anomaly });
  }

  scheduleNextAmbientShift(anchor = this.matchTime) {
    const from = Number.isFinite(anchor) ? Math.max(0, anchor) : 0;
    this.nextAmbientShift = from + AMBIENT_SHIFT_DELAY + this.random() * AMBIENT_SHIFT_JITTER;
    return this.nextAmbientShift;
  }

  updateShift(dt) {
    if (!this.shift) {
      if ([PHASES.SHIFT, PHASES.HUNT].includes(this.phase)) {
        if (this.matchTime >= this.nextAmbientShift) this.scheduleNextAmbientShift();
        return;
      }
      if (this.matchTime >= this.nextAmbientShift) {
        const requiredGate = this.getPhaseStart(PHASES.SHIFT);
        const gateBuffer = Number.isFinite(this.runConfig.ambientShiftGateBufferSeconds)
          ? this.runConfig.ambientShiftGateBufferSeconds
          : 15;
        if (this.pendingTransition === PHASES.SHIFT && requiredGate - this.matchTime <= gateBuffer) return;
        this.scheduleNextAmbientShift();
        this.beginRealityShift(false);
      }
      return;
    }
    this.shift.remaining -= dt;
    if (this.shift.stage === 'warning' && this.shift.remaining <= 0) {
      const { anomaly, required } = this.shift;
      const applied = this.arena?.applyShift?.(anomaly.id, this.player.position);
      if (applied === false) {
        this.shift.remaining = 2;
        this.audio?.playEnvironment?.('shiftWarning');
        this.eventBus?.emit?.('director:shift-warning', {
          title: 'НЕБЕЗОПАСНАЯ ПОЗИЦИЯ',
          detail: 'Покиньте подсвеченную геометрию — Сдвиг задержан',
          seconds: 2,
          anomaly,
        });
        return;
      }
      this.shift.stage = 'transition';
      this.shift.remaining = 1.25;
      this.effects.spawnShiftPulse(new THREE.Vector3(0, 0.1, 0), 38);
      this.audio?.playEnvironment?.('shift');
      this.setAnomaly(anomaly);
      this.shiftCount += 1;
      this.eventBus?.emit?.('director:shift-applied', { anomaly, count: this.shiftCount });
      if (anomaly.id === 'supply') {
        const supply = this.getObjectivePoint(4);
        this.enemySystem.spawnPickup?.(supply, true);
        this.enemySystem.spawnPickup?.(supply.clone().add(new THREE.Vector3(1, 0, 1)), true);
      }
      this.shift.required = required;
    } else if (this.shift.stage === 'transition' && this.shift.remaining <= 0) {
      const required = this.shift.required;
      this.shift = null;
      this.requestUpgrade('АДАПТАЦИЯ К СДВИГУ', () => {
        if (required && this.phase === PHASES.SHIFT) this.scheduleTransition(PHASES.HUNT);
      });
    }
  }

  setAnomaly(anomaly) {
    this.currentAnomaly = anomaly;
    this.player.setAnomaly?.(anomaly ? {
      id: anomaly.id,
      gravityScale: anomaly.gravityScale,
      speedScale: anomaly.speedScale,
      dashScale: anomaly.dashScale ?? 1,
    } : null);
    if (this.weaponSystem?.modifiers) {
      this.weaponSystem.modifiers.railAnomalyMultiplier = anomaly?.railDamage ?? 1;
    }
  }

  requestUpgrade(title, after = null) {
    if (this.pendingUpgrade) return;
    const options = this.upgradeSystem.rollChoices(3);
    if (!options.length) {
      after?.();
      return;
    }
    this.pendingUpgrade = true;
    this.afterUpgrade = after;
    this.eventBus?.emit?.('director:upgrade-request', { title, options });
  }

  selectUpgrade(id) {
    if (!this.pendingUpgrade) return false;
    const applied = this.upgradeSystem.apply(id);
    if (!applied) return false;
    this.pendingUpgrade = false;
    const after = this.afterUpgrade;
    this.afterUpgrade = null;
    after?.();
    this.eventBus?.emit?.('director:upgrade-complete', { id });
    return true;
  }

  beginHunt() {
    this.phase = PHASES.HUNT;
    this.phaseTime = 0;
    this.scheduleNextAmbientShift();
    const position = this.getObjectivePoint(2);
    this.enemySystem.spawn('warden', position);
    this.enemySystem.spawn('hunter');
    this.setObjective({
      type: 'boss',
      title: 'УНИЧТОЖИТЬ СТРАЖА РАЗЛОМА',
      detail: 'Разрушьте фазовый щит и переживите специальные атаки',
      duration: 1,
      radius: 5,
      position,
    });
    this.eventBus?.emit?.('director:phase', { phase: this.phase, label: PHASE_LABELS[this.phase] });
    this.eventBus?.emit?.('director:announcement', { title: 'СТРАЖ РАЗЛОМА', detail: 'Элитная сигнатура // несколько фаз поведения', duration: 4 });
  }

  updateSpawning(dt) {
    if (this.phase === PHASES.COMPLETE || this.pendingUpgrade) return;
    if (this.phase === PHASES.SHIFT && this.objective?.type !== 'survive') return;
    const healthRatio = (this.player.health ?? 100) / (this.player.maxHealth ?? 100);
    const phaseIntensity = {
      [PHASES.RECON]: 0.32,
      [PHASES.ESCALATION]: 0.62,
      [PHASES.SHIFT]: 0.66,
      [PHASES.HUNT]: 0.7,
      [PHASES.FINAL]: 0.88,
    }[this.phase] ?? 0.4;
    const difficultyScale = this.difficulty === 'easy' ? 0.78 : this.difficulty === 'hard' ? 1.18 : 1;
    const relief = healthRatio < 0.3 ? 0.78 : 1;
    this.intensity = THREE.MathUtils.lerp(this.intensity, phaseIntensity * difficultyScale * relief, 0.025);
    const cap = this.phase === PHASES.RECON ? 5 : this.phase === PHASES.FINAL ? 11 : 9;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || this.enemySystem.activeCount >= cap) return;
    const hunterChance = this.phase === PHASES.RECON ? 0.08 : this.phase === PHASES.ESCALATION ? 0.28 : 0.38;
    const type = this.random() < hunterChance ? 'hunter' : 'trooper';
    this.enemySystem.spawn(type);
    if (this.intensity > 0.75 && this.enemySystem.activeCount < cap - 1 && this.random() < 0.35) this.enemySystem.spawn('trooper');
    const baseInterval = THREE.MathUtils.lerp(5.2, 2.2, THREE.MathUtils.clamp(this.intensity, 0, 1));
    this.spawnTimer = baseInterval * (0.82 + this.random() * 0.5);
  }

  onEnemyKilled(event) {
    if (!this.running) return;
    this.stats.kills += 1;
    if (event.headshot) this.stats.headshots += 1;
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 4.2;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    const multiplier = 1 + Math.min(2, (this.combo - 1) * 0.12);
    this.stats.score += Math.round((event.score ?? 100) * multiplier);
    this.stats.experience += event.elite ? 220 : 18;
    const blast = this.upgradeSystem.onKill({ headshot: event.headshot });
    if (blast > 0 && event.position) {
      this.effects.spawnExplosion(event.position, 2.8, 0x67f5ff);
      this.enemySystem.damageInRadius(event.position, 2.8, blast, { source: 'upgrade', weapon: 'headshotExplosion' });
    }
    if (event.elite && this.phase === PHASES.HUNT && this.objective?.type === 'boss') this.objective.progress = 1;
    this.pushHUD(true);
  }

  onPlayerHit({ damage = 0 }) {
    if (!this.running) return;
    this.stats.damageTaken += damage;
    this.combo = Math.max(1, this.combo - 1);
    this.pushHUD(true);
  }

  onPickup({ type, value }) {
    if (type === 'health') this.player.heal?.(value);
    else if (type === 'armor') this.player.addArmor?.(value);
    else if (type === 'ammo') this.weaponSystem.addAmmo?.(value);
    this.pushHUD(true);
  }

  animateObjective(dt) {
    if (!this.objectiveVisual.visible) return;
    this.objectiveVisual.userData.ring.rotation.z += dt * 0.38;
    this.objectiveVisual.userData.core.rotation.x += dt * 0.7;
    this.objectiveVisual.userData.core.rotation.y += dt * 1.1;
    this.objectiveVisual.userData.beam.material.opacity = 0.18 + Math.sin(this.matchTime * 3) * 0.06;
  }

  getObjectivePoint(index) {
    const points = this.arena?.objectivePoints ?? this.arena?.getObjectivePoints?.() ?? [];
    const fallbacks = [
      new THREE.Vector3(-12, 0, -10),
      new THREE.Vector3(12, 0, 10),
      new THREE.Vector3(0, 0, 17),
      new THREE.Vector3(-17, 0, 14),
      new THREE.Vector3(17, 0, -13),
    ];
    const point = points[index % Math.max(1, points.length)] ?? fallbacks[index % fallbacks.length];
    return (point.position ?? point).clone();
  }

  horizontalDistance(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  getShiftCountdown() {
    if (this.shift) return Math.max(0, this.shift.remaining);
    if (this.pendingTransition === PHASES.SHIFT) {
      return Math.max(0, this.getPhaseStart(PHASES.SHIFT) - this.matchTime);
    }
    if ([PHASES.SHIFT, PHASES.HUNT].includes(this.phase)) return null;
    return Math.max(0, this.nextAmbientShift - this.matchTime);
  }

  pushHUD(force = false) {
    if (!force && this.hudTimer > 0) return;
    const weapon = this.weaponSystem.getState();
    const dash = this.player.getDashState?.() ?? { ready: 1 };
    this.eventBus?.emit?.('director:hud', {
      health: Math.max(0, Math.ceil(this.player.health ?? 0)),
      maxHealth: Math.ceil(this.player.maxHealth ?? 100),
      armor: Math.ceil(this.player.armor ?? 0),
      ammo: weapon.ammo,
      reserve: weapon.reserve,
      magazine: weapon.magazine,
      weapon: weapon.name ?? weapon.weapon,
      weaponId: weapon.id,
      reload: weapon.reload,
      reloadProgress: weapon.reloadProgress,
      objective: this.objective?.title ?? 'ОЖИДАНИЕ ДАННЫХ',
      objectiveDetail: this.objective?.detail ?? '',
      progress: this.objective?.progress ?? 0,
      anomaly: this.currentAnomaly?.name ?? 'СТАБИЛЬНАЯ РЕАЛЬНОСТЬ',
      dash: dash.progress ?? dash.ready ?? 1,
      upgrades: this.upgradeSystem.getActive(),
      score: this.stats.score,
      combo: this.combo,
      phase: PHASE_LABELS[this.phase],
      shiftCountdown: this.getShiftCountdown(),
      matchTime: this.matchTime,
    });
  }

  getStats() {
    const accuracy = this.weaponSystem.getAccuracy();
    return {
      duration: this.matchTime,
      kills: this.stats.kills,
      headshots: this.stats.headshots,
      accuracy,
      shotsFired: this.weaponSystem.shotsFired ?? 0,
      shotsHit: this.weaponSystem.shotsHit ?? 0,
      damageTaken: Math.round(this.stats.damageTaken),
      bestCombo: this.stats.bestCombo,
      upgrades: this.upgradeSystem.getActive(),
      xp: this.stats.experience,
      score: this.stats.score,
      objectives: this.stats.objectives,
      difficulty: this.difficulty,
    };
  }

  end(victory, cause = null) {
    if (!this.running) return;
    this.running = false;
    this.phase = PHASES.COMPLETE;
    this.pendingTransition = null;
    this.objectiveVisual.visible = false;
    for (const fragment of this.fragments) fragment.visible = false;
    this.eventBus?.emit?.('director:interact', null);
    this.eventBus?.emit?.('director:ended', { victory, cause, stats: this.getStats() });
  }

  forceCompleteObjective() {
    if (!this.objective) return;
    if (this.objective.type === 'survive') {
      this.matchTime = Math.min(this.objective.gateTime, this.maxDurationSeconds);
      if (this.matchTime >= this.maxDurationSeconds) this.end(false, 'Окно эвакуации закрыто');
      else this.executeTransition(this.objective.nextPhase);
      return;
    }
    this.objective.progress = 1;
    this.completeObjective();
  }

  forceShift() {
    if (!this.shift) this.beginRealityShift(false);
    if (this.shift) this.shift.remaining = 0;
  }

  getDebugData() {
    return {
      phase: this.phase,
      phaseLabel: PHASE_LABELS[this.phase],
      intensity: this.intensity,
      activeEnemies: this.enemySystem.activeCount,
      spawnTimer: this.spawnTimer,
      anomaly: this.currentAnomaly?.name ?? 'none',
      objective: this.objective?.type ?? 'none',
      objectiveProgress: this.objective?.progress ?? 0,
      pendingTransition: this.pendingTransition ?? 'none',
      maxDuration: this.maxDurationSeconds,
      matchTime: this.matchTime,
    };
  }

  dispose() {
    this.running = false;
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers.length = 0;
    this.afterUpgrade = null;
    this.scene.remove(this.objectiveVisual);
    this.objectiveVisual.traverse((object) => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    for (const fragment of this.fragments) {
      this.scene.remove(fragment);
      fragment.traverse((object) => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
    }
  }
}

export { PHASES, ANOMALIES };
export default RunDirector;
