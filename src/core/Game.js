import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EventBus } from './EventBus.js';
import { GameStateManager, GAME_STATES } from './GameStateManager.js';
import { SceneManager } from './SceneManager.js';
import { CameraFovController } from './CameraFovController.js';
import { CameraShakeController } from './CameraShakeController.js';
import { HitStopController } from './HitStopController.js';
import { AssetManager } from './AssetManager.js';
import { InputManager } from './InputManager.js';
import { AudioManager } from './AudioManager.js';
import { SettingsManager } from './SettingsManager.js';
import { SaveManager } from './SaveManager.js';
import { DebugManager } from './DebugManager.js';
import { Arena } from '../world/Arena.js';
import { PlayerController } from '../player/PlayerController.js';
import { WeaponSystem } from '../combat/WeaponSystem.js';
import { EnemySystem } from '../combat/EnemySystem.js';
import { EffectsSystem } from '../combat/EffectsSystem.js';
import { RunDirector } from '../systems/RunDirector.js';
import { MomentumSystem } from '../systems/MomentumSystem.js';
import { UpgradeSystem } from '../systems/UpgradeSystem.js';
import { AchievementSystem } from '../systems/AchievementSystem.js';
import { UIManager } from '../ui/UIManager.js';
import { GAME_CONFIG } from '../configs/gameConfig.js';
import { DEFAULT_MAP_ID, resolveMapId } from '../configs/mapConfigs.js';

const PLAYING_STATES = new Set([GAME_STATES.PLAYING, GAME_STATES.TUTORIAL]);
const FIXED_STEP = GAME_CONFIG.fixedTimeStep ?? 1 / 60;
const MAX_FRAME_DELTA = GAME_CONFIG.maxFrameDelta ?? 0.1;
const MAX_SUB_STEPS = GAME_CONFIG.maxSubSteps ?? 5;

const TUTORIAL_STEPS = Object.freeze([
  { title: 'НАВИГАЦИЯ', text: 'Используйте WASD, чтобы войти в решётку.', keys: ['W', 'A', 'S', 'D'] },
  { title: 'ВЕРТИКАЛЬНЫЙ ИМПУЛЬС', text: 'Нажмите или удерживайте пробел: после приземления прыжок повторится. Доступны coyote time и буфер прыжка.', keys: ['SPACE'] },
  { title: 'УКЛОНЕНИЕ', text: 'Выполните энергетический рывок или начните скольжение из спринта.', keys: ['Q', 'SHIFT + CTRL'] },
  { title: 'ОГНЕВОЙ КОНТАКТ', text: 'Стреляйте и используйте точное прицеливание.', keys: ['ЛКМ', 'ПКМ'] },
  { title: 'БОЕВОЙ ЦИКЛ', text: 'Перезаряжайтесь, меняйте платформы для Momentum и нажмите F при полном заряде Overdrive.', keys: ['R', '1', '2', '3', '4', '5', 'F'] },
  { title: 'СТАБИЛИЗАЦИЯ', text: 'Подойдите к янтарной цели и удерживайте взаимодействие.', keys: ['E'] },
  { title: 'АДАПТАЦИЯ', text: 'После награды выберите один временный модуль.', keys: ['1', '2', '3'] },
]);

class GameplayInputAdapter {
  constructor(inputManager, settingsManager) {
    this.input = inputManager;
    this.settings = settingsManager;
    this.toggled = { aim: false, crouch: false };
  }

  beginStepBatch() {
    if (this.settings.get('gameplay.aimMode', 'hold') === 'toggle' && this.input.wasPressed('aim')) {
      this.toggled.aim = !this.toggled.aim;
    }
    if (this.settings.get('gameplay.crouchMode', 'hold') === 'toggle' && this.input.wasPressed('crouch')) {
      this.toggled.crouch = !this.toggled.crouch;
    }
  }

  isDown(action) {
    if (action === 'aim' && this.settings.get('gameplay.aimMode', 'hold') === 'toggle') return this.toggled.aim;
    if (action === 'crouch' && this.settings.get('gameplay.crouchMode', 'hold') === 'toggle') return this.toggled.crouch;
    return this.input.isDown(action);
  }

  wasPressed(action) {
    return this.input.wasPressed(action);
  }

  wasReleased(action) {
    return this.input.wasReleased(action);
  }

  getAxis(negative, positive) {
    return Number(this.isDown(positive)) - Number(this.isDown(negative));
  }

  consumeLook() {
    return this.input.consumeLook();
  }

  consumeWheel() {
    return this.input.consumeWheel();
  }

  get invertY() {
    return this.input.invertY;
  }

  reset() {
    this.toggled.aim = false;
    this.toggled.crouch = false;
  }
}

function disposeDebugObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
  object.removeFromParent?.();
}

export class Game {
  constructor({ canvas, uiRoot }) {
    if (!canvas || !uiRoot) throw new Error('[Game] Canvas and UI root are required.');
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.eventBus = new EventBus({
      onError: (error, context) => console.error(`[Game/EventBus] ${context.event}`, error),
    });
    this.state = new GameStateManager({ eventBus: this.eventBus });
    this.settings = new SettingsManager({ eventBus: this.eventBus });
    this.save = new SaveManager({ eventBus: this.eventBus });
    this.assets = new AssetManager({ eventBus: this.eventBus });
    this.input = new InputManager({
      eventBus: this.eventBus,
      element: this.canvas,
      bindings: this.settings.get('controls.bindings'),
      mouseSensitivity: this.settings.get('controls.mouseSensitivity', 1),
      invertY: this.settings.get('controls.invertY', false),
    });
    this.gameplayInput = new GameplayInputAdapter(this.input, this.settings);
    this.audio = new AudioManager({
      eventBus: this.eventBus,
      volumes: this.settings.get('audio'),
      muted: this.settings.get('audio.muted', false),
    });
    this.ui = new UIManager({ eventBus: this.eventBus, settingsManager: this.settings, saveManager: this.save, uiRoot });
    this.sceneManager = null;
    this.cameraFov = null;
    this.cameraShake = null;
    this.hitStop = null;
    this.cameraFovContext = { sprinting: false, adsAmount: 0, adsFovMultiplier: 1 };
    this.world = null;
    this.arena = null;
    this.player = null;
    this.effects = null;
    this.enemies = null;
    this.weapons = null;
    this.upgrades = null;
    this.momentum = null;
    this.director = null;
    this.achievements = null;
    this.debug = null;
    this.debugLayer = null;
    this.debugRefresh = 0;
    this.matchDifficulty = this.settings.get('gameplay.difficulty', GAME_CONFIG.defaultDifficulty);
    this.matchMapId = DEFAULT_MAP_ID;
    this.matchTutorial = false;
    this.tutorialStep = 0;
    this.tutorialMovement = 0;
    this.tutorialComplete = false;
    this.running = false;
    this.disposed = false;
    this.raf = 0;
    this.lastTimestamp = 0;
    this.physicsAccumulator = 0;
    this.timeScale = 1;
    this.lowFpsTime = 0;
    this.adaptiveQualityReduced = false;
    this.lastHud = {};
    this.profileSaveTimer = 0;
    this.pointerLockWarningShown = false;
    this.unsubscribers = [];
    this._frame = (timestamp) => this.frame(timestamp);
  }

  async boot() {
    this.ui.init();
    this.ui.showLoading(0.04, 'Проверка систем комплекса');
    this.state.transition(GAME_STATES.LOADING, { reason: 'boot' });
    this.registerEvents();

    try {
      await this.save.init();
      this.ui.showLoading(0.18, 'Восстановление профиля оператора');
      const profile = await this.save.load();
      this.ui.profile = profile;

      this.ui.showLoading(0.32, 'Формирование Нулевой решётки');
      this.createSimulation();
      await this.assets.loadAll({ strict: false });

      this.ui.showLoading(0.78, 'Синхронизация боевых систем');
      this.achievements = new AchievementSystem({ eventBus: this.eventBus, saveManager: this.save });
      await this.achievements.init();
      this.createDebugManager();
      this.applySettings(this.settings.getSettings());

      this.ui.showLoading(1, 'Комплекс готов');
      this.state.transition(GAME_STATES.MAIN_MENU, { reason: 'loaded' });
      this.ui.showMainMenu(this.decorateProfile(this.save.getProfile()));
      this.positionMenuCamera();
      this.running = true;
      this.lastTimestamp = performance.now();
      this.raf = requestAnimationFrame(this._frame);
      return this;
    } catch (error) {
      console.error('[Game] Boot failed.', error);
      this.ui.showError({ title: 'Не удалось запустить комплекс', detail: error.message, code: 'BOOT_FAILURE' });
      throw error;
    }
  }

  createSimulation() {
    const settings = this.settings.getSettings();
    this.sceneManager = new SceneManager({ canvas: this.canvas, eventBus: this.eventBus, settings });
    this.cameraFov = new CameraFovController({ camera: this.sceneManager.camera, settings });
    const gravity = GAME_CONFIG.physics?.gravity ?? [0, -22, 0];
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(...gravity) });
    this.world.allowSleep = true;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = GAME_CONFIG.physics?.solverIterations ?? 10;
    this.world.solver.tolerance = 0.001;
    this.world.defaultContactMaterial.friction = GAME_CONFIG.physics?.defaultFriction ?? 0.08;
    this.world.defaultContactMaterial.restitution = 0;

    this.arena = new Arena({
      scene: this.sceneManager.scene,
      eventBus: this.eventBus,
      mapId: this.matchMapId,
      telegraphDuration: GAME_CONFIG.realityShift?.warningDuration ?? 5,
      autoApplyShifts: false,
    });
    this.arena.build(this.world);
    this.player = new PlayerController({
      world: this.world,
      eventBus: this.eventBus,
      camera: this.sceneManager.camera,
      config: GAME_CONFIG.player,
      spawn: this.arena.getSafePlayerSpawn(),
    });
    this.cameraShake = new CameraShakeController({
      camera: this.sceneManager.camera,
      eventBus: this.eventBus,
      positionProvider: () => this.player?.position,
      settings,
    });
    this.hitStop = new HitStopController({
      eventBus: this.eventBus,
      settings,
      canTrigger: () => PLAYING_STATES.has(this.state.state),
    });
    this.effects = new EffectsSystem({
      scene: this.sceneManager.scene,
      camera: this.sceneManager.camera,
      eventBus: this.eventBus,
      quality: settings.graphics.particles,
    });
    this.enemies = new EnemySystem({
      scene: this.sceneManager.scene,
      eventBus: this.eventBus,
      audioManager: this.audio,
      effects: this.effects,
      arena: this.arena,
      player: this.player,
      difficulty: this.matchDifficulty,
    });
    this.weapons = new WeaponSystem({
      camera: this.sceneManager.camera,
      scene: this.sceneManager.scene,
      eventBus: this.eventBus,
      audioManager: this.audio,
      effects: this.effects,
      arena: this.arena,
      player: this.player,
      enemySystem: this.enemies,
    });
    this.upgrades = new UpgradeSystem({ eventBus: this.eventBus });
    this.upgrades.reset({ player: this.player, weaponSystem: this.weapons });
    this.momentum = new MomentumSystem({ eventBus: this.eventBus });
    this.director = new RunDirector({
      scene: this.sceneManager.scene,
      eventBus: this.eventBus,
      arena: this.arena,
      player: this.player,
      weaponSystem: this.weapons,
      enemySystem: this.enemies,
      effects: this.effects,
      audioManager: this.audio,
      upgradeSystem: this.upgrades,
      momentumSystem: this.momentum,
    });
    this.debugLayer = new THREE.Group();
    this.debugLayer.name = 'Debug visual layer';
    this.sceneManager.scene.add(this.debugLayer);
    this.weapons.setEnabled(false);
  }

  registerEvents() {
    const on = (event, listener, options) => {
      const unsubscribe = this.eventBus.on(event, listener, options);
      this.unsubscribers.push(unsubscribe);
      return unsubscribe;
    };

    on('ui:start', (options) => void this.startMatch(options));
    on('ui:resume', () => void this.resume());
    on('ui:restart', () => void this.restartMatch());
    on('ui:menu', () => void this.returnToMenu());
    on('ui:select-upgrade', (id) => this.selectUpgrade(id));
    on('ui:skip-tutorial', () => void this.finishTutorial(true));
    on('ui:difficulty', (value, payload) => {
      this.matchDifficulty = payload?.difficulty ?? value ?? 'normal';
    });
    on('ui:setting', (path, value, payload) => {
      if (payload?.reset || path === 'reset') this.applySettings(this.settings.getSettings());
      else this.applySettings(this.settings.getSettings(), path, value);
    });
    on('ui:reset-save', async () => {
      const profile = await this.save.reset();
      this.ui.profile = profile;
      this.ui.showMainMenu(this.decorateProfile(profile));
      this.ui.showToast({ type: 'success', title: 'Профиль очищен', message: 'Статистика и достижения сброшены.' });
    });

    on('settings:changed', ({ settings }) => {
      this.applySettings(settings);
      window.clearTimeout(this.profileSaveTimer);
      this.profileSaveTimer = window.setTimeout(() => {
        void this.save.updateProfile({ settings, bindings: settings.controls.bindings }).catch((error) => {
          console.warn('[Game] Profile settings sync failed.', error);
        });
      }, 220);
    });
    on('input:pointer-lock-lost', ({ fallbackActive } = {}) => {
      if (PLAYING_STATES.has(this.state.state) && !fallbackActive) this.pause('pointer-lock');
    });
    on('input:pointer-lock-acquired', () => {
      this.ui.hideInputActivation?.();
    });
    on('input:fallback-enabled', () => {
      if (PLAYING_STATES.has(this.state.state)) this.ui.showInputActivation?.({ fallback: true });
    });
    on('input:element-activated', () => {
      this.ui.hideInputActivation?.();
    });
    on('input:pointer-lock-error', () => {
      if (this.pointerLockWarningShown || !PLAYING_STATES.has(this.state.state)) return;
      this.pointerLockWarningShown = true;
      this.ui.showToast({
        type: 'warning',
        title: 'УПРАВЛЕНИЕ БЕЗ ЗАХВАТА МЫШИ',
        message: 'Кликните по сцене: WASD — движение, обзор — перетаскиванием мыши.',
        duration: 5200,
      });
    });
    on('input:blur', () => {
      if (PLAYING_STATES.has(this.state.state)) this.pause('focus-lost');
    });

    on('director:hud', (hud) => {
      this.lastHud = { ...this.lastHud, ...hud };
      this.ui.updateHUD(this.lastHud);
    });
    on('director:interact', (interact) => {
      this.ui.updateHUD({ interact: interact ? { visible: true, label: interact.text, hold: interact.active, progress: interact.progress, key: 'KeyE' } : null });
    });
    on('director:announcement', ({ title, detail, duration }) => this.ui.showToast({ type: 'info', title, message: detail, duration: (duration ?? 2.5) * 1000 }));
    on('director:shift-warning', ({ title, detail, seconds }) => this.ui.showWarning(title, detail, seconds));
    on('director:shift-applied', ({ anomaly }) => this.ui.showToast({ type: 'upgrade', title: anomaly.name, message: anomaly.description, duration: 4200 }));
    on('director:upgrade-request', ({ options }) => this.openUpgrade(options));
    on('director:ended', (payload) => void this.finishMatch(payload));

    on('momentum:changed', ({ state }) => this.pushMomentumHUD(state));
    on('momentum:rank-changed', ({ rank, direction, state }) => {
      if (direction !== 'down') this.audio.playMomentumRank?.(rank);
      this.pushMomentumHUD(state);
    });
    on('style:action', ({ label, state }) => {
      this.pushMomentumHUD(state, label);
    });
    on('overdrive:ready', ({ state }) => {
      this.pushMomentumHUD(state);
      this.ui.showToast({
        type: 'upgrade',
        title: 'OVERDRIVE ГОТОВ',
        message: 'Нажмите F, чтобы ускорить оператора и вооружение.',
        duration: 3200,
      });
    });
    on('overdrive:activated', ({ effects, state }) => {
      this.setOverdriveEffects(true, effects, 'activated');
      this.pushMomentumHUD(state);
    });
    on('overdrive:extended', ({ state }) => this.pushMomentumHUD(state));
    on('overdrive:ended', ({ reason, state }) => {
      this.setOverdriveEffects(false, {}, reason);
      this.pushMomentumHUD(state);
    });

    on('combat:impact', (impact = {}) => {
      const type = impact.killed
        ? 'kill'
        : impact.headshot || impact.critical
          ? 'headshot'
          : 'body';
      this.ui.setHitmarker({ ...impact, type });
      this.audio?.playCombatConfirmation?.(impact);
    });
    on('enemy:killed', ({ id, type, headshot, score }) => {
      const labels = { trooper: 'Штурмовик', hunter: 'Охотник', warden: 'Страж Разлома' };
      this.ui.updateHUD({ killfeed: { id, enemy: labels[type] ?? type, headshot, score } });
    });
    on('player:damaged', ({ direction, health, armor }) => {
      this.ui.updateHUD({ damageDirection: direction, health, armor });
    });
    on('player:died', () => {
      if (this.director?.running) this.director.end(false, this.player.lastDamageCause);
    });
    on('achievement:unlocked', (achievement) => {
      this.ui.showToast({ type: 'success', title: 'ДОСТИЖЕНИЕ', message: `${achievement.name} — ${achievement.description}`, duration: 5200 });
    });

    on('player:jumped', () => this.advanceTutorialWhen(1));
    on('player:dashStarted', () => {
      this.advanceTutorialWhen(2);
      if (this.player.modifiers.dashDamageMultiplier > 1) {
        const damage = 20 * this.player.modifiers.dashDamageMultiplier;
        const hits = this.enemies.damageInRadius(this.player.position, 2.25, damage, { source: 'dash', weapon: 'impact-vector' });
        if (hits > 0) this.effects.spawnExplosion(this.player.position, 2.25, 0x5ee7ff);
      }
    });
    on('player:slideStarted', () => this.advanceTutorialWhen(2));
    on('combat:shot', () => this.advanceTutorialWhen(3));
    on('weapon:reload-start', () => this.advanceTutorialWhen(4));
    on('director:objective-complete', () => this.advanceTutorialWhen(5));
    on('upgrade:applied', () => this.advanceTutorialWhen(6, true));

    on('player:jumped', () => this.audio.playEffect('jump'));
    on('player:landed', ({ impact }) => this.audio.playEffect('land', { gain: Math.min(0.35, 0.08 + impact * 0.014) }));
    on('player:dashStarted', () => this.audio.playEffect('dash'));
    on('debug:toggle', () => { this.debugRefresh = 0; });
  }

  createDebugManager() {
    this.debug = new DebugManager({
      eventBus: this.eventBus,
      hooks: {
        toggleGodMode: (enabled) => {
          const next = typeof enabled === 'boolean' ? enabled : !this.player.invincible;
          this.player.setInvincible?.(next);
          return `god: ${next ? 'on' : 'off'}`;
        },
        infiniteAmmo: (enabled = true) => `ammo: ${this.weapons.setInfiniteAmmo(enabled) ? 'on' : 'off'}`,
        giveWeapon: (weapon = 'carbine') => {
          const index = this.weapons.weaponOrder.indexOf(String(weapon));
          if (index < 0) throw new Error(`Unknown weapon: ${weapon}`);
          this.weapons.switchTo(index);
          this.weapons.addAmmo(999, weapon);
          return `equipped: ${weapon}`;
        },
        spawnEnemy: (type = 'trooper', count = 1) => {
          const amount = THREE.MathUtils.clamp(Math.floor(Number(count) || 1), 1, 20);
          for (let index = 0; index < amount; index += 1) this.enemies.spawn(String(type));
          return `spawned ${amount} ${type}`;
        },
        killAllEnemies: () => { this.enemies.killAll(); return 'hostiles cleared'; },
        freezeAI: (enabled = true) => {
          this.enemies.aiFrozen = Boolean(enabled);
          this.eventBus.emit('debug:freeze-ai', { enabled: Boolean(enabled) });
          return `ai: ${enabled ? 'frozen' : 'active'}`;
        },
        forceShift: () => { this.director.forceShift(); return 'shift forced'; },
        completeObjective: () => { this.director.forceCompleteObjective(); return 'objective completed'; },
        teleport: (x, y, z) => { this.player.teleport(new THREE.Vector3(Number(x), Number(y), Number(z))); return `teleported: ${x}, ${y}, ${z}`; },
        restartMatch: () => { void this.restartMatch(); return 'match restarted'; },
        setTimeScale: (scale) => { this.timeScale = THREE.MathUtils.clamp(Number(scale) || 1, 0.1, 5); return `timescale: ${this.timeScale}`; },
        fillOverdrive: () => {
          const actions = ['eliteKill', 'headshot', 'slideKill', 'airKill', 'multiKill'];
          let index = 0;
          while (!this.momentum.getState().overdrive.ready && index < 100) {
            this.momentum.recordAction(actions[index % actions.length], {
              enemyType: `debug-${index % 7}`,
              weapon: this.weapons.currentId,
              count: 3,
            });
            index += 1;
          }
          return 'overdrive: ready';
        },
      },
    });
    this.debug.registerMetric('State', () => this.state.state);
    this.debug.registerMetric('Arena', () => this.arena.getMapInfo().shortName);
    this.debug.registerMetric('Accuracy', () => `${(this.weapons.getAccuracy() * 100).toFixed(1)}%`);
    this.debug.registerMetric('Camera FOV', () => this.cameraFov.getState().currentFov.toFixed(1));
    this.debug.registerMetric('Camera trauma', () => this.cameraShake.getState().trauma.toFixed(2));
    this.debug.registerMetric('Camera recoil', () => {
      const recoil = this.player.getRecoilState();
      return `${THREE.MathUtils.radToDeg(recoil.pitch).toFixed(1)}° / ${THREE.MathUtils.radToDeg(recoil.yaw).toFixed(1)}°`;
    });
    this.debug.registerMetric('Model recoil', () => this.weapons.getRecoilState().modelKick.toFixed(2));
    this.debug.registerMetric('Hit stop', () => {
      const state = this.hitStop.getState();
      if (state.active) return `${Math.ceil(state.remaining * 1000)} ms`;
      return state.lastDuration > 0 ? `last ${Math.round(state.lastDuration * 1000)} ms ×${state.triggerCount}` : 'ready';
    });
    this.debug.registerMetric('Time scale', () => this.timeScale.toFixed(2));
    this.debug.registerMetric('Momentum', () => `${this.momentum.getState().momentum.toFixed(1)} / 100`);
    this.debug.registerMetric('Style rank', () => this.momentum.getState().rank);
    this.debug.registerMetric('Overdrive', () => {
      const state = this.momentum.getState().overdrive;
      return state.active ? `${state.remaining.toFixed(1)} s` : state.ready ? 'ready' : 'charging';
    });
    this.debug.registerCommand('filloverdrive', () => this.debug.hooks.fillOverdrive(), 'charge Overdrive');
  }

  async startMatch({ difficulty = this.matchDifficulty, tutorial = false, mapId = null, map = null } = {}) {
    if (this.disposed) return;
    this.input.clear();
    this.pointerLockWarningShown = false;
    this.audio.stopAll('weapons');
    this.audio.stopAll('effects');
    void this.audio.unlock().then((ready) => {
      if (ready) {
        this.audio.startAmbience();
        this.audio.startMusic();
      }
    });
    if (![GAME_STATES.MAIN_MENU, GAME_STATES.VICTORY, GAME_STATES.DEFEAT].includes(this.state.state)) {
      this.returnToMenu({ show: false });
    }
    const nextMapId = resolveMapId(mapId ?? map ?? this.matchMapId);
    const mapChanged = nextMapId !== this.arena.mapId;
    this.matchMapId = nextMapId;
    if (mapChanged) {
      this.weapons.setEnabled(false);
      this.enemies.reset();
      this.effects.reset();
      this.arena.setMap(this.matchMapId, { rebuild: true });
    }
    void this.input.requestPointerLock(this.canvas, { rawInput: this.settings.get('controls.rawInput', true) });
    this.matchDifficulty = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
    this.matchTutorial = Boolean(tutorial);
    this.timeScale = 1;
    this.physicsAccumulator = 0;
    this.hitStop?.reset();
    this.adaptiveQualityReduced = false;
    this.lowFpsTime = 0;
    this.gameplayInput.reset();
    this.clearDebugVisuals();
    this.arena.reset();
    this.player.reset(this.arena.getSafePlayerSpawn());
    this.effects.reset();
    this.enemies.reset();
    this.enemies.setDifficulty(this.matchDifficulty);
    this.weapons.reset();
    this.resetCameraPresentation?.();
    this.weapons.setEnabled(true);
    this.upgrades.reset({ player: this.player, weaponSystem: this.weapons });
    this.momentum?.reset?.();
    this.setOverdriveEffects?.(false, {}, 'reset');
    this.director.reset({ difficulty: this.matchDifficulty, tutorial: this.matchTutorial });
    this.achievements.beginRun();
    this.lastHud = {};
    this.tutorialStep = 0;
    this.tutorialMovement = 0;
    this.tutorialComplete = !this.matchTutorial;
    this.ui.showHUD();
    this.ui.showInputActivation?.({ fallback: this.input.isFallbackActive });
    if (this.input.isPointerLocked) this.ui.hideInputActivation?.();
    this.director.start();
    const nextState = this.matchTutorial ? GAME_STATES.TUTORIAL : GAME_STATES.PLAYING;
    this.state.transition(nextState, { difficulty: this.matchDifficulty, tutorial: this.matchTutorial });
    if (mapChanged) {
      const mapInfo = this.arena.getMapInfo();
      this.ui.showToast({ type: 'info', title: mapInfo.name, message: mapInfo.description, duration: 4200 });
    }
    if (this.matchTutorial) this.showTutorialStep();
    this.input.focusElement();
  }

  pause(reason = 'manual') {
    if (!PLAYING_STATES.has(this.state.state)) return false;
    const paused = this.state.pause({ reason });
    if (!paused) return false;
    this.resetSimulationTiming();
    void this.input.exitPointerLock();
    this.input.clear();
    this.ui.showPause();
    this.resetCameraPresentation?.();
    this.audio.setVolume('master', this.settings.get('audio.master', 0.8) * 0.3);
    return true;
  }

  async resume() {
    if (!this.state.is(GAME_STATES.PAUSED)) return false;
    void this.audio.unlock();
    void this.input.requestPointerLock(this.canvas, { rawInput: this.settings.get('controls.rawInput', true) });
    const resumed = this.state.resume({ reason: 'ui' });
    if (resumed) {
      this.audio.setVolume('master', this.settings.get('audio.master', 0.8));
      this.ui.showHUD();
      this.ui.showInputActivation?.({ fallback: this.input.isFallbackActive });
      if (this.input.isPointerLocked) this.ui.hideInputActivation?.();
      if (this.director?.shift?.stage === 'warning') {
        this.ui.showWarning(
          'СДВИГ РЕАЛЬНОСТИ',
          this.director.shift.anomaly?.name ?? 'Перестройка полигона',
          Math.max(0.1, this.director.shift.remaining),
        );
      }
      if (this.matchTutorial && !this.tutorialComplete) this.showTutorialStep();
      this.input.focusElement();
    }
    return resumed;
  }

  openUpgrade(options) {
    if (![GAME_STATES.PLAYING, GAME_STATES.TUTORIAL].includes(this.state.state)) return;
    this.state.transition(GAME_STATES.UPGRADE_SELECTION, { reason: 'upgrade' });
    this.resetSimulationTiming();
    void this.input.exitPointerLock();
    this.input.clear();
    this.ui.showUpgrade(options);
    this.resetCameraPresentation?.();
    this.audio.setVolume('master', this.settings.get('audio.master', 0.8) * 0.55);
  }

  selectUpgrade(id) {
    if (!this.state.is(GAME_STATES.UPGRADE_SELECTION)) return false;
    const selected = this.director.selectUpgrade(id);
    if (!selected) return false;
    void this.audio.unlock();
    void this.input.requestPointerLock(this.canvas, { rawInput: this.settings.get('controls.rawInput', true) });
    this.state.transition(GAME_STATES.PLAYING, { reason: 'upgrade-selected', id });
    this.audio.setVolume('master', this.settings.get('audio.master', 0.8));
    this.ui.showHUD();
    this.ui.showInputActivation?.({ fallback: this.input.isFallbackActive });
    if (this.input.isPointerLocked) this.ui.hideInputActivation?.();
    if (this.matchTutorial && !this.tutorialComplete) this.showTutorialStep();
    this.input.focusElement();
    return true;
  }

  async finishMatch({ victory, cause, stats }) {
    if (![GAME_STATES.PLAYING, GAME_STATES.TUTORIAL, GAME_STATES.UPGRADE_SELECTION].includes(this.state.state)) return;
    const resultState = victory ? GAME_STATES.VICTORY : GAME_STATES.DEFEAT;
    const overdriveWasActive = this.momentum?.endOverdrive?.('match-ended') === true;
    if (!overdriveWasActive) this.setOverdriveEffects?.(false, {}, 'match-ended');
    this.state.transition(resultState, { cause });
    this.resetSimulationTiming();
    this.resetCameraPresentation?.();
    this.weapons.setEnabled(false);
    void this.input.exitPointerLock();
    this.input.clear();
    this.audio.play(victory ? 'victory' : 'defeat');
    let progress = { newBest: false };
    try {
      progress = await this.achievements.finishRun(victory, stats);
    } catch (error) {
      console.warn('[Game] Could not persist run results.', error);
      this.ui.showToast({ type: 'warning', title: 'Сохранение', message: 'Результат показан, но профиль не удалось обновить.' });
    }
    this.ui.profile = this.save.getProfile();
    this.ui.showResults(victory ? 'victory' : 'defeat', { ...stats, cause, newBest: progress.newBest });
  }

  restartMatch() {
    return this.startMatch({ difficulty: this.matchDifficulty, mapId: this.matchMapId, tutorial: false });
  }

  returnToMenu({ show = true } = {}) {
    this.resetSimulationTiming();
    if (this.director) this.director.running = false;
    this.weapons?.setEnabled(false);
    const overdriveWasActive = this.momentum?.endOverdrive?.('menu') === true;
    if (!overdriveWasActive) this.setOverdriveEffects?.(false, {}, 'menu');
    this.audio.stopAll('weapons');
    this.audio.stopAll('effects');
    this.input.clear();
    void this.input.exitPointerLock();
    if (this.state.state !== GAME_STATES.MAIN_MENU) {
      if (this.state.canTransition(GAME_STATES.MAIN_MENU)) this.state.transition(GAME_STATES.MAIN_MENU, { reason: 'menu' });
      else {
        this.state.reset({ reason: 'menu-recovery' });
        this.state.transition(GAME_STATES.LOADING);
        this.state.transition(GAME_STATES.MAIN_MENU);
      }
    }
    this.clearDebugVisuals();
    this.positionMenuCamera();
    this.audio.setVolume('master', this.settings.get('audio.master', 0.8));
    if (show) this.ui.showMainMenu(this.decorateProfile(this.save.getProfile()));
  }

  positionMenuCamera() {
    if (!this.sceneManager?.camera) return;
    this.resetCameraPresentation?.();
    const camera = this.sceneManager.camera;
    camera.position.set(20, 11, 29);
    camera.lookAt(0, 4, 0);
  }

  showTutorialStep() {
    if (!this.matchTutorial || this.tutorialComplete) return;
    const step = TUTORIAL_STEPS[this.tutorialStep];
    if (!step) {
      void this.finishTutorial(false);
      return;
    }
    this.ui.showTutorial({ index: this.tutorialStep, kicker: `ПРОТОКОЛ // ${String(this.tutorialStep + 1).padStart(2, '0')}`, ...step });
  }

  advanceTutorialWhen(expected, finish = false) {
    if (!this.matchTutorial || this.tutorialComplete || this.tutorialStep !== expected) return;
    if (finish) {
      void this.finishTutorial(false);
      return;
    }
    this.tutorialStep += 1;
    this.showTutorialStep();
  }

  async finishTutorial(skipped = false) {
    if (!this.matchTutorial || this.tutorialComplete) return;
    this.tutorialComplete = true;
    this.matchTutorial = false;
    if (this.state.is(GAME_STATES.TUTORIAL)) this.state.transition(GAME_STATES.PLAYING, { reason: skipped ? 'tutorial-skipped' : 'tutorial-complete' });
    this.ui.hideOverlay();
    this.ui.showHUD();
    this.ui.showToast({ type: 'success', title: 'ПРОТОКОЛ ОСВОЕН', message: skipped ? 'Подсказки отключены для этого прогона.' : 'Базовые системы оператора синхронизированы.' });
    try {
      await this.save.updateProfile({ tutorialComplete: true, tutorialCompleted: true });
    } catch (error) {
      console.warn('[Game] Tutorial completion was not saved.', error);
    }
  }

  applySettings(settings = this.settings.getSettings()) {
    if (!settings) return;
    this.sceneManager?.applySettings(settings);
    this.cameraFov?.applySettings(settings, { immediate: true });
    this.cameraShake?.applySettings(settings);
    this.hitStop?.applySettings(settings);
    this.player?.setRecoilIntensity(settings.gameplay.weaponRecoil, settings.accessibility.reducedMotion);
    this.weapons?.setRecoilIntensity(settings.gameplay.weaponRecoil, settings.accessibility.reducedMotion);
    this.input.setBindings(settings.controls.bindings, { replace: true, silent: true });
    this.input.setMouseOptions({ sensitivity: settings.controls.mouseSensitivity, invertY: settings.controls.invertY });
    this.player?.setHeadBobEnabled(settings.gameplay.headBob && !settings.accessibility.reducedMotion);
    this.audio.setVolumes(settings.audio);
    this.audio.setMuted(settings.audio.muted);
    document.documentElement.style.setProperty('--ui-scale', String(settings.accessibility.uiScale ?? 1));
    document.documentElement.style.setProperty('--crosshair-color', settings.gameplay.crosshairColor);
  }

  decorateProfile(profile = {}) {
    return {
      ...profile,
      achievementsCatalog: this.achievements?.getCatalog?.() ?? [],
      difficulty: this.matchDifficulty,
      mapId: this.matchMapId,
    };
  }

  frame(timestamp) {
    if (!this.running || this.disposed) return;
    this.raf = requestAnimationFrame(this._frame);
    const fpsLimit = Number(this.settings.get('graphics.fpsLimit', 0));
    if (fpsLimit > 0 && timestamp - this.lastTimestamp < 1000 / fpsLimit - 0.35) return;
    const realDelta = Math.min(MAX_FRAME_DELTA, Math.max(0, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;
    const playing = PLAYING_STATES.has(this.state.state);
    const hitStopMultiplier = playing ? (this.hitStop?.update(realDelta) ?? 1) : 1;
    const delta = realDelta * this.timeScale * hitStopMultiplier;
    const presentationDelta = realDelta * hitStopMultiplier;

    try {
      this.cameraShake?.restoreCamera();
      if (playing) this.updateGameplay(delta, { hitStopped: hitStopMultiplier < 1 });
      if ([GAME_STATES.PLAYING, GAME_STATES.TUTORIAL, GAME_STATES.PAUSED, GAME_STATES.UPGRADE_SELECTION].includes(this.state.state)) {
        this.player?.update(this.sceneManager.camera, PLAYING_STATES.has(this.state.state) ? presentationDelta : 0);
      }
      if (PLAYING_STATES.has(this.state.state)) this.updateCameraFov(presentationDelta);
      this.updateAudioListener();
      if (PLAYING_STATES.has(this.state.state)) this.cameraShake?.update(realDelta);
      this.updateDebug(realDelta);
      const stats = this.sceneManager.render(realDelta);
      this.updateAdaptiveQuality(realDelta, stats.fps);
    } catch (error) {
      this.handleRuntimeError(error);
    }
  }

  updateGameplay(delta, { hitStopped = false } = {}) {
    if (this.input.wasPressed('pause')) {
      this.pause('manual');
      this.input.endFrame();
      return;
    }
    if (hitStopped && delta <= 0) {
      this.physicsAccumulator = 0;
      return;
    }
    this.physicsAccumulator = Math.min(FIXED_STEP * MAX_SUB_STEPS, this.physicsAccumulator + delta);
    let steps = 0;
    if (this.physicsAccumulator >= FIXED_STEP) {
      this.gameplayInput.beginStepBatch();
      if (this.gameplayInput.wasPressed('overdrive')) this.momentum?.activateOverdrive?.();
    }
    while (this.physicsAccumulator >= FIXED_STEP && steps < MAX_SUB_STEPS && PLAYING_STATES.has(this.state.state)) {
      const momentumState = this.momentum?.getState?.();
      const worldTimeScale = momentumState?.overdrive?.active
        ? Number(this.momentum.config?.overdrive?.effects?.worldTimeScale ?? 0.86)
        : 1;
      const worldDelta = FIXED_STEP * THREE.MathUtils.clamp(worldTimeScale, 0.5, 1);
      this.player.fixedUpdate(this.gameplayInput, FIXED_STEP);
      this.world.step(FIXED_STEP);
      this.weapons.update(FIXED_STEP, this.gameplayInput);
      this.enemies.update(worldDelta);
      this.director.update(worldDelta, this.gameplayInput);
      this.effects.update(FIXED_STEP);
      this.arena.update(worldDelta, this.player.position);
      this.momentum?.update?.(FIXED_STEP, {
        moving: this.player.horizontalSpeed > 0.35,
        speed: this.player.horizontalSpeed,
      });
      this.physicsAccumulator = Math.max(0, this.physicsAccumulator - FIXED_STEP);
      steps += 1;
      if (this.hitStop?.active) {
        const discardedSimulationTime = this.physicsAccumulator;
        this.physicsAccumulator = 0;
        if (discardedSimulationTime > 0 && this.timeScale > 0) {
          const playableFraction = this.hitStop.update(discardedSimulationTime / this.timeScale);
          this.physicsAccumulator = discardedSimulationTime * playableFraction;
        }
        break;
      }
    }
    if (steps > 0) this.input.endFrame();

    if (this.matchTutorial && !this.tutorialComplete && this.tutorialStep === 0) {
      this.tutorialMovement += this.player.horizontalSpeed > 0.8 ? delta : -delta * 0.4;
      this.tutorialMovement = Math.max(0, this.tutorialMovement);
      if (this.tutorialMovement >= 1.1) {
        this.tutorialStep = 1;
        this.showTutorialStep();
      }
    }
    if (this.player.position.y < -8) {
      this.player.damage(24, { source: 'arena', cause: 'Падение за пределы решётки', bypassArmor: true });
      this.player.teleport(this.arena.getSafePlayerSpawn());
    }
  }

  updateCameraFov(deltaSeconds) {
    if (!this.cameraFov) return undefined;
    const context = this.cameraFovContext ??= {
      sprinting: false,
      adsAmount: 0,
      adsFovMultiplier: 1,
    };
    const readsIntent = typeof this.gameplayInput?.isDown === 'function';
    const sprintIntent = !readsIntent || this.gameplayInput.isDown('sprint');
    const aimIntent = !readsIntent || this.gameplayInput.isDown('aim');
    context.sprinting = Boolean(this.player?.isSprinting && sprintIntent);
    context.adsAmount = aimIntent ? Number(this.weapons?.adsAmount ?? 0) : 0;
    context.adsFovMultiplier = Number(this.weapons?.currentConfig?.adsFovMultiplier ?? 1);
    return this.cameraFov.update(deltaSeconds, context);
  }

  resetCameraPresentation() {
    this.cameraShake?.reset();
    this.player?.resetRecoil?.();
    this.weapons?.clearModelRecoil?.();
    return this.cameraFov?.reset();
  }

  resetSimulationTiming() {
    this.physicsAccumulator = 0;
    this.weapons?.clearInputBuffer?.();
    return this.hitStop?.reset();
  }

  pushMomentumHUD(state = this.momentum?.getState?.(), actionLabel = null) {
    if (!state) return;
    const duration = Number(this.momentum?.config?.overdrive?.duration ?? 8);
    const momentum = {
      ...state,
      normalized: THREE.MathUtils.clamp(Number(state.momentum ?? 0) / 100, 0, 1),
      actionLabel: actionLabel ?? state.lastAction ?? null,
      actionRemaining: Number(state.lastActionRemaining ?? 0),
    };
    const overdrive = {
      ...state.overdrive,
      duration,
      key: this.settings.get('controls.bindings.overdrive', 'KeyF'),
    };
    this.lastHud = { ...this.lastHud, momentum, overdrive };
    this.ui.updateHUD(this.lastHud);
  }

  setOverdriveEffects(active, effects = {}, reason = 'manual') {
    const enabled = Boolean(active);
    const wasEnabled = Boolean(this.player?.overdriveActive || this.weapons?.runtimeModifiers?.overdrive);
    this.player?.setOverdrive?.(enabled, effects);
    this.weapons?.setOverdrive?.(enabled, effects);
    this.audio?.setOverdriveActive?.(enabled, {
      cue: enabled || (wasEnabled && reason !== 'reset' && reason !== 'menu'),
    });
    if (
      this.effects?.spawnOverdrivePulse
      && this.player?.position
      && (enabled || wasEnabled)
      && reason !== 'reset'
      && reason !== 'menu'
    ) {
      this.effects.spawnOverdrivePulse(this.player.position, enabled ? 'start' : 'end', enabled ? 1.2 : 0.8);
    }
  }

  updateAudioListener() {
    if (!this.audio.ready || !this.sceneManager?.camera) return;
    const position = new THREE.Vector3();
    const forward = new THREE.Vector3();
    this.sceneManager.camera.getWorldPosition(position);
    this.sceneManager.camera.getWorldDirection(forward);
    this.audio.setListener(position, forward);
  }

  updateAdaptiveQuality(dt, fps) {
    if (!PLAYING_STATES.has(this.state.state) || !Number.isFinite(fps) || fps <= 0) return;
    this.lowFpsTime = fps < 42 ? this.lowFpsTime + dt : Math.max(0, this.lowFpsTime - dt * 0.5);
    if (this.lowFpsTime > 8 && !this.adaptiveQualityReduced && this.settings.get('graphics.particles') !== 'low') {
      this.adaptiveQualityReduced = true;
      this.effects.quality = 'low';
      this.ui.showToast({ type: 'warning', title: 'АДАПТИВНОЕ КАЧЕСТВО', message: 'Плотность вторичных частиц временно снижена. Пользовательские настройки не изменены.', duration: 5200 });
    }
  }

  updateDebug(dt) {
    if (!this.debug) return;
    this.debug.update(dt, {
      renderer: this.sceneManager.renderer,
      scene: this.sceneManager.scene,
      player: this.player,
      enemySystem: this.enemies,
      effectsSystem: this.effects,
      particles: this.effects,
      director: this.director.getDebugData(),
      aiState: this.enemies.getNearestAIState(),
      anomaly: this.director.currentAnomaly?.name ?? 'none',
    });
    this.debugRefresh -= dt;
    if (this.debug.visible && this.debugRefresh <= 0) {
      this.debugRefresh = 0.24;
      this.refreshDebugVisuals();
    } else if (!this.debug.visible && this.debugLayer?.children.length) {
      this.clearDebugVisuals();
    }
  }

  clearDebugVisuals() {
    if (!this.debugLayer) return;
    for (const child of [...this.debugLayer.children]) disposeDebugObject(child);
  }

  refreshDebugVisuals() {
    this.clearDebugVisuals();
    const toggles = this.debug.toggles;
    const arenaData = this.arena.getDebugData();
    const enemyData = this.enemies.getDebugData();
    const addMarker = (position, color, size = 0.25) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(size, 7, 5),
        new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false }),
      );
      marker.position.copy(position);
      marker.renderOrder = 100;
      this.debugLayer.add(marker);
    };
    const addLine = (points, color) => {
      if (points.length < 2) return;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
      line.renderOrder = 100;
      this.debugLayer.add(line);
    };

    if (toggles.spawns) {
      arenaData.playerSpawns.forEach((position) => addMarker(position, 0x55ff9a, 0.38));
      arenaData.enemySpawns.forEach((position) => addMarker(position, 0xff4d72, 0.3));
    }
    if (toggles.navigationNodes) {
      arenaData.waypoints.forEach((node) => addMarker(node.position, node.enabled ? 0x5ee7ff : 0x555555, 0.18));
      const map = new Map(arenaData.waypoints.map((node) => [node.id, node.position]));
      const points = [];
      arenaData.edges.filter((edge) => edge.enabled).forEach((edge) => {
        if (map.get(edge.a) && map.get(edge.b)) points.push(map.get(edge.a), map.get(edge.b));
      });
      addLine(points, 0x2c8491);
    }
    if (toggles.objectiveZones && this.director.objective) {
      const segments = 40;
      const points = [];
      const center = this.director.objective.position;
      const radius = this.director.objective.radius ?? 3;
      for (let index = 0; index < segments; index += 1) {
        const a = index / segments * Math.PI * 2;
        const b = (index + 1) / segments * Math.PI * 2;
        points.push(
          new THREE.Vector3(center.x + Math.cos(a) * radius, center.y + 0.12, center.z + Math.sin(a) * radius),
          new THREE.Vector3(center.x + Math.cos(b) * radius, center.y + 0.12, center.z + Math.sin(b) * radius),
        );
      }
      addLine(points, 0xffc857);
    }
    if (toggles.enemyRoutes) {
      const points = [];
      enemyData.forEach((enemy) => points.push(enemy.position.clone().add(new THREE.Vector3(0, 1, 0)), enemy.target.clone().add(new THREE.Vector3(0, 1, 0))));
      addLine(points, 0xff8a3d);
    }
    if (toggles.lineOfSight) {
      const points = [];
      enemyData.forEach((enemy) => points.push(enemy.position.clone().add(new THREE.Vector3(0, 1.5, 0)), this.player.position.clone().add(new THREE.Vector3(0, 1, 0))));
      addLine(points, 0xff4d72);
    }
    if (toggles.hitboxes) {
      for (const enemy of this.enemies.enemies.filter((entry) => !entry.dead)) {
        for (const mesh of enemy.hitMeshes) {
          const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(mesh), mesh.userData.hitZone === 'head' ? 0xffef75 : 0xff4d72);
          helper.material.depthTest = false;
          helper.renderOrder = 100;
          this.debugLayer.add(helper);
        }
      }
    }
    if (toggles.colliders) {
      for (const body of this.arena.staticBodies) {
        body.shapes.forEach((shape, index) => {
          let geometry;
          if (shape.halfExtents) geometry = new THREE.BoxGeometry(shape.halfExtents.x * 2, shape.halfExtents.y * 2, shape.halfExtents.z * 2);
          else if (shape.radius) geometry = new THREE.SphereGeometry(shape.radius, 8, 6);
          else return;
          const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x5ee7ff, wireframe: true, depthTest: false, transparent: true, opacity: 0.42 }));
          const offset = body.shapeOffsets[index];
          mesh.position.set(body.position.x + offset.x, body.position.y + offset.y, body.position.z + offset.z);
          mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
          mesh.renderOrder = 99;
          this.debugLayer.add(mesh);
        });
      }
    }
  }

  handleRuntimeError(error) {
    console.error('[Game] Runtime failure.', error);
    const overdriveWasActive = this.momentum?.endOverdrive?.('runtime-error') === true;
    if (!overdriveWasActive) this.setOverdriveEffects?.(false, {}, 'runtime-error');
    this.resetSimulationTiming?.();
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resetCameraPresentation?.();
    this.ui.showError({ title: 'Симуляция остановлена', detail: error.message, code: 'RUNTIME_FAILURE' });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.profileSaveTimer);
    const overdriveWasActive = this.momentum?.endOverdrive?.('dispose') === true;
    if (!overdriveWasActive) this.setOverdriveEffects?.(false, {}, 'dispose');
    this.resetSimulationTiming?.();
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers.length = 0;
    this.clearDebugVisuals();
    this.debug?.dispose();
    this.achievements?.dispose();
    this.momentum?.dispose?.();
    this.director?.dispose();
    this.weapons?.dispose();
    this.enemies?.dispose();
    this.effects?.dispose();
    this.player?.dispose();
    this.arena?.dispose();
    this.cameraShake?.dispose?.();
    this.hitStop?.dispose?.();
    this.cameraFov?.dispose?.();
    this.sceneManager?.dispose();
    this.audio?.dispose();
    this.input?.dispose();
    this.assets?.dispose();
    this.save?.dispose();
    this.ui?.dispose();
    this.eventBus.clear();
  }
}

export default Game;
