import { levelFromExperience } from '../configs/progressionConfig.js';

const ACHIEVEMENTS = Object.freeze([
  {
    id: 'first_contact',
    name: 'ПЕРВЫЙ КОНТАКТ',
    description: 'Уничтожить первого противника.',
    test: ({ lifetime }) => lifetime.kills >= 1,
  },
  {
    id: 'precision_loop',
    name: 'ТОЧНАЯ ПЕТЛЯ',
    description: 'Сделать 8 попаданий в голову за один прогон.',
    test: ({ run }) => run.headshots >= 8,
  },
  {
    id: 'warden_down',
    name: 'СЛОМАННЫЙ СТРАЖ',
    description: 'Победить Стража Разлома.',
    test: ({ victory }) => victory,
  },
  {
    id: 'clean_extraction',
    name: 'ЧИСТАЯ ЭВАКУАЦИЯ',
    description: 'Победить, получив не более 75 единиц урона.',
    test: ({ victory, run }) => victory && run.damageTaken <= 75,
  },
  {
    id: 'adaptive',
    name: 'АДАПТИВНЫЙ ВЕКТОР',
    description: 'Завершить прогон минимум с тремя улучшениями.',
    test: ({ run }) => run.upgrades.length >= 3,
  },
  {
    id: 'velocity',
    name: 'СКОРОСТЬ НУЛЯ',
    description: 'Эвакуироваться быстрее чем за 6 минут.',
    test: ({ victory, run }) => victory && run.duration > 0 && run.duration < 360,
  },
]);

function safeClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export class AchievementSystem {
  constructor({ eventBus, saveManager }) {
    this.eventBus = eventBus;
    this.saveManager = saveManager;
    this.profile = null;
    this.runKills = 0;
    this.unsubscribe = this.eventBus?.on?.('enemy:killed', () => { this.runKills += 1; });
  }

  async init() {
    this.profile = this.saveManager.getProfile?.() ?? await this.saveManager.load?.();
    return this.profile;
  }

  beginRun() {
    this.runKills = 0;
  }

  async finishRun(victory, stats = {}) {
    const current = safeClone(this.saveManager.getProfile?.() ?? this.profile ?? {});
    const previousStats = current.stats ?? {};
    const runKills = Number(stats.kills ?? this.runKills) || 0;
    const runHeadshots = Number(stats.headshots) || 0;
    const runShotsFired = Number(stats.shotsFired) || 0;
    const runShotsHit = Number(stats.shotsHit) || 0;
    const runDamageTaken = Number(stats.damageTaken) || 0;
    const runDuration = Number(stats.duration) || 0;
    const runScore = Number(stats.score) || 0;
    const previousBestScore = Number(current.bestScore ?? previousStats.bestScore) || 0;
    const lifetime = {
      ...previousStats,
      runs: Number(previousStats.runs ?? 0) + 1,
      wins: Number(previousStats.wins ?? previousStats.victories ?? 0) + Number(victory),
      victories: Number(previousStats.victories ?? previousStats.wins ?? 0) + Number(victory),
      defeats: Number(previousStats.defeats ?? 0) + Number(!victory),
      deaths: Number(previousStats.deaths ?? 0) + Number(!victory),
      kills: Number(previousStats.kills ?? 0) + runKills,
      headshots: Number(previousStats.headshots ?? 0) + runHeadshots,
      shotsFired: Number(previousStats.shotsFired ?? 0) + runShotsFired,
      shotsHit: Number(previousStats.shotsHit ?? 0) + runShotsHit,
      damageTaken: Number(previousStats.damageTaken ?? 0) + runDamageTaken,
      totalScore: Number(previousStats.totalScore ?? 0) + runScore,
      bestScore: Math.max(previousBestScore, runScore),
      playTimeSeconds: Number(previousStats.playTimeSeconds ?? previousStats.totalPlayTime ?? 0) + runDuration,
      totalPlayTime: Number(previousStats.totalPlayTime ?? previousStats.playTimeSeconds ?? 0) + runDuration,
      bestCombo: Math.max(Number(previousStats.bestCombo ?? 0), Number(stats.bestCombo ?? 0)),
    };
    const experience = Math.max(0, Number(current.totalXp ?? current.progression?.totalExperience ?? 0)) + Number(stats.xp ?? 0);
    const bestScore = Math.max(previousBestScore, runScore);
    const newBest = runScore > previousBestScore;
    const known = new Set(Array.isArray(current.achievements) ? current.achievements.map((item) => typeof item === 'string' ? item : item.id) : []);
    const unlocked = [];
    for (const achievement of ACHIEVEMENTS) {
      if (!known.has(achievement.id) && achievement.test({ victory, run: stats, lifetime })) {
        known.add(achievement.id);
        unlocked.push({ ...achievement, unlockedAt: new Date().toISOString() });
      }
    }

    const previousEntries = Array.isArray(current.achievements)
      ? current.achievements.map((item) => typeof item === 'string' ? { id: item } : item)
      : [];
    const level = levelFromExperience(experience);
    const cosmetics = new Set(current.unlocks?.cosmetics ?? []);
    cosmetics.add('crosshair-cyan');
    if (level >= 2) cosmetics.add('crosshair-amber');
    if (level >= 3) cosmetics.add('theme-magenta');
    if (level >= 4) cosmetics.add('weapon-graphite');

    const next = {
      ...current,
      totalXp: experience,
      level,
      bestScore,
      stats: lifetime,
      achievements: [...previousEntries, ...unlocked],
      unlocks: {
        weapons: current.unlocks?.weapons ?? [],
        cosmetics: [...cosmetics],
      },
      lastPlayed: new Date().toISOString(),
      progression: {
        ...(current.progression ?? {}),
        totalExperience: experience,
        level,
        bestScore,
      },
    };
    this.profile = await this.saveManager.save?.(next) ?? next;
    for (const achievement of unlocked) this.eventBus?.emit?.('achievement:unlocked', achievement);
    this.eventBus?.emit?.('progression:updated', { profile: this.profile, unlocked, newBest });
    return { profile: this.profile, unlocked, newBest };
  }

  getCatalog() {
    const profile = this.saveManager.getProfile?.() ?? this.profile ?? {};
    const unlockedIds = new Set((profile.achievements ?? []).map((item) => typeof item === 'string' ? item : item.id));
    return ACHIEVEMENTS.map(({ test: _test, ...achievement }) => ({
      ...achievement,
      unlocked: unlockedIds.has(achievement.id),
    }));
  }

  getProfile() {
    return this.saveManager.getProfile?.() ?? this.profile;
  }

  dispose() {
    this.unsubscribe?.();
  }
}

export { ACHIEVEMENTS, levelFromExperience };
export default AchievementSystem;
