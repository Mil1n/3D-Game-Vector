const DIFFICULTIES = {
  easy: ['Синхронизация', 'Больше ресурсов и мягче темп директора.'],
  normal: ['Оперативная', 'Сбалансированный протокол Нулевой решётки.'],
  hard: ['Разрыв', 'Плотные волны, меньше ресурсов, агрессивный директор.'],
};

const MAPS = Object.freeze({
  'null-grid': {
    label: 'Нулевая решётка',
    code: '07-A',
    detail: 'Сбалансированный комплекс с перестраиваемыми мостами и укрытиями.',
  },
  'sunken-relay': {
    label: 'Затонувший ретранслятор',
    code: '12-S',
    detail: 'Прямоугольный грузовой двор с длинными прострелами и тесными контейнерными проходами.',
  },
  'sky-foundry': {
    label: 'Небесная литейная',
    code: '31-F',
    detail: 'Трёхъярусная литейная над облаками с воздушными потоками и перепадами высоты.',
  },
});

const DEFAULT_SETTINGS = Object.freeze({
  audio: { master: 0.8, music: 0.45, weapons: 0.85, effects: 0.75, environment: 0.6, ui: 0.7, muted: false },
  graphics: { quality: 'high', exposure: 1.12, resolutionScale: 1, shadows: true, shadowQuality: 'medium', antialias: true, bloom: true, particles: 'high', maxPixelRatio: 1.5, fpsLimit: 0 },
  controls: {
    mouseSensitivity: 0.55,
    invertY: false,
    rawInput: true,
    bindings: { forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', crouch: 'ControlLeft', dash: 'KeyQ', overdrive: 'KeyF', interact: 'KeyE', reload: 'KeyR' },
  },
  gameplay: { difficulty: 'normal', fov: 82, sprintFov: 92, headBob: 0.55, cameraShake: 0.65, subtitles: true, crosshairColor: '#64f4ff', aimMode: 'hold', crouchMode: 'hold' },
  accessibility: { reducedMotion: false, highContrast: false, colorBlindMode: 'none', screenFlash: 0.65, uiScale: 1 },
});

const TUTORIAL_STEPS = [
  ['ПРОТОКОЛ // 01', 'Навигация', 'Двигайтесь от отметки к активному фазовому узлу.', ['W', 'A', 'S', 'D']],
  ['ПРОТОКОЛ // 02', 'Импульс движения', 'Удерживайте спринт и совершайте рывок, чтобы сменить вектор атаки.', ['SHIFT', 'Q']],
  ['ПРОТОКОЛ // 03', 'Огневой контакт', 'Левая кнопка стреляет, правая сужает прицел. Разные платформы заряжают Momentum; F запускает готовый Overdrive.', ['ЛКМ', 'ПКМ', '1', '2', '3', '4', '5', 'F']],
  ['ПРОТОКОЛ // 04', 'Стабилизация узла', 'Подойдите к маркеру цели и удерживайте взаимодействие до завершения сканирования.', ['E']],
  ['ПРОТОКОЛ // 05', 'Сдвиг реальности', 'Магентовая метка обозначает перестраиваемые секции. До Сдвига займите безопасный маршрут.', []],
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
  if (Array.isArray(code)) return code.map((entry) => humanKey(entry)).join(' / ');
  const names = { Space: 'Пробел', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', Escape: 'Esc' };
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
    this.mapId = 'null-grid';
    this.hudState = {};
    this.options = [];
    this.lastKillfeedKey = '';
    this.lastWarningKey = '';
    this.overdriveDisplayDuration = 0;
    this.disposers = [];
    this.timers = new Set();
    this.warningTimer = null;
    this.warningInterval = null;
    this.warningHideTimer = null;
    this.hitmarkerTimer = null;
    this.bindingCapture = null;
    this.inputActivationRequested = false;
    this._onRootClick = this._onRootClick.bind(this);
    this._onRootInput = this._onRootInput.bind(this);
    this._onRootChange = this._onRootChange.bind(this);
    this._onRootKeydown = this._onRootKeydown.bind(this);
    this._onFullscreenChange = this._onFullscreenChange.bind(this);
  }

  init() {
    if (this.initialized) return this;
    if (!this.root) throw new Error('[UIManager] Контейнер #app не найден.');
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
    this.inputActivation = this.root.querySelector('[data-ui-input-activation]');
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
    return `<div class="ui-noise" aria-hidden="true"></div><div class="ui-vignette" aria-hidden="true"></div><div class="overdrive-screen-effect" aria-hidden="true"><i></i><i></i></div>
      <div class="ui-screen" data-ui-screen></div>
      <section class="hud" data-ui-hud hidden aria-label="Игровой интерфейс">
        <section class="hud-objective hud-panel" data-hud-panel="objective"><header><span data-hud="phase">ФАЗА 01</span><b>ТЕКУЩАЯ ЗАДАЧА</b></header><strong data-hud="objective">Ожидание протокола</strong><p data-hud="objective-detail">Сканирование окружения</p><div class="objective-progress"><span data-meter="objective"></span><output data-hud="objective-progress">0%</output></div></section>
        <section class="hud-anomaly hud-panel" data-hud-panel="anomaly"><div class="anomaly-radar" aria-hidden="true"><i></i><i></i><i></i></div><div><span>АНОМАЛИЯ</span><strong data-hud="anomaly">Сеть стабильна</strong></div><output data-hud="shift-countdown">СИНХРОН</output></section>
        <div class="hud-score"><div data-hud-panel="score"><span>СЧЁТ</span><strong data-hud="score">0</strong></div><div data-hud-panel="combo"><span>СЕРИЯ</span><strong data-hud="combo">×1</strong></div></div>
        <section class="momentum-card hud-panel" data-hud-panel="momentum" data-rank="D" role="meter" aria-label="Momentum" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="momentum-rank"><span>STYLE</span><strong data-hud="momentum-rank">D</strong></div><div class="momentum-readout"><header><span>MOMENTUM</span><b data-hud="momentum-multiplier">×1.00</b></header><div class="momentum-meter"><i data-meter="momentum"></i><b></b><b></b><b></b></div><div class="momentum-action"><strong data-hud="momentum-action">ДЕРЖИТЕ ТЕМП</strong><output data-hud="momentum-action-time"></output></div></div></section>
        <div class="killfeed" data-hud="killfeed" aria-live="polite" aria-label="Уведомления о ликвидациях"></div>
        <div class="damage-direction" aria-hidden="true"><i data-damage="front"></i><i data-damage="right"></i><i data-damage="back"></i><i data-damage="left"></i></div>
        <div class="interact-prompt" data-hud-panel="interact" hidden><kbd data-hud="interact-key">E</kbd><div><span data-hud="interact-action">ВЗАИМОДЕЙСТВИЕ</span><strong data-hud="interact-label">Активировать</strong></div><div class="interact-hold"><i data-meter="interact"></i></div></div>
        <div class="hud-vitals">
          <section class="vital-card vital-card--health hud-panel" data-hud-panel="health"><header><span>СОСТОЯНИЕ</span><b>HP</b></header><div><strong data-hud="health">100</strong><small>/100</small></div><div class="segmented-meter"><span data-meter="health"></span><i></i><i></i><i></i></div></section>
          <section class="vital-card vital-card--armor hud-panel" data-hud-panel="armor"><header><span>БРОНЯ</span><b>AR</b></header><div><strong data-hud="armor">0</strong><small>/100</small></div><div class="segmented-meter"><span data-meter="armor"></span><i></i><i></i><i></i></div></section>
        </div>
        <div class="hud-abilities"><section class="dash-indicator hud-panel" data-hud-panel="dash"><div class="dash-ring"><i data-meter="dash"></i><b>Q</b></div><div><span>РЫВОК</span><strong data-hud="dash">ГОТОВ</strong></div></section><section class="overdrive-indicator hud-panel" data-hud-panel="overdrive" role="status" aria-live="polite"><div class="overdrive-ring"><i data-meter="overdrive"></i><b data-hud="overdrive-key">F</b></div><div><span>OVERDRIVE</span><strong data-hud="overdrive-status">ЗАРЯД 0%</strong><small data-hud="overdrive-time"></small></div></section><div class="hud-upgrades" data-hud="upgrades" aria-label="Активные улучшения"></div></div>
        <section class="ammo-card hud-panel" data-hud-panel="ammo"><header><span data-hud="weapon">ИМПУЛЬСНЫЙ КАРАБИН</span><b>01</b></header><div class="ammo-readout"><strong data-hud="ammo">24</strong><i>/</i><span data-hud="reserve">120</span></div><footer><kbd>R</kbd><span data-hud="reload-status">ПЕРЕЗАРЯДКА</span></footer></section>
        <div class="crosshair" data-ui-crosshair data-state="default" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
        <div class="hitmarker" data-ui-hitmarker data-type="body" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      </section>
      <section class="tutorial-layer" data-ui-tutorial hidden></section>
      <section class="input-activation" data-ui-input-activation hidden role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true"><i></i>КАНАЛ ВВОДА</span><strong>Кликните по сцене, чтобы активировать управление</strong><small>После активации доступны WASD и обзор мышью</small></section>
      <section class="warning-banner" data-ui-warning hidden role="alert" aria-live="assertive"><div class="warning-chevron" aria-hidden="true">///</div><div><p>ВНИМАНИЕ // НЕСТАБИЛЬНАЯ ГЕОМЕТРИЯ</p><h2 data-warning-title>СДВИГ РЕАЛЬНОСТИ</h2><span data-warning-detail>Освободите опасную зону</span><i class="warning-progress" data-warning-bar></i></div><output data-warning-countdown>5.0</output></section>
      <section class="toast-region" data-ui-toasts aria-live="polite" aria-label="Уведомления"></section>`;
  }

  showLoading(progress = 0, text = 'Инициализация комплекса') {
    this._ensureInit();
    const value = percent(progress);
    this._hideHud();
    this._showScreen(`<main class="loading-screen" aria-labelledby="loading-title"><div class="loading-grid" aria-hidden="true"></div><div class="loading-core">
      <div class="brand-mark"><span>VECTOR</span><i>//</i><strong>NULL</strong></div><p class="eyebrow">ЗАГРУЗКА НУЛЕВОЙ РЕШЁТКИ</p><h1 id="loading-title">${escapeHTML(text)}</h1>
      <div class="loading-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value)}"><span style="--progress:${value}%"></span></div>
      <div class="loading-readout"><span>SYS.BOOT</span><output>${Math.round(value)}%</output></div><p class="loading-tip">Перестройка арены всегда предупреждается маркером и звуковым сигналом.</p>
    </div></main>`, 'loading');
  }

  showMainMenu(profile = this.profile) {
    this._ensureInit();
    this._hideWarning(true);
    this.profile = profile ?? this.profile ?? this._cachedProfile();
    if (MAPS[this.profile?.mapId]) this.mapId = this.profile.mapId;
    this._readSettings();
    this.difficulty = getPath(this.settings, 'gameplay.difficulty', this.difficulty);
    this.returnView = 'main-menu';
    this._hideHud();
    const stats = this.profile?.stats ?? {};
    const progression = this.profile?.progression ?? {};
    const tutorialCompleted = Boolean(this.profile?.tutorialCompleted);
    if (!MAPS[this.mapId]) this.mapId = 'null-grid';
    const selectedMap = MAPS[this.mapId];
    const difficultyButtons = Object.entries(DIFFICULTIES).map(([key, [label]]) =>
      `<button type="button" data-action="difficulty" data-value="${key}" aria-pressed="${key === this.difficulty}">${label}</button>`).join('');
    const mapButtons = Object.entries(MAPS).map(([id, map]) =>
      `<button class="map-option" type="button" role="radio" data-action="map" data-value="${id}" aria-checked="${id === this.mapId}"><b>${escapeHTML(map.label)}</b><small>${escapeHTML(map.code)}</small></button>`).join('');

    this._showScreen(`<main class="menu-screen" aria-labelledby="main-menu-title">
      <div class="menu-atmosphere" aria-hidden="true"><span></span><span></span><span></span></div>
      <header class="menu-topbar"><div class="system-status"><i></i><span>КОМПЛЕКС НА СВЯЗИ</span><b>07-A</b></div><button class="icon-button" type="button" data-action="fullscreen" aria-label="Полноэкранный режим" title="Полный экран">⛶</button></header>
      <section class="menu-hero"><p class="eyebrow">ЭКСПЕРИМЕНТАЛЬНЫЙ ПРОТОКОЛ // V.07</p><h1 id="main-menu-title" class="game-logo"><span>VECTOR</span><em>//</em><strong>NULL</strong></h1>
        <p class="hero-copy">Полигон меняет свою геометрию. Завершите протокол и выйдите из Нулевой решётки.</p>
        <nav class="primary-actions" aria-label="Главное меню">
          <button class="action-button action-button--primary" type="button" data-action="start" autofocus><span class="action-index">01</span><span><b>Начать забег</b><small>Стабилизировать 3 узла и эвакуироваться</small></span><i>НАЧАТЬ СЕАНС</i></button>
          <button class="action-button" type="button" data-action="tutorial"><span class="action-index">02</span><span><b>${tutorialCompleted ? 'Повторить обучение' : 'Продолжить обучение'}</b><small>Короткий интерактивный протокол</small></span><i>WASD</i></button>
        </nav>
        <section class="map-selector" aria-labelledby="map-selector-label"><div class="map-selector__meta"><span class="field-label" id="map-selector-label">ПОЛИГОН</span><p data-map-detail>${escapeHTML(selectedMap.detail)}</p></div><div class="map-options" role="radiogroup" aria-label="Выбор карты">${mapButtons}</div></section>
        <div class="difficulty-block"><div><span class="field-label">УРОВЕНЬ УГРОЗЫ</span><p data-difficulty-detail>${escapeHTML(DIFFICULTIES[this.difficulty]?.[1] ?? DIFFICULTIES.normal[1])}</p></div><div class="segmented-control" role="group" aria-label="Сложность">${difficultyButtons}</div></div>
        <nav class="secondary-actions" aria-label="Дополнительные разделы">
          <button type="button" data-action="settings"><span>Настройки</span><small>Графика и доступность</small></button>
          <button type="button" data-action="achievements"><span>Достижения</span><small>Результаты протоколов</small></button>
          <button type="button" data-action="statistics"><span>Статистика</span><small>Архив оператора</small></button>
          <button type="button" data-action="controls"><span>Управление</span><small>Движение и боевые системы</small></button>
        </nav>
      </section>
      <aside class="profile-card" aria-label="Профиль оператора"><div class="profile-card__header"><span>ОПЕРАТОР</span><b>VN-${escapeHTML(String(this.profile?.id ?? '071').slice(-3).toUpperCase())}</b></div><div class="level-orbit"><span>${formatInteger(progression.level ?? 1)}</span><small>УРОВЕНЬ</small></div><dl class="profile-metrics"><div><dt>Успешных операций</dt><dd>${formatInteger(stats.wins)}</dd></div><div><dt>Лучший счёт</dt><dd>${formatInteger(stats.bestScore)}</dd></div></dl><div class="profile-signal"><i></i><span>Профиль синхронизирован</span></div></aside>
      <footer class="menu-footer"><span>СЕАНС 07 // ПОЛИГОН НЕСТАБИЛЕН</span><span>Выбор: <b data-map-selection>${escapeHTML(selectedMap.label)}</b> // <b data-difficulty-selection>${escapeHTML(DIFFICULTIES[this.difficulty]?.[0] ?? DIFFICULTIES.normal[0])}</b></span></footer>
    </main>`, 'main-menu');

    if (!profile && this.saveManager?.load) {
      Promise.resolve(this.saveManager.load()).then((loaded) => {
        if (loaded && this.activeView === 'main-menu' && loaded !== this.profile) this.showMainMenu(loaded);
      }).catch(() => {});
    }
  }

  showHUD() {
    this._ensureInit();
    this._hideWarning(true);
    this.screen.hidden = true;
    this.screen.innerHTML = '';
    this.screen.classList.remove('is-active');
    this.hud.hidden = false;
    this.hud.classList.add('is-active');
    this.crosshair.hidden = false;
    this.root.dataset.view = 'playing';
    this.activeView = 'playing';
    this._syncInputActivation();
    return this;
  }

  showInputActivation() {
    this._ensureInit();
    this.inputActivationRequested = true;
    this._syncInputActivation();
    return this;
  }

  hideInputActivation() {
    this._ensureInit();
    this.inputActivationRequested = false;
    this._setInputActivationDisplayed(false);
    return this;
  }

  updateHUD(data = {}) {
    this._ensureInit();
    this.hudState = { ...this.hudState, ...data };
    const state = this.hudState;
    const health = finite(state.health ?? state.vitals?.health, 100);
    const maxHealth = Math.max(1, finite(state.maxHealth ?? state.vitals?.maxHealth, 100));
    const armor = finite(state.armor ?? state.vitals?.armor, 0);
    const maxArmor = Math.max(1, finite(state.maxArmor ?? state.vitals?.maxArmor, 100));
    const ammo = Math.max(0, finite(state.ammo?.current ?? state.ammo));
    const reserve = Math.max(0, finite(state.ammo?.reserve ?? state.reserve ?? state.reserveAmmo));
    this._setText('health', Math.ceil(health));
    this._setMeter('health', health / maxHealth);
    this._setText('armor', Math.ceil(armor));
    this._setMeter('armor', armor / maxArmor);
    this._setText('ammo', Math.floor(ammo));
    this._setText('reserve', Math.floor(reserve));
    const weaponName = state.weapon?.name ?? state.weapon?.label ?? state.weapon ?? 'ИМПУЛЬСНЫЙ КАРАБИН';
    this._setText('weapon', weaponName);
    const weaponLabel = this.root.querySelector('[data-hud="weapon"]');
    if (weaponLabel) {
      weaponLabel.title = String(weaponName);
      weaponLabel.setAttribute('aria-label', `Активное оружие: ${weaponName}`);
    }
    this.hud.classList.toggle('is-critical', health / maxHealth <= 0.25);
    const ammoCapacity = Math.max(1, finite(state.ammo?.capacity ?? state.magazine, 24));
    const reloading = Boolean(state.ammo?.reload ?? state.reload);
    const reloadProgress = clamp(state.ammo?.reloadProgress ?? state.reloadProgress ?? 0);
    const ammoPanel = this.root.querySelector('[data-hud-panel="ammo"]');
    ammoPanel?.classList.toggle('is-low', !reloading && ammo <= Math.max(1, Math.floor(ammoCapacity * 0.2)));
    ammoPanel?.classList.toggle('is-reloading', reloading);
    this._setText('reload-status', reloading ? `ПЕРЕЗАРЯДКА ${Math.round(reloadProgress * 100)}%` : 'ПЕРЕЗАРЯДКА');

    this._setText('objective', state.objective?.title ?? state.objective?.name ?? state.objective ?? 'Ожидание протокола');
    this._setText('objective-detail', state.objective?.detail ?? state.objectiveDetail ?? 'Сканирование окружения');
    const objectiveProgress = state.objective?.progress ?? state.progress ?? 0;
    this._setText('objective-progress', `${Math.round(percent(objectiveProgress))}%`);
    this._setMeter('objective', objectiveProgress);
    this._setText('phase', state.phase ?? 'ФАЗА 01');

    const anomaly = state.anomaly;
    const shift = anomaly?.countdown ?? anomaly?.time ?? state.shiftCountdown;
    this._setText('anomaly', anomaly?.name ?? anomaly?.title ?? (typeof anomaly === 'string' ? anomaly : 'Сеть стабильна'));
    this._setText('shift-countdown', Number.isFinite(Number(shift)) ? `${Math.max(0, Number(shift)).toFixed(Number(shift) < 10 ? 1 : 0)} с` : 'СИНХРОН');
    const anomalyPanel = this.root.querySelector('[data-hud-panel="anomaly"]');
    anomalyPanel?.classList.toggle('is-warning', Boolean(anomaly?.warning) || (Number.isFinite(Number(shift)) && Number(shift) <= 5));
    anomalyPanel?.classList.toggle('is-active', Boolean(anomaly?.active));

    const dash = state.dash;
    const dashProgress = typeof dash === 'object' ? (dash.ready ? 1 : dash.progress ?? 1 - finite(dash.cooldown) / Math.max(0.001, finite(dash.duration, 1))) : dash;
    this._setMeter('dash', dashProgress ?? 1);
    this._setText('dash', percent(dashProgress ?? 1) >= 99 ? 'ГОТОВ' : `${Math.round(percent(dashProgress ?? 0))}%`);
    this.root.querySelector('[data-hud-panel="dash"]')?.classList.toggle('is-ready', percent(dashProgress ?? 1) >= 99);
    this._setText('score', formatInteger(state.score));
    const combo = Math.max(1, finite(state.combo, 1));
    this._setText('combo', `×${combo.toFixed(combo % 1 ? 1 : 0)}`);
    this.root.querySelector('[data-hud-panel="combo"]')?.classList.toggle('is-hot', combo > 1);

    const momentum = state.momentum && typeof state.momentum === 'object' ? state.momentum : {};
    const momentumValue = clamp(
      momentum.normalized ?? momentum.progress
        ?? (finite(momentum.value ?? momentum.momentum ?? state.momentumValue ?? state.momentum, 0) / 100),
    );
    const momentumRank = String(momentum.rank ?? state.momentumRank ?? state.styleRank ?? state.rank ?? 'D').toUpperCase();
    const styleMultiplier = Math.max(1, finite(momentum.multiplier ?? state.styleMultiplier ?? state.multiplier, 1));
    const rawStyleAction = momentum.action ?? momentum.lastAction ?? state.styleAction ?? state.lastAction;
    const styleAction = rawStyleAction && typeof rawStyleAction === 'object' ? rawStyleAction : {};
    const styleActionLabel = styleAction.label ?? styleAction.name ?? momentum.actionLabel
      ?? (typeof rawStyleAction === 'string' ? rawStyleAction : '');
    const styleActionRemaining = Math.max(0, finite(
      styleAction.remaining ?? styleAction.time ?? momentum.actionRemaining ?? momentum.lastActionRemaining
        ?? state.styleActionRemaining ?? state.lastActionRemaining,
    ));
    const momentumPanel = this.root.querySelector('[data-hud-panel="momentum"]');
    momentumPanel?.setAttribute('data-rank', momentumRank);
    momentumPanel?.setAttribute('aria-valuenow', String(Math.round(momentumValue * 100)));
    this._setText('momentum-rank', momentumRank);
    this._setText('momentum-multiplier', `×${styleMultiplier.toFixed(2)}`);
    this._setMeter('momentum', momentumValue);
    this._setText('momentum-action', styleActionLabel || 'ДЕРЖИТЕ ТЕМП');
    this._setText('momentum-action-time', styleActionLabel && styleActionRemaining > 0 ? `${styleActionRemaining.toFixed(1)} с` : '');
    momentumPanel?.classList.toggle('has-action', Boolean(styleActionLabel) && styleActionRemaining > 0);

    const overdriveSource = state.overdrive ?? momentum.overdrive;
    const overdrive = overdriveSource && typeof overdriveSource === 'object' ? overdriveSource : {};
    const overdriveReady = Boolean(overdrive.ready ?? state.overdriveReady);
    const overdriveActive = Boolean(overdrive.active ?? state.overdriveActive);
    const overdriveRemaining = Math.max(0, finite(overdrive.remaining ?? state.overdriveRemaining));
    const rememberedDuration = Math.max(0, finite(this.overdriveDisplayDuration));
    const reportedDuration = Math.max(0, finite(overdrive.duration ?? overdrive.totalDuration ?? state.overdriveDuration));
    if (overdriveActive) this.overdriveDisplayDuration = Math.max(rememberedDuration, reportedDuration, overdriveRemaining);
    else this.overdriveDisplayDuration = 0;
    const overdriveDuration = Math.max(0.001, finite(this.overdriveDisplayDuration, overdriveRemaining || 1));
    const overdriveProgress = overdriveActive
      ? clamp(overdrive.progress ?? overdriveRemaining / overdriveDuration)
      : momentumValue;
    const overdriveKey = overdrive.key ?? state.overdriveKey
      ?? getPath(this.settings, 'controls.bindings.overdrive', getPath(DEFAULT_SETTINGS, 'controls.bindings.overdrive', 'KeyF'));
    const overdrivePanel = this.root.querySelector('[data-hud-panel="overdrive"]');
    this._setText('overdrive-key', humanKey(overdriveKey));
    this._setMeter('overdrive', overdriveProgress);
    this._setText('overdrive-status', overdriveActive ? 'АКТИВЕН' : overdriveReady ? 'ГОТОВ' : `ЗАРЯД ${Math.round(momentumValue * 100)}%`);
    this._setText('overdrive-time', overdriveActive ? `${overdriveRemaining.toFixed(1)} с` : overdriveReady ? `${humanKey(overdriveKey)} // АКТИВИРОВАТЬ` : '');
    overdrivePanel?.classList.toggle('is-ready', overdriveReady && !overdriveActive);
    overdrivePanel?.classList.toggle('is-active', overdriveActive);
    this.hud.classList.toggle('is-overdrive-ready', overdriveReady && !overdriveActive);
    this.hud.classList.toggle('is-overdrive-active', overdriveActive);
    this.root.classList.toggle('is-overdrive-ready', overdriveReady && !overdriveActive);
    this.root.classList.toggle('is-overdrive-active', overdriveActive);

    if (Array.isArray(state.upgrades)) this._renderHudUpgrades(state.upgrades);
    this._updateInteract(state.interact);
    if (state.crosshair !== undefined) this.setCrosshair(state.crosshair);
    if (state.hitmarker) this.setHitmarker(state.hitmarker);
    if (state.damageDirection !== undefined) this._showDamageDirection(state.damageDirection);
    if (state.killfeed !== undefined) this._updateKillfeed(state.killfeed);
    if (state.warning && typeof state.warning === 'object') {
      const warningKey = String(state.warning.id ?? `${state.warning.title}:${state.warning.detail}`);
      if (warningKey !== this.lastWarningKey) {
        this.lastWarningKey = warningKey;
        this.showWarning(state.warning.title, state.warning.detail, state.warning.seconds);
      }
    } else if (Object.hasOwn(data, 'warning')) {
      this.lastWarningKey = '';
    }
  }

  showPause() {
    this._ensureInit();
    this.hud.hidden = false;
    this.returnView = 'pause';
    this._showScreen(`<section class="overlay-screen overlay-screen--pause" role="dialog" aria-modal="true" aria-labelledby="pause-title"><article class="dialog-panel pause-panel">
      <header class="dialog-header"><p class="eyebrow">ПРОТОКОЛ ОСТАНОВЛЕН</p><h1 id="pause-title">Пауза</h1><span class="pause-status"><i></i>Симуляция зафиксирована</span></header>
      <nav class="dialog-actions" aria-label="Меню паузы">
        ${this._actionButton('01', 'Продолжить', 'Вернуться в симуляцию', 'resume', true, 'ESC')}
        ${this._actionButton('02', 'Настройки', 'Звук, графика и доступность', 'settings')}
        ${this._actionButton('03', 'Управление', 'Схема клавиш и боевых систем', 'controls')}
        ${this._actionButton('04', 'Перезапустить матч', 'Текущий прогресс будет потерян', 'restart', false, '', true)}
        <button class="text-button" type="button" data-action="menu">Выйти в главное меню</button>
      </nav><footer class="dialog-footer"><span>Время комплекса остановлено</span><span>Аудиоканал приглушён</span></footer>
    </article></section>`, 'pause');
  }

  showSettings(returnView = this.activeView === 'pause' ? 'pause' : 'main-menu') {
    this._ensureInit();
    this.returnView = returnView;
    this._readSettings();
    this._renderSettings();
  }

  showUpgrade(options = []) {
    this._ensureInit();
    this.hud.hidden = false;
    this.options = Array.isArray(options) ? options.slice(0, 3) : [];
    const cards = this.options.length ? this.options.map((option, index) => this._upgradeCard(option, index)).join('')
      : `<div class="empty-state"><b>Каталог не отвечает</b><p>Продолжение будет возобновлено после синхронизации с директором.</p></div>`;
    this._showScreen(`<section class="overlay-screen overlay-screen--upgrade" role="dialog" aria-modal="true" aria-labelledby="upgrade-title"><div class="upgrade-aura" aria-hidden="true"></div><article class="upgrade-panel">
      <header class="upgrade-header"><p class="eyebrow">СИНХРОНИЗАЦИЯ // ВЫБОР МОДУЛЯ</p><h1 id="upgrade-title">Перенаправьте вектор</h1><p>Выберите один модуль. Его эффект сохранится до конца забега.</p></header>
      <div class="upgrade-grid">${cards}</div><footer class="upgrade-footer"><span>Время комплекса замедлено</span><span>Клавиши 1—3 выбирают модуль</span></footer>
    </article></section>`, 'upgrade');
  }

  showResults(kind = 'defeat', stats = {}) {
    this._ensureInit();
    this._hideWarning(true);
    this._hideHud();
    const victory = ['victory', 'win', 'success', true].includes(kind);
    const accuracy = finite(stats.accuracy) <= 1 ? finite(stats.accuracy) * 100 : finite(stats.accuracy);
    const upgrades = Array.isArray(stats.upgrades) ? stats.upgrades : [];
    const metric = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    this._showScreen(`<main class="results-screen results-screen--${victory ? 'victory' : 'defeat'}" aria-labelledby="results-title"><div class="results-sigil" aria-hidden="true"><i></i><i></i><i></i></div><section class="results-panel">
      <header class="results-header"><p class="eyebrow">${stats.newBest ? 'НОВЫЙ РЕКОРД' : victory ? 'ПРОТОКОЛ ЗАВЕРШЁН' : 'ПРОТОКОЛ ОБОРВАН'}</p><h1 id="results-title">${victory ? 'Решётка стабилизирована' : 'Сигнал оператора потерян'}</h1><p>${victory ? 'Три фазовых узла сведены. Коридор эвакуации открыт.' : 'Решётка сохранила данные прогона. Комплекс готов к новому запуску.'}</p></header>
      <div class="result-score"><span>ИТОГОВЫЙ РЕЗУЛЬТАТ</span><strong>${formatInteger(stats.score)}</strong><small>+${formatInteger(stats.xp)} XP</small></div>
      <dl class="results-grid">${metric('Время прохождения', formatDuration(stats.duration ?? stats.time))}${metric('Ликвидации', formatInteger(stats.kills))}${metric('Попадания в голову', formatInteger(stats.headshots))}${metric('Точность', `${clamp(accuracy, 0, 100).toFixed(1)}%`)}${metric('Получено урона', formatInteger(stats.damageTaken))}${metric('Лучшая серия', `×${Math.max(1, finite(stats.bestCombo, 1)).toFixed(finite(stats.bestCombo, 1) % 1 ? 1 : 0)}`)}${metric('Лучший стиль', escapeHTML(stats.bestStyleRank ?? 'D'))}${metric('Style score', formatInteger(stats.styleScore))}${metric('Overdrive', `${formatInteger(stats.overdriveActivations)} запусков / ${finite(stats.overdriveTime).toFixed(1)} с`)}</dl>
      <section class="result-upgrades"><h2>Модули забега</h2><div>${upgrades.length ? upgrades.map((upgrade) => `<span>${escapeHTML(upgrade.name ?? upgrade.title ?? upgrade)}</span>`).join('') : '<span class="is-muted">Модули не установлены</span>'}</div></section>
      <div class="results-actions">${this._actionButton('01', 'Новый забег', 'Сформировать новый протокол', 'restart', true)}<button class="text-button" type="button" data-action="menu">В главное меню</button></div>
    </section></main>`, 'results');
  }

  showTutorial(step = 0) {
    this._ensureInit();
    const index = typeof step === 'object' ? finite(step.index) : finite(step);
    const source = typeof step === 'object' ? step : {};
    const preset = TUTORIAL_STEPS[clamp(index, 0, TUTORIAL_STEPS.length - 1)] ?? TUTORIAL_STEPS[0];
    const kicker = source.kicker ?? preset[0];
    const title = source.title ?? preset[1];
    const text = source.text ?? source.detail ?? preset[2];
    const keys = Array.isArray(source.keys) ? source.keys : preset[3];
    this.tutorial.innerHTML = `<article class="tutorial-card" role="status" aria-labelledby="tutorial-title"><div class="tutorial-progress" aria-hidden="true"><span style="--step:${percent((index + 1) / TUTORIAL_STEPS.length)}%"></span></div><div><p class="eyebrow">${escapeHTML(kicker)}</p><h2 id="tutorial-title">${escapeHTML(title)}</h2><p>${escapeHTML(text)}</p></div>${keys.length ? `<div class="key-row" aria-label="Клавиши">${keys.map((key) => `<kbd>${escapeHTML(key)}</kbd>`).join('')}</div>` : ''}<button class="text-button" type="button" data-action="skip-tutorial">Пропустить обучение</button></article>`;
    this.tutorial.hidden = false;
    requestAnimationFrame(() => this.tutorial.classList.add('is-active'));
  }

  showWarning(title = 'Предупреждение', detail = '', seconds = 5) {
    this._ensureInit();
    this._clearWarningTimers();
    const duration = Math.max(0, finite(seconds, 5));
    this.warning.querySelector('[data-warning-title]').textContent = title;
    this.warning.querySelector('[data-warning-detail]').textContent = detail;
    this.warning.querySelector('[data-warning-bar]').style.setProperty('--warning-duration', `${Math.max(0.1, duration)}s`);
    this.warning.hidden = false;
    this.warning.classList.remove('is-leaving');
    requestAnimationFrame(() => this.warning.classList.add('is-active'));
    const startedAt = performance.now();
    const output = this.warning.querySelector('[data-warning-countdown]');
    const update = () => {
      const remaining = Math.max(0, duration - (performance.now() - startedAt) / 1000);
      output.textContent = duration > 0 ? remaining.toFixed(remaining < 10 ? 1 : 0) : 'ДЕЙСТВУЕТ';
    };
    update();
    if (duration > 0) {
      this.warningInterval = window.setInterval(update, 100);
      this.warningTimer = window.setTimeout(() => this._hideWarning(), duration * 1000);
    }
  }

  showToast(message, type = 'info', duration = 3200) {
    this._ensureInit();
    const data = typeof message === 'object' ? message : { message, type, duration };
    const tone = ['info', 'success', 'warning', 'upgrade', 'kill'].includes(data.type) ? data.type : 'info';
    const toast = document.createElement('article');
    toast.className = `toast toast--${tone}`;
    toast.setAttribute('role', tone === 'warning' ? 'alert' : 'status');
    const icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = tone === 'success' || tone === 'kill' ? 'Ч' : tone === 'warning' ? '!' : tone === 'upgrade' ? '+' : 'i';
    const copy = document.createElement('div');
    if (data.title) { const title = document.createElement('b'); title.textContent = data.title; copy.append(title); }
    const text = document.createElement('span');
    text.textContent = data.message ?? data.text ?? '';
    copy.append(text);
    toast.append(icon, copy);
    this.toastRegion.append(toast);
    requestAnimationFrame(() => toast.classList.add('is-active'));
    while (this.toastRegion.children.length > 4) this.toastRegion.firstElementChild?.remove();
    const timer = window.setTimeout(() => {
      toast.classList.remove('is-active');
      toast.classList.add('is-leaving');
      this._trackTimer(window.setTimeout(() => toast.remove(), 260));
    }, Math.max(1000, finite(data.duration, duration)));
    this._trackTimer(timer);
    return toast;
  }

  showError(error, detail = '') {
    this._ensureInit();
    this._hideWarning(true);
    const payload = error && typeof error === 'object' ? error : null;
    const title = payload ? payload.title ?? 'Ошибка комплекса' : error || 'Ошибка комплекса';
    const message = payload ? payload.detail ?? payload.message ?? detail : detail;
    const code = payload?.code ?? null;
    const recoverable = payload?.recoverable === true;
    const fallbackMessage = recoverable
      ? 'Модуль безопасности остановил симуляцию. Перезапустите игру или вернитесь в меню.'
      : 'Модуль безопасности остановил симуляцию. Перезапустите игру.';
    const menuAction = recoverable
      ? '<button class="text-button" type="button" data-action="menu">Вернуться в меню</button>'
      : '';
    this._hideHud();
    this._showScreen(`<main class="error-screen" role="alertdialog" aria-modal="true" aria-labelledby="error-title"><article class="dialog-panel error-panel"><div class="error-glyph" aria-hidden="true">!</div><p class="eyebrow">НЕРЕГУЛЯРНОЕ ЗАВЕРШЕНИЕ${code ? ` // ${escapeHTML(code)}` : ''}</p><h1 id="error-title">${escapeHTML(title)}</h1><p>${escapeHTML(message || fallbackMessage)}</p><div class="error-actions">${this._actionButton('01', 'Перезапустить игру', 'Полная переинициализация', 'reload', true)}${menuAction}</div></article></main>`, 'error');
  }

  hideOverlay() {
    this._ensureInit();
    this.screen.hidden = true;
    this.screen.classList.remove('is-active');
    this.screen.innerHTML = '';
    this.tutorial.hidden = true;
    this.tutorial.classList.remove('is-active');
    this._hideWarning();
    this.root.dataset.view = this.hud.hidden ? 'idle' : 'playing';
    this.activeView = this.hud.hidden ? 'idle' : 'playing';
  }

  setCrosshair(state = 'default') {
    this._ensureInit();
    const data = typeof state === 'object' ? state : { state };
    const mode = String(data.state ?? data.mode ?? 'default');
    this.crosshair.dataset.state = mode;
    this.crosshair.hidden = data.visible === false || ['hidden', 'disabled'].includes(mode);
    if (data.color) this.crosshair.style.setProperty('--crosshair-color', data.color);
    if (Number.isFinite(Number(data.size))) this.crosshair.style.setProperty('--crosshair-size', `${clamp(data.size, 6, 42)}px`);
    if (Number.isFinite(Number(data.spread))) this.crosshair.style.setProperty('--crosshair-spread', `${clamp(data.spread, 0, 32)}px`);
    this.crosshair.classList.toggle('is-target', Boolean(data.target) || mode === 'enemy');
    this.crosshair.classList.toggle('is-interact', mode === 'interact');
  }

  setHitmarker(hit = 'body') {
    this._ensureInit();
    const data = typeof hit === 'object' ? hit : { type: hit };
    const type = String(data.type ?? (data.headshot ? 'headshot' : 'body'));
    window.clearTimeout(this.hitmarkerTimer);
    this.hitmarker.dataset.type = type;
    this.hitmarker.classList.remove('is-active');
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('is-active');
    this.hitmarkerTimer = window.setTimeout(() => this.hitmarker?.classList.remove('is-active'), clamp(data.duration ?? 130, 60, 500));
  }

  dispose() {
    if (!this.initialized) return;
    this._clearWarningTimers();
    window.clearTimeout(this.hitmarkerTimer);
    this._cancelBindingCapture();
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers.clear();
    this.disposers.splice(0).forEach((dispose) => { try { dispose(); } catch { /* foreign disposer */ } });
    this.root.removeEventListener('click', this._onRootClick);
    this.root.removeEventListener('input', this._onRootInput);
    this.root.removeEventListener('change', this._onRootChange);
    this.root.removeEventListener('keydown', this._onRootKeydown);
    document.removeEventListener('fullscreenchange', this._onFullscreenChange);
    this.root.innerHTML = '';
    this.root.classList.remove('ui-root', 'ui-high-contrast', 'ui-reduced-motion');
    this.root.style.removeProperty('--ui-scale');
    this.root.removeAttribute('data-view');
    this.initialized = false;
  }

  _renderSettings() {
    const tabs = { graphics: 'Графика', controls: 'Управление', audio: 'Звук', accessibility: 'Доступность', data: 'Данные' };
    this._showScreen(`<section class="overlay-screen overlay-screen--settings" role="dialog" aria-modal="true" aria-labelledby="settings-title"><article class="settings-panel">
      <header class="settings-header"><div><p class="eyebrow">КОНФИГУРАЦИЯ ОПЕРАТОРА</p><h1 id="settings-title">Настройки</h1></div><button class="close-button" type="button" data-action="back" aria-label="Закрыть настройки"><span aria-hidden="true">×</span><small>ESC</small></button></header>
      <div class="settings-layout"><nav class="settings-tabs" aria-label="Разделы настроек">${Object.entries(tabs).map(([key, label], index) => `<button type="button" data-settings-tab="${key}" aria-selected="${this.settingsTab === key}"><span>0${index + 1}</span>${label}</button>`).join('')}</nav><div class="settings-content" data-settings-content>${this._settingsTabMarkup(this.settingsTab)}</div></div>
      <footer class="settings-footer"><button class="text-button" type="button" data-action="reset-settings">Сбросить настройки</button><span>Изменения сохраняются автоматически</span><button class="button-compact" type="button" data-action="back">Готово</button></footer>
    </article></section>`, 'settings');
  }

  _settingsTabMarkup(tab) {
    const value = (path) => getPath(this.settings, path, getPath(DEFAULT_SETTINGS, path));
    if (tab === 'graphics') {
      return `${this._settingsHeader('VIDEO // RENDER', 'Графика', 'Профиль качества влияет на нагрузку видеокарты. Изменения применяются без перезапуска.')}
        <div class="settings-groups"><section class="settings-group"><h3>Рендер</h3>
          ${this._selectSetting('graphics.quality', 'Общее качество', 'Баланс детализации и стабильности кадров.', value('graphics.quality'), [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']])}
          ${this._rangeSetting('graphics.exposure', 'Яркость сцены', 'Экспозиция трёхмерного мира без изменения HUD.', value('graphics.exposure'), 0.7, 1.6, 0.05, 'decimal')}
          ${this._rangeSetting('graphics.resolutionScale', 'Разрешение рендера', 'Внутреннее разрешение трёхмерной сцены.', value('graphics.resolutionScale'), 0.6, 1, 0.05, 'percent')}
          ${this._rangeSetting('graphics.maxPixelRatio', 'Плотность пикселей', 'Ограничивает DPR на дисплеях высокой плотности.', value('graphics.maxPixelRatio'), 1, 2, 0.25, 'ratio')}
          ${this._selectSetting('graphics.fpsLimit', 'Ограничение FPS', 'Стабилизирует нагрузку и энергопотребление.', String(value('graphics.fpsLimit')), [['0', 'Без ограничения'], ['30', '30 FPS'], ['60', '60 FPS'], ['90', '90 FPS'], ['120', '120 FPS'], ['144', '144 FPS']])}
        </section><section class="settings-group"><h3>Эффекты</h3>
          ${this._toggleSetting('graphics.shadows', 'Тени', 'Динамические тени объектов и противников.', value('graphics.shadows'))}
          ${this._selectSetting('graphics.shadowQuality', 'Качество теней', 'Разрешение карты теней.', value('graphics.shadowQuality'), [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']])}
          ${this._toggleSetting('graphics.antialias', 'Сглаживание', 'Лёгкое сглаживание контуров.', value('graphics.antialias'))}
          ${this._toggleSetting('graphics.bloom', 'Bloom', 'Мягкое свечение энергетических объектов.', value('graphics.bloom'))}
          ${this._selectSetting('graphics.particles', 'Частицы', 'Плотность искр, взрывов и аномалий.', value('graphics.particles'), [['low', 'Мало'], ['medium', 'Средне'], ['high', 'Много']])}
        </section><section class="settings-group"><h3>Обзор</h3>
          ${this._rangeSetting('gameplay.fov', 'Угол зрения', 'Основное FOV камеры.', value('gameplay.fov'), 65, 105, 1, 'degrees')}
          ${this._rangeSetting('gameplay.sprintFov', 'FOV при спринте', 'Расширение обзора на высокой скорости.', value('gameplay.sprintFov'), 70, 110, 1, 'degrees')}
          <div class="setting-row"><div><b>Полноэкранный режим</b><p>Переключение без перезапуска страницы.</p></div><button class="button-compact" type="button" data-action="fullscreen" data-fullscreen-label>${document.fullscreenElement ? 'Выйти' : 'Включить'}</button></div>
        </section></div>`;
    }
    if (tab === 'controls') {
      const bindings = [
        ['forward', 'Движение вперёд'], ['backward', 'Движение назад'], ['left', 'Шаг влево'], ['right', 'Шаг вправо'],
        ['jump', 'Прыжок'], ['sprint', 'Спринт'], ['crouch', 'Присесть'], ['dash', 'Рывок'],
        ['overdrive', 'Активировать Overdrive'], ['interact', 'Взаимодействие'], ['reload', 'Перезарядка'],
        ['weapon1', 'Оружие 1'], ['weapon2', 'Оружие 2'], ['weapon3', 'Оружие 3'], ['weapon4', 'Оружие 4'], ['weapon5', 'Оружие 5'],
      ];
      return `${this._settingsHeader('INPUT // RESPONSE', 'Управление', 'Для новой клавиши нажмите «Изменить», затем нужную клавишу. Escape отменяет захват.')}
        <div class="settings-groups"><section class="settings-group"><h3>Мышь</h3>
          ${this._rangeSetting('controls.mouseSensitivity', 'Чувствительность', 'Скорость поворота камеры.', value('controls.mouseSensitivity'), 0.1, 1, 0.01, 'decimal')}
          ${this._toggleSetting('controls.invertY', 'Инверсия оси Y', 'Меняет направление вертикального обзора.', value('controls.invertY'))}
          ${this._toggleSetting('controls.rawInput', 'Прямой ввод', 'Минимизирует обработку указателя браузером.', value('controls.rawInput'))}
          ${this._selectSetting('gameplay.aimMode', 'Прицеливание', 'Удерживать кнопку или переключать состояние.', value('gameplay.aimMode'), [['hold', 'Удержание'], ['toggle', 'Переключение']])}
          ${this._selectSetting('gameplay.crouchMode', 'Приседание', 'Удерживать кнопку или переключать состояние.', value('gameplay.crouchMode'), [['hold', 'Удержание'], ['toggle', 'Переключение']])}
        </section><section class="settings-group settings-group--bindings"><h3>Назначение клавиш</h3>${bindings.map(([key, label]) => this._bindingSetting(`controls.bindings.${key}`, label, value(`controls.bindings.${key}`))).join('')}</section></div>`;
    }
    if (tab === 'audio') {
      return `${this._settingsHeader('AUDIO // MIX', 'Звук', 'Каналы смешиваются процедурно. Регулируйте баланс боевой информации и атмосферы.')}
        <div class="settings-groups"><section class="settings-group"><h3>Общий микс</h3>
          ${this._toggleSetting('audio.muted', 'Заглушить всё', 'Мгновенно отключает все аудиоканалы.', value('audio.muted'))}
          ${this._rangeSetting('audio.master', 'Общая громкость', 'Главный уровень всех звуков.', value('audio.master'), 0, 1, 0.01, 'percent')}
          ${this._rangeSetting('audio.music', 'Музыка', 'Адаптивный музыкальный слой.', value('audio.music'), 0, 1, 0.01, 'percent')}
          ${this._rangeSetting('audio.weapons', 'Оружие', 'Выстрелы, попадания и перезарядка.', value('audio.weapons'), 0, 1, 0.01, 'percent')}
        </section><section class="settings-group"><h3>Окружение</h3>
          ${this._rangeSetting('audio.effects', 'Эффекты', 'Взрывы, аномалии и взаимодействия.', value('audio.effects'), 0, 1, 0.01, 'percent')}
          ${this._rangeSetting('audio.environment', 'Окружение', 'Вентиляция, механизмы и пространственный фон.', value('audio.environment'), 0, 1, 0.01, 'percent')}
          ${this._rangeSetting('audio.ui', 'Интерфейс', 'Кнопки, сигналы HUD и меню.', value('audio.ui'), 0, 1, 0.01, 'percent')}
        </section></div>`;
    }
    if (tab === 'accessibility') {
      return `${this._settingsHeader('ACCESS // CLARITY', 'Доступность', 'Настройте движение и визуальные сигналы под свои потребности.')}
        <div class="settings-groups"><section class="settings-group"><h3>Движение и камера</h3>
          ${this._toggleSetting('accessibility.reducedMotion', 'Снижение движения', 'Отключает декоративные анимации и сокращает переходы.', value('accessibility.reducedMotion'))}
          ${this._rangeSetting('accessibility.uiScale', 'Размер интерфейса', 'Масштаб боевого HUD и контекстных подсказок.', value('accessibility.uiScale'), 0.8, 1.3, 0.05, 'ratio')}
          ${this._rangeSetting('gameplay.headBob', 'Покачивание камеры', 'Амплитуда камеры при движении.', value('gameplay.headBob'), 0, 1, 0.05, 'percent')}
          ${this._rangeSetting('gameplay.cameraShake', 'Тряска камеры', 'Сила импульсов от урона и взрывов.', value('gameplay.cameraShake'), 0, 1, 0.05, 'percent')}
          ${this._rangeSetting('accessibility.screenFlash', 'Экранные вспышки', 'Яркость вспышек и эффектов попадания.', value('accessibility.screenFlash'), 0, 1, 0.05, 'percent')}
          ${this._toggleSetting('gameplay.subtitles', 'Субтитры', 'Показывает речь и важные звуки.', value('gameplay.subtitles'))}
        </section><section class="settings-group"><h3>Читаемость</h3>
          ${this._toggleSetting('accessibility.highContrast', 'Повышенный контраст', 'Усиливает интерфейс и прицел.', value('accessibility.highContrast'))}
          ${this._selectSetting('accessibility.colorBlindMode', 'Цветовой режим', 'Адаптирует сигнальные цвета.', value('accessibility.colorBlindMode'), [['none', 'Без коррекции'], ['protanopia', 'Протанопия'], ['deuteranopia', 'Дейтеранопия'], ['tritanopia', 'Тританопия']])}
          <label class="setting-row setting-row--color"><div><b>Цвет прицела</b><p>Применяется сразу в игре.</p></div><input type="color" value="${escapeHTML(value('gameplay.crosshairColor'))}" data-setting="gameplay.crosshairColor" aria-label="Цвет прицела"></label>
        </section></div>`;
    }
    const updated = this.profile?.updatedAt ? new Date(this.profile.updatedAt).toLocaleString('ru-RU') : 'при следующей синхронизации';
    return `${this._settingsHeader('PROFILE // STORAGE', 'Данные', 'Профиль сохраняется локально в браузере. Сброс нельзя отменить.')}
      <div class="settings-groups"><section class="settings-group data-card"><h3>Локальный профиль</h3><dl><div><dt>Идентификатор</dt><dd>${escapeHTML(this.profile?.id ?? 'primary')}</dd></div><div><dt>Схема</dt><dd>v${escapeHTML(this.profile?.version ?? '1')}</dd></div><div><dt>Последняя запись</dt><dd>${escapeHTML(updated)}</dd></div></dl><div class="profile-signal"><i></i><span>Локальное хранилище доступно</span></div></section>
      <section class="settings-group danger-zone"><h3>Сброс профиля</h3><p>Удаляет статистику, достижения, прогрессию и отметку об обучении. Настройки вернутся к заводским.</p><button class="button-danger" type="button" data-action="reset-save">Сбросить профиль</button></section></div>`;
  }

  _settingsHeader(kicker, title, detail) {
    return `<header class="settings-section-header"><div><p class="eyebrow">${kicker}</p><h2>${title}</h2></div><p>${detail}</p></header>`;
  }

  _toggleSetting(path, label, detail, checked) {
    return `<label class="setting-row"><div><b>${label}</b><p>${detail}</p></div><span class="toggle"><input type="checkbox" data-setting="${path}" ${checked ? 'checked' : ''}><i></i><em>${checked ? 'ВКЛ' : 'ВЫКЛ'}</em></span></label>`;
  }

  _rangeSetting(path, label, detail, value, min, max, step, format) {
    return `<label class="setting-row setting-row--range"><div><b>${label}</b><p>${detail}</p></div><div class="range-control"><input type="range" min="${min}" max="${max}" step="${step}" value="${finite(value, min)}" data-setting="${path}" data-format="${format}"><output>${this._formatSettingValue(value, format)}</output></div></label>`;
  }

  _selectSetting(path, label, detail, value, options) {
    return `<label class="setting-row"><div><b>${label}</b><p>${detail}</p></div><span class="select-wrap"><select data-setting="${path}">${options.map(([key, text]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${text}</option>`).join('')}</select></span></label>`;
  }

  _bindingSetting(path, label, value) {
    return `<div class="setting-row binding-row"><div><b>${label}</b></div><button type="button" class="key-binding" data-action="bind-key" data-setting-path="${path}"><kbd>${escapeHTML(humanKey(value))}</kbd><span>Изменить</span></button></div>`;
  }

  _formatSettingValue(value, format) {
    if (format === 'percent') return `${Math.round(finite(value) * 100)}%`;
    if (format === 'degrees') return `${Math.round(finite(value))}°`;
    if (format === 'ratio') return `${finite(value).toFixed(2)}×`;
    return finite(value).toFixed(2);
  }

  _showInfoView(type) {
    const fromPause = this.activeView === 'pause' || this.returnView === 'pause';
    this.returnView = fromPause ? 'pause' : 'main-menu';
    const titles = { statistics: 'Статистика', achievements: 'Достижения', controls: 'Управление' };
    const content = type === 'statistics' ? this._statisticsMarkup() : type === 'achievements' ? this._achievementsMarkup() : this._controlsMarkup();
    this._showScreen(`<section class="overlay-screen overlay-screen--archive" role="dialog" aria-modal="true" aria-labelledby="archive-title"><article class="archive-panel"><header class="settings-header"><div><p class="eyebrow">АРХИВ // ОПЕРАТОР</p><h1 id="archive-title">${titles[type]}</h1></div><button class="close-button" type="button" data-action="back" aria-label="Закрыть"><span aria-hidden="true">×</span><small>ESC</small></button></header><div class="archive-content">${content}</div><footer class="settings-footer"><span>Данные обновляются после каждого забега</span><button class="button-compact" type="button" data-action="back">Назад</button></footer></article></section>`, type);
  }

  _statisticsMarkup() {
    const stats = this.profile?.stats ?? {};
    const runs = Math.max(0, finite(stats.runs));
    const wins = Math.max(0, finite(stats.wins));
    const cards = [
      ['Забеги', formatInteger(runs), 'Всего запущено'], ['Успешные', formatInteger(wins), `${runs ? Math.round(wins / runs * 100) : 0}% побед`],
      ['Ликвидации', formatInteger(stats.kills), 'За все протоколы'], ['Лучший счёт', formatInteger(stats.bestScore), 'Личный рекорд'],
      ['Общий счёт', formatInteger(stats.totalScore), 'Сумма очков'], ['Время в комплексе', formatDuration(stats.playTimeSeconds), 'Активное время'],
    ];
    return `<div class="stat-grid">${cards.map(([label, value, note]) => `<article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')}</div><section class="archive-note"><h2>Интерпретация</h2><p>${runs ? `Оператор завершил ${formatInteger(wins)} из ${formatInteger(runs)} зафиксированных выходов. Полная статистика хранится локально в профиле.` : 'Архив пока пуст. Завершите первый забег, чтобы открыть оперативную статистику.'}</p></section>`;
  }

  _achievementsMarkup() {
    const stats = this.profile?.stats ?? {};
    const unlocked = this.profile?.progression?.achievements ?? [];
    const unlockedIds = new Set(unlocked.map((item) => typeof item === 'string' ? item : item.id));
    const definitions = [
      ['first-run', 'Первый вектор', 'Завершить первый забег.', finite(stats.runs), 1],
      ['first-win', 'Стабильный коридор', 'Стабилизировать все три фазовых узла.', finite(stats.wins), 1],
      ['hunter', 'Охотник решётки', 'Уничтожить 100 противников.', finite(stats.kills), 100],
      ['veteran', 'Ветеран протокола', 'Завершить 10 забегов.', finite(stats.runs), 10],
      ['high-score', 'Резонанс', 'Набрать 50 000 очков за забег.', finite(stats.bestScore), 50000],
      ['unstoppable', 'Неудержимый', 'Пять раз успешно стабилизировать решётку.', finite(stats.wins), 5],
    ];
    return `<div class="achievement-grid">${definitions.map(([id, name, detail, current, target], index) => {
      const complete = unlockedIds.has(id) || current >= target;
      return `<article class="achievement ${complete ? 'is-unlocked' : ''}"><div class="achievement__icon"><span>${String(index + 1).padStart(2, '0')}</span><i style="--progress:${clamp(current / target) * 360}deg"></i></div><div><span>${complete ? 'РАЗБЛОКИРОВАНО' : `${formatInteger(current)} / ${formatInteger(target)}`}</span><h2>${name}</h2><p>${detail}</p></div></article>`;
    }).join('')}</div>`;
  }

  _controlsMarkup() {
    const binding = (name) => humanKey(getPath(this.settings, `controls.bindings.${name}`, getPath(DEFAULT_SETTINGS, `controls.bindings.${name}`)));
    const groups = [
      ['Движение', [binding('forward'), binding('left'), binding('backward'), binding('right')], 'Перемещайтесь и не задерживайтесь в открытом пространстве.'],
      ['Огневой контакт', ['ЛКМ', 'ПКМ'], 'Левая кнопка стреляет, правая включает прицеливание.'],
      ['Мобильность', [binding('jump'), binding('sprint'), binding('dash')], 'Прыжок, спринт и рывок позволяют менять вектор атаки.'],
      ['Momentum', [binding('overdrive')], 'При полной шкале активирует Overdrive и временно усиливает боевой темп.'],
      ['Взаимодействие', [binding('interact'), binding('reload')], 'Контекстное действие и перезарядка активного оружия.'],
      ['Система', ['ESC', '1', '2', '3', '4', '5'], 'Пауза и быстрая смена одного из пяти видов оружия.'],
    ];
    return `<div class="controls-grid">${groups.map(([title, keys, detail]) => `<article><div class="key-row">${keys.map((key) => `<kbd>${escapeHTML(key)}</kbd>`).join('')}</div><h2>${title}</h2><p>${detail}</p></article>`).join('')}</div><section class="archive-note"><h2>Переназначение</h2><p>Любую игровую клавишу можно изменить в разделе «Управление» настроек. Новая схема сохранится в локальном профиле.</p></section>`;
  }

  _upgradeCard(upgrade, index) {
    const rarity = String(upgrade.rarity ?? 'standard').toLowerCase();
    const rarityLabels = { common: 'СТАНДАРТ', standard: 'СТАНДАРТ', rare: 'РЕДКИЙ', epic: 'ЭПИЧЕСКИЙ', legendary: 'АНОМАЛЬНЫЙ' };
    return `<button class="upgrade-card upgrade-card--${escapeHTML(rarity)}" type="button" data-action="select-upgrade" data-upgrade-id="${escapeHTML(upgrade.id ?? index)}" data-upgrade-index="${index}" ${index === 0 ? 'autofocus' : ''}><span class="upgrade-number">0${index + 1}</span><div class="upgrade-icon" aria-hidden="true"><i></i><b>${escapeHTML(upgrade.glyph ?? ['Ч', 'Д', 'К'][index] ?? '+')}</b></div><div class="upgrade-rarity"><i></i>${escapeHTML(rarityLabels[rarity] ?? rarity.toUpperCase())}</div><h2>${escapeHTML(upgrade.name ?? upgrade.title ?? `Модуль ${index + 1}`)}</h2><p>${escapeHTML(upgrade.description ?? 'Синхронизирует параметры оператора до конца забега.')}</p><span class="upgrade-select">УСТАНОВИТЬ МОДУЛЬ <i>→</i></span></button>`;
  }

  _actionButton(index, title, detail, action, autofocus = false, key = '', danger = false) {
    return `<button class="action-button ${autofocus ? 'action-button--primary' : ''} ${danger ? 'action-button--danger' : ''}" type="button" data-action="${action}" ${autofocus ? 'autofocus' : ''}><span class="action-index">${index}</span><span><b>${title}</b><small>${detail}</small></span>${key ? `<i>${key}</i>` : ''}</button>`;
  }

  _renderHudUpgrades(upgrades) {
    const container = this.root.querySelector('[data-hud="upgrades"]');
    if (!container) return;
    container.replaceChildren(...upgrades.slice(0, 4).map((upgrade, index) => {
      const item = document.createElement('div');
      item.className = 'hud-upgrade';
      item.title = upgrade.description ?? upgrade.name ?? String(upgrade);
      const glyph = document.createElement('b'); glyph.textContent = upgrade.glyph ?? String(index + 1).padStart(2, '0');
      const label = document.createElement('span'); label.textContent = upgrade.name ?? upgrade.title ?? String(upgrade);
      item.append(glyph, label);
      return item;
    }));
  }

  _updateInteract(interact) {
    const panel = this.root.querySelector('[data-hud-panel="interact"]');
    if (!panel) return;
    if (!interact || interact.visible === false) { panel.hidden = true; return; }
    const data = typeof interact === 'string' ? { label: interact } : interact;
    panel.hidden = false;
    this._setText('interact-key', humanKey(data.key ?? 'KeyE'));
    this._setText('interact-action', data.action ?? (data.hold ? 'УДЕРЖИВАЙТЕ' : 'ВЗАИМОДЕЙСТВИЕ'));
    this._setText('interact-label', data.label ?? data.text ?? 'Активировать');
    this._setMeter('interact', data.progress ?? 0);
    panel.classList.toggle('is-holding', Boolean(data.hold));
  }

  _showDamageDirection(direction) {
    const values = Array.isArray(direction) ? direction : [direction];
    values.filter(Boolean).forEach((value) => {
      const key = typeof value === 'object' ? value.direction : value;
      const node = this.root.querySelector(`[data-damage="${String(key).toLowerCase()}"]`);
      if (!node) return;
      node.classList.remove('is-active');
      void node.offsetWidth;
      node.classList.add('is-active');
      this._trackTimer(window.setTimeout(() => node.classList.remove('is-active'), finite(value?.duration, 650)));
    });
  }

  _updateKillfeed(feed) {
    const container = this.root.querySelector('[data-hud="killfeed"]');
    if (!container) return;
    if (Array.isArray(feed)) {
      container.replaceChildren();
      feed.slice(-4).forEach((item) => this._appendKillfeed(container, item));
      return;
    }
    const key = typeof feed === 'object' ? `${feed.id ?? ''}:${feed.enemy ?? feed.target ?? feed.text}:${feed.time ?? ''}` : String(feed);
    if (key === this.lastKillfeedKey) return;
    this.lastKillfeedKey = key;
    this._appendKillfeed(container, feed);
    while (container.children.length > 4) container.firstElementChild?.remove();
  }

  _appendKillfeed(container, item) {
    const data = typeof item === 'object' ? item : { text: item };
    const node = document.createElement('div');
    node.className = `killfeed-item${data.headshot ? ' is-headshot' : ''}`;
    const marker = document.createElement('i'); marker.textContent = data.headshot ? 'Х' : 'Ч';
    const text = document.createElement('span'); text.textContent = data.text ?? `${data.enemy ?? data.target ?? 'Противник'} — ликвидирован`;
    const score = document.createElement('b'); score.textContent = data.score ? `+${formatInteger(data.score)}` : '';
    node.append(marker, text, score);
    container.append(node);
  }

  _onRootClick(event) {
    const trigger = event.target.closest('[data-action], [data-settings-tab]');
    if (!trigger || !this.root.contains(trigger)) return;
    if (trigger.dataset.settingsTab) {
      this.settingsTab = trigger.dataset.settingsTab;
      this._renderSettings();
      return;
    }
    const action = trigger.dataset.action;
    if (action === 'start') this._emit('ui:start', { difficulty: this.difficulty, mapId: this.mapId, map: this.mapId, tutorial: false, mode: 'run' });
    else if (action === 'tutorial') this._emit('ui:start', { difficulty: this.difficulty, mapId: this.mapId, map: this.mapId, tutorial: true, mode: 'tutorial', continue: true });
    else if (action === 'difficulty') this._selectDifficulty(trigger.dataset.value);
    else if (action === 'map') this._selectMap(trigger.dataset.value);
    else if (action === 'settings') this.showSettings(this.activeView === 'pause' ? 'pause' : 'main-menu');
    else if (['achievements', 'statistics', 'controls'].includes(action)) this._showInfoView(action);
    else if (action === 'resume') this._emit('ui:resume');
    else if (action === 'restart') this._emit('ui:restart');
    else if (action === 'menu') this._emit('ui:menu');
    else if (action === 'back') this._returnFromSubview();
    else if (action === 'select-upgrade') {
      const index = finite(trigger.dataset.upgradeIndex);
      const option = this.options[index] ?? { id: trigger.dataset.upgradeId };
      trigger.closest('.upgrade-grid')?.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      this._emit('ui:select-upgrade', option.id ?? trigger.dataset.upgradeId, option, index);
    } else if (action === 'skip-tutorial') {
      this.tutorial.classList.remove('is-active');
      this.tutorial.hidden = true;
      this._emit('ui:skip-tutorial');
    } else if (action === 'fullscreen') this._toggleFullscreen();
    else if (action === 'reset-settings') this._resetSettings();
    else if (action === 'reset-save') this._resetSave();
    else if (action === 'bind-key') this._captureBinding(trigger, trigger.dataset.settingPath);
    else if (action === 'reload') window.location.reload();
  }

  _onRootInput(event) {
    const input = event.target.closest('[data-setting]');
    if (!input || input.type !== 'range') return;
    if (input.nextElementSibling) input.nextElementSibling.textContent = this._formatSettingValue(input.value, input.dataset.format);
    this._applySetting(input.dataset.setting, Number(input.value));
  }

  _onRootChange(event) {
    const input = event.target.closest('[data-setting]');
    if (!input || input.type === 'range') return;
    let value = input.type === 'checkbox' ? input.checked : input.value;
    if (input.dataset.setting === 'graphics.fpsLimit') value = Number(value);
    if (input.type === 'checkbox') {
      const label = input.closest('.toggle')?.querySelector('em');
      if (label) label.textContent = value ? 'ВКЛ' : 'ВЫКЛ';
    }
    this._applySetting(input.dataset.setting, value);
  }

  _onRootKeydown(event) {
    if (event.repeat) return;
    if (this.activeView === 'upgrade' && ['1', '2', '3'].includes(event.key)) {
      this.screen.querySelectorAll('[data-action="select-upgrade"]')[Number(event.key) - 1]?.click();
      return;
    }
    if (event.key !== 'Escape' || this.bindingCapture) return;
    if (['settings', 'statistics', 'achievements', 'controls'].includes(this.activeView)) {
      event.preventDefault();
      this._returnFromSubview();
    } else if (this.activeView === 'pause') {
      event.preventDefault();
      this._emit('ui:resume');
    }
  }

  _selectDifficulty(value) {
    if (!DIFFICULTIES[value]) return;
    this.difficulty = value;
    this._applySetting('gameplay.difficulty', value, false);
    this.screen.querySelectorAll('[data-action="difficulty"]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.value === value)));
    const detail = this.screen.querySelector('[data-difficulty-detail]');
    if (detail) detail.textContent = DIFFICULTIES[value][1];
    const footer = this.screen.querySelector('[data-difficulty-selection]');
    if (footer) footer.textContent = DIFFICULTIES[value][0];
    this._emit('ui:difficulty', value, { difficulty: value });
  }

  _selectMap(value) {
    if (!MAPS[value]) return;
    this.mapId = value;
    this.screen.querySelectorAll('[data-action="map"]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.value === value));
    });
    const detail = this.screen.querySelector('[data-map-detail]');
    if (detail) detail.textContent = MAPS[value].detail;
    const footer = this.screen.querySelector('[data-map-selection]');
    if (footer) footer.textContent = MAPS[value].label;
  }

  _captureBinding(button, path) {
    this._cancelBindingCapture();
    button.classList.add('is-listening');
    const label = button.querySelector('span');
    if (label) label.textContent = 'Нажмите клавишу…';
    const onKey = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key !== 'Escape') this._applySetting(path, event.code || event.key);
      this._cancelBindingCapture();
      this._renderSettings();
    };
    this.bindingCapture = { button, onKey };
    window.addEventListener('keydown', onKey, { capture: true, once: true });
  }

  _cancelBindingCapture() {
    if (!this.bindingCapture) return;
    window.removeEventListener('keydown', this.bindingCapture.onKey, { capture: true });
    this.bindingCapture.button?.classList.remove('is-listening');
    this.bindingCapture = null;
  }

  _toggleFullscreen() {
    const request = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
    Promise.resolve(request).then(() => this._emit('ui:fullscreen', Boolean(document.fullscreenElement))).catch((error) => {
      this.showToast({ type: 'warning', title: 'Полный экран', message: error?.message ?? 'Браузер отклонил запрос.' });
    });
  }

  _onFullscreenChange() {
    this.root.querySelectorAll('[data-fullscreen-label]').forEach((node) => { node.textContent = document.fullscreenElement ? 'Выйти' : 'Включить'; });
  }

  async _resetSettings() {
    if (!window.confirm('Вернуть все настройки к заводским?')) return;
    try {
      await this.settingsManager?.reset?.();
      this.settings = deepMerge(DEFAULT_SETTINGS, this.settingsManager?.getSettings?.() ?? this.settingsManager?.settings ?? {});
      this.difficulty = getPath(this.settings, 'gameplay.difficulty', 'normal');
      this._applyAccessibilitySettings();
      this._emit('ui:setting', 'reset', null, { reset: true });
      this._renderSettings();
      this.showToast({ type: 'success', message: 'Настройки возвращены к заводским.' });
    } catch (error) {
      this.showToast({ type: 'warning', message: `Не удалось сбросить настройки: ${error?.message ?? error}` });
    }
  }

  _resetSave() {
    if (!window.confirm('Удалить весь прогресс профиля? Это действие нельзя отменить.')) return;
    this._emit('ui:reset-save', { id: this.profile?.id ?? 'primary' });
  }

  _returnFromSubview() {
    if (this.returnView === 'pause') this.showPause();
    else this.showMainMenu(this.profile);
  }

  _readSettings() {
    let loaded;
    try { loaded = this.settingsManager?.getSettings?.() ?? this.settingsManager?.get?.() ?? this.settingsManager?.settings; }
    catch { loaded = this.settingsManager?.settings; }
    this.settings = deepMerge(DEFAULT_SETTINGS, loaded ?? this.profile?.settings ?? {});
    this.difficulty = getPath(this.settings, 'gameplay.difficulty', this.difficulty);
  }

  async _applySetting(path, value, emit = true) {
    setPath(this.settings, path, value);
    this._applyAccessibilitySettings();
    try {
      if (typeof this.settingsManager?.set === 'function') await this.settingsManager.set(path, value);
      else if (typeof this.settingsManager?.setSetting === 'function') {
        const [category, ...keys] = path.split('.');
        await this.settingsManager.setSetting(category, keys.join('.'), value);
      } else if (typeof this.settingsManager?.update === 'function') {
        if (this.settingsManager.update.length >= 2) await this.settingsManager.update(path, value);
        else { const patch = {}; setPath(patch, path, value); await this.settingsManager.update(patch); }
      } else if (typeof this.settingsManager?.patch === 'function') {
        const patch = {}; setPath(patch, path, value); await this.settingsManager.patch(patch);
      }
      if (emit) this._emit('ui:setting', path, value, { path, key: path, value });
    } catch (error) {
      this.showToast({ type: 'warning', message: `Настройка не сохранена: ${error?.message ?? error}` });
    }
  }

  _applyAccessibilitySettings() {
    if (!this.root) return;
    this.root.classList.toggle('ui-reduced-motion', Boolean(getPath(this.settings, 'accessibility.reducedMotion', false)));
    this.root.classList.toggle('ui-high-contrast', Boolean(getPath(this.settings, 'accessibility.highContrast', false)));
    this.root.dataset.colorMode = getPath(this.settings, 'accessibility.colorBlindMode', 'none');
    this.root.style.setProperty('--ui-scale', clamp(getPath(this.settings, 'accessibility.uiScale', 1), 0.8, 1.3));
    this.crosshair?.style.setProperty('--crosshair-color', getPath(this.settings, 'gameplay.crosshairColor', '#64f4ff'));
  }

  _cachedProfile() {
    return this.saveManager?.profile ?? this.saveManager?.currentProfile ?? null;
  }

  _emit(event, ...args) {
    try { return this.eventBus?.emit?.(event, ...args) ?? 0; }
    catch (error) {
      console.error(`[UIManager] Ошибка обработчика ${event}.`, error);
      this.showToast({ type: 'warning', message: 'Команда не принята. Повторите действие.' });
      return 0;
    }
  }

  _showScreen(markup, view) {
    this._setInputActivationDisplayed(false);
    this.screen.innerHTML = markup;
    this.screen.hidden = false;
    this.screen.classList.remove('is-active');
    this.root.dataset.view = view;
    this.activeView = view;
    requestAnimationFrame(() => {
      this.screen?.classList.add('is-active');
      this.screen?.querySelector('[autofocus], button:not([disabled]), [tabindex="0"]')?.focus({ preventScroll: true });
    });
  }

  _hideHud() {
    if (!this.hud) return;
    this.inputActivationRequested = false;
    this._setInputActivationDisplayed(false);
    this.hud.hidden = true;
    this.hud.classList.remove('is-active', 'is-critical', 'is-overdrive-ready', 'is-overdrive-active');
    this.root.classList.remove('is-overdrive-ready', 'is-overdrive-active');
    if (this.crosshair) this.crosshair.hidden = true;
  }

  _syncInputActivation() {
    const visible = this.inputActivationRequested
      && this.activeView === 'playing'
      && this.hud?.hidden === false
      && this.screen?.hidden === true;
    this._setInputActivationDisplayed(visible);
  }

  _setInputActivationDisplayed(visible) {
    if (!this.inputActivation) return;
    this.inputActivation.hidden = !visible;
    this.inputActivation.classList.toggle('is-active', visible);
  }

  _setText(key, value) {
    const node = this.root.querySelector(`[data-hud="${key}"]`);
    if (node) node.textContent = String(value ?? '');
  }

  _setMeter(key, value) {
    const node = this.root.querySelector(`[data-meter="${key}"]`);
    if (!node) return;
    const normalized = clamp(Number(value) > 1 ? Number(value) / 100 : Number(value));
    node.style.setProperty('--value', `${normalized * 100}%`);
    node.parentElement?.setAttribute('aria-valuenow', String(Math.round(normalized * 100)));
  }

  _clearWarningTimers() {
    window.clearTimeout(this.warningTimer);
    window.clearInterval(this.warningInterval);
    window.clearTimeout(this.warningHideTimer);
    if (this.warningHideTimer !== null) this.timers.delete(this.warningHideTimer);
    this.warningTimer = null;
    this.warningInterval = null;
    this.warningHideTimer = null;
  }

  _hideWarning(immediate = false) {
    this._clearWarningTimers();
    if (!this.warning) return;
    this.warning.classList.remove('is-active');
    if (immediate) {
      this.warning.hidden = true;
      this.warning.classList.remove('is-leaving');
      return;
    }
    this.warning.classList.add('is-leaving');
    const hideTimer = window.setTimeout(() => {
      this.timers.delete(hideTimer);
      if (this.warningHideTimer === hideTimer) this.warningHideTimer = null;
      if (!this.warning) return;
      this.warning.hidden = true;
      this.warning.classList.remove('is-leaving');
    }, 260);
    this.warningHideTimer = this._trackTimer(hideTimer);
  }

  _trackTimer(timer) {
    this.timers.add(timer);
    window.setTimeout(() => this.timers.delete(timer), 10000);
    return timer;
  }

  _ensureInit() {
    if (!this.initialized) this.init();
  }
}

export default UIManager;
