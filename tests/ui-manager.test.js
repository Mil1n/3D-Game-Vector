import test from 'node:test';
import assert from 'node:assert/strict';

import { UIManager } from '../src/ui/UIManager.js';

function renderError(error, detail = '') {
  const ui = Object.create(UIManager.prototype);
  const rendered = {};
  ui._ensureInit = () => {};
  ui._hideWarning = (immediate) => {
    rendered.warningHiddenImmediately = immediate;
  };
  ui._hideHud = () => {};
  ui._showScreen = (markup, view) => {
    rendered.markup = markup;
    rendered.view = view;
  };
  ui.showError(error, detail);
  return rendered;
}

test('fatal error offers only an accessible full reload action', () => {
  const { markup, view, warningHiddenImmediately } = renderError({ title: 'Сбой', message: 'Цикл остановлен', code: 'RUNTIME_FAILURE' });

  assert.equal(view, 'error');
  assert.equal(warningHiddenImmediately, true);
  assert.match(markup, /role="alertdialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="error-title"/);
  assert.match(markup, /data-action="reload"/);
  assert.match(markup, /Перезапустить игру/);
  assert.doesNotMatch(markup, /data-action="menu"/);
});

test('recoverable error explicitly exposes the menu action', () => {
  const { markup } = renderError({ title: 'Сбой', recoverable: true });

  assert.match(markup, /data-action="reload"/);
  assert.match(markup, /data-action="menu"/);
  assert.match(markup, /Вернуться в меню/);
});

test('showError keeps the string and detail call shape', () => {
  const { markup } = renderError('Ошибка канала', '<повторите>');

  assert.match(markup, /Ошибка канала/);
  assert.match(markup, /&lt;повторите&gt;/);
});

test('HUD startup synchronously clears a stale shift warning', () => {
  const ui = Object.create(UIManager.prototype);
  let immediate = false;
  ui._ensureInit = () => {};
  ui._hideWarning = (value) => {
    immediate = value;
  };
  ui.screen = { hidden: false, innerHTML: 'old', classList: { remove() {} } };
  ui.hud = { hidden: true, classList: { add() {} } };
  ui.crosshair = { hidden: true };
  ui.root = { dataset: {} };

  ui.showHUD();

  assert.equal(immediate, true);
  assert.equal(ui.hud.hidden, false);
  assert.equal(ui.crosshair.hidden, false);
});

test('immediate warning cleanup cancels timers without a delayed fade', () => {
  const ui = Object.create(UIManager.prototype);
  const removed = [];
  let cleared = false;
  let added = false;
  ui._clearWarningTimers = () => {
    cleared = true;
  };
  ui.warning = {
    hidden: false,
    classList: {
      remove: (...names) => removed.push(...names),
      add: () => {
        added = true;
      },
    },
  };

  ui._hideWarning(true);

  assert.equal(cleared, true);
  assert.equal(ui.warning.hidden, true);
  assert.ok(removed.includes('is-active'));
  assert.ok(removed.includes('is-leaving'));
  assert.equal(added, false);
});

test('warning timer cleanup cancels a pending fade callback', (t) => {
  const previousWindow = globalThis.window;
  const clearedTimeouts = [];
  const clearedIntervals = [];
  globalThis.window = {
    clearTimeout: (timer) => clearedTimeouts.push(timer),
    clearInterval: (timer) => clearedIntervals.push(timer),
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const ui = Object.create(UIManager.prototype);
  ui.warningTimer = 11;
  ui.warningInterval = 12;
  ui.warningHideTimer = 13;
  ui.timers = new Set([13]);

  ui._clearWarningTimers();

  assert.deepEqual(clearedTimeouts, [11, 13]);
  assert.deepEqual(clearedIntervals, [12]);
  assert.equal(ui.warningHideTimer, null);
  assert.equal(ui.timers.has(13), false);
});
