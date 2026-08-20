import test from 'node:test';
import assert from 'node:assert/strict';

import { levelFromExperience } from '../src/configs/progressionConfig.js';
import { SaveManager, validateProfile } from '../src/core/SaveManager.js';
import { AchievementSystem } from '../src/systems/AchievementSystem.js';

function createFallbackSaveManager() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  return new SaveManager({ indexedDB: null, storage });
}

test('levelFromExperience follows the canonical square-root curve at exact boundaries', () => {
  const cases = [
    [0, 1],
    [259, 1],
    [260, 2],
    [1039, 2],
    [1040, 3],
    [2_548_259, 99],
    [2_548_260, 100],
    [Number.MAX_SAFE_INTEGER, 100],
  ];

  for (const [experience, expectedLevel] of cases) {
    assert.equal(levelFromExperience(experience), expectedLevel, `${experience} XP`);
  }
});

test('levelFromExperience safely normalizes negative and non-finite experience', () => {
  for (const experience of [-1, -Infinity, Infinity, NaN, undefined]) {
    assert.equal(levelFromExperience(experience), 1, `${String(experience)} XP`);
  }
});

test('validateProfile repairs conflicting persisted level aliases from canonical experience', () => {
  const profile = validateProfile({
    version: 3,
    totalXp: 1040,
    level: 1,
    progression: {
      totalExperience: 1040,
      level: 1,
    },
  });

  assert.equal(profile.totalXp, 1040);
  assert.equal(profile.progression.totalExperience, profile.totalXp);
  assert.equal(profile.level, levelFromExperience(profile.totalXp));
  assert.equal(profile.progression.level, profile.level);
});

test('AchievementSystem finishRun applies the canonical level and synchronizes profile aliases', async () => {
  let profile = {
    totalXp: 1039,
    level: 2,
    progression: { totalExperience: 1039, level: 2 },
    stats: {},
    achievements: [],
    unlocks: { weapons: [], cosmetics: [] },
  };
  const achievements = new AchievementSystem({
    saveManager: {
      getProfile: () => profile,
      save: async (next) => {
        profile = next;
        return next;
      },
    },
  });

  const result = await achievements.finishRun(false, { xp: 1, upgrades: [] });
  const expectedLevel = levelFromExperience(1040);

  assert.equal(result.profile.totalXp, 1040);
  assert.equal(result.profile.progression.totalExperience, result.profile.totalXp);
  assert.equal(result.profile.level, expectedLevel);
  assert.equal(result.profile.progression.level, result.profile.level);
});

test('SaveManager recordRun applies the canonical level and synchronizes profile aliases', async () => {
  const saves = createFallbackSaveManager();
  await saves.load();
  await saves.updateProfile({
    totalXp: 1039,
    level: 2,
  });

  const profile = await saves.recordRun({ experience: 1 });
  const expectedLevel = levelFromExperience(1040);

  assert.equal(profile.totalXp, 1040);
  assert.equal(profile.progression.totalExperience, profile.totalXp);
  assert.equal(profile.level, expectedLevel);
  assert.equal(profile.progression.level, profile.level);
});
