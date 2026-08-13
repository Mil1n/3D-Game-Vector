import { MOMENTUM_CONFIG, deepFreeze } from '../configs/momentumConfig.js';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rounded = (value, precision = 1000) => Math.round(value * precision) / precision;

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function mergeConfig(base, override = {}) {
  return {
    ...base,
    ...override,
    actions: { ...base.actions, ...(override.actions ?? {}) },
    ranks: override.ranks ?? base.ranks,
    antiRepeat: { ...base.antiRepeat, ...(override.antiRepeat ?? {}) },
    decay: { ...base.decay, ...(override.decay ?? {}) },
    feedback: { ...base.feedback, ...(override.feedback ?? {}) },
    multiKill: { ...base.multiKill, ...(override.multiKill ?? {}) },
    penalties: { ...base.penalties, ...(override.penalties ?? {}) },
    overdrive: {
      ...base.overdrive,
      ...(override.overdrive ?? {}),
      effects: { ...base.overdrive.effects, ...(override.overdrive?.effects ?? {}) },
    },
  };
}

function createStats(initialRank) {
  return {
    actions: 0,
    actionCounts: {},
    styleScore: 0,
    bestRank: initialRank,
    peakMomentum: 0,
    overdriveActivations: 0,
    overdriveKills: 0,
    overdriveTime: 0,
    shots: 0,
    hits: 0,
    misses: 0,
    damageTaken: 0,
    penalties: {
      inactivity: 0,
      stationary: 0,
      miss: 0,
      heavyDamage: 0,
    },
  };
}

/**
 * Owns the run-local style meter and Overdrive lifecycle.
 * It contains no rendering code; consumers react to emitted state events.
 */
export class MomentumSystem {
  constructor({ eventBus = null, config = MOMENTUM_CONFIG } = {}) {
    this.eventBus = eventBus;
    this.config = deepFreeze(mergeConfig(MOMENTUM_CONFIG, config === MOMENTUM_CONFIG ? {} : config));
    this.rankOrder = [...this.config.ranks].sort((left, right) => left.threshold - right.threshold);
    if (this.rankOrder.length === 0) throw new Error('[MomentumSystem] At least one rank is required');

    this.unsubscribers = [];
    this.disposed = false;
    this.reset();
    this.bindEvents();
  }

  reset() {
    const initialRank = this.rankOrder[0].id;
    this.momentum = 0;
    this.rank = initialRank;
    this.bestRank = initialRank;
    this.styleScore = 0;
    this.lastAction = null;
    this.lastActionLabel = null;
    this.lastActionRemaining = 0;
    this.lastKillWeapon = null;
    this.currentWeapon = null;
    this.tookDamageSinceKill = false;
    this.actionStreak = 0;
    this.recentSignatures = [];
    this.inactivity = 0;
    this.stationary = 0;
    this.missStreak = 0;
    this.multiKillTimer = 0;
    this.multiKillCount = 0;
    this.overdrive = { ready: false, active: false, remaining: 0 };
    this.readyRank = null;
    this.overdriveRank = null;
    this.readyLatched = false;
    this.stats = createStats(initialRank);
    return this.getState();
  }

  bindEvents() {
    if (!this.eventBus?.on) return;
    const on = (name, listener, options) => this.unsubscribers.push(this.eventBus.on(name, listener, options));

    on('enemy:killed', (event = {}) => this.recordKill(event), { priority: 20 });
    on('player:damaged', (event = {}) => this.recordDamage(event.amount ?? event.damage));
    on('weapon:changed', (event = {}) => {
      this.currentWeapon = event.id ?? event.weapon ?? event.weaponId ?? this.currentWeapon;
    });
    on('combat:shot', (event = {}) => this.recordShot(event));
    on('combat:precision-hit', (event = {}) => this.recordAction('headshot', {
      enemyType: event.enemyType ?? event.type,
      weapon: event.weapon ?? event.weaponId,
    }));
    on('combat:damage-dealt', () => { this.inactivity = 0; });
    on('momentum:action', (event = {}) => this.recordAction(event.action ?? event.type, event));
    on('overdrive:activate', () => this.activateOverdrive());
  }

  recordKill(context = {}) {
    const common = {
      ...context,
      enemyType: context.enemyType ?? context.type,
      weapon: context.weapon ?? context.weaponId,
    };
    this.multiKillCount = this.multiKillTimer > 0 ? this.multiKillCount + 1 : 1;
    this.multiKillTimer = Math.max(0, finite(this.config.multiKill.window, 1.8));
    const elite = context.elite === true || context.boss === true;
    const results = [this.recordAction('kill', { ...common, extendOverdrive: !elite })];
    const supplemental = { ...common, extendOverdrive: false };
    const killWeapon = common.weapon ?? this.currentWeapon;
    if (killWeapon && this.lastKillWeapon && killWeapon !== this.lastKillWeapon) {
      results.push(this.recordAction('weaponSwitch', { ...supplemental, weapon: killWeapon }));
    }
    if (killWeapon) this.lastKillWeapon = killWeapon;
    if (context.headshot) results.push(this.recordAction('headshot', supplemental));
    if (context.airKill || context.airborne || context.inAir) results.push(this.recordAction('airKill', supplemental));
    if (context.slideKill || context.sliding) results.push(this.recordAction('slideKill', supplemental));
    if (context.wallRunKill || context.wallRunning || context.afterWallRun) results.push(this.recordAction('wallRunKill', supplemental));
    if (context.explosiveKill || context.explosive || context.damageType === 'explosive') {
      results.push(this.recordAction('explosiveKill', supplemental));
    }
    const reportedCount = Math.max(1, Math.floor(finite(context.count, 1)));
    if (this.multiKillCount > 1 || reportedCount > 1 || context.multiKill) {
      results.push(this.recordAction('multiKill', {
        ...supplemental,
        count: Math.max(this.multiKillCount, reportedCount),
      }));
    }
    if (context.noDamageKill || context.noDamage) results.push(this.recordAction('noDamageKill', supplemental));
    else if (!this.tookDamageSinceKill) results.push(this.recordAction('noDamageKill', supplemental));
    this.tookDamageSinceKill = false;
    if (elite) results.push(this.recordAction('eliteKill', common));
    return results;
  }

  recordShot(context = {}) {
    if (this.disposed) return this.getState();
    const hit = context.hit === true;
    this.stats.shots += 1;
    if (hit) {
      this.stats.hits += 1;
      this.missStreak = 0;
      this.inactivity = 0;
      return this.getState();
    }

    this.stats.misses += 1;
    this.missStreak += 1;
    const threshold = Math.max(1, finite(this.config.penalties.missStreakThreshold, 3));
    if (this.missStreak >= threshold) {
      const excess = this.missStreak - threshold;
      const penalty = finite(this.config.penalties.missBase, 0)
        + excess * finite(this.config.penalties.missRamp, 0);
      this.applyPenalty(penalty, 'miss');
    }
    return this.getState();
  }

  recordDamage(amount) {
    if (this.disposed) return this.getState();
    const damage = Math.max(0, finite(amount));
    if (damage > 0) this.tookDamageSinceKill = true;
    this.stats.damageTaken += damage;
    const threshold = Math.max(0, finite(this.config.penalties.heavyDamageThreshold, 40));
    if (damage >= threshold) {
      const penalty = finite(this.config.penalties.heavyDamageBase, 0)
        + (damage - threshold) * finite(this.config.penalties.heavyDamageScale, 0);
      this.applyPenalty(penalty, 'heavyDamage');
    }
    return this.getState();
  }

  recordAction(action, context = {}) {
    const definition = this.config.actions[action];
    if (this.disposed || !definition) {
      return { action, delta: 0, styleDelta: 0, accepted: false };
    }

    const count = clamp(Math.floor(finite(context.count, 1)), 1, 10);
    const signature = this.createSignature(action, context);
    const factor = this.styleFactor(action, signature, count);
    const requestedMomentum = Math.max(0, finite(definition.momentum)) * factor;
    const styleDelta = Math.max(0, Math.round(finite(definition.style) * factor));
    const previous = this.momentum;

    if (!this.overdrive.active) this.setMomentum(this.momentum + requestedMomentum, { action, styleDelta });
    this.styleScore += styleDelta;
    this.stats.actions += 1;
    this.stats.actionCounts[action] = (this.stats.actionCounts[action] ?? 0) + 1;
    this.stats.styleScore = this.styleScore;
    this.inactivity = 0;
    this.trackAction(action, signature);

    if (this.overdrive.active && definition.extendsOverdrive && context.extendOverdrive !== false) {
      this.extendOverdrive(definition.elite === true);
    }
    this.refreshRank();

    const effectiveRank = this.effectiveRank();
    const result = {
      action,
      label: definition.label ?? action,
      delta: rounded(this.momentum - previous),
      styleDelta,
      factor: rounded(factor),
      accepted: true,
      rank: effectiveRank.id,
      multiplier: effectiveRank.scoreMultiplier,
    };
    this.lastActionLabel = result.label;
    this.lastActionRemaining = Math.max(0, finite(this.config.feedback.actionDuration, 1.8));
    const payload = { ...result, type: action, state: this.getState() };
    this.eventBus?.emit?.('style:action', payload);
    this.eventBus?.emit?.('style:scored', payload);
    return result;
  }

  update(deltaSeconds, activity = {}) {
    if (this.disposed) return this.getState();
    const delta = Math.max(0, finite(deltaSeconds));
    if (delta === 0) return this.getState();

    if (this.multiKillTimer > 0) {
      this.multiKillTimer = Math.max(0, this.multiKillTimer - delta);
      if (this.multiKillTimer === 0) this.multiKillCount = 0;
    }
    const hadActionFeedback = this.lastActionRemaining > 0;
    this.lastActionRemaining = Math.max(0, this.lastActionRemaining - delta);
    if (hadActionFeedback && this.lastActionRemaining === 0) {
      this.lastActionLabel = null;
      this.lastAction = null;
      this.actionStreak = 0;
      this.recentSignatures.length = 0;
    }

    if (this.overdrive.active) {
      const elapsed = Math.min(delta, this.overdrive.remaining);
      this.stats.overdriveTime += elapsed;
      this.overdrive.remaining = Math.max(0, this.overdrive.remaining - delta);
      if (this.overdrive.remaining === 0) this.endOverdrive('expired');
      return this.getState();
    }

    const dealtDamage = activity.dealtDamage === true || finite(activity.damageDealt) > 0;
    const moving = activity.moving === true || finite(activity.speed) > finite(activity.stationarySpeedThreshold, 0.2);
    const previousInactivity = this.inactivity;
    const previousStationary = this.stationary;
    this.inactivity = dealtDamage ? 0 : this.inactivity + delta;
    this.stationary = moving ? 0 : this.stationary + delta;

    const inactivityExposure = this.exposure(previousInactivity, this.inactivity, this.config.decay.inactivityGrace);
    const stationaryExposure = this.exposure(previousStationary, this.stationary, this.config.decay.stationaryGrace);
    if (inactivityExposure > 0) {
      this.applyPenalty(inactivityExposure * finite(this.config.decay.inactivityPerSecond), 'inactivity');
    }
    if (stationaryExposure > 0) {
      this.applyPenalty(stationaryExposure * finite(this.config.decay.stationaryPerSecond), 'stationary');
    }
    return this.getState();
  }

  activateOverdrive() {
    if (this.disposed || this.overdrive.active || !this.overdrive.ready) return false;
    const previous = this.momentum;
    this.overdriveRank = this.readyRank ?? this.currentRank();
    this.momentum = 0;
    this.overdrive.ready = false;
    this.overdrive.active = true;
    this.overdrive.remaining = Math.max(0, finite(this.config.overdrive.duration, 8));
    this.readyLatched = false;
    this.readyRank = null;
    this.inactivity = 0;
    this.stationary = 0;
    this.stats.overdriveActivations += 1;
    this.refreshRank();
    this.emitMomentumChanged({ previous, reason: 'overdrive', delta: -previous });
    this.eventBus?.emit?.('overdrive:activated', {
      state: this.getState(),
      effects: clone(this.config.overdrive.effects),
      duration: this.overdrive.remaining,
    });
    if (this.overdrive.remaining === 0) this.endOverdrive('expired');
    return true;
  }

  extendOverdrive(elite = false) {
    if (!this.overdrive.active) return 0;
    const extension = finite(elite
      ? this.config.overdrive.eliteKillExtension
      : this.config.overdrive.killExtension);
    const duration = Math.max(0, finite(this.config.overdrive.duration, 8));
    const maximum = Math.max(duration, finite(this.config.overdrive.maxDuration, duration * 3));
    const previous = this.overdrive.remaining;
    this.overdrive.remaining = Math.min(maximum, previous + Math.max(0, extension));
    this.stats.overdriveKills += 1;
    const applied = this.overdrive.remaining - previous;
    if (applied > 0) {
      this.eventBus?.emit?.('overdrive:extended', {
        extension: rounded(applied),
        remaining: rounded(this.overdrive.remaining),
        state: this.getState(),
      });
    }
    return rounded(applied);
  }

  endOverdrive(reason = 'expired') {
    if (!this.overdrive.active) return false;
    const previousRank = this.effectiveRank().id;
    this.overdrive.active = false;
    this.overdrive.remaining = 0;
    this.overdriveRank = null;
    this.emitRankChanged(previousRank, this.effectiveRank());
    this.eventBus?.emit?.('overdrive:ended', { reason, state: this.getState() });
    return true;
  }

  applyPenalty(amount, reason = 'other') {
    if (this.disposed || this.overdrive.active) return 0;
    const requested = Math.max(0, finite(amount));
    if (requested === 0 || this.momentum === 0) return 0;
    const previous = this.momentum;
    this.setMomentum(this.momentum - requested, { reason });
    const applied = previous - this.momentum;
    if (this.stats.penalties[reason] !== undefined) this.stats.penalties[reason] += applied;
    this.eventBus?.emit?.('momentum:penalty', { reason, amount: rounded(applied), state: this.getState() });
    return rounded(applied);
  }

  setMomentum(value, detail = {}) {
    const previous = this.momentum;
    const maximum = Math.max(1, finite(this.config.maximum, 100));
    this.momentum = clamp(finite(value), 0, maximum);
    this.stats.peakMomentum = Math.max(this.stats.peakMomentum, this.momentum);
    this.refreshRank();

    const reachedMaximum = this.momentum >= maximum && !this.overdrive.active;
    if (reachedMaximum && !this.readyLatched) {
      this.readyLatched = true;
      this.readyRank = this.currentRank();
      this.overdrive.ready = true;
      this.eventBus?.emit?.('overdrive:ready', { state: this.getState() });
    }
    this.overdrive.ready = this.readyLatched && !this.overdrive.active;

    const delta = this.momentum - previous;
    if (delta !== 0) this.emitMomentumChanged({ ...detail, previous, delta });
    return delta;
  }

  refreshRank() {
    const previousRank = this.effectiveRank().id;
    let selected = this.rankOrder[0];
    for (const rank of this.rankOrder) {
      if (this.momentum < rank.threshold) break;
      selected = rank;
    }
    this.rank = selected.id;
    const currentIndex = this.rankOrder.findIndex((entry) => entry.id === this.rank);
    const bestIndex = this.rankOrder.findIndex((entry) => entry.id === this.bestRank);
    if (currentIndex > bestIndex) this.bestRank = this.rank;
    this.stats.bestRank = this.bestRank;
    this.emitRankChanged(previousRank, this.effectiveRank());
  }

  currentRank() {
    return this.rankOrder.find((entry) => entry.id === this.rank) ?? this.rankOrder[0];
  }

  effectiveRank() {
    if (this.overdrive.active && this.overdriveRank) return this.overdriveRank;
    return this.currentRank();
  }

  emitRankChanged(previousRank, rank = this.effectiveRank()) {
    if (previousRank === undefined || previousRank === rank.id) return;
    const previousIndex = this.rankOrder.findIndex((entry) => entry.id === previousRank);
    const rankIndex = this.rankOrder.findIndex((entry) => entry.id === rank.id);
    this.eventBus?.emit?.('momentum:rank-changed', {
      previousRank,
      rank: rank.id,
      direction: rankIndex > previousIndex ? 'up' : 'down',
      bestRank: this.bestRank,
      multiplier: rank.scoreMultiplier,
      scoreMultiplier: rank.scoreMultiplier,
      xpMultiplier: rank.xpMultiplier,
      state: this.getState(),
    });
  }

  createSignature(action, context) {
    const enemy = context.enemyType ?? context.type ?? context.targetType ?? '-';
    const weapon = context.weapon ?? context.weaponId ?? '-';
    return `${action}|${String(enemy)}|${String(weapon)}`;
  }

  styleFactor(action, signature, count) {
    const antiRepeat = this.config.antiRepeat;
    const nextStreak = action === this.lastAction ? this.actionStreak + 1 : 1;
    const streakFactors = antiRepeat.streakFactors ?? [1];
    const streakFactor = finite(streakFactors[Math.min(nextStreak - 1, streakFactors.length - 1)], 1);
    const exactRepeats = this.recentSignatures.filter((entry) => entry === signature).length;
    const signatureFactor = Math.max(
      finite(antiRepeat.minimumFactor, 0.2),
      1 - exactRepeats * finite(antiRepeat.signaturePenalty, 0.15),
    );
    const uniqueActions = new Set(this.recentSignatures.map((entry) => entry.split('|', 1)[0])).size;
    const varietyBonus = Math.min(
      finite(antiRepeat.maximumVarietyBonus, 0),
      uniqueActions * finite(antiRepeat.varietyBonusPerAction, 0),
    );
    const countBonus = Math.min(
      finite(antiRepeat.maximumCountBonus, 0),
      (count - 1) * finite(antiRepeat.countBonusPerExtraTarget, 0),
    );
    return Math.max(finite(antiRepeat.minimumFactor, 0.2), streakFactor * signatureFactor + varietyBonus + countBonus);
  }

  trackAction(action, signature) {
    this.actionStreak = action === this.lastAction ? this.actionStreak + 1 : 1;
    this.lastAction = action;
    this.recentSignatures.push(signature);
    const maximum = Math.max(1, Math.floor(finite(this.config.antiRepeat.historySize, 8)));
    if (this.recentSignatures.length > maximum) this.recentSignatures.splice(0, this.recentSignatures.length - maximum);
  }

  exposure(previous, current, graceValue) {
    const grace = Math.max(0, finite(graceValue));
    return Math.max(0, current - grace) - Math.max(0, previous - grace);
  }

  emitMomentumChanged(detail = {}) {
    this.eventBus?.emit?.('momentum:changed', {
      ...detail,
      delta: rounded(detail.delta ?? 0),
      state: this.getState(),
    });
  }

  getState() {
    const rank = this.effectiveRank();
    return {
      momentum: rounded(this.momentum),
      rank: rank.id,
      bestRank: this.bestRank,
      multiplier: rank.scoreMultiplier,
      scoreMultiplier: rank.scoreMultiplier,
      xpMultiplier: rank.xpMultiplier,
      styleScore: this.styleScore,
      lastAction: this.lastActionLabel,
      lastActionRemaining: rounded(this.lastActionRemaining),
      overdrive: {
        ready: this.overdrive.ready,
        active: this.overdrive.active,
        remaining: rounded(this.overdrive.remaining),
      },
    };
  }

  getStats() {
    return clone({
      ...this.stats,
      styleScore: this.styleScore,
      bestRank: this.bestRank,
      peakMomentum: rounded(this.stats.peakMomentum),
      overdriveTime: rounded(this.stats.overdriveTime),
      penalties: Object.fromEntries(
        Object.entries(this.stats.penalties).map(([key, value]) => [key, rounded(value)]),
      ),
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }
}

export default MomentumSystem;
