import { EventBus } from './EventBus.js';

export const SAVE_SCHEMA_VERSION = 3;
export const SAVE_DATABASE_VERSION = 3;
export const SAVE_DATABASE_NAME = 'vector-null';
export const DEFAULT_PROFILE_ID = 'primary';

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const finite = (value, fallback = 0, minimum = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
};
const integer = (value, fallback = 0, minimum = 0) => Math.floor(finite(value, fallback, minimum));
const strings = (value) => Array.isArray(value)
  ? [...new Set(value.filter((entry) => typeof entry === 'string' && entry.length > 0))]
  : [];
const achievements = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    const normalized = typeof entry === 'string'
      ? entry
      : (entry && typeof entry === 'object' && typeof entry.id === 'string' ? deepClone(entry) : null);
    const id = typeof normalized === 'string' ? normalized : normalized?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(normalized);
  }
  return result;
};
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? deepClone(value) : {};

export function createDefaultProfile(id = DEFAULT_PROFILE_ID) {
  const timestamp = nowIso();
  return {
    id,
    version: SAVE_SCHEMA_VERSION,
    totalXp: 0,
    level: 1,
    bestScore: 0,
    tutorialComplete: false,
    achievements: [],
    unlocks: {
      weapons: ['carbine', 'scatter', 'rail'],
      cosmetics: ['reticle-vector', 'theme-null'],
    },
    settings: {},
    bindings: {},
    stats: {
      runs: 0,
      wins: 0,
      victories: 0,
      defeats: 0,
      kills: 0,
      deaths: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      damageTaken: 0,
      bestCombo: 0,
      bestScore: 0,
      totalScore: 0,
      playTimeSeconds: 0,
      totalPlayTime: 0,
    },
    progression: {
      level: 1,
      totalExperience: 0,
      unlockedWeapons: ['carbine', 'scatter', 'rail'],
      unlockedCosmetics: ['reticle-vector', 'theme-null'],
      achievements: [],
    },
    tutorialCompleted: false,
    lastPlayed: timestamp,
    lastLaunch: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export const DEFAULT_PROFILE = Object.freeze(createDefaultProfile());

export function migrateProfile(input, id = DEFAULT_PROFILE_ID) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Save profile must be an object');
  }

  let data = deepClone(input);
  let version = integer(data.version ?? data.schemaVersion, 0);
  if (version > SAVE_SCHEMA_VERSION) {
    throw new RangeError(`Save version ${version} is newer than supported version ${SAVE_SCHEMA_VERSION}`);
  }

  if (version < 1) {
    data = {
      id: data.id ?? id,
      version: 1,
      settings: record(data.settings),
      bindings: record(data.bindings ?? data.keyBindings),
      stats: {
        runs: data.runs ?? data.matchesPlayed ?? 0,
        wins: data.wins ?? 0,
        defeats: data.defeats ?? data.losses ?? 0,
        kills: data.kills ?? data.totalKills ?? 0,
        deaths: data.deaths ?? 0,
        bestScore: data.bestScore ?? 0,
        totalScore: data.totalScore ?? 0,
        playTimeSeconds: data.playTimeSeconds ?? data.playTime ?? 0,
      },
      progression: {
        level: data.level ?? 1,
        totalExperience: data.totalExperience ?? data.xp ?? 0,
        unlockedWeapons: data.unlockedWeapons ?? ['carbine', 'scatter', 'rail'],
        unlockedCosmetics: data.unlockedCosmetics ?? [],
        achievements: data.achievements ?? [],
      },
      tutorialCompleted: data.tutorialCompleted ?? false,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      lastLaunch: data.lastLaunch,
    };
    version = 1;
  }

  if (version < 2) {
    data.stats ??= {};
    data.stats.totalScore ??= data.stats.bestScore ?? 0;
    data.stats.playTimeSeconds ??= 0;
    data.progression ??= {};
    data.progression.unlockedCosmetics ??= ['reticle-vector', 'theme-null'];
    data.version = 2;
    version = 2;
  }

  if (version < 3) {
    data.settings ??= {};
    data.bindings ??= {};
    data.stats ??= {};
    data.stats.deaths ??= 0;
    data.progression ??= {};
    data.progression.achievements ??= [];
    data.version = 3;
  }

  data.version = SAVE_SCHEMA_VERSION;
  return data;
}

export function validateProfile(input, id = DEFAULT_PROFILE_ID) {
  const source = migrateProfile(input, id);
  const defaults = createDefaultProfile(id);
  const timestamp = nowIso();
  const totalExperience = integer(source.totalXp ?? source.progression?.totalExperience);
  const level = integer(source.level ?? source.progression?.level, 1, 1);
  const bestScore = integer(source.bestScore ?? source.stats?.bestScore);
  const achievementEntries = achievements(source.achievements ?? source.progression?.achievements);
  const unlockedWeapons = strings(source.unlocks?.weapons ?? source.progression?.unlockedWeapons);
  const unlockedCosmetics = strings(source.unlocks?.cosmetics ?? source.progression?.unlockedCosmetics);
  const tutorialCompleted = source.tutorialComplete === true || source.tutorialCompleted === true;
  const victories = Math.max(integer(source.stats?.wins), integer(source.stats?.victories));
  const lastPlayed = typeof source.lastPlayed === 'string'
    ? source.lastPlayed
    : (typeof source.lastLaunch === 'string' ? source.lastLaunch : timestamp);
  return {
    id: typeof source.id === 'string' && source.id.length > 0 ? source.id : id,
    version: SAVE_SCHEMA_VERSION,
    totalXp: totalExperience,
    level,
    bestScore,
    tutorialComplete: tutorialCompleted,
    achievements: achievementEntries,
    unlocks: {
      weapons: unlockedWeapons.length ? unlockedWeapons : [...defaults.progression.unlockedWeapons],
      cosmetics: unlockedCosmetics,
    },
    settings: record(source.settings),
    bindings: record(source.bindings),
    stats: {
      runs: integer(source.stats?.runs),
      wins: victories,
      victories,
      defeats: integer(source.stats?.defeats),
      kills: integer(source.stats?.kills),
      deaths: integer(source.stats?.deaths),
      headshots: integer(source.stats?.headshots),
      shotsFired: integer(source.stats?.shotsFired),
      shotsHit: integer(source.stats?.shotsHit),
      damageTaken: finite(source.stats?.damageTaken),
      bestCombo: integer(source.stats?.bestCombo),
      bestScore,
      totalScore: integer(source.stats?.totalScore),
      playTimeSeconds: finite(source.stats?.playTimeSeconds ?? source.stats?.totalPlayTime),
      totalPlayTime: finite(source.stats?.totalPlayTime ?? source.stats?.playTimeSeconds),
    },
    progression: {
      level,
      totalExperience,
      unlockedWeapons: unlockedWeapons.length
        ? unlockedWeapons
        : [...defaults.progression.unlockedWeapons],
      unlockedCosmetics,
      achievements: achievementEntries,
    },
    tutorialCompleted,
    lastPlayed,
    lastLaunch: typeof source.lastLaunch === 'string' ? source.lastLaunch : timestamp,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : timestamp,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : timestamp,
  };
}

const merge = (base, patch) => {
  const output = deepClone(base);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object') {
      output[key] = merge(output[key], value);
    } else {
      output[key] = deepClone(value);
    }
  }
  return output;
};

export class SaveManager {
  #db = null;
  #openPromise = null;
  #memory = new Map();

  constructor(options = {}) {
    if (options && typeof options.emit === 'function') options = { eventBus: options };
    this.eventBus = options.eventBus ?? new EventBus();
    this.indexedDB = Object.hasOwn(options, 'indexedDB') ? options.indexedDB : this.#globalValue('indexedDB');
    this.storage = Object.hasOwn(options, 'storage') ? options.storage : this.#globalValue('localStorage');
    this.databaseName = options.databaseName ?? SAVE_DATABASE_NAME;
    this.storagePrefix = options.storagePrefix ?? 'vector-null:save';
    this.mode = 'uninitialized';
    this.currentProfile = null;
  }

  async init() {
    if (this.#db) return true;
    if (this.mode === 'fallback') return false;
    if (!this.indexedDB) {
      this.#useFallback(new Error('IndexedDB is unavailable'));
      return false;
    }
    if (this.#openPromise) return this.#openPromise;

    this.#openPromise = new Promise((resolve) => {
      let request;
      try {
        request = this.indexedDB.open(this.databaseName, SAVE_DATABASE_VERSION);
      } catch (error) {
        this.#useFallback(error);
        resolve(false);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'key', autoIncrement: true });
        if (!db.objectStoreNames.contains('metadata')) db.createObjectStore('metadata', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        this.#db = request.result;
        this.mode = 'indexeddb';
        this.#db.onversionchange = () => {
          this.#db?.close();
          this.#db = null;
          this.#openPromise = null;
        };
        resolve(true);
      };
      request.onerror = () => {
        this.#useFallback(request.error ?? new Error('Failed to open IndexedDB'));
        resolve(false);
      };
      request.onblocked = () => this.eventBus.emit('save:blocked');
    }).finally(() => {
      if (!this.#db) this.#openPromise = null;
    });
    return this.#openPromise;
  }

  open() {
    return this.init();
  }

  async load(id = DEFAULT_PROFILE_ID) {
    await this.init();
    let raw = null;
    try {
      raw = this.mode === 'indexeddb' ? await this.#idbGet('profiles', id) : this.#fallbackGet(id);
    } catch (error) {
      this.#useFallback(error);
      raw = this.#fallbackGet(id);
    }

    if (raw === null || raw === undefined) {
      const profile = createDefaultProfile(id);
      this.currentProfile = profile;
      await this.save(profile, id);
      this.eventBus.emit('save:loaded', { profile: deepClone(profile), created: true });
      return deepClone(profile);
    }

    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const originalVersion = integer(parsed?.version ?? parsed?.schemaVersion, 0);
      const profile = validateProfile(parsed, id);
      profile.lastLaunch = nowIso();
      profile.lastPlayed = profile.lastLaunch;
      this.currentProfile = profile;
      await this.save(profile, id);
      this.eventBus.emit('save:loaded', { profile: deepClone(profile), migrated: originalVersion !== SAVE_SCHEMA_VERSION });
      return deepClone(profile);
    } catch (error) {
      await this.#backup(raw, id, error.message);
      const profile = createDefaultProfile(id);
      this.currentProfile = profile;
      await this.save(profile, id);
      this.eventBus.emit('save:recovered', { error, profile: deepClone(profile) });
      return deepClone(profile);
    }
  }

  async loadProfile(id = DEFAULT_PROFILE_ID) {
    return this.load(id);
  }

  async save(profile = this.currentProfile, id = profile?.id ?? DEFAULT_PROFILE_ID) {
    await this.init();
    const validated = validateProfile(profile ?? createDefaultProfile(id), id);
    validated.id = id;
    validated.updatedAt = nowIso();

    let persisted = false;
    if (this.mode === 'indexeddb') {
      try {
        await this.#idbPut('profiles', validated);
        persisted = true;
      } catch (error) {
        this.#useFallback(error);
      }
    }
    const mirrored = this.#fallbackSet(id, validated);
    persisted = persisted || mirrored;
    this.#memory.set(id, deepClone(validated));
    this.currentProfile = validated;
    this.lastPersisted = persisted;
    this.eventBus.emit('save:saved', { profile: deepClone(validated), persisted, mode: this.mode });
    return deepClone(validated);
  }

  async saveProfile(profile, id = profile?.id ?? DEFAULT_PROFILE_ID) {
    await this.save(profile, id);
    return deepClone(this.currentProfile);
  }

  async update(patchOrMutator, id = DEFAULT_PROFILE_ID) {
    return this.updateProfile(patchOrMutator, id);
  }

  getProfile() {
    return this.currentProfile ? deepClone(this.currentProfile) : null;
  }

  get profile() {
    return this.currentProfile;
  }

  async updateProfile(patchOrMutator, id = DEFAULT_PROFILE_ID) {
    const current = this.currentProfile?.id === id ? deepClone(this.currentProfile) : await this.load(id);
    const before = deepClone(current);
    let draft;
    if (typeof patchOrMutator === 'function') {
      const possible = await patchOrMutator(current);
      draft = possible === undefined ? current : possible;
    } else if (patchOrMutator && typeof patchOrMutator === 'object') {
      draft = merge(current, patchOrMutator);
    } else {
      throw new TypeError('Profile update requires an object or mutator function');
    }
    this.#synchronizeAliases(draft, before, patchOrMutator);
    await this.save(draft, id);
    return this.getProfile();
  }

  async reset(id = DEFAULT_PROFILE_ID) {
    const current = this.currentProfile?.id === id ? this.currentProfile : await this.load(id);
    await this.#backup(current, id, 'manual-reset');
    const profile = createDefaultProfile(id);
    await this.save(profile, id);
    this.eventBus.emit('save:reset', { profile: deepClone(profile) });
    return deepClone(profile);
  }

  async recordRun(result = {}, id = DEFAULT_PROFILE_ID) {
    return this.update((profile) => {
      const score = integer(result.score);
      const experience = integer(result.experience ?? score * 0.02);
      profile.stats.runs += 1;
      profile.stats.wins += result.victory === true ? 1 : 0;
      profile.stats.victories = profile.stats.wins;
      profile.stats.defeats += result.victory === true ? 0 : 1;
      profile.stats.kills += integer(result.kills);
      profile.stats.deaths += integer(result.deaths);
      profile.stats.totalScore += score;
      profile.stats.bestScore = Math.max(profile.stats.bestScore, score);
      profile.stats.playTimeSeconds += finite(result.playTimeSeconds);
      profile.stats.totalPlayTime = profile.stats.playTimeSeconds;
      profile.progression.totalExperience += experience;
      profile.progression.level = this.#levelForExperience(profile.progression.totalExperience);
      for (const achievement of achievements(result.achievements)) {
        const id = typeof achievement === 'string' ? achievement : achievement.id;
        const known = profile.progression.achievements.some((entry) => (typeof entry === 'string' ? entry : entry.id) === id);
        if (!known) profile.progression.achievements.push(achievement);
      }
      profile.bestScore = profile.stats.bestScore;
      profile.totalXp = profile.progression.totalExperience;
      profile.level = profile.progression.level;
      profile.achievements = [...profile.progression.achievements];
      return profile;
    }, id);
  }

  exportProfile() {
    return this.currentProfile ? JSON.stringify(this.currentProfile, null, 2) : null;
  }

  async importProfile(serialized, id = DEFAULT_PROFILE_ID) {
    const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    const profile = validateProfile(parsed, id);
    profile.id = id;
    await this.save(profile, id);
    return deepClone(this.currentProfile);
  }

  dispose() {
    this.#db?.close();
    this.#db = null;
    this.#openPromise = null;
  }

  async #idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB read aborted'));
    });
  }

  async #idbPut(storeName, value) {
    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(deepClone(value));
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'));
    });
  }

  async #backup(raw, id, reason) {
    const backup = { profileId: id, createdAt: nowIso(), reason, data: deepClone(raw) };
    if (this.mode === 'indexeddb' && this.#db) {
      try {
        await this.#idbPut('backups', backup);
      } catch (error) {
        this.eventBus.emit('save:error', { operation: 'backup', error });
      }
    }
    try {
      this.storage?.setItem(`${this.storagePrefix}:backup:${id}:${Date.now()}`, JSON.stringify(backup));
    } catch {
      this.#memory.set(`backup:${id}:${Date.now()}`, backup);
    }
  }

  #fallbackGet(id) {
    try {
      const stored = this.storage?.getItem(`${this.storagePrefix}:${id}`);
      if (stored !== null && stored !== undefined) return stored;
    } catch (error) {
      this.eventBus.emit('save:error', { operation: 'fallback-read', error });
    }
    return this.#memory.get(id) ?? null;
  }

  #fallbackSet(id, profile) {
    this.#memory.set(id, deepClone(profile));
    if (!this.storage) return false;
    try {
      this.storage.setItem(`${this.storagePrefix}:${id}`, JSON.stringify(profile));
      return true;
    } catch (error) {
      this.eventBus.emit('save:error', { operation: 'fallback-write', error });
      return false;
    }
  }

  #useFallback(error) {
    this.#db?.close();
    this.#db = null;
    if (this.mode !== 'fallback') this.eventBus.emit('save:fallback', { error });
    this.mode = 'fallback';
  }

  #levelForExperience(experience) {
    let level = 1;
    let remaining = experience;
    let cost = 500;
    while (remaining >= cost && level < 100) {
      remaining -= cost;
      level += 1;
      cost = Math.floor(cost * 1.22);
    }
    return level;
  }

  #globalValue(name) {
    try {
      return globalThis[name] ?? null;
    } catch {
      return null;
    }
  }

  #synchronizeAliases(profile, previous, patchOrMutator) {
    const patch = typeof patchOrMutator === 'object' ? patchOrMutator : {};
    const rootXpChanged = Object.hasOwn(patch, 'totalXp') || profile.totalXp !== previous.totalXp;
    const nestedXpChanged = Object.hasOwn(patch.progression ?? {}, 'totalExperience')
      || profile.progression?.totalExperience !== previous.progression?.totalExperience;
    if (rootXpChanged) {
      profile.progression ??= {};
      profile.progression.totalExperience = profile.totalXp;
    } else if (nestedXpChanged) profile.totalXp = profile.progression?.totalExperience;

    const rootLevelChanged = Object.hasOwn(patch, 'level') || profile.level !== previous.level;
    const nestedLevelChanged = Object.hasOwn(patch.progression ?? {}, 'level')
      || profile.progression?.level !== previous.progression?.level;
    if (rootLevelChanged) {
      profile.progression ??= {};
      profile.progression.level = profile.level;
    } else if (nestedLevelChanged) profile.level = profile.progression?.level;

    const rootScoreChanged = Object.hasOwn(patch, 'bestScore') || profile.bestScore !== previous.bestScore;
    const nestedScoreChanged = Object.hasOwn(patch.stats ?? {}, 'bestScore')
      || profile.stats?.bestScore !== previous.stats?.bestScore;
    if (rootScoreChanged) {
      profile.stats ??= {};
      profile.stats.bestScore = profile.bestScore;
    } else if (nestedScoreChanged) profile.bestScore = profile.stats?.bestScore;

    if (Object.hasOwn(patch, 'tutorialComplete') || profile.tutorialComplete !== previous.tutorialComplete) {
      profile.tutorialCompleted = profile.tutorialComplete;
    } else if (Object.hasOwn(patch, 'tutorialCompleted') || profile.tutorialCompleted !== previous.tutorialCompleted) {
      profile.tutorialComplete = profile.tutorialCompleted;
    }

    const rootAchievementsChanged = Object.hasOwn(patch, 'achievements')
      || JSON.stringify(profile.achievements) !== JSON.stringify(previous.achievements);
    const nestedAchievementsChanged = Object.hasOwn(patch.progression ?? {}, 'achievements')
      || JSON.stringify(profile.progression?.achievements) !== JSON.stringify(previous.progression?.achievements);
    if (rootAchievementsChanged) {
      profile.progression ??= {};
      profile.progression.achievements = profile.achievements;
    } else if (nestedAchievementsChanged) profile.achievements = profile.progression?.achievements;

    const rootUnlocksChanged = Object.hasOwn(patch, 'unlocks')
      || JSON.stringify(profile.unlocks) !== JSON.stringify(previous.unlocks);
    const nestedUnlocksChanged = Object.hasOwn(patch.progression ?? {}, 'unlockedWeapons')
      || Object.hasOwn(patch.progression ?? {}, 'unlockedCosmetics')
      || JSON.stringify(profile.progression?.unlockedWeapons) !== JSON.stringify(previous.progression?.unlockedWeapons)
      || JSON.stringify(profile.progression?.unlockedCosmetics) !== JSON.stringify(previous.progression?.unlockedCosmetics);
    if (rootUnlocksChanged) {
      profile.progression ??= {};
      profile.progression.unlockedWeapons = profile.unlocks?.weapons;
      profile.progression.unlockedCosmetics = profile.unlocks?.cosmetics;
    } else if (nestedUnlocksChanged) profile.unlocks = {
      weapons: profile.progression?.unlockedWeapons,
      cosmetics: profile.progression?.unlockedCosmetics,
    };
  }
}

export default SaveManager;
