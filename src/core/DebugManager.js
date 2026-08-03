import { EventBus } from './EventBus.js';

export const DEBUG_TOGGLES = Object.freeze([
  'hitboxes',
  'colliders',
  'spawns',
  'lineOfSight',
  'enemyRoutes',
  'objectiveZones',
  'navigationNodes',
]);

const commandArguments = (line) => {
  const tokens = [];
  const matcher = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+)/g;
  let match;
  while ((match = matcher.exec(line)) !== null) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
};

const primitive = (value) => {
  if (value === 'true' || value === 'on') return true;
  if (value === 'false' || value === 'off') return false;
  const number = Number(value);
  return value !== '' && Number.isFinite(number) ? number : value;
};

const vectorText = (value) => {
  if (!value) return '—';
  const x = Number(value.x ?? value[0] ?? 0).toFixed(2);
  const y = Number(value.y ?? value[1] ?? 0).toFixed(2);
  const z = Number(value.z ?? value[2] ?? 0).toFixed(2);
  return `${x}, ${y}, ${z}`;
};

export class DebugManager {
  #visible = false;
  #root = null;
  #metricsElement = null;
  #logElement = null;
  #inputElement = null;
  #lastRender = 0;
  #smoothedFrameMs = 16.67;
  #commands = new Map();
  #providers = new Map();
  #metrics = new Map();
  #history = [];
  #keyHandler;

  constructor(options = {}) {
    if (options && typeof options.emit === 'function') options = { eventBus: options };
    this.eventBus = options.eventBus ?? new EventBus();
    this.document = options.document ?? globalThis.document ?? null;
    this.window = options.window ?? globalThis.window ?? null;
    this.hooks = options.hooks ?? {};
    this.updateInterval = Math.max(50, Number(options.updateInterval) || 200);
    this.toggles = Object.fromEntries(DEBUG_TOGGLES.map((name) => [name, false]));
    this.#keyHandler = (event) => {
      if (event.code !== 'F3') return;
      event.preventDefault();
      this.toggle();
    };
    if (options.bindHotkey !== false) this.document?.addEventListener('keydown', this.#keyHandler);
    this.#registerDefaultCommands();
    if (options.visible === true) this.show();
  }

  get visible() {
    return this.#visible;
  }

  show() {
    if (!this.document) return false;
    this.#ensureOverlay();
    this.#visible = true;
    this.#root.hidden = false;
    this.eventBus.emit('debug:visibility', { visible: true });
    return true;
  }

  hide() {
    this.#visible = false;
    if (this.#root) this.#root.hidden = true;
    this.eventBus.emit('debug:visibility', { visible: false });
    return true;
  }

  toggle(force) {
    const next = typeof force === 'boolean' ? force : !this.#visible;
    return next ? this.show() : this.hide();
  }

  registerMetric(name, provider) {
    if (typeof name !== 'string' || name.length === 0) throw new TypeError('Metric name is required');
    if (typeof provider !== 'function') throw new TypeError('Metric provider must be a function');
    this.#providers.set(name, provider);
    return () => this.#providers.delete(name);
  }

  setMetric(name, value) {
    this.#metrics.set(name, value);
  }

  registerCommand(name, handler, description = '') {
    const normalized = String(name).trim().toLowerCase();
    if (!normalized || /\s/.test(normalized)) throw new TypeError('Command name must be one word');
    if (typeof handler !== 'function') throw new TypeError('Command handler must be a function');
    this.#commands.set(normalized, { handler, description });
    return () => this.#commands.delete(normalized);
  }

  execute(commandLine) {
    const [name = '', ...rawArgs] = commandArguments(String(commandLine).trim());
    const command = this.#commands.get(name.toLowerCase());
    if (!command) {
      const message = `Unknown command: ${name || '(empty)'}`;
      this.#log(message, true);
      return { ok: false, message };
    }

    const args = rawArgs.map(primitive);
    try {
      const value = command.handler(...args);
      if (value?.then) {
        value.then((result) => this.#log(String(result ?? 'OK'))).catch((error) => this.#log(error.message, true));
        return { ok: true, pending: true, value };
      }
      const message = String(value ?? 'OK');
      this.#log(message);
      return { ok: true, message, value };
    } catch (error) {
      this.#log(error.message, true);
      return { ok: false, message: error.message, error };
    }
  }

  executeCommand(commandLine) {
    return this.execute(commandLine);
  }

  setToggle(name, value = !this.toggles[name]) {
    if (!(name in this.toggles)) throw new RangeError(`Unknown debug toggle: ${name}`);
    this.toggles[name] = Boolean(value);
    this.eventBus.emit('debug:toggle', { name, value: this.toggles[name], toggles: { ...this.toggles } });
    this.#refreshToggleButtons();
    return this.toggles[name];
  }

  update(deltaSeconds, context = {}) {
    const delta = Number(deltaSeconds);
    if (Number.isFinite(delta) && delta > 0) {
      const frameMs = delta > 1 ? delta : delta * 1000;
      this.#smoothedFrameMs += (frameMs - this.#smoothedFrameMs) * 0.08;
    }
    if (!this.#visible) return;

    const timestamp = globalThis.performance?.now?.() ?? Date.now();
    if (timestamp - this.#lastRender < this.updateInterval) return;
    this.#lastRender = timestamp;
    this.#collectMetrics(context);
    this.#renderMetrics();
  }

  dispose() {
    this.document?.removeEventListener('keydown', this.#keyHandler);
    this.#root?.remove();
    this.#root = null;
    this.#metricsElement = null;
    this.#logElement = null;
    this.#inputElement = null;
    this.#commands.clear();
    this.#providers.clear();
    this.#metrics.clear();
  }

  #collectMetrics(context) {
    const rendererInfo = context.renderer?.info;
    const render = rendererInfo?.render ?? {};
    const player = context.player ?? context.playerController;
    const position = player?.position ?? player?.body?.position ?? context.playerPosition;
    const velocity = player?.velocity ?? player?.body?.velocity ?? context.playerVelocity;
    const enemies = context.enemies?.activeCount ?? context.enemySystem?.activeCount ?? context.enemyCount ?? 0;
    const particles = context.particles?.activeCount ?? context.effectsSystem?.activeParticleCount ?? context.particleCount ?? 0;
    const sceneObjects = context.scene?.traverse
      ? (() => { let count = 0; context.scene.traverse(() => { count += 1; }); return count; })()
      : (context.scene?.children?.length ?? 0);

    this.#metrics.set('FPS', (1000 / Math.max(0.01, this.#smoothedFrameMs)).toFixed(0));
    this.#metrics.set('Frame', `${this.#smoothedFrameMs.toFixed(2)} ms`);
    this.#metrics.set('Draw calls', render.calls ?? 0);
    this.#metrics.set('Triangles', (render.triangles ?? 0).toLocaleString());
    this.#metrics.set('Scene objects', sceneObjects);
    this.#metrics.set('Enemies', enemies);
    this.#metrics.set('Particles', particles);
    this.#metrics.set('Player XYZ', vectorText(position));
    this.#metrics.set('Velocity', vectorText(velocity));
    this.#metrics.set('Player state', player?.state ?? context.playerState ?? '—');
    this.#metrics.set('AI state', context.aiState ?? context.enemySystem?.debugState ?? '—');
    this.#metrics.set('Director phase', context.director?.phase ?? context.directorPhase ?? '—');
    this.#metrics.set('Anomaly', context.director?.currentAnomaly ?? context.anomaly ?? '—');
    const memory = globalThis.performance?.memory?.usedJSHeapSize;
    this.#metrics.set('JS heap', memory ? `${(memory / 1048576).toFixed(1)} MB` : 'n/a');

    for (const [name, provider] of this.#providers) {
      try {
        this.#metrics.set(name, provider(context));
      } catch (error) {
        this.#metrics.set(name, `error: ${error.message}`);
      }
    }
  }

  #renderMetrics() {
    if (!this.#metricsElement) return;
    this.#metricsElement.textContent = [...this.#metrics]
      .map(([name, value]) => `${name.padEnd(16)} ${String(value)}`)
      .join('\n');
  }

  #ensureOverlay() {
    if (this.#root || !this.document) return;
    const root = this.document.createElement('aside');
    root.id = 'vector-null-debug';
    root.setAttribute('aria-label', 'Developer tools');
    Object.assign(root.style, {
      position: 'fixed',
      top: '10px',
      left: '10px',
      zIndex: '100000',
      width: '360px',
      maxHeight: 'calc(100vh - 20px)',
      overflow: 'auto',
      padding: '12px',
      color: '#a8fff1',
      background: 'rgba(4, 10, 16, .92)',
      border: '1px solid #3fcdb9',
      boxShadow: '0 0 24px rgba(46, 238, 207, .2)',
      font: '12px/1.4 Consolas, monospace',
      pointerEvents: 'auto',
      userSelect: 'text',
    });

    const title = this.document.createElement('strong');
    title.textContent = 'VECTOR//NULL — DEBUG [F3]';
    title.style.display = 'block';
    title.style.marginBottom = '8px';
    root.append(title);

    this.#metricsElement = this.document.createElement('pre');
    Object.assign(this.#metricsElement.style, { margin: '0 0 10px', whiteSpace: 'pre-wrap' });
    root.append(this.#metricsElement);

    const toggles = this.document.createElement('div');
    toggles.dataset.debugToggles = 'true';
    Object.assign(toggles.style, { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' });
    for (const name of DEBUG_TOGGLES) {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.dataset.toggle = name;
      button.addEventListener('click', () => this.setToggle(name));
      Object.assign(button.style, {
        border: '1px solid #39756c',
        padding: '3px 5px',
        color: '#bcefe7',
        background: '#142129',
        font: 'inherit',
        cursor: 'pointer',
      });
      toggles.append(button);
    }
    root.append(toggles);

    this.#logElement = this.document.createElement('pre');
    Object.assign(this.#logElement.style, { minHeight: '34px', margin: '0 0 6px', color: '#8ebcb5', whiteSpace: 'pre-wrap' });
    root.append(this.#logElement);

    this.#inputElement = this.document.createElement('input');
    this.#inputElement.type = 'text';
    this.#inputElement.placeholder = 'help | spawn hunter | timescale 2';
    this.#inputElement.autocomplete = 'off';
    Object.assign(this.#inputElement.style, {
      boxSizing: 'border-box',
      width: '100%',
      border: '1px solid #3fcdb9',
      padding: '6px',
      color: '#dcfff9',
      background: '#071016',
      font: 'inherit',
      outline: 'none',
    });
    this.#inputElement.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key !== 'Enter') return;
      this.execute(this.#inputElement.value);
      this.#inputElement.value = '';
    });
    root.append(this.#inputElement);
    (this.document.body ?? this.document.documentElement).append(root);
    this.#root = root;
    this.#refreshToggleButtons();
  }

  #refreshToggleButtons() {
    if (!this.#root) return;
    for (const button of this.#root.querySelectorAll('[data-toggle]')) {
      const active = this.toggles[button.dataset.toggle];
      button.textContent = `${active ? '●' : '○'} ${button.dataset.toggle}`;
      button.style.borderColor = active ? '#5fffe7' : '#39756c';
      button.style.color = active ? '#ffffff' : '#bcefe7';
    }
  }

  #log(message, error = false) {
    this.#history.push(`${error ? 'ERR' : '>'} ${message}`);
    if (this.#history.length > 6) this.#history.shift();
    if (this.#logElement) {
      this.#logElement.textContent = this.#history.join('\n');
      this.#logElement.style.color = error ? '#ff7993' : '#8ebcb5';
    }
  }

  #dispatch(command, hookName, args) {
    const payload = { command, args };
    this.eventBus.emit('debug:command', payload);
    this.eventBus.emit(`debug:${command}`, ...args);
    const hook = this.hooks[hookName];
    const result = typeof hook === 'function' ? hook(...args) : undefined;
    return result ?? `${command}: dispatched`;
  }

  #registerDefaultCommands() {
    this.registerCommand('help', () => [...this.#commands]
      .map(([name, command]) => `${name}${command.description ? ` — ${command.description}` : ''}`)
      .join('\n'), 'list commands');
    this.registerCommand('god', (enabled) => this.#dispatch('god', 'toggleGodMode', [enabled]), 'god [on|off]');
    this.registerCommand('ammo', (enabled = true) => this.#dispatch('ammo', 'infiniteAmmo', [enabled]), 'ammo [on|off]');
    this.registerCommand('give', (weapon = 'carbine') => this.#dispatch('give', 'giveWeapon', [weapon]), 'give <weapon>');
    this.registerCommand('spawn', (enemy = 'trooper', count = 1) => this.#dispatch('spawn', 'spawnEnemy', [enemy, count]), 'spawn <enemy> [count]');
    this.registerCommand('killall', () => this.#dispatch('killall', 'killAllEnemies', []), 'destroy all enemies');
    this.registerCommand('freezeai', (enabled = true) => this.#dispatch('freezeai', 'freezeAI', [enabled]), 'freezeai [on|off]');
    this.registerCommand('shift', () => this.#dispatch('shift', 'forceShift', []), 'force a Reality Shift');
    this.registerCommand('objective', () => this.#dispatch('objective', 'completeObjective', []), 'complete objective');
    this.registerCommand('teleport', (x = 0, y = 2, z = 0) => this.#dispatch('teleport', 'teleport', [x, y, z]), 'teleport <x> <y> <z>');
    this.registerCommand('restart', () => this.#dispatch('restart', 'restartMatch', []), 'restart match');
    this.registerCommand('timescale', (scale = 1) => this.#dispatch('timescale', 'setTimeScale', [Math.max(0.1, Number(scale) || 1)]), 'timescale <0.1..>');
  }
}

export default DebugManager;
