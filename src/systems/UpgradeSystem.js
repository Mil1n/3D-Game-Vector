import { UPGRADE_CONFIGS } from '../configs/upgradeConfigs.js';

const RARITY_WEIGHT = Object.freeze({ common: 68, rare: 25, epic: 7 });

function weightedPick(items, random = Math.random) {
  const total = items.reduce((sum, item) => sum + (RARITY_WEIGHT[item.rarity] ?? 1), 0);
  let target = random() * total;
  for (const item of items) {
    target -= RARITY_WEIGHT[item.rarity] ?? 1;
    if (target <= 0) return item;
  }
  return items.at(-1);
}

export class UpgradeSystem {
  constructor({ eventBus, random = Math.random }) {
    this.eventBus = eventBus;
    this.random = random;
    this.player = null;
    this.weaponSystem = null;
    this.stacks = new Map();
    this.active = [];
  }

  reset({ player, weaponSystem }) {
    this.player = player;
    this.weaponSystem = weaponSystem;
    this.stacks.clear();
    this.active = [];
  }

  rollChoices(count = 3) {
    const candidates = UPGRADE_CONFIGS.filter((upgrade) => {
      const stacks = this.stacks.get(upgrade.id) ?? 0;
      return stacks < (upgrade.maxStacks ?? 1);
    });
    const selected = [];
    const pool = [...candidates];
    while (selected.length < count && pool.length) {
      const choice = weightedPick(pool, this.random);
      selected.push({ ...choice, stacks: this.stacks.get(choice.id) ?? 0 });
      pool.splice(pool.indexOf(choice), 1);
    }
    return selected;
  }

  apply(upgradeOrId) {
    const upgrade = typeof upgradeOrId === 'string'
      ? UPGRADE_CONFIGS.find((entry) => entry.id === upgradeOrId)
      : upgradeOrId;
    if (!upgrade) throw new Error(`[UpgradeSystem] Unknown upgrade: ${upgradeOrId}`);

    const currentStacks = this.stacks.get(upgrade.id) ?? 0;
    if (currentStacks >= (upgrade.maxStacks ?? 1)) return false;
    const nextStacks = currentStacks + 1;
    this.stacks.set(upgrade.id, nextStacks);
    this.active.push({ id: upgrade.id, name: upgrade.name, rarity: upgrade.rarity, stacks: nextStacks });
    this.applyEffects(upgrade.effects ?? {});
    this.eventBus?.emit?.('upgrade:applied', { upgrade, stacks: nextStacks, active: this.getActive() });
    return true;
  }

  applyEffects(effects) {
    if (!this.player || !this.weaponSystem) return;
    if (effects.maxHealth) this.player.modifyMaxHealth?.(effects.maxHealth, true);
    if (effects.heal) this.player.heal?.(effects.heal);
    if (effects.armor) this.player.addArmor?.(effects.armor);
    if (effects.dashCooldownMultiplier) this.player.modifiers.dashCooldown *= effects.dashCooldownMultiplier;
    if (effects.killSpeed) this.player.modifiers.killSpeed = Math.max(this.player.modifiers.killSpeed ?? 0, effects.killSpeed);
    if (effects.shieldOnHit) this.player.modifiers.shieldOnHit = Math.max(this.player.modifiers.shieldOnHit ?? 0, effects.shieldOnHit);
    if (effects.dashDamageMultiplier) this.player.modifiers.dashDamageMultiplier *= effects.dashDamageMultiplier;
    if (effects.lowHealthDamage) this.player.modifiers.lowHealthDamage += effects.lowHealthDamage;
    this.weaponSystem.applyModifiers?.(effects);
  }

  onKill({ headshot = false } = {}) {
    const speed = this.player?.modifiers?.killSpeed ?? 0;
    if (speed > 0) this.player.grantSpeedBoost?.(speed, 3);
    if (headshot && this.weaponSystem?.modifiers?.headshotExplosion) {
      return this.weaponSystem.modifiers.headshotExplosion;
    }
    return 0;
  }

  getActive() {
    return [...this.stacks.entries()].map(([id, stacks]) => {
      const config = UPGRADE_CONFIGS.find((upgrade) => upgrade.id === id);
      return { id, stacks, name: config?.name ?? id, rarity: config?.rarity ?? 'common' };
    });
  }
}

export default UpgradeSystem;
