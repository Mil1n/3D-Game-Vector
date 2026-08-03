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
    if (!element?.requestPointerLock) {
      this.eventBus.emit('input:pointer-lock-error', new Error('Pointer Lock API is unavailable'));
      return false;
    }
    this.element = element;
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
    const input = `Mouse${event.button}`;
    if (!this.#down.has(input)) this.#pressed.add(input);
    this.#down.add(input);
    if (this.preventDefaults && (this.isPointerLocked || this.#isBoundInput(input))) event.preventDefault();
  }

  #onMouseUp(event) {
    const input = `Mouse${event.button}`;
    if (this.#down.delete(input)) this.#released.add(input);
    if (this.preventDefaults && (this.isPointerLocked || this.#isBoundInput(input))) event.preventDefault();
  }

  #onMouseMove(event) {
    if (!this.isPointerLocked && !this.captureUnlockedMouse) return;
    this.#lookX += (Number(event.movementX) || 0) * this.mouseSensitivity;
    this.#lookY += (Number(event.movementY) || 0) * this.mouseSensitivity;
  }

  #onWheel(event) {
    const input = event.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    this.#wheel += Math.sign(Number(event.deltaY) || 0);
    this.#down.add(input);
    this.#pressed.add(input);
    if (this.preventDefaults && (this.isPointerLocked || this.#isBoundInput(input))) event.preventDefault();
  }

  #onContextMenu(event) {
    if (this.isPointerLocked || this.#isBoundInput('Mouse2')) event.preventDefault();
  }

  #onPointerLockChange() {
    const locked = this.isPointerLocked;
    if (!locked) this.clear();
    this.eventBus.emit('input:pointer-lock', { locked, element: this.document?.pointerLockElement ?? null });
    this.eventBus.emit(locked ? 'input:pointer-lock-acquired' : 'input:pointer-lock-lost');
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

  #finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
}

export default InputManager;
