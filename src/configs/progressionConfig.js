export const PROGRESSION_CONFIG = Object.freeze({
  experienceScale: 260,
  maxLevel: 100,
});

export function levelFromExperience(experience) {
  const numericExperience = Number(experience);
  const safeExperience = Number.isFinite(numericExperience) ? Math.max(0, numericExperience) : 0;
  const level = 1 + Math.floor(Math.sqrt(safeExperience / PROGRESSION_CONFIG.experienceScale));
  return Math.min(PROGRESSION_CONFIG.maxLevel, level);
}

