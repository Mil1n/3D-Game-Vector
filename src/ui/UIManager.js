const DIFFICULTIES = {
  easy: ['Ð¡Ð¸Ð½Ñ…Ñ€Ð¾Ð½Ð¸Ð·Ð°Ñ†Ð¸Ñ', 'Ð‘Ð¾Ð»ÑŒÑˆÐµ Ñ€ÐµÑÑƒÑ€ÑÐ¾Ð² Ð¸ Ð¼ÑÐ³Ñ‡Ðµ Ñ‚ÐµÐ¼Ð¿ Ð´Ð¸Ñ€ÐµÐºÑ‚Ð¾Ñ€Ð°.'],
  normal: ['ÐžÐ¿ÐµÑ€Ð°Ñ‚Ð¸Ð²Ð½Ð°Ñ', 'Ð¡Ð±Ð°Ð»Ð°Ð½ÑÐ¸Ñ€Ð¾Ð²Ð°Ð½Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾Ñ‚Ð¾ÐºÐ¾Ð» ÐÑƒÐ»ÐµÐ²Ð¾Ð¹ Ñ€ÐµÑˆÑ‘Ñ‚ÐºÐ¸.'],
  hard: ['Ð Ð°Ð·Ñ€Ñ‹Ð²', 'ÐŸÐ»Ð¾Ñ‚Ð½Ñ‹Ðµ Ð²Ð¾Ð»Ð½Ñ‹, Ð¼ÐµÐ½ÑŒÑˆÐµ Ñ€ÐµÑÑƒÑ€ÑÐ¾Ð², Ð°Ð³Ñ€ÐµÑÑÐ¸Ð²Ð½Ñ‹Ð¹ Ð´Ð¸Ñ€ÐµÐºÑ‚Ð¾Ñ€.'],
};

const DEFAULT_SETTINGS = Object.freeze({
  audio: { master: 0.8, music: 0.45, weapons: 0.85, effects: 0.75, environment: 0.6, ui: 0.7, muted: false },
  graphics: { quality: 'high', resolutionScale: 1, shadows: true, shadowQuality: 'medium', antialias: true, bloom: true, particles: 'high', maxPixelRatio: 1.5, fpsLimit: 0 },
  controls: {
    mouseSensitivity: 0.55,
    invertY: false,
    rawInput: true,
    bindings: { forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', crouch: 'ControlLeft', dash: 'KeyQ', interact: 'KeyE', reload: 'KeyR' },
  },
  gameplay: { difficulty: 'normal', fov: 82, sprintFov: 92, headBob: 0.55, cameraShake: 0.65, subtitles: true, crosshairColor: '#64f4ff', aimMode: 'hold', crouchMode: 'hold' },
  accessibility: { reducedMotion: false, highContrast: false, colorBlindMode: 'none', screenFlash: 0.65, uiScale: 1 },
});

const TUTORIAL_STEPS = [
  ['ÐŸÐ ÐžÐ¢ÐžÐšÐžÐ› // 01', 'ÐÐ°Ð²Ð¸Ð³Ð°Ñ†Ð¸Ñ', 'Ð”Ð²Ð¸Ð³Ð°Ð¹Ñ‚ÐµÑÑŒ Ð¾Ñ‚ Ð¾Ñ‚Ð¼ÐµÑ‚ÐºÐ¸ Ðº Ð°ÐºÑ‚Ð¸Ð²Ð½Ð¾Ð¼Ñƒ Ñ„Ð°Ð·Ð¾Ð²Ð¾Ð¼Ñƒ ÑƒÐ·Ð»Ñƒ.', ['W', 'A', 'S', 'D']],
  ['ÐŸÐ ÐžÐ¢ÐžÐšÐžÐ› // 02', 'Ð˜Ð¼Ð¿ÑƒÐ»ÑŒÑ Ð´Ð²Ð¸Ð¶ÐµÐ½Ð¸Ñ', 'Ð£Ð´ÐµÑ€Ð¶Ð¸Ð²Ð°Ð¹Ñ‚Ðµ ÑÐ¿Ñ€Ð¸Ð½Ñ‚ Ð¸ ÑÐ¾Ð²ÐµÑ€ÑˆÐ°Ð¹Ñ‚Ðµ Ñ€Ñ‹Ð²Ð¾Ðº, Ñ‡Ñ‚Ð¾Ð±Ñ‹ ÑÐ¼ÐµÐ½Ð¸Ñ‚ÑŒ Ð²ÐµÐºÑ‚Ð¾Ñ€ Ð°Ñ‚Ð°ÐºÐ¸.', ['SHIFT', 'Q']],
  ['ÐŸÐ ÐžÐ¢ÐžÐšÐžÐ› // 03', 'ÐžÐ³Ð½ÐµÐ²Ð¾Ð¹ ÐºÐ¾Ð½Ñ‚Ð°ÐºÑ‚', 'Ð›ÐµÐ²Ð°Ñ ÐºÐ½Ð¾Ð¿ÐºÐ° ÑÑ‚Ñ€ÐµÐ»ÑÐµÑ‚, Ð¿Ñ€Ð°Ð²Ð°Ñ ÑÑƒÐ¶Ð°ÐµÑ‚ Ð¿Ñ€Ð¸Ñ†ÐµÐ». ÐŸÐ¾Ð¿Ð°Ð´Ð°Ð½Ð¸Ðµ Ð² Ð³Ð¾Ð»Ð¾Ð²Ñƒ Ð½Ð°Ð½Ð¾ÑÐ¸Ñ‚ Ð±Ð¾Ð»ÑŒÑˆÐµ ÑƒÑ€Ð¾Ð½Ð°.', ['Ð›ÐšÐœ', 'ÐŸÐšÐœ']],
  ['ÐŸÐ ÐžÐ¢ÐžÐšÐžÐ› // 04', 'Ð¡Ñ‚Ð°Ð±Ð¸Ð»Ð¸Ð·Ð°Ñ†Ð¸Ñ ÑƒÐ·Ð»Ð°', 'ÐŸÐ¾Ð´Ð¾Ð¹Ð´Ð¸Ñ‚Ðµ Ðº Ð¼Ð°Ñ€ÐºÐµÑ€Ñƒ Ñ†ÐµÐ»Ð¸ Ð¸ ÑƒÐ´ÐµÑ€Ð¶Ð¸Ð²Ð°Ð¹Ñ‚Ðµ Ð²Ð·Ð°Ð¸Ð¼Ð¾Ð´ÐµÐ¹ÑÑ‚Ð²Ð¸Ðµ Ð´Ð¾ Ð·Ð°Ð²ÐµÑ€ÑˆÐµÐ½Ð¸Ñ ÑÐºÐ°Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ñ.', ['E']],
  ['ÐŸÐ ÐžÐ¢ÐžÐšÐžÐ› // 05', 'Ð¡Ð´Ð²Ð¸Ð³ Ñ€ÐµÐ°Ð»ÑŒÐ½Ð¾ÑÑ‚Ð¸', 'ÐœÐ°Ð³ÐµÐ½Ñ‚Ð¾Ð²Ð°Ñ Ð¼ÐµÑ‚ÐºÐ° Ð¾Ð±Ð¾Ð·Ð½Ð°Ñ‡Ð°ÐµÑ‚ Ð¿ÐµÑ€ÐµÑÑ‚Ñ€Ð°Ð¸Ð²Ð°ÐµÐ¼Ñ‹Ðµ ÑÐµÐºÑ†Ð¸Ð¸. Ð”Ð¾ Ð¡Ð´Ð²Ð¸Ð³Ð° Ð·Ð°Ð¹Ð¼Ð¸Ñ‚Ðµ Ð±ÐµÐ·Ð¾Ð¿Ð°ÑÐ½Ñ‹Ð¹ Ð¼Ð°Ñ€ÑˆÑ€ÑƒÑ‚.', []],
];

const NUMBER_FORMAT = new Intl.NumberFormat('ru-RU');
const clamp = (value, min = 0, max = 1) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const percent = (value) => clamp(Number(value) > 1 ? Number(value) / 100 : Number(value)) * 100;
const formatInteger = (value) => NUMBER_FORMAT.format(Math.max(0, Math.round(finite(value))));
const formatDuration = (value) => {
  const seconds = Math.max(0, Math.floor(finite(value)));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const escapeHTML = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function deepMerge(base, patch) {
  const result = Array.isArray(base) ? [...base] : { ...base };
  if (!patch || typeof patch !== 'object') return result;
  Object.entries(patch).forEach(([key, value]) => {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(result[key] ?? {}, value)
      : value ?? result[key];
  });
  return result;
}

function getPath(object, path, fallback) {
  const value = String(path).split('.').reduce((current, key) => current?.[key], object);
  return value === undefined ? fallback : value;
}

function setPath(object, path, value) {
  const keys = String(path).split('.');
  let target = object;
  keys.slice(0, -1).forEach((key) => {
    if (!target[key] || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  });
  target[keys.at(-1)] = value;
}

function humanKey(code) {
  const names = { Space: 'ÐŸÑ€Ð¾Ð±ÐµÐ»', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', Escape: 'Esc' };
  return names[code] ?? String(code ?? '').replace(/^Key/, '').replace(/^Digit/, '');
}

/** DOM-only UI. Gameplay mutations are emitted as `ui:*` intents. */
export class UIManager {
  constructor({ eventBus, settingsManager, saveManager, root, uiRoot } = {}) {
    this.eventBus = eventBus ?? null;
    this.settingsManager = settingsManager ?? null;
    this.saveManager = saveManager ?? null;
    this.root = root ?? uiRoot ?? (typeof document !== 'undefined' ? document.querySelector('#app') : null);
    this.initialized = false;
    this.activeView = 'boot';
    this.returnView = 'main-menu';
    this.settingsTab = 'graphics';
    this.profile = null;
    this.settings = deepMerge(DEFAULT_SETTINGS, {});
    this.difficulty = 'normal';
    this.hudState = {};
    this.options = [];
    this.lastKillfeedKey = '';
    this.lastWarningKey = '';
    this.disposers = [];
    this.timers = new Set();
    this.warningTimer = null;
    this.warningInterval = null;
    this.hitmarkerTimer = null;
    this.bindingCapture = null;
    this._onRootClick = this._onRootClick.bind(this);
    this._onRootInput = this._onRootInput.bind(this);
    this._onRootChange = this._onRootChange.bind(this);
    this._onRootKeydown = this._onRootKeydown.bind(this);
    this._onFullscreenChange = this._onFullscreenChange.bind(this);
  }

  init() {
    if (this.initialized) return this;
    if (!this.root) throw new Error('[UIManager] ÐšÐ¾Ð½Ñ‚ÐµÐ¹Ð½ÐµÑ€ #app Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½.');
    this.root.classList.add('ui-root');
    this.root.dataset.view = 'boot';
    this.root.innerHTML = this._shellMarkup();
    this.screen = this.root.querySelector('[data-ui-screen]');
    this.hud = this.root.querySelector('[data-ui-hud]');
    this.tutorial = this.root.querySelector('[data-ui-tutorial]');
    this.warning = this.root.querySelector('[data-ui-warning]');
    this.toastRegion = this.root.querySelector('[data-ui-toasts]');
    this.crosshair = this.root.querySelector('[data-ui-crosshair]');
    this.hitmarker = this.root.querySelector('[data-ui-hitmarker]');
    this.root.addEventListener('click', this._onRootClick);
    this.root.addEventListener('input', this._onRootInput);
    this.root.addEventListener('change', this._onRootChange);
    this.root.addEventListener('keydown', this._onRootKeydown);
    document.addEventListener('fullscreenchange', this._onFullscreenChange);
    const unsubscribe = this.eventBus?.on?.('settings:changed', ({ settings } = {}) => {
      if (!settings) return;
      this.settings = deepMerge(DEFAULT_SETTINGS, settings);
      this._applyAccessibilitySettings();
    });
    if (typeof unsubscribe === 'function') this.disposers.push(unsubscribe);
    this._readSettings();
    this._applyAccessibilitySettings();
    this.initialized = true;
    return this;
  }

  _shellMarkup() {
    return `<div class="ui-noise" aria-hidden="true"></div><div class="ui-vignette" aria-hidden="true"></div>
      <div class="ui-screen" data-ui-screen></div>
      <section class="hud" data-ui-hud hidden aria-label="Ð˜Ð³Ñ€Ð¾Ð²Ð¾Ð¹ Ð¸Ð½Ñ‚ÐµÑ€Ñ„ÐµÐ¹Ñ">
        <section class="hud-objective hud-panel" data-hud-panel="objective"><header><span data-hud="phase">Ð¤ÐÐ—Ð 01</span><b>Ð¢Ð•ÐšÐ£Ð©ÐÐ¯ Ð—ÐÐ”ÐÐ§Ð</b></header><strong data-hud="objective">ÐžÐ¶Ð¸Ð´Ð°Ð½Ð¸Ðµ Ð¿Ñ€Ð¾Ñ‚Ð¾ÐºÐ¾Ð»Ð°</strong><p data-hud="objective-detail">Ð¡ÐºÐ°Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ Ð¾ÐºÑ€ÑƒÐ¶ÐµÐ½Ð¸Ñ</p><div class="objective-progress"><span data-meter="objective"></span><output data-hud="objective-progress">0%</output></div></section>
        <section class="hud-anomaly hud-panel" data-hud-panel="anomaly"><div class="anomaly-radar" aria-hidden="true"><i></i><i></i><i></i></div><div><span>ÐÐÐžÐœÐÐ›Ð˜Ð¯</span><strong data-hud="anomaly">Ð¡ÐµÑ‚ÑŒ ÑÑ‚Ð°Ð±Ð¸Ð»ÑŒÐ½Ð°</strong></div><output data-hud="shift-countdown">Ð¡Ð˜ÐÐ¥Ð ÐžÐ</output></section>
        <div class="hud-score"><div data-hud-panel="score"><span>Ð¡Ð§ÐÐ¢</span><strong data-hud="score">0</strong></div><div data-hud-panel="combo"><span>Ð¡Ð•Ð Ð˜Ð¯</span><strong data-hud="combo">Ã—1</strong></div></div>
        <div class="killfeed" data-hud="killfeed" aria-live="polite" aria-label="Ð£Ð²ÐµÐ´Ð¾Ð¼Ð»ÐµÐ½Ð¸Ñ Ð¾ Ð»Ð¸ÐºÐ²Ð¸Ð´Ð°Ñ†Ð¸ÑÑ…"></div>
        <div class="damage-direction" aria-hidden="true"><i data-damage="front"></i><i data-damage="right"></i><i data-damage="back"></i><i data-damage="left"></i></div>
        <div class="interact-prompt" data-hud-panel="interact" hidden><kbd data-hud="interact-key">E</kbd><div><span data-hud="interact-action">Ð’Ð—ÐÐ˜ÐœÐžÐ”Ð•Ð™Ð¡Ð¢Ð’Ð˜Ð•</span><strong data-hud="interact-label">ÐÐºÑ‚Ð¸Ð²Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ</strong></div><div class="interact-hold"><i data-meter="interact"></i></div></div>
        <div class="hud-vitals">
          <section class="vital-card vital-card--health hud-panel" data-hud-panel="health"><header><span>Ð¡ÐžÐ¡Ð¢ÐžÐ¯ÐÐ˜Ð•</span><b>HP</b></header><div><strong data-hud="health">100</strong><small>/100</small></div><div class="segmented-meter"><span data-meter="health"></span><i></i><i></i><i></i></div></section>
          <section class="vital-card vital-card--armor hud-panel" data-hud-panel="armor"><header><span>Ð‘Ð ÐžÐÐ¯</span><b>AR</b></header><div><strong data-hud="armor">0</strong><small>/100</small></div><div class="segmented-meter"><span data-meter="armor"></span><i></i><i></i><i></i></div></section>
        </div>
        <div class="hud-abilities"><section class="dash-indicator hud-panel" data-hud-panel="dash"><div class="dash-ring"><i data-meter="dash"></i><b>Q</b></div><div><span>Ð Ð«Ð’ÐžÐš</span><strong data-hud="dash">Ð“ÐžÐ¢ÐžÐ’</strong></div></section><div class="hud-upgrades" data-hud="upgrades" aria-label="ÐÐºÑ‚Ð¸Ð²Ð½Ñ‹Ðµ ÑƒÐ»ÑƒÑ‡ÑˆÐµÐ½Ð¸Ñ"></div></div>
        <section class="ammo-card hud-panel" data-hud-panel="ammo"><header><span data-hud="weapon">Ð˜ÐœÐŸÐ£Ð›Ð¬Ð¡ÐÐ«Ð™ ÐšÐÐ ÐÐ‘Ð˜Ð</span><b>01</b></header><div class="ammo-readout"><strong data-hud="ammo">24</strong><i>/</i><span data-hud="reserve">120</span></div><footer><kbd>R</kbd><span>ÐŸÐ•Ð Ð•Ð—ÐÐ Ð¯Ð”ÐšÐ</span></footer></section>
        <div class="crosshair" data-ui-crosshair data-state="default" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
        <div class="hitmarker" data-ui-hitmarker data-type="body" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      </section>
      <section class="tutorial-layer" data-ui-tutorial hidden></section>
      <section class="warning-banner" data-ui-warning hidden role="alert" aria-live="assertive"><div class="warning-chevron" aria-hidden="true">///</div><div><p>Ð’ÐÐ˜ÐœÐÐÐ˜Ð• // ÐÐ•Ð¡Ð¢ÐÐ‘Ð˜Ð›Ð¬ÐÐÐ¯ Ð“Ð•ÐžÐœÐ•Ð¢Ð Ð˜Ð¯</p><h2 data-warning-title>Ð¡Ð”Ð’Ð˜Ð“ Ð Ð•ÐÐ›Ð¬ÐÐžÐ¡Ð¢Ð˜</h2><span data-warning-detail>ÐžÑÐ²Ð¾Ð±Ð¾Ð´Ð¸Ñ‚Ðµ Ð¾Ð¿Ð°ÑÐ½ÑƒÑŽ Ð·Ð¾Ð½Ñƒ</span><i class="warning-progress" data-warning-bar></i></div><output data-warning-countdown>5.0</output></section>
      <section class="toast-region" data-ui-toasts aria-live="polite" aria-label="Ð£Ð²ÐµÐ´Ð¾Ð¼Ð»ÐµÐ½Ð¸Ñ"></section>`;
  }

  showLoading(progress = 0, text = 'Ð˜Ð½Ð¸Ñ†Ð¸Ð°Ð»Ð¸Ð·Ð°Ñ†Ð¸Ñ ÐºÐ¾Ð¼Ð¿Ð»ÐµÐºÑÐ°') {
    this._ensureInit();
    const value = percent(progress);
    this._hideHud();
    this._showScreen(`<main class="loading-screen" aria-labelledby="loading-title"><div class="loading-grid" aria-hidden="true"></div><div class="loading-core">
      <div class="brand-mark"><span>VECTOR</span><i>//</i><strong>NULL</strong></div><p class="eyebrow">Ð—ÐÐ“Ð Ð£Ð—ÐšÐ ÐÐ£Ð›Ð•Ð’ÐžÐ™ Ð Ð•Ð¨ÐÐ¢ÐšÐ˜</p><h1 id="loading-title">${escapeHTML(text)}</h1>
      <div class="loading-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value)}"><span style="--progress:${value}%"></span></div>
      <div class="loading-readout"><span>SYS.BOOT</span><output>${Math.round(value)}%</output></div><p class="loading-tip">ÐŸÐµÑ€ÐµÑÑ‚Ñ€Ð¾Ð¹ÐºÐ° Ð°Ñ€ÐµÐ½Ñ‹ Ð²ÑÐµÐ³Ð´Ð° Ð¿Ñ€ÐµÐ´ÑƒÐ¿Ñ€ÐµÐ¶Ð´Ð°ÐµÑ‚ÑÑ Ð¼Ð°Ñ€ÐºÐµÑ€Ð¾Ð¼ Ð¸ Ð·Ð²ÑƒÐºÐ¾Ð²Ñ‹Ð¼ ÑÐ¸Ð³Ð½Ð°Ð»Ð¾Ð¼.</p>
    </div></main>`, 'loading');
  }

  showMainMenu(profile = this.profile) {
    this._ensureInit();
    this.profile = profile ?? this.profile ?? this._cachedProfile();
    this._readSettings();
    this.difficulty = getPath(this.settings, 'gameplay.difficulty', this.difficulty);
    this.returnView = 'main-menu';
    this._hideHud();
    const stats = this.profile?.stats ?? {};
    const progression = this.profile?.progression ?? {};
    const tutorialCompleted = Boolean(this.profile?.tutorialCompleted);
    const difficultyButtons = Object.entries(DIFFICULTIES).map(([key, [label]]) =>
      `<button type="button" data-action="difficulty" data-value="${key}" aria-pressed="${key === this.difficulty}">${label}</button>`).join('');

    this._showScreen(`<main class="menu-screen" aria-labelledby="main-menu-title">
      <div class="menu-atmosphere" aria-hidden="true"><span></span><span></span><span></span></div>
      <header class="menu-topbar"><div class="system-status"><i></i><span>ÐšÐžÐœÐŸÐ›Ð•ÐšÐ¡ ÐÐ Ð¡Ð’Ð¯Ð—Ð˜</span><b>07-A</b></div><button class="icon-button" type="button" data-action="fullscreen" aria-label="ÐŸÐ¾Ð»Ð½Ð¾ÑÐºÑ€Ð°Ð½Ð½Ñ‹Ð¹ Ñ€ÐµÐ¶Ð¸Ð¼" title="ÐŸÐ¾Ð»Ð½Ñ‹Ð¹ ÑÐºÑ€Ð°Ð½">â›¶</button></header>
      <section class="menu-hero"><p class="eyebrow">Ð­ÐšÐ¡ÐŸÐ•Ð Ð˜ÐœÐ•ÐÐ¢ÐÐ›Ð¬ÐÐ«Ð™ ÐŸÐ ÐžÐ¢ÐžÐšÐžÐ› // V.07</p><h1 id="main-menu-title" class="game-logo"><span>VECTOR</span><em>//</em><strong>NULL</strong></h1>
        <p class="hero-copy">ÐŸÐ¾Ð»Ð¸Ð³Ð¾Ð½ Ð¼ÐµÐ½ÑÐµÑ‚ ÑÐ²Ð¾ÑŽ Ð³ÐµÐ¾Ð¼ÐµÑ‚Ñ€Ð¸ÑŽ. Ð—Ð°Ð²ÐµÑ€ÑˆÐ¸Ñ‚Ðµ Ð¿Ñ€Ð¾Ñ‚Ð¾ÐºÐ¾Ð» Ð¸ Ð²Ñ‹Ð¹Ð´Ð¸Ñ‚Ðµ Ð¸Ð· ÐÑƒÐ»ÐµÐ²Ð¾Ð¹ Ñ€ÐµÑˆÑ‘Ñ‚ÐºÐ¸.</p>
        <nav class="primary-actions" aria-label="Ð“Ð»Ð°Ð²Ð½Ð¾Ðµ Ð¼ÐµÐ½ÑŽ">
          <button class="action-button action-button--primary" type="button" data-action="start" autofocus><span class="action-index">01</span><span><b>ÐÐ°Ñ‡Ð°Ñ‚ÑŒ Ð·Ð°Ð±ÐµÐ³</b><small>Ð¡Ñ‚Ð°Ð±Ð¸Ð»Ð¸Ð·Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ 3 ÑƒÐ·Ð»Ð° Ð¸ ÑÐ²Ð°ÐºÑƒÐ¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒÑÑ</small></span><i>ÐÐÐ§ÐÐ¢Ð¬ Ð¡Ð•ÐÐÐ¡</i></button>
          <button class="action-button" type="button" data-action="tutorial"><span class="action-index">02</span><span><b>${tutorialCompleted ? 'ÐŸÐ¾Ð²Ñ‚Ð¾Ñ€Ð¸Ñ‚ÑŒ Ð¾Ð±ÑƒÑ‡ÐµÐ½Ð¸Ðµ' : 'ÐŸÑ€Ð¾Ð´Ð¾Ð»Ð¶Ð¸Ñ‚ÑŒ Ð¾Ð±ÑƒÑ‡ÐµÐ½Ð¸Ðµ'}</b><small>ÐšÐ¾Ñ€Ð¾Ñ‚ÐºÐ¸Ð¹ Ð¸Ð½Ñ‚ÐµÑ€Ð°ÐºÑ‚Ð¸Ð²Ð½Ñ‹Ð¹ Ð¿Ñ€Ð¾Ñ‚Ð¾ÐºÐ¾Ð»</small></span><i>WASD</i></button>
        </nav>
        <div class="difficulty-block"><div><span class="field-label">Ð£Ð ÐžÐ’Ð•ÐÐ¬ Ð£Ð“Ð ÐžÐ—Ð«</span><p data-difficulty-detail>${escapeHTML(DIFFICULTIES[this.difficulty]?.[1] ?? DIFFICULTIES.normal[1])}</p></div><div class="segmented-control" role="group" aria-label="Ð¡Ð»Ð¾Ð¶Ð½Ð¾ÑÑ‚ÑŒ">${difficultyButtons}</div></div>
        <nav clas×7òÚ$z{-®éÜj×âÖ'WGFöâÒ×&–Ö'’r¢rwÒG¶FævW"òv7F–öâÖ'WGFöâÒÖFævW"r¢rwÒ"G—SÒ&'WGFöâ"FFÖ7F–öãÒ"G¶7F–öçÒ"G¶WFöfö7W2òvWFöfö7W2r¢rwÓãÇ7â6Æ73Ò&7F–öâÖ–æFW‚#âG¶–æFW‡ÓÂ÷7ããÇ7ããÆ#âG·F—FÆWÓÂö#ãÇ6ÖÆÃâG¶FWF–ÇÓÂ÷6ÖÆÃãÂ÷7ãâG¶¶W’òÆ“âG¶¶W—ÓÂö“æ¢rwÓÂö'WGFöãæ°¢Ð ¢÷&VæFW$‡VEWw&FW2‡Ww&FW2’°¢6öç7B6öçF–æW"ÒF†—2ç&ö÷BçVW'•6VÆV7F÷"‚u¶FFÖ‡VCÒ'Ww&FW2%Òr“°¢–b‚6öçF–æW"’&WGW&ã°¢6öçF–æW"ç&WÆ6T6†–ÆG&Vâ‚ââçWw&FW2ç6Æ–6RƒÂB’æÖ‚‡Ww&FRÂ–æFW‚’Óâ°¢6öç7B—FVÒÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢—FVÒæ6Æ74æÖRÒv‡VB×Ww&FRs°¢—FVÒçF—FÆRÒWw&FRæFW67&—F–öâóòWw&FRææÖRóò7G&–ær‡Ww&FR“°¢6öç7BvÇ—‚ÒFö7VÖVçBæ7&VFTVÆVÖVçB‚v"r“²vÇ—‚çFW‡D6öçFVçBÒWw&FRævÇ—‚óò7G&–ær†–æFW‚²’çE7F'Bƒ"Âsr“°¢6öç7BÆ&VÂÒFö7VÖVçBæ7&VFTVÆVÖVçB‚w7âr“²Æ&VÂçFW‡D6öçFVçBÒWw&FRææÖRóòWw&FRçF—FÆRóò7G&–ær‡Ww&FR“°¢—FVÒæVæB†vÇ—‚ÂÆ&VÂ“°¢&WGW&â—FVÓ°¢Ò’“°¢Ð ¢÷WFFT–çFW&7B†–çFW&7B’°¢6öç7BæVÂÒF†—2ç&ö÷BçVW'•6VÆV7F÷"‚u¶FFÖ‡VB×æVÃÒ&–çFW&7B%Òr“°¢–b‚æVÂ’&WGW&ã°¢–b‚–çFW&7BÇÂ–çFW&7Bçf—6–&ÆRÓÓÒfÇ6R’²æVÂæ†–FFVâÒG'VS²&WGW&ã²Ð¢6öç7BFFÒG—Vöb–çFW&7BÓÓÒw7G&–ærrò²Æ&VÃ¢–çFW&7BÒ¢–çFW&7C°¢æVÂæ†–FFVâÒfÇ6S°¢F†—2å÷6WEFW‡B‚v–çFW&7BÖ¶W’rÂ‡VÖä¶W’†FFæ¶W’óòt¶W”Rr’“°¢F†—2å÷6WEFW‡B‚v–çFW&7BÖ7F–öârÂFFæ7F–öâóò†FFæ†öÆBò}
=	M	]
	m		-		
-	Rr¢}	-	}			Í	í	M	]	

-	-		Rr’“°¢F†—2å÷6WEFW‡B‚v–çFW&7BÖÆ&VÂrÂFFæÆ&VÂóòFFçFW‡Bóò}	­--í--Âr“°¢F†—2å÷6WDÖWFW"‚v–çFW&7BrÂFFç&öw&W72óò“°¢æVÂæ6Æ74Æ—7BçFövvÆR‚v—2Ö†öÆF–ærrÂ&ööÆVâ†FFæ†öÆB’“°¢Ð ¢÷6†÷tFÖvTF—&V7F–öâ†F—&V7F–öâ’°¢6öç7BfÇVW2Ò'&’æ—4'&’†F—&V7F–öâ’òF—&V7F–öâ¢¶F—&V7F–öåÓ°¢fÇVW2æf–ÇFW"„&ööÆVâ’æf÷$V6‚‚‡fÇVR’Óâ°¢6öç7B¶W’ÒG—VöbfÇVRÓÓÒvö&¦V7BròfÇVRæF—&V7F–öâ¢fÇVS°¢6öç7BæöFRÒF†—2ç&ö÷BçVW'•6VÆV7F÷"†¶FFÖFÖvSÒ"Gµ7G&–ær†¶W’’çFôÆ÷vW$66R‚—Ò%Ö“°¢–b‚æöFR’&WGW&ã°¢æöFRæ6Æ74Æ—7Bç&VÖ÷fR‚v—2Ö7F—fRr“°¢fö–BæöFRæöfg6WEv–GFƒ°¢æöFRæ6Æ74Æ—7BæFB‚v—2Ö7F—fRr“°¢F†—2å÷G&6µF–ÖW"‡v–æF÷rç6WEF–ÖV÷WB‚‚’ÓâæöFRæ6Æ74Æ—7Bç&VÖ÷fR‚v—2Ö7F—fRr’Âf–æ—FR‡fÇVSòæGW&F–öâÂcS’’“°¢Ò“°¢Ð ¢÷WFFT¶–ÆÆfVVB†fVVB’°¢6öç7B6öçF–æW"ÒF†—2ç&ö÷BçVW'•6VÆV7F÷"‚u¶FFÖ‡VCÒ&¶–ÆÆfVVB%Òr“°¢–b‚6öçF–æW"’&WGW&ã°¢–b„'&’æ—4'&’†fVVB’’°¢6öçF–æW"ç&WÆ6T6†–ÆG&Vâ‚“°¢fVVBç6Æ–6R‚ÓB’æf÷$V6‚‚†—FVÒ’ÓâF†—2åöVæD¶–ÆÆfVVB†6öçF–æW"Â—FVÒ’“°¢&WGW&ã°¢Ð¢6öç7B¶W’ÒG—VöbfVVBÓÓÒvö&¦V7BròG¶fVVBæ–BóòrwÓ¢G¶fVVBæVæV×’óòfVVBçF&vWBóòfVVBçFW‡GÓ¢G¶fVVBçF–ÖRóòrwÖ¢7G&–ær†fVVB“°¢–b†¶W’ÓÓÒF†—2æÆ7D¶–ÆÆfVVD¶W’’&WGW&ã°¢F†—2æÆ7D¶–ÆÆfVVD¶W’Ò¶W“°¢F†—2åöVæD¶–ÆÆfVVB†6öçF–æW"ÂfVVB“°¢v†–ÆR†6öçF–æW"æ6†–ÆG&VâæÆVæwF‚âB’6öçF–æW"æf—'7DVÆVÖVçD6†–ÆCòç&VÖ÷fR‚“°¢Ð ¢öVæD¶–ÆÆfVVB†6öçF–æW"Â—FVÒ’°¢6öç7BFFÒG—Vöb—FVÒÓÓÒvö&¦V7Brò—FVÒ¢²FW‡C¢—FVÒÓ°¢6öç7BæöFRÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢æöFRæ6Æ74æÖRÒ¶–ÆÆfVVBÖ—FVÒG¶FFæ†VG6†÷Bòr—2Ö†VG6†÷Br¢rwÖ°¢6öç7BÖ&¶W"ÒFö7VÖVçBæ7&VFTVÆVÖVçB‚v’r“²Ö&¶W"çFW‡D6öçFVçBÒFFæ†VG6†÷Bò}
Rr¢}
rs°¢6öç7BFW‡BÒFö7VÖVçBæ7&VFTVÆVÖVçB‚w7âr“²FW‡BçFW‡D6öçFVçBÒFFçFW‡BóòG¶FFæVæV×’óòFFçF&vWBóò}	ýí--Ý¢wÒ(	B½­-Mí-Ö°¢6öç7B66÷&RÒFö7VÖVçBæ7&VFTVÆVÖVçB‚v"r“²66÷&RçFW‡D6öçFVçBÒFFç66÷&Rò²G¶f÷&ÖD–çFVvW"†FFç66÷&R—Ö¢rs°¢æöFRæVæB†Ö&¶W"ÂFW‡BÂ66÷&R“°¢6öçF–æW"æVæB†æöFR“°¢Ð ¢ööå&ö÷D6Æ–6²†WfVçB’°¢6öç7BG&–vvW"ÒWfVçBçF&vWBæ6Æ÷6W7B‚u¶FFÖ7F–öåÒÂ¶FF×6WGF–æw2×F%Òr“°¢–b‚G&–vvW"ÇÂF†—2ç&ö÷Bæ6öçF–ç2‡G&–vvW"’’&WGW&ã°¢–b‡G&–vvW"æFF6WBç6WGF–æw5F"’°¢F†—2ç6WGF–æw5F"ÒG&–vvW"æFF6WBç6WGF–æw5F#°¢F†—2å÷&VæFW%6WGF–æw2‚“°¢&WGW&ã°¢Ð¢6öç7B7F–öâÒG&–vvW"æFF6WBæ7F–öã°¢–b†7F–öâÓÓÒw7F'Br’F†—2åöVÖ—B‚wV“§7F'BrÂ²F–ff–7VÇG“¢F†—2æF–ff–7VÇG’ÂGWF÷&–Ã¢fÇ6RÂÖöFS¢w'VârÒ“°¢VÇ6R–b†7F–öâÓÓÒwGWF÷&–Âr’F†—2åöVÖ—B‚wV“§7F'BrÂ²F–ff–7VÇG“¢F†—2æF–ff–7VÇG’ÂGWF÷&–Ã¢G'VRÂÖöFS¢wGWF÷&–ÂrÂ6öçF–çVS¢G'VRÒ“°¢VÇ6R–b†7F–öâÓÓÒvF–ff–7VÇG’r’F†—2å÷6VÆV7DF–ff–7VÇG’‡G&–vvW"æFF6WBçfÇVR“°¢VÇ6R–b†7F–öâÓÓÒw6WGF–æw2r’F†—2ç6†÷u6WGF–æw2‡F†—2æ7F—fUf–WrÓÓÒwW6RròwW6Rr¢vÖ–âÖÖVçRr“°¢VÇ6R–b…²v6†–WfVÖVçG2rÂw7FF—7F–72rÂv6öçG&öÇ2uÒæ–æ6ÇVFW2†7F–öâ’’F†—2å÷6†÷t–æfõf–Wr†7F–öâ“°¢VÇ6R–b†7F–öâÓÓÒw&W7VÖRr’F†—2åöVÖ—B‚wV“§&W7VÖRr“°¢VÇ6R–b†7F–öâÓÓÒw&W7F'Br’F†—2åöVÖ—B‚wV“§&W7F'Br“°¢VÇ6R–b†7F–öâÓÓÒvÖVçRr’F†—2åöVÖ—B‚wV“¦ÖVçRr“°¢VÇ6R–b†7F–öâÓÓÒv&6²r’F†—2å÷&WGW&äg&öÕ7V'f–Wr‚“°¢VÇ6R–b†7F–öâÓÓÒw6VÆV7B×Ww&FRr’°¢6öç7B–æFW‚Òf–æ—FR‡G&–vvW"æFF6WBçWw&FT–æFW‚“°¢6öç7B÷F–öâÒF†—2æ÷F–öç5¶–æFW…Òóò²–C¢G&–vvW"æFF6WBçWw&FT–BÓ°¢G&–vvW"æ6Æ÷6W7B‚rçWw&FRÖw&–Br“òçVW'•6VÆV7F÷$ÆÂ‚v'WGFöâr’æf÷$V6‚‚†'WGFöâ’Óâ²'WGFöâæF—6&ÆVBÒG'VS²Ò“°¢F†—2åöVÖ—B‚wV“§6VÆV7B×Ww&FRrÂ÷F–öâæ–BóòG&–vvW"æFF6WBçWw&FT–BÂ÷F–öâÂ–æFW‚“°¢ÒVÇ6R–b†7F–öâÓÓÒw6¶—×GWF÷&–Âr’°¢F†—2çGWF÷&–Âæ6Æ74Æ—7Bç&VÖ÷fR‚v—2Ö7F—fRr“°¢F†—2çGWF÷&–Âæ†–FFVâÒG'VS°¢F†—2åöVÖ—B‚wV“§6¶—×GWF÷&–Âr“°¢ÒVÇ6R–b†7F–öâÓÓÒvgVÆÇ67&VVâr’F†—2å÷FövvÆTgVÆÇ67&VVâ‚“°¢VÇ6R–b†7F–öâÓÓÒw&W6WB×6WGF–æw2r’F†—2å÷&W6WE6WGF–æw2‚“°¢VÇ6R–b†7F–öâÓÓÒw&W6WB×6fRr’F†—2å÷&W6WE6fR‚“°¢VÇ6R–b†7F–öâÓÓÒv&–æBÖ¶W’r’F†—2åö6GW&T&–æF–ær‡G&–vvW"ÂG&–vvW"æFF6WBç6WGF–æuF‚“°¢VÇ6R–b†7F–öâÓÓÒw&VÆöBr’v–æF÷ræÆö6F–öâç&VÆöB‚“°¢Ð ¢ööå&ö÷D–çWB†WfVçB’°¢6öç7B–çWBÒWfVçBçF&vWBæ6Æ÷6W7B‚u¶FF×6WGF–æuÒr“°¢–b‚–çWBÇÂ–çWBçG—RÓÒw&ævRr’&WGW&ã°¢–b†–çWBææW‡DVÆVÖVçE6–&Æ–ær’–çWBææW‡DVÆVÖVçE6–&Æ–ærçFW‡D6öçFVçBÒF†—2åöf÷&ÖE6WGF–æufÇVR†–çWBçfÇVRÂ–çWBæFF6WBæf÷&ÖB“°¢F†—2åöÇ•6WGF–ær†–çWBæFF6WBç6WGF–ærÂçVÖ&W"†–çWBçfÇVR’“°¢Ð ¢ööå&ö÷D6†ævR†WfVçB’°¢6öç7B–çWBÒWfVçBçF&vWBæ6Æ÷6W7B‚u¶FF×6WGF–æuÒr“°¢–b‚–çWBÇÂ–çWBçG—RÓÓÒw&ævRr’&WGW&ã°¢ÆWBfÇVRÒ–çWBçG—RÓÓÒv6†V6¶&÷‚rò–çWBæ6†V6¶VB¢–çWBçfÇVS°¢–b†–çWBæFF6WBç6WGF–ærÓÓÒvw&†–72æg4Æ–Ö—Br’fÇVRÒçVÖ&W"‡fÇVR“°¢–b†–çWBçG—RÓÓÒv6†V6¶&÷‚r’°¢6öç7BÆ&VÂÒ–çWBæ6Æ÷6W7B‚rçFövvÆRr“òçVW'•6VÆV7F÷"‚vVÒr“°¢–b†Æ&VÂ’Æ&VÂçFW‡D6öçFVçBÒfÇVRò}	-	­	²r¢}	-
½	­	²s°¢Ð¢F†—2åöÇ•6WGF–ær†–çWBæFF6WBç6WGF–ærÂfÇVR“°¢Ð ¢ööå&ö÷D¶W–F÷vâ†WfVçB’°¢–b†WfVçBç&WVB’&WGW&ã°¢–b‡F†—2æ7F—fUf–WrÓÓÒwWw&FRrbb²srÂs"rÂs2uÒæ–æ6ÇVFW2†WfVçBæ¶W’’’°¢F†—2ç67&VVâçVW'•6VÆV7F÷$ÆÂ‚u¶FFÖ7F–öãÒ'6VÆV7B×Ww&FR%Òr•´çVÖ&W"†WfVçBæ¶W’’ÒÓòæ6Æ–6²‚“°¢&WGW&ã°¢Ð¢–b†WfVçBæ¶W’ÓÒtW66RrÇÂF†—2æ&–æF–æt6GW&R’&WGW&ã°¢–b…²w6WGF–æw2rÂw7FF—7F–72rÂv6†–WfVÖVçG2rÂv6öçG&öÇ2uÒæ–æ6ÇVFW2‡F†—2æ7F—fUf–Wr’’°¢WfVçBç&WfVçDFVfVÇB‚“°¢F†—2å÷&WGW&äg&öÕ7V'f–Wr‚“°¢ÒVÇ6R–b‡F†—2æ7F—fUf–WrÓÓÒwW6Rr’°¢WfVçBç&WfVçDFVfVÇB‚“°¢F†—2åöVÖ—B‚wV“§&W7VÖRr“°¢Ð¢Ð ¢÷6VÆV7DF–ff–7VÇG’‡fÇVR’°¢–b‚D”dd”5TÅD”U5·fÇVUÒ’&WGW&ã°¢F†—2æF–ff–7VÇG’ÒfÇVS°¢F†—2åöÇ•6WGF–ær‚vvÖWÆ’æF–ff–7VÇG’rÂfÇVRÂfÇ6R“°¢F†—2ç67&VVâçVW'•6VÆV7F÷$ÆÂ‚u¶FFÖ7F–öãÒ&F–ff–7VÇG’%Òr’æf÷$V6‚‚†'WGFöâ’Óâ'WGFöâç6WDGG&–'WFR‚v&–×&W76VBrÂ7G&–ær†'WGFöâæFF6WBçfÇVRÓÓÒfÇVR’’“°¢6öç7BFWF–ÂÒF†—2ç67&VVâçVW'•6VÆV7F÷"‚u¶FFÖF–ff–7VÇG’ÖFWF–ÅÒr“°¢–b†FWF–Â’FWF–ÂçFW‡D6öçFVçBÒD”dd”5TÅD”U5·fÇVUÕ³Ó°¢6öç7Bfö÷FW"ÒF†—2ç67&VVâçVW'•6VÆV7F÷"‚ræÖVçRÖfö÷FW"7ã¦Æ7BÖ6†–ÆBr“°¢–b†fö÷FW"’fö÷FW"çFW‡D6öçFVçBÒ	-½í¢G´D”dd”5TÅD”U5·fÇVUÕ³×Ö°¢F†—2åöVÖ—B‚wV“¦F–ff–7VÇG’rÂfÇVRÂ²F–ff–7VÇG“¢fÇVRÒ“°¢Ð ¢ö6GW&T&–æF–ær†'WGFöâÂF‚’°¢F†—2åö6æ6VÄ&–æF–æt6GW&R‚“°¢'WGFöâæ6Æ74Æ—7BæFB‚v—2ÖÆ—7FVæ–ærr“°¢6öç7BÆ&VÂÒ'WGFöâçVW'•6VÆV7F÷"‚w7âr“°¢–b†Æ&VÂ’Æ&VÂçFW‡D6öçFVçBÒ}	ÝmÍ-R­½->(
bs°¢6öç7Böä¶W’Ò†WfVçB’Óâ°¢WfVçBç&WfVçDFVfVÇB‚“°¢WfVçBç7F÷&÷vF–öâ‚“°¢–b†WfVçBæ¶W’ÓÒtW66Rr’F†—2åöÇ•6WGF–ær‡F‚ÂWfVçBæ6öFRÇÂWfVçBæ¶W’“°¢F†—2åö6æ6VÄ&–æF–æt6GW&R‚“°¢F†—2å÷&VæFW%6WGF–æw2‚“°¢Ó°¢F†—2æ&–æF–æt6GW&RÒ²'WGFöâÂöä¶W’Ó°¢v–æF÷ræFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂöä¶W’Â²6GW&S¢G'VRÂöæ6S¢G'VRÒ“°¢Ð ¢ö6æ6VÄ&–æF–æt6GW&R‚’°¢–b‚F†—2æ&–æF–æt6GW&R’&WGW&ã°¢v–æF÷rç&VÖ÷fTWfVçDÆ—7FVæW"‚v¶W–F÷vârÂF†—2æ&–æF–æt6GW&Ræöä¶W’Â²6GW&S¢G'VRÒ“°¢F†—2æ&–æF–æt6GW&Ræ'WGFöãòæ6Æ74Æ—7Bç&VÖ÷fR‚v—2ÖÆ—7FVæ–ærr“°¢F†—2æ&–æF–æt6GW&RÒçVÆÃ°¢Ð ¢÷FövvÆTgVÆÇ67&VVâ‚’°¢6öç7B&WVW7BÒFö7VÖVçBægVÆÇ67&VVäVÆVÖVçBòFö7VÖVçBæW†—DgVÆÇ67&VVãòâ‚’¢Fö7VÖVçBæFö7VÖVçDVÆVÖVçBç&WVW7DgVÆÇ67&VVãòâ‚“°¢&öÖ—6Rç&W6öÇfR‡&WVW7B’çF†Vâ‚‚’ÓâF†—2åöVÖ—B‚wV“¦gVÆÇ67&VVârÂ&ööÆVâ†Fö7VÖVçBægVÆÇ67&VVäVÆVÖVçB’’’æ6F6‚‚†W'&÷"’Óâ°¢F†—2ç6†÷uFö7B‡²G—S¢wv&æ–ærrÂF—FÆS¢}	ýí½Ý½’Ý­ÒrÂÖW76vS¢W'&÷#òæÖW76vRóò}	=}]í-­½íÝ²}ýíârÒ“°¢Ò“°¢Ð ¢ööägVÆÇ67&VVä6†ævR‚’°¢F†—2ç&ö÷BçVW'•6VÆV7F÷$ÆÂ‚u¶FFÖgVÆÇ67&VVâÖÆ&VÅÒr’æf÷$V6‚‚†æöFR’Óâ²æöFRçFW‡D6öçFVçBÒFö7VÖVçBægVÆÇ67&VVäVÆVÖVçBò}	-½-‚r¢}	-­½í}-Âs²Ò“°¢Ð ¢7–æ2÷&W6WE6WGF–æw2‚’°¢–b‚v–æF÷ræ6öæf—&Ò‚}	-]Ý=-Â-RÝ-í­‚¢}-íM­Ãòr’’&WGW&ã°¢G'’°¢v—BF†—2ç6WGF–æw4ÖævW#òç&W6WCòâ‚“°¢F†—2ç6WGF–æw2ÒFVWÖW&vR„DTdTÅEõ4UED”äu2ÂF†—2ç6WGF–æw4ÖævW#òævWE6WGF–æw3òâ‚’óòF†—2ç6WGF–æw4ÖævW#òç6WGF–æw2óò·Ò“°¢F†—2æF–ff–7VÇG’ÒvWEF‚‡F†—2ç6WGF–æw2ÂvvÖWÆ’æF–ff–7VÇG’rÂvæ÷&ÖÂr“°¢F†—2åöÇ”66W76–&–Æ—G•6WGF–æw2‚“°¢F†—2åöVÖ—B‚wV“§6WGF–ærrÂw&W6WBrÂçVÆÂÂ²&W6WC¢G'VRÒ“°¢F†—2å÷&VæFW%6WGF–æw2‚“°¢F†—2ç6†÷uFö7B‡²G—S¢w7V66W72rÂÖW76vS¢}	Ý-í­‚-í}-]Ý²¢}-íM­ÂârÒ“°¢Ò6F6‚†W'&÷"’°¢F†—2ç6†÷uFö7B‡²G—S¢wv&æ–ærrÂÖW76vS¢	ÝR=M½íÂí-ÂÝ-í­ƒ¢G¶W'&÷#òæÖW76vRóòW'&÷'ÖÒ“°¢Ð¢Ð ¢÷&W6WE6fR‚’°¢–b‚v–æF÷ræ6öæf—&Ò‚}
=M½-Â-]Âýí=]ýíM½óò
Ý-âM]--RÝ]½Í}òí-Í]Ý-Ââr’’&WGW&ã°¢F†—2åöVÖ—B‚wV“§&W6WB×6fRrÂ²–C¢F†—2ç&öf–ÆSòæ–Bóòw&–Ö'’rÒ“°¢Ð ¢÷&WGW&äg&öÕ7V'f–Wr‚’°¢–b‡F†—2ç&WGW&åf–WrÓÓÒwW6Rr’F†—2ç6†÷uW6R‚“°¢VÇ6RF†—2ç6†÷tÖ–äÖVçR‡F†—2ç&öf–ÆR“°¢Ð ¢÷&VE6WGF–æw2‚’°¢ÆWBÆöFVC°¢G'’²ÆöFVBÒF†—2ç6WGF–æw4ÖævW#òævWE6WGF–æw3òâ‚’óòF†—2ç6WGF–æw4ÖævW#òævWCòâ‚’óòF†—2ç6WGF–æw4ÖævW#òç6WGF–æw3²Ð¢6F6‚²ÆöFVBÒF†—2ç6WGF–æw4ÖævW#òç6WGF–æw3²Ð¢F†—2ç6WGF–æw2ÒFVWÖW&vR„DTdTÅEõ4UED”äu2ÂÆöFVBóòF†—2ç&öf–ÆSòç6WGF–æw2óò·Ò“°¢F†—2æF–ff–7VÇG’ÒvWEF‚‡F†—2ç6WGF–æw2ÂvvÖWÆ’æF–ff–7VÇG’rÂF†—2æF–ff–7VÇG’“°¢Ð ¢7–æ2öÇ•6WGF–ær‡F‚ÂfÇVRÂVÖ—BÒG'VR’°¢6WEF‚‡F†—2ç6WGF–æw2ÂF‚ÂfÇVR“°¢F†—2åöÇ”66W76–&–Æ—G•6WGF–æw2‚“°¢G'’°¢–b‡G—VöbF†—2ç6WGF–æw4ÖævW#òç6WBÓÓÒvgVæ7F–öâr’v—BF†—2ç6WGF–æw4ÖævW"ç6WB‡F‚ÂfÇVR“°¢VÇ6R–b‡G—VöbF†—2ç6WGF–æw4ÖævW#òç6WE6WGF–ærÓÓÒvgVæ7F–öâr’°¢6öç7B¶6FVv÷'’Âââæ¶W—5ÒÒF‚ç7Æ—B‚râr“°¢v—BF†—2ç6WGF–æw4ÖævW"ç6WE6WGF–ær†6FVv÷'’Â¶W—2æ¦ö–â‚râr’ÂfÇVR“°¢ÒVÇ6R–b‡G—VöbF†—2ç6WGF–æw4ÖævW#òçWFFRÓÓÒvgVæ7F–öâr’°¢–b‡F†—2ç6WGF–æw4ÖævW"çWFFRæÆVæwF‚ãÒ"’v—BF†—2ç6WGF–æw4ÖævW"çWFFR‡F‚ÂfÇVR“°¢VÇ6R²6öç7BF6‚Ò·Ó²6WEF‚‡F6‚ÂF‚ÂfÇVR“²v—BF†—2ç6WGF–æw4ÖævW"çWFFR‡F6‚“²Ð¢ÒVÇ6R–b‡G—VöbF†—2ç6WGF–æw4ÖævW#òçF6‚ÓÓÒvgVæ7F–öâr’°¢6öç7BF6‚Ò·Ó²6WEF‚‡F6‚ÂF‚ÂfÇVR“²v—BF†—2ç6WGF–æw4ÖævW"çF6‚‡F6‚“°¢Ð¢–b†VÖ—B’F†—2åöVÖ—B‚wV“§6WGF–ærrÂF‚ÂfÇVRÂ²F‚Â¶W“¢F‚ÂfÇVRÒ“°¢Ò6F6‚†W'&÷"’°¢F†—2ç6†÷uFö7B‡²G—S¢wv&æ–ærrÂÖW76vS¢	Ý-í­ÝRí]Ý]Ý¢G¶W'&÷#òæÖW76vRóòW'&÷'ÖÒ“°¢Ð¢Ð ¢öÇ”66W76–&–Æ—G•6WGF–æw2‚’°¢–b‚F†—2ç&ö÷B’&WGW&ã°¢F†—2ç&ö÷Bæ6Æ74Æ—7BçFövvÆR‚wV’×&VGV6VBÖÖ÷F–öârÂ&ööÆVâ†vWEF‚‡F†—2ç6WGF–æw2Âv66W76–&–Æ—G’ç&VGV6VDÖ÷F–öârÂfÇ6R’’“°¢F†—2ç&ö÷Bæ6Æ74Æ—7BçFövvÆR‚wV’Ö†–v‚Ö6öçG&7BrÂ&ööÆVâ†vWEF‚‡F†—2ç6WGF–æw2Âv66W76–&–Æ—G’æ†–v„6öçG&7BrÂfÇ6R’’“°¢F†—2ç&ö÷BæFF6WBæ6öÆ÷$ÖöFRÒvWEF‚‡F†—2ç6WGF–æw2Âv66W76–&–Æ—G’æ6öÆ÷$&Æ–æDÖöFRrÂvæöæRr“°¢F†—2ç&ö÷Bç7G–ÆRç6WE&÷W'G’‚rÒ×V’×66ÆRrÂ6Æ×†vWEF‚‡F†—2ç6WGF–æw2Âv66W76–&–Æ—G’çV•66ÆRrÂ’Âã‚Âã2’“°¢F†—2æ7&÷76†—#òç7G–ÆRç6WE&÷W'G’‚rÒÖ7&÷76†—"Ö6öÆ÷"rÂvWEF‚‡F†—2ç6WGF–æw2ÂvvÖWÆ’æ7&÷76†—$6öÆ÷"rÂr3cFcFfbr’“°¢Ð ¢ö66†VE&öf–ÆR‚’°¢&WGW&âF†—2ç6fTÖævW#òç&öf–ÆRóòF†—2ç6fTÖævW#òæ7W'&VçE&öf–ÆRóòçVÆÃ°¢Ð ¢öVÖ—B†WfVçBÂââæ&w2’°¢G'’²&WGW&âF†—2æWfVçD'W3òæVÖ—Còâ†WfVçBÂââæ&w2’óò²Ð¢6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"†µT”ÖævW%Ò	í­íí-}­G¶WfVçGÒæÂW'&÷"“°¢F†—2ç6†÷uFö7B‡²G—S¢wv&æ–ærrÂÖW76vS¢}	­íÍÝMÝRýÝý-â	ýí--í-RM]--RârÒ“°¢&WGW&â°¢Ð¢Ð ¢÷6†÷u67&VVâ†Ö&·WÂf–Wr’°¢F†—2ç67&VVâæ–ææW$…DÔÂÒÖ&·W°¢F†—2ç67&VVâæ†–FFVâÒfÇ6S°¢F†—2ç67&VVâæ6Æ74Æ—7Bç&VÖ÷fR‚v—2Ö7F—fRr“°¢F†—2ç&ö÷BæFF6WBçf–WrÒf–Ws°¢F†—2æ7F—fUf–WrÒf–Ws°¢&WVW7Dæ–ÖF–öäg&ÖR‚‚’Óâ°¢F†—2ç67&VVãòæ6Æ74Æ—7BæFB‚v—2Ö7F—fRr“°¢F†—2ç67&VVãòçVW'•6VÆV7F÷"‚u¶WFöfö7W5ÒÂ'WGFöã¦æ÷B…¶F—6&ÆVEÒ’Â·F&–æFWƒÒ#%Òr“òæfö7W2‡²&WfVçE67&öÆÃ¢G'VRÒ“°¢Ò“°¢Ð ¢ö†–FT‡VB‚’°¢–b‚F†—2æ‡VB’&WGW&ã°¢F†—2æ‡VBæ†–FFVâÒG'VS°¢F†—2æ‡VBæ6Æ74Æ—7Bç&VÖ÷fR‚v—2Ö7F—fRrÂv—2Ö7&—F–6Âr“°¢–b‡F†—2æ7&÷76†—"’F†—2æ7&÷76†—"æ†–FFVâÒG'VS°¢Ð ¢÷6WEFW‡B†¶W’ÂfÇVR’°¢6öç7BæöFRÒF†—2ç&ö÷BçVW'•6VÆV7F÷"†¶FFÖ‡VCÒ"G¶¶W—Ò%Ö“°¢–b†æöFR’æöFRçFW‡D6öçFVçBÒ7G&–ær‡fÇVRóòrr“°¢Ð ¢÷6WDÖWFW"†¶W’ÂfÇVR’°¢6öç7BæöFRÒF†—2ç&ö÷BçVW'•6VÆV7F÷"†¶FFÖÖWFW#Ò"G¶¶W—Ò%Ö“°¢–b‚æöFR’&WGW&ã°¢6öç7Bæ÷&ÖÆ—¦VBÒ6Æ×„çVÖ&W"‡fÇVR’âòçVÖ&W"‡fÇVR’ò¢çVÖ&W"‡fÇVR’“°¢æöFRç7G–ÆRç6WE&÷W'G’‚rÒ×fÇVRrÂG¶æ÷&ÖÆ—¦VB¢ÒV“°¢æöFRç&VçDVÆVÖVçCòç6WDGG&–'WFR‚v&–×fÇVVæ÷rrÂ7G&–ær„ÖF‚ç&÷VæB†æ÷&ÖÆ—¦VB¢’’“°¢Ð ¢ö6ÆV%v&æ–æuF–ÖW'2‚’°¢v–æF÷ræ6ÆV%F–ÖV÷WB‡F†—2çv&æ–æuF–ÖW"“°¢v–æF÷ræ6ÆV$–çFW'fÂ‡F†—2çv&æ–æt–çFW'fÂ“°¢F†—2çv&æ–æuF–ÖW"ÒçVÆÃ°¢F†—2çv&æ–æt–çFW'fÂÒçVÆÃ°¢Ð ¢ö†–FUv&æ–ær‚’°¢F†—2åö6ÆV%v&æ–æuF–ÖW'2‚“°¢–b‚F†—2çv&æ–ær’&WGW&ã°¢F†—2çv&æ–æræ6Æ74Æ—7Bç&VÖ÷fR‚v—2Ö7F—fRr“°¢F†—2çv&æ–æræ6Æ74Æ—7BæFB‚v—2ÖÆVf–ærr“°¢F†—2å÷G&6µF–ÖW"‡v–æF÷rç6WEF–ÖV÷WB‚‚’Óâ°¢–b‚F†—2çv&æ–ær’&WGW&ã°¢F†—2çv&æ–æræ†–FFVâÒG'VS°¢F†—2çv&æ–æræ6Æ74Æ—7Bç&VÖ÷fR‚v—2ÖÆVf–ærr“°¢ÒÂ#c’“°¢Ð ¢÷G&6µF–ÖW"‡F–ÖW"’°¢F†—2çF–ÖW'2æFB‡F–ÖW"“°¢v–æF÷rç6WEF–ÖV÷WB‚‚’ÓâF†—2çF–ÖW'2æFVÆWFR‡F–ÖW"’Â“°¢&WGW&âF–ÖW#°¢Ð ¢öVç7W&T–æ—B‚’°¢–b‚F†—2æ–æ—F–Æ—¦VB’F†—2æ–æ—B‚“°¢Ð§Ð ¦W‡÷'BFVfVÇBT”ÖævW#°