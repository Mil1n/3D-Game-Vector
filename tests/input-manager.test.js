import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/EventBus.js';
import { InputManager } from '../src/core/InputManager.js';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}

function createEnvironment({ pointerLock = false } = {}) {
  const document = new FakeEventTarget();
  const window = new FakeEventTarget();
  document.pointerLockElement = null;
  document.activeElement = null;
  document.exitPointerLock = () => {
    document.pointerLockElement = null;
    document.dispatch('pointerlockchange', { target: document });
  };

  const attributes = new Map();
  const canvas = {
    nodeType: 1,
    ownerDocument: document,
    tabIndex: -1,
    contains: (target) => target === canvas,
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name, value) => {
      attributes.set(name, String(value));
      if (name === 'tabindex') canvas.tabIndex = Number(value);
    },
    focus: () => { document.activeElement = canvas; },
  };
  if (pointerLock) {
    canvas.requestPointerLock = () => {
      document.pointerLockElement = canvas;
      document.dispatch('pointerlockchange', { target: document });
    };
  }
  document.body = canvas;
  return { document, window, canvas };
}

test('unavailable Pointer Lock falls back to focused drag-to-look and keyboard input', async () => {
  const environment = createEnvironment();
  const input = new InputManager({ ...environment, element: environment.canvas, eventBus: new EventBus() });

  assert.equal(await input.requestPointerLock(environment.canvas), false);
  assert.equal(input.isFallbackActive, true);
  assert.equal(input.inputMode, 'drag');
  assert.equal(environment.document.activeElement, environment.canvas);
  assert.equal(environment.canvas.tabIndex, 0);

  environment.document.dispatch('keydown', { target: environment.canvas, code: 'KeyW', repeat: false });
  assert.equal(input.isDown('forward'), true);

  environment.document.dispatch('mousedown', { target: environment.canvas, button: 0, clientX: 20, clientY: 30 });
  environment.document.dispatch('mousemove', { target: environment.canvas, movementX: 0, movementY: 0, clientX: 27, clientY: 25 });
  assert.deepEqual(input.consumeLook(), { x: 7, y: -5 });
  environment.document.dispatch('mouseup', { target: environment.canvas, button: 0, clientX: 27, clientY: 25 });

  environment.document.dispatch('mousemove', { target: environment.canvas, movementX: 8, movementY: 9, clientX: 35, clientY: 34 });
  assert.deepEqual(input.consumeLook(), { x: 0, y: 0 });
  input.dispose();
});

test('losing Pointer Lock preserves held keys and hands control to drag fallback', async () => {
  const environment = createEnvironment({ pointerLock: true });
  const eventBus = new EventBus();
  let lostPayload = null;
  eventBus.on('input:pointer-lock-lost', (payload) => { lostPayload = payload; });
  const input = new InputManager({ ...environment, element: environment.canvas, eventBus });

  assert.equal(await input.requestPointerLock(environment.canvas), true);
  assert.equal(input.inputMode, 'pointer-lock');
  environment.document.dispatch('keydown', { target: environment.canvas, code: 'KeyD', repeat: false });

  environment.document.pointerLockElement = null;
  environment.document.dispatch('pointerlockchange', { target: environment.document });

  assert.equal(input.isDown('right'), true);
  assert.equal(input.isFallbackActive, true);
  assert.equal(lostPayload?.fallbackActive, true);
  assert.equal(lostPayload?.mode, 'drag');
  input.dispose();
});

test('mousedown on the canvas focuses it and reports element activation', () => {
  const environment = createEnvironment();
  const eventBus = new EventBus();
  let activatedPayload = null;
  eventBus.on('input:element-activated', (payload) => { activatedPayload = payload; });
  const input = new InputManager({ ...environment, element: environment.canvas, eventBus });

  environment.document.dispatch('mousedown', {
    target: environment.canvas,
    button: 0,
    clientX: 18,
    clientY: 24,
  });

  assert.equal(environment.document.activeElement, environment.canvas);
  assert.equal(activatedPayload?.element, environment.canvas);
  assert.equal(activatedPayload?.mode, 'drag');
  input.dispose();
});

test('mousedown outside the canvas does not report element activation', () => {
  const environment = createEnvironment();
  const eventBus = new EventBus();
  let activationCount = 0;
  eventBus.on('input:element-activated', () => { activationCount += 1; });
  const input = new InputManager({ ...environment, element: environment.canvas, eventBus });

  environment.document.dispatch('mousedown', {
    target: { nodeType: 1 },
    button: 0,
    clientX: 18,
    clientY: 24,
  });

  assert.equal(environment.document.activeElement, null);
  assert.equal(activationCount, 0);
  input.dispose();
});
