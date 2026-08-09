import { EventBus } from './EventBus.js';

const freezeBindings = (bindings) => Object.freeze(Object.fromEntries(
  Object.entries(bindings).map(([action, inputs]) => [action, Object.freeze([...inputs])]),
));

export const DEFAULT_BINDINGS = freezeBindings({
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  dash: ['KeyQ', 'Mouse3'],
  interact: ['KeyE'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  reload: ['KeyR'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  weapon4: ['Digit4'],
  weapon5: ['Digit5'],
  pause: ['Escape'],
  debug: ['F3'],
});

const cloneBindings = (bindings) => Object.fromEntries(
  Object.entries(bindings).map(([action, inputs]) => [action, [...inputs]]),
);

export class InputManager {
  #down = new Set();
  #pressed = new Set();
  #released = new Set();
  #lookX = 0;
  #lookY = 0;
  #wheel = 0;
  #dragging = false;
  #fallbackActive = false;
  #lastPointerX = 0;
  #lastPointerY = 0;
  #lastLockAttemptAt = 0;
  #lastPointerLockOptions = {};
  #attached = false;
  #handlers;

  constructor(eventBusOrOptions = {}, legacyEventBus = null) {
    const isElement = eventBusOrOptions?.nodeType === 1 || typeof eventBusOrOptions?.requestPointerLock === 'function';
    const options = eventBusOrOptions && typeof eventBusOrOptions.emit === 'function'
      ? { eventBus: eventBusOrOptions }
      : (isElement ? { element: eventBusOrOptions, document: eventBusOrOptions.ownerDocument, eventBus: legacyEventBus } : (eventBusOrOptions ?? {}));
    this.eventBus = options.eventBus ?? new EventBus();
    this.document = options.document ?? globalThis.document ?? null;
    this.window = options.window ?? globalThis.window ?? null;
    this.element = options.element ?? this.document?.body ?? null;
    this.mouseSensitivity = this.#finite(options.mouseSensitivity, 1);
    this.invertY = options.invertY === true;
    this.captureUnlockedMouse = options.captureUnlockedMouse === true;
    this.allowUnlockedFallback = options.allowUnlockedFallback !== false;
    this.preventDefaults = options.preventDefaults !== false;
    this.bindings = cloneBindings(DEFAULT_BINDINGS);
    if (options.bindings) this.setBindings(options.bindings, { replace: false, silent: true });

    this.#handlers = {
      keydown: (event) => this.#onKeyDown(event),
      keyup: (event) => this.#onKeyUp(event),
      mousedown: (event) => this.#onMouseDown(event),
      mouseup: (event) => this.#onMouseUp(event),
      mousemove: (event) => this.#onMouseMove(event),
      wheel: (event) => this.#onWheel(event),
      contextmenu: (event) => this.#onContextMenu(event),
      pointerlockchange: () => this.#onPointerLockChange(),
      pointerlockerror: (event) => this.eventBus.emit('input:pointer-lock-error', event),
      blur: () => this.#onBlur(),
    };

    if (options.autoAttach !== false) this.attach();
  }

  attach(element = this.element) {
    if (this.#attached || !this.document) return false;
    this.element = element ?? this.document.body;
    this.#makeElementFocusable();
    this.document.addEventListener('keydown', this.#handlers.keydown);
    this.document.addEventListener('keyup', this.#handlers.keyup);
    this.document.addEventListener('mousedown', this.#handlers.mousedown);
    this.document.addEventListener('mouseup', this.#handlers.mouseup);
    this.document.addEventListener('mousemove', this.#handlers.mousemove);
    this.document.addEventListener('wheel', this.#handlers.wheel, { passive: false });
    this.document.addEventListener('contextmenu', this.#handlers.contextmenu);
    this.document.addEventListener('pointerlockchange', this.#handlers.pointerlockchange);
    this.document.addEventListener('pointerlockerror', this.#handlers.pointerlockerror);
    this.window?.addEventListener('blur', this.#handlers.blur);
    this.#attached = true;
    return true;
  }

  detach() {
    if (!this.#attached || !this.document) return false;
    this.document.removeEventListener('keydown', this.#handlers.keydown);
    this.document.removeEventListener('keyup', this.#handlers.keyup);
    this.document.removeEventListener('mousedown', this.#handlers.mousedown);
    this.document.removeEventListener('mouseup', this.#handlers.mouseup);
    this.document.removeEventListener('mousemove', this.#handlers.mousemove);
    this.document.removeEventListener('wheel', this.#handlers.wheel);
    this.document.removeEventListener('contextmenu', this.#handlers.contextmenu);
    this.document.removeEventListener('pointerlockchange', this.#handlers.pointerlockchange);
    this.document.removeEventListener('pointerlockerror', this.#handlers.pointerlockerror);
    this.window?.removeEventListener('blur', this.#handlers.blur);
    this.#attached = false;
    this.clear();
    return true;
  }

  async requestPointerLock(element = this.element, options = {}) {
    this.element = element ?? this.element;
    this.#lastPointerLockOptions = { ...options };
    this.#lastLockAttemptAt = Date.now();
    this.#makeElementFocusable();
    this.focusElement();

    if (!element?.requestPointerLock) {
      this.#enableFallback('unavailable');
      this.eventBus.emit('input:pointer-lock-error', new Error('Pointer Lock API is unavailable'));
      return false;
    }

    // Keep controls usable while permission is pending. A successful
    // pointerlockchange switches this off before any unlocked movement leaks in.
    this.#enableFallback('pending');
    try {
      const result = element.requestPointerLock({ unadjustedMovement: options.rawInput !== false });
      if (result?.then) await result;
      return true;
    } catch (firstError) {
      try {
        const fallback = element.requestPointerLock();
        if (fallback?.then) await fallback;
        return true;
      } catch (error) {
        this.#enableFallback('rejected');
        this.eventBus.emit('input:pointer-lock-error', error ?? firstError);
        return false;
      }
    }
  }

  async exitPointerLock() {
    if (!this.document?.exitPointerLock || !this.isPointerLocked) return false;
    const result = this.document.exitPointerLock();
    if (result?.then) await result;
    return true;
  }

  get isPointerLocked() {
    return Boolean(this.document && this.element && this.document.pointerLockElement === this.element);
  }

  get isFallbackActive() {
    return this.allowUnlockedFallback && this.#fallbackActive && !this.isPointerLocked;
  }

  get inputMode() {
    if (this.isPointerLocked) return 'pointer-lock';
    if (this.isFallbackActive) return 'drag';
    return 'keyboard';
  }

  focusElement() {
    if (!this.element?.focus) return false;
    try {
      this.element.focus({ preventScroll: true });
    } catch {
      this.element.focus();
    }
    return this.document?.activeElement === this.element;
  }

  isDown(action) {
    return this.#inputsFor(action).some((input) => this.#down.has(input));
  }

  wasPressed(action) {
    return this.#inputsFor(action).some((input) => this.#pressed.has(input));
  }

  wasReleased(action) {
    return this.#inputsFor(action).some((input) => this.#released.has(input));
  }

  getAxis(negativeAction, positiveAction) {
    return Number(this.isDown(positiveAction)) - Number(this.isDown(negativeAction));
  }

  consumeLook() {
    const look = { x: this.#lookX, y: this.#lookY };
    this.#lookX = 0;
    this.#lookY = 0;
    return look;
  }

  consumeWheel() {
    const wheel = this.#wheel;
    this.#wheel = 0;
    return wheel;
  }

  snapshot({ consumeLook = false } = {}) {
    const actions = {};
    const pressed = {};
    const released = {};
    for (const action of Object.keys(this.bindings)) {
      actions[action] = this.isDown(action);
      pressed[action] = this.wasPressed(action);
      released[action] = this.wasReleased(action);
    }
    const look = consumeLook ? this.consumeLook() : { x: this.#lookX, y: this.#lookY };
    const edgeAliases = {};
    for (const action of Object.keys(this.bindings)) {
      edgeAliases[`${action}Pressed`] = pressed[action];
      edgeAliases[`${action}Released`] = released[action];
      actions[`${action}Pressed`] = pressed[action];
      actions[`${action}Released`] = released[action];
    }
    return {
      ...actions,
      ...edgeAliases,
      actions,
      pressed,
      released,
      movement: {
        x: Number(actions.right) - Number(actions.left),
        y: Number(actions.forward) - Number(actions.backward),
        z: Number(actions.backward) - Number(actions.forward),
      },
      look,
      wheel: this.#wheel,
      invertY: this.invertY,
      pointerLocked: this.isPointerLocked,
      bindings: this.getBindings(),
    };
  }

  getSnapshot(options) {
    return this.snapshot(options);
  }

  endFrame() {
    this.#pressed.clear();
    this.#released.clear();
    this.#down.delete('WheelUp');
    this.#down.delete('WheelDown');
    this.#wheel = 0;
  }

  rebind(action, inputs, { append = false, allowConflicts = false, silent = false } = {}) {
    this.#assertAction(action);
    const normalized = this.#normalizeInputs(inputs);
    const next = append ? [...new Set([...this.bindings[action], ...normalized])] : normalized;
    if (!allowConflicts) {
      for (const [otherAction, otherInputs] of Object.entries(this.bindings)) {
        if (otherAction === action) continue;
        this.bindings[otherAction] = otherInputs.filter((input) => !next.includes(input));
      }
    }
    this.bindings[action] = next;
    if (!silent) this.eventBus.emit('input:rebound', { action, inputs: [...next], bindings: this.getBindings() });
    return [...next];
  }

  setBindings(bindings, { replace = false, silent = false } = {}) {
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
      throw new TypeError('bindings must be an object');
    }
    if (replace) this.bindings = Object.fromEntries(Object.keys(DEFAULT_BINDINGS).map((action) => [action, []]));
    for (const [action, inputs] of Object.entries(bindings)) {
      if (!(action in this.bindings)) continue;
      this.rebind(action, inputs, { allowConflicts: true, silent: true });
    }
    if (!silent) this.eventBus.emit('input:bindings-changed', this.getBindings());
    return this.getBindings();
  }

  resetBindings() {
    this.bindings = cloneBindings(DEFAULT_BINDINGS);
    const result = this.getBindings();
    this.eventBus.emit('input:bindings-changed', result);
    return result;
  }

  getBindings() {
    return cloneBindings(this.bindings);
  }

  setMouseOptions({ sensitivity, invertY } = {}) {
    if (sensitivity !== undefined) this.mouseSensitivity = Math.max(0, this.#finite(sensitivity, this.mouseSensitivity));
    if (invertY !== undefined) this.invertY = Boolean(invertY);
  }

  clear() {
    this.#down.clear();
    this.#pressed.clear();
    this.#released.clear();
    this.#lookX = 0;
    this.#lookY = 0;
    this.#wheel = 0;
    this.#dragging = false;
  }

  dispose() {
    this.detach();
  }

  #onKeyDown(event) {
    const input = event.code || event.key;
    if (!input) return;
    if (!event.repeat && !this.#down.has(input)) this.#pressed.add(input);
    this.#down.add(input);
    if (this.preventDefaults && (this.isPointerLocked || this.#isBoundInput(input))) event.preventDefault();
  }

  #onKeyUp(event) {
    const input = event.code || event.key;
    if (!input) return;
    if (this.#down.delete(input)) this.#released.add(input);
    if (this.preventDefaults && (this.isPointerLocked || this.#isBoundInput(input))) event.preventDefault();
  }

  #onMouseDown(event) {
    const onElement = this.#targetsElement(event.target);
    if (!this.isPointerLocked && !onElement) return;
    if (onElement) this.focusElement();
    if (
      !this.isPointerLocked
      && onElement
      && this.isFallbackActive
      && typeof this.element?.requestPointerLock === 'function'
      && Date.now() - this.#lastLockAttemptAt > 750
    ) {
      // A canvas press is a fresh user gesture, so browsers that rejected the
      // menu-button request get another standards-compliant chance to lock.
      void this.requestPointerLock(this.element, this.#lastPointerLockOptions);
    }
    if (!this.isPointerLocked && this.allowUnlockedFallback) {
      this.#enableFallback('canvas-interaction');
      this.#dragging = true;
      this.#lastPointerX = Number(event.clientX) || 0;
      this.#lastPointerY = Number(event.clientY) || 0;
    }
    const input = `Mouse${event.button}`;
    if (!this.#down.has(input)) this.#pressed.add(input);
    this.#down.add(input);
    if (this.preventDefaults && (this.isPointerLocked || onElement) && this.#isBoundInput(input)) event.preventDefault();
  }

  #onMouseUp(event) {
    if (!this.isPointerLocked && !this.#dragging && !this.#targetsElement(event.target)) return;
    const input = `Mouse${event.button}`;
    if (this.#down.delete(input)) this.#released.add(input);
    if (!this.isPointerLocked) this.#dragging = false;
    if (this.preventDefaults && (this.isPointerLocked || this.#targetsElement(event.target)) && this.#isBoundInput(input)) event.preventDefault();
  }

  #onMouseMove(event) {
    const unlockedCapture = this.captureUnlockedMouse || (this.isFallbackActive && this.#dragging);
    if (!this.isPointerLocked && !unlockedCapture) return;
    let movementX = Number(event.movementX) || 0;
    let movementY = Number(event.movementY) || 0;
    if (!this.isPointerLocked && this.#dragging) {
      const clientX = Number(event.clientX);
      const clientY = Number(event.clientY);
      if (!movementX && Number.isFinite(clientX)) movementX = clientX - this.#lastPointerX;
      if (!movementY && Number.isFinite(clientY)) movementY = clientY - this.#lastPointerY;
      if (Number.isFinite(clientX)) this.#lastPointerX = clientX;
      if (Number.isFinite(clientY)) this.#lastPointerY = clientY;
    }
    this.#lookX += movementX * this.mouseSensitivity;
    this.#lookY += movementY * this.mouseSensitivity;
    if (!this.isPointerLocked && this.preventDefaults) event.preventDefault();
  }

  #onWheel(event) {
    if (!this.isPointerLocked && !this.#targetsElement(event.target)) return;
    const input = event.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    this.#wheel += Math.sign(Number(event.deltaY) || 0);
    this.#down.add(input);
    this.#pressed.add(input);
    if (this.preventDefaults && (this.isPointerLocked || this.#isBoundInput(input))) event.preventDefault();
  }

  #onContextMenu(event) {
    if (this.isPointerLocked || (this.#targetsElement(event.target) && this.#isBoundInput('Mouse2'))) event.preventDefault();
  }

  #onPointerLockChange() {
    const locked = this.isPointerLocked;
    if (locked) {
      this.#disableFallback('pointer-lock-acquired');
      this.#dragging = false;
      this.focusElement();
    } else {
      // Do not clear held keyboard keys here: sandboxed/embedded browsers can
      // revoke pointer lock without a blur. Preserve movement and switch to the
      // explicit drag-to-look fallback instead.
      this.#releaseMouseInputs();
      this.#lookX = 0;
      this.#lookY = 0;
      this.#enableFallback('pointer-lock-lost');
    }
    const payload = {
      locked,
      fallbackActive: this.isFallbackActive,
      mode: this.inputMode,
      element: this.document?.pointerLockElement ?? null,
    };
    this.eventBus.emit('input:pointer-lock', payload);
    this.eventBus.emit(locked ? 'input:pointer-lock-acquired' : 'input:pointer-lock-lost', payload);
  }

  #onBlur() {
    this.clear();
    this.eventBus.emit('input:blur');
  }

  #inputsFor(action) {
    this.#assertAction(action);
    return this.bindings[action];
  }

  #assertAction(action) {
    if (!(action in this.bindings)) throw new RangeError(`Unknown input action: ${String(action)}`);
  }

  #normalizeInputs(inputs) {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    if (list.some((input) => typeof input !== 'string' || input.length === 0)) {
      throw new TypeError('Input bindings must be non-empty strings');
    }
    return [...new Set(list)];
  }

  #isBoundInput(input) {
    return Object.values(this.bindings).some((inputs) => inputs.includes(input));
  }

  #targetsElement(target) {
    if (!target || !this.element) return false;
    return target === this.element || Boolean(this.element.contains?.(target));
  }

  #makeElementFocusable() {
    if (!this.element) return;
    if (typeof this.element.tabIndex === 'number' && this.element.tabIndex < 0) this.element.tabIndex = 0;
    else if (!this.element.hasAttribute?.('tabindex')) this.element.setAttribute?.('tabindex', '0');
  }

  #enableFallback(reason) {
    if (!this.allowUnlockedFallback || this.isPointerLocked) return false;
    const changed = !this.#fallbackActive;
    this.#fallbackActive = true;
    if (changed) this.eventBus.emit('input:fallback-enabled', { reason, mode: 'drag' });
    return changed;
  }

  #disableFallback(reason) {
    const changed = this.#fallbackActive;
    this.#fallbackActive = false;
    this.#dragging = false;
    if (changed) this.eventBus.emit('input:fallback-disabled', { reason, mode: this.inputMode });
    return changed;
  }

  #releaseMouseInputs() {
    for (const input of [...this.#down]) {
      if (!input.startsWith('Mouse')) continue;
      this.#down.delete(input);
      this.#released.add(input);
    }
    this.#dragging = false;
  }

  #finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
}

export default InputManager;
