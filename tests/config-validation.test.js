import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_CONFIG, DIFFICULTY_CONFIGS } from '../src/configs/gameConfig.js';
import { WEAPON_CONFIGS, WEAPON_ORDER } from '../src/configs/weaponConfigs.js';
import { ENEMY_CONFIGS } from '../src/configs/enemyConfigs.js';
import { UPGRADE_CONFIGS } from '../src/configs/upgradeConfigs.js';

const positive = (value, label) => assert.ok(Number.isFinite(value) && value > 0, `${label} must be positive`);
const probability = (value, label) => assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${label} must be 0..1`);

test('game timing and difficulty configs are complete and balanced', () => {
  positive(GAME_CONFIG.fixedTimeStep, 'fixedTimeStep');
  assert.ok(GAME_CONFIG.maxFrameDelta >= GAME_CONFIG.fixedTimeStep);
  assert.equal(GAME_CONFIG.run.phases.length, 5);
  positive(GAME_CONFIG.run.targetDurationSeconds, 'run.targetDurationSeconds');
  positive(GAME_CONFIG.run.maxDurationSeconds, 'run.maxDurationSeconds');
  positive(GAME_CONFIG.run.ambientShiftGateBufferSeconds, 'run.ambientShiftGateBufferSeconds');
  assert.ok(GAME_CONFIG.run.maxDurationSeconds >= GAME_CONFIG.run.targetDurationSeconds);
  const phaseStarts = GAME_CONFIG.run.phases.map(({ start }) => start);
  assert.deepEqual(phaseStarts, [...phaseStarts].sort((a, b) => a - b));
  assert.ok(GAME_CONFIG.run.maxDurationSeconds > phaseStarts.at(-1));
  assert.deepEqual(Object.keys(DIFFICULTY_CONFIGS), ['easy', 'normal', 'hard']);

  for (const [id, config] of Object.entries(DIFFICULTY_CONFIGS)) {
    assert.equal(config.id, id);
    for (const key of [
      'enemyHealthMultiplier', 'enemyDamageMultiplier', 'enemySpeedMultiplier',
      'reactionTimeMultiplier', 'accuracyMultiplier', 'attackCooldownMultiplier',
      'groupSizeMultiplier', 'resourceMultiplier', 'directorIntensityMultiplier',
      'eventFrequencyMultiplier',
    ]) positive(config[key], `${id}.${key}`);
  }
  assert.ok(DIFFICULTY_CONFIGS.easy.reactionTimeMultiplier > DIFFICULTY_CONFIGS.normal.reactionTimeMultiplier);
  assert.ok(DIFFICULTY_CONFIGS.hard.resourceMultiplier < DIFFICULTY_CONFIGS.normal.resourceMultiplier);
});

test('all five weapon configs expose the WeaponSystem contract', () => {
  assert.deepEqual(WEAPON_ORDER, ['carbine', 'scatter', 'rail', 'plasma', 'nova']);
  const required = [
    'id', 'name', 'shortName', 'description', 'type', 'damage', 'fireRate', 'magazine',
    'reserve', 'reloadTime', 'spread', 'moveSpread', 'adsSpread', 'recoil', 'range',
    'falloffStart', 'falloffEnd', 'automatic', 'pellets', 'headMultiplier', 'color',
    'adsFovMultiplier',
  ];

  for (const id of WEAPON_ORDER) {
    const weapon = WEAPON_CONFIGS[id];
    assert.ok(weapon, `missing ${id}`);
    required.forEach((field) => assert.ok(field in weapon, `${id}.${field} missing`));
    assert.equal(weapon.id, id);
    for (const field of ['damage', 'fireRate', 'magazine', 'reserve', 'reloadTime', 'range', 'pellets', 'headMultiplier']) {
      positive(weapon[field], `${id}.${field}`);
    }
    assert.ok(
      Number.isFinite(weapon.adsFovMultiplier)
        && weapon.adsFovMultiplier > 0
        && weapon.adsFovMultiplier <= 1,
      `${id}.adsFovMultiplier must be finite and within (0, 1]`,
    );
    assert.ok(weapon.falloffStart < weapon.falloffEnd && weapon.falloffEnd <= weapon.range);
    for (const field of ['pitch', 'yaw', 'recovery']) {
      positive(weapon.recoil[field], `${id}.recoil.${field}`);
    }
    assert.ok(weapon.recoil.pitch <= 0.2, `${id}.recoil.pitch must stay within the camera cap`);
    assert.ok(weapon.recoil.yaw <= 0.05, `${id}.recoil.yaw must stay within the camera cap`);
    assert.ok(weapon.recoil.recovery <= 30, `${id}.recoil.recovery must stay within the supported range`);
  }
  assert.equal(WEAPON_CONFIGS.plasma.automatic, true);
  assert.ok(WEAPON_CONFIGS.plasma.fireRate > WEAPON_CONFIGS.carbine.fireRate);
  positive(WEAPON_CONFIGS.nova.impactBlast.radius, 'nova.impactBlast.radius');
  positive(WEAPON_CONFIGS.nova.impactBlast.damage, 'nova.impactBlast.damage');
});

test('enemy configs cover ranged, flanker and elite roles', () => {
  assert.deepEqual(Object.keys(ENEMY_CONFIGS), ['trooper', 'hunter', 'warden']);
  for (const [id, enemy] of Object.entries(ENEMY_CONFIGS)) {
    assert.equal(enemy.id, id);
    for (const field of ['health', 'speed', 'sightRange', 'damage', 'attackCooldown', 'spawnCost', 'score']) {
      positive(enemy[field], `${id}.${field}`);
    }
    probability(enemy.accuracy, `${id}.accuracy`);
    assert.ok(enemy.preferredRange <= enemy.sightRange);
  }
  assert.equal(ENEMY_CONFIGS.warden.role, 'elite');
  assert.ok(ENEMY_CONFIGS.warden.health > ENEMY_CONFIGS.hunter.health);
});

test('upgrade configs have unique IDs, bounded stacks and supported effects', () => {
  const ids = new Set();
  const supportedEffects = new Set([
    'maxHealth', 'heal', 'reloadMultiplier', 'dashDamageMultiplier', 'shotgunPellets',
    'railRicochet', 'critChance', 'shieldOnHit', 'killSpeed', 'headshotExplosion',
    'dashCooldownMultiplier', 'lowHealthDamage',
  ]);

  assert.ok(UPGRADE_CONFIGS.length >= 10);
  for (const upgrade of UPGRADE_CONFIGS) {
    assert.ok(!ids.has(upgrade.id), `duplicate upgrade ${upgrade.id}`);
    ids.add(upgrade.id);
    assert.ok(upgrade.name && upgrade.description);
    assert.ok(['common', 'uncommon', 'rare', 'epic'].includes(upgrade.rarity));
    assert.ok(Number.isInteger(upgrade.maxStacks) && upgrade.maxStacks > 0);
    assert.ok(Array.isArray(upgrade.tags) && upgrade.tags.length > 0);
    const effects = Object.keys(upgrade.effects);
    assert.ok(effects.length > 0);
    effects.forEach((effect) => assert.ok(supportedEffects.has(effect), `${upgrade.id}.${effect} unsupported`));
    Object.values(upgrade.effects).forEach((value) => positive(value, `${upgrade.id}.effect`));
  }
});

test('exported configuration graphs are immutable', () => {
  assert.ok(Object.isFrozen(GAME_CONFIG));
  assert.ok(Object.isFrozen(GAME_CONFIG.player));
  assert.ok(Object.isFrozen(DIFFICULTY_CONFIGS.hard));
  assert.ok(Object.isFrozen(WEAPON_CONFIGS.carbine.recoil));
  assert.ok(Object.isFrozen(ENEMY_CONFIGS.warden.phaseThresholds));
  assert.ok(Object.isFrozen(UPGRADE_CONFIGS));
  assert.ok(Object.isFrozen(UPGRADE_CONFIGS[0].effects));
});
