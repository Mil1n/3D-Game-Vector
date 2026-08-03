const deepFreeze = (value) => {
  Object.freeze(value);
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  });
  return value;
};

export const UPGRADE_CONFIGS = deepFreeze([
  {
    id: 'reinforced-shell',
    name: 'Усиленная оболочка',
    description: '+20 к максимальному здоровью и мгновенное лечение.',
    rarity: 'common',
    maxStacks: 3,
    tags: ['survival', 'health'],
    effects: { maxHealth: 20, heal: 20 },
  },
  {
    id: 'phase-loader',
    name: 'Фазовый досылатель',
    description: 'Перезарядка оружия на 16% быстрее.',
    rarity: 'common',
    maxStacks: 3,
    tags: ['weapon', 'tempo'],
    effects: { reloadMultiplier: 0.84 },
  },
  {
    id: 'impact-vector',
    name: 'Ударный вектор',
    description: 'Рывок наносит повышенный урон ближайшим целям.',
    rarity: 'common',
    maxStacks: 2,
    tags: ['movement', 'damage'],
    effects: { dashDamageMultiplier: 1.6 },
  },
  {
    id: 'fragment-matrix',
    name: 'Матрица фрагментации',
    description: 'SG-4 выпускает два дополнительных осколка.',
    rarity: 'common',
    maxStacks: 2,
    tags: ['weapon', 'scatter'],
    effects: { shotgunPellets: 2 },
  },
  {
    id: 'recursive-lance',
    name: 'Рекурсивное копьё',
    description: 'Снаряд ARX один раз рикошетит в ближайшую цель.',
    rarity: 'rare',
    maxStacks: 1,
    tags: ['weapon', 'rail'],
    effects: { railRicochet: 1 },
  },
  {
    id: 'fault-analysis',
    name: 'Анализ разлома',
    description: '+8% к шансу критического попадания.',
    rarity: 'rare',
    maxStacks: 3,
    tags: ['weapon', 'precision'],
    effects: { critChance: 0.08 },
  },
  {
    id: 'reactive-aegis',
    name: 'Реактивная эгида',
    description: 'Точные попадания восстанавливают немного щита.',
    rarity: 'rare',
    maxStacks: 2,
    tags: ['survival', 'precision'],
    effects: { shieldOnHit: 2 },
  },
  {
    id: 'predator-loop',
    name: 'Контур хищника',
    description: 'Убийство временно ускоряет движение.',
    rarity: 'rare',
    maxStacks: 2,
    tags: ['movement', 'kill'],
    effects: { killSpeed: 0.12 },
  },
  {
    id: 'cranial-breach',
    name: 'Черепной пробой',
    description: 'Убийство в голову вызывает малый энергетический взрыв.',
    rarity: 'epic',
    maxStacks: 1,
    tags: ['precision', 'area'],
    effects: { headshotExplosion: 38 },
  },
  {
    id: 'vector-capacitor',
    name: 'Векторный конденсатор',
    description: 'Перезарядка рывка ускорена на 18%.',
    rarity: 'common',
    maxStacks: 3,
    tags: ['movement'],
    effects: { dashCooldownMultiplier: 0.82 },
  },
  {
    id: 'last-signal',
    name: 'Последний сигнал',
    description: 'При низком здоровье оружие наносит на 28% больше урона.',
    rarity: 'epic',
    maxStacks: 1,
    tags: ['survival', 'damage'],
    effects: { lowHealthDamage: 0.28 },
  },
  {
    id: 'field-repair',
    name: 'Полевой ремонт',
    description: 'Немедленно восстанавливает 35 здоровья.',
    rarity: 'common',
    maxStacks: 5,
    tags: ['survival', 'health'],
    effects: { heal: 35 },
  },
]);

export default UPGRADE_CONFIGS;
