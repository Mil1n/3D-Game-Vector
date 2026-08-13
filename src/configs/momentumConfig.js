function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const MOMENTUM_ACTIONS = deepFreeze({
  kill: { momentum: 5, style: 100, label: 'ELIMINATION', extendsOverdrive: true },
  headshot: { momentum: 8, style: 175, label: 'HEADHUNTER' },
  airKill: { momentum: 12, style: 260, label: 'AIR SUPERIORITY', extendsOverdrive: true },
  slideKill: { momentum: 12, style: 260, label: 'LOW VECTOR', extendsOverdrive: true },
  wallRunKill: { momentum: 14, style: 310, label: 'WALL REAPER', extendsOverdrive: true },
  multiKill: { momentum: 15, style: 350, label: 'CHAIN REACTION', extendsOverdrive: true },
  explosiveKill: { momentum: 11, style: 240, label: 'DETONATION', extendsOverdrive: true },
  weaponSwitch: { momentum: 3, style: 55, label: 'ARSENAL FLOW' },
  projectileDeflect: { momentum: 10, style: 225, label: 'REVERSAL' },
  noDamageKill: { momentum: 9, style: 200, label: 'UNTOUCHED', extendsOverdrive: true },
  eliteKill: { momentum: 20, style: 500, label: 'APEX DOWN', extendsOverdrive: true, elite: true },
  challengeComplete: { momentum: 18, style: 450, label: 'PROTOCOL COMPLETE' },
});

export const MOMENTUM_RANKS = deepFreeze([
  { id: 'D', threshold: 0, scoreMultiplier: 1, xpMultiplier: 1 },
  { id: 'C', threshold: 15, scoreMultiplier: 1.15, xpMultiplier: 1.05 },
  { id: 'B', threshold: 30, scoreMultiplier: 1.35, xpMultiplier: 1.1 },
  { id: 'A', threshold: 45, scoreMultiplier: 1.6, xpMultiplier: 1.18 },
  { id: 'S', threshold: 60, scoreMultiplier: 2, xpMultiplier: 1.28 },
  { id: 'SS', threshold: 80, scoreMultiplier: 2.5, xpMultiplier: 1.4 },
  { id: 'SSS', threshold: 100, scoreMultiplier: 3.25, xpMultiplier: 1.6 },
]);

export const OVERDRIVE_CONFIG = deepFreeze({
  duration: 8,
  killExtension: 1.25,
  eliteKillExtension: 2,
  maxDuration: 24,
  effects: {
    playerSpeedMultiplier: 1.2,
    worldTimeScale: 0.86,
    fireRateMultiplier: 1.35,
    reloadTimeMultiplier: 0.62,
    weaponSwitchTimeMultiplier: 0.55,
    impactMultiplier: 1.4,
    damageResistance: 0,
  },
});

export const MOMENTUM_CONFIG = deepFreeze({
  maximum: 100,
  actions: MOMENTUM_ACTIONS,
  ranks: MOMENTUM_RANKS,
  antiRepeat: {
    historySize: 8,
    signaturePenalty: 0.15,
    minimumFactor: 0.2,
    streakFactors: [1, 0.68, 0.42, 0.25],
    varietyBonusPerAction: 0.025,
    maximumVarietyBonus: 0.12,
    countBonusPerExtraTarget: 0.3,
    maximumCountBonus: 1.2,
  },
  decay: {
    inactivityGrace: 3,
    inactivityPerSecond: 2.25,
    stationaryGrace: 2,
    stationaryPerSecond: 1.25,
  },
  feedback: {
    actionDuration: 1.8,
  },
  multiKill: {
    window: 1.8,
  },
  penalties: {
    missStreakThreshold: 3,
    missBase: 1.5,
    missRamp: 0.5,
    heavyDamageThreshold: 40,
    heavyDamageBase: 9,
    heavyDamageScale: 0.22,
  },
  overdrive: OVERDRIVE_CONFIG,
});

export { deepFreeze };
export default MOMENTUM_CONFIG;
