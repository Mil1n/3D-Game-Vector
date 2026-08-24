import test from 'node:test';
import assert from 'node:assert/strict';

import { AchievementSystem } from '../src/systems/AchievementSystem.js';
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

test('input activation prompt is an accessible non-blocking persistent shell element', () => {
  const ui = Object.create(UIManager.prototype);
  const markup = ui._shellMarkup();

  assert.match(markup, /data-ui-input-activation/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /Кликните по сцене, чтобы активировать управление/);
  assert.match(markup, /data-ui-input-activation hidden/);
});

test('HUD shell exposes Momentum, Overdrive and the default activation key', () => {
  const ui = Object.create(UIManager.prototype);
  const markup = ui._shellMarkup();

  assert.match(markup, /data-hud-panel="momentum"/);
  assert.match(markup, /role="meter"/);
  assert.match(markup, /data-meter="momentum"/);
  assert.match(markup, /data-hud="momentum-action-time"/);
  assert.match(markup, /data-hud-panel="overdrive"/);
  assert.match(markup, /data-meter="overdrive"/);
  assert.match(markup, /data-hud="overdrive-key">F</);
  assert.match(markup, /overdrive-screen-effect/);
});

test('tiered hitmarkers prioritize kills, expose distinct profiles and safely retrigger', (t) => {
  const previousWindow = globalThis.window;
  const cleared = [];
  const scheduled = [];
  let nextTimer = 1;
  globalThis.window = {
    clearTimeout: (timer) => cleared.push(timer),
    setTimeout(callback, duration) {
      const timer = nextTimer;
      nextTimer += 1;
      scheduled.push({ timer, callback, duration });
      return timer;
    },
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const classes = new Set();
  const style = new Map();
  const ui = Object.create(UIManager.prototype);
  ui._ensureInit = () => {};
  ui.hitmarkerTimer = 77;
  ui.hitmarker = {
    dataset: {},
    offsetWidth: 26,
    style: { setProperty: (name, value) => style.set(name, value) },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
  };

  ui.setHitmarker(null);
  assert.equal(ui.hitmarker.dataset.type, 'body');
  assert.equal(ui.hitmarker.dataset.strength, '1');
  assert.equal(style.get('--hitmarker-duration'), '110ms');
  assert.equal(scheduled.at(-1).duration, 110);

  ui.setHitmarker({ critical: true });
  assert.equal(ui.hitmarker.dataset.type, 'headshot');
  assert.equal(ui.hitmarker.dataset.label, 'КРИТ');
  assert.equal(ui.hitmarker.dataset.strength, '2');
  assert.equal(scheduled.at(-1).duration, 165);

  ui.setHitmarker({ type: 'headshot', headshot: true, killed: true });
  assert.equal(ui.hitmarker.dataset.type, 'kill');
  assert.equal(ui.hitmarker.dataset.label, 'ЛИКВ');
  assert.equal(ui.hitmarker.dataset.strength, '3');
  assert.equal(scheduled.at(-1).duration, 225);

  ui.setHitmarker({ type: 'unsupported', duration: 9999 });
  assert.equal(ui.hitmarker.dataset.type, 'body');
  assert.equal(scheduled.at(-1).duration, 500);
  assert.equal(classes.has('is-active'), true);
  assert.deepEqual(cleared, [77, 1, 2, 3]);
  scheduled.at(-1).callback();
  assert.equal(classes.has('is-active'), false);

  const shell = ui._shellMarkup();
  assert.equal((shell.match(/data-ui-hitmarker/g) ?? []).length, 1);
  assert.match(shell, /data-ui-hitmarker data-type="body" aria-hidden="true"/);
});

test('Momentum and Overdrive controls are listed with a remappable KeyF default', () => {
  const ui = Object.create(UIManager.prototype);
  ui.settings = {};

  const settingsMarkup = ui._settingsTabMarkup('controls');
  const controlsMarkup = ui._controlsMarkup();

  assert.match(settingsMarkup, /controls\.bindings\.overdrive/);
  assert.match(settingsMarkup, /Активировать Overdrive/);
  assert.match(controlsMarkup, /Momentum/);
  assert.match(controlsMarkup, />F</);
});

test('accessibility settings expose independent weapon recoil intensity', () => {
  const ui = Object.create(UIManager.prototype);
  ui.settings = {};

  const markup = ui._settingsTabMarkup('accessibility');

  assert.match(markup, /gameplay\.weaponRecoil/);
  assert.match(markup, /Оружейная отдача/);
  assert.match(markup, /Сила управляемого отклонения прицела/);
});

test('accessibility settings expose a saved hit-stop intensity slider', () => {
  const ui = Object.create(UIManager.prototype);
  ui.settings = { gameplay: { hitStop: 0.35 } };

  const markup = ui._settingsTabMarkup('accessibility');

  assert.match(markup, /Стоп-кадр попаданий/);
  assert.match(markup, /type="range" min="0" max="1" step="0\.05" value="0\.35" data-setting="gameplay\.hitStop"/);
  assert.match(markup, />35%<\/output>/);
});

test('accessibility settings expose a saved enemy hit-reaction intensity slider', () => {
  const ui = Object.create(UIManager.prototype);
  ui.settings = { gameplay: { enemyHitReaction: 0.45 } };

  const markup = ui._settingsTabMarkup('accessibility');

  assert.match(markup, /Реакция противников/);
  assert.match(markup, /type="range" min="0" max="1" step="0\.05" value="0\.45" data-setting="gameplay\.enemyHitReaction"/);
  assert.match(markup, /Снижение движения полностью отключает эффект/);
  assert.match(markup, />45%<\/output>/);
});

test('achievements view renders the canonical AchievementSystem catalog', () => {
  const achievements = new AchievementSystem({
    saveManager: {
      getProfile: () => ({ achievements: [{ id: 'first_contact' }] }),
    },
  });
  const catalog = achievements.getCatalog();
  const ui = Object.create(UIManager.prototype);
  ui.profile = {
    achievementsCatalog: catalog,
    progression: { achievements: [] },
    stats: { runs: 99, wins: 99, kills: 999, bestScore: 999999 },
  };

  const markup = ui._achievementsMarkup();
  const cards = [...markup.matchAll(/<article\b[^>]*class="[^"]*\bachievement\b[^"]*"[^>]*>/g)].map((match) => match[0]);
  const renderedIds = cards.map((card) => card.match(/data-achievement-id="([^"]+)"/)?.[1]);

  assert.equal(new Set(catalog.map(({ id }) => id)).size, catalog.length);
  assert.ok(catalog.every((achievement) => !Object.hasOwn(achievement, 'test')), 'public catalog must not expose evaluator functions');
  assert.deepEqual(renderedIds, catalog.map(({ id }) => id));
  for (const achievement of catalog) {
    assert.ok(markup.includes(achievement.name), `missing achievement name: ${achievement.id}`);
    assert.ok(markup.includes(achievement.description), `missing achievement description: ${achievement.id}`);
  }
  assert.match(cards.find((card) => card.includes('data-achievement-id="first_contact"')) ?? '', /\bis-unlocked\b/);
  assert.doesNotMatch(cards.find((card) => card.includes('data-achievement-id="velocity"')) ?? '', /\bis-unlocked\b/);
  assert.doesNotMatch(markup, /data-achievement-id="(?:first-run|first-win|hunter|veteran|high-score|unstoppable)"/);
});

test('achievements view escapes catalog fields and handles an unavailable catalog', () => {
  const ui = Object.create(UIManager.prototype);
  ui.profile = {
    achievementsCatalog: [{
      id: `"><script>alert('id')</script>`,
      name: '<b>Unsafe name</b>',
      description: 'A & B',
      unlocked: false,
    }],
  };

  const markup = ui._achievementsMarkup();
  assert.doesNotMatch(markup, /<script>|<b>/);
  assert.match(markup, /data-achievement-id="&quot;&gt;&lt;script&gt;alert\(&#039;id&#039;\)&lt;\/script&gt;"/);
  assert.match(markup, /&lt;b&gt;Unsafe name&lt;\/b&gt;/);
  assert.match(markup, /A &amp; B/);

  ui.profile = { achievementsCatalog: [] };
  const emptyMarkup = ui._achievementsMarkup();
  assert.match(emptyMarkup, /Каталог недоступен/);
  assert.doesNotMatch(emptyMarkup, /class="[^"]*\bachievement\b/);
});

function createHudUpdateHarness() {
  const nodes = new Map();
  const element = (selector) => {
    if (!nodes.has(selector)) {
      const classes = new Set();
      nodes.set(selector, {
        textContent: '',
        title: '',
        attrs: {},
        style: { values: {}, setProperty(key, value) { this.values[key] = value; } },
        classList: {
          toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
          contains(name) { return classes.has(name); },
        },
        setAttribute(key, value) { this.attrs[key] = value; },
      });
    }
    return nodes.get(selector);
  };
  const rootClasses = new Set();
  const hudClasses = new Set();
  const ui = Object.create(UIManager.prototype);
  ui._ensureInit = () => {};
  ui.hudState = {};
  ui.overdriveDisplayDuration = 0;
  ui.settings = { controls: { bindings: { overdrive: 'KeyF' } } };
  ui.root = {
    querySelector: element,
    classList: { toggle(name, enabled) { enabled ? rootClasses.add(name) : rootClasses.delete(name); } },
  };
  ui.hud = {
    classList: { toggle(name, enabled) { enabled ? hudClasses.add(name) : hudClasses.delete(name); } },
  };
  ui._renderHudUpgrades = () => {};
  ui._updateInteract = () => {};
  ui._setText = (key, value) => { element(`[data-hud="${key}"]`).textContent = String(value ?? ''); };
  ui._setMeter = (key, value) => { element(`[data-meter="${key}"]`).style.setProperty('--value', `${Number(value) * 100}%`); };
  return { ui, element, rootClasses, hudClasses };
}

test('HUD renders canonical Momentum state and active Overdrive countdown', () => {
  const { ui, element, rootClasses, hudClasses } = createHudUpdateHarness();
  ui.updateHUD({
    momentum: { value: 78, rank: 'S', multiplier: 2.35, action: { label: 'ВОЗДУШНАЯ ЛИКВИДАЦИЯ', remaining: 1.4 } },
    overdrive: { active: true, ready: false, remaining: 4.25, duration: 8, key: 'KeyF' },
  });

  assert.equal(element('[data-hud="momentum-rank"]').textContent, 'S');
  assert.equal(element('[data-hud="momentum-multiplier"]').textContent, '×2.35');
  assert.equal(element('[data-hud="momentum-action"]').textContent, 'ВОЗДУШНАЯ ЛИКВИДАЦИЯ');
  assert.equal(element('[data-hud="momentum-action-time"]').textContent, '1.4 с');
  assert.equal(element('[data-hud="overdrive-status"]').textContent, 'АКТИВЕН');
  assert.equal(element('[data-hud="overdrive-time"]').textContent, '4.3 с');
  assert.equal(element('[data-hud="overdrive-key"]').textContent, 'F');
  assert.equal(rootClasses.has('is-overdrive-active'), true);
  assert.equal(hudClasses.has('is-overdrive-active'), true);
  assert.equal(element('[data-hud-panel="momentum"]').attrs['aria-valuenow'], '78');
});

test('HUD accepts flat Momentum fallback fields and marks Overdrive ready', () => {
  const { ui, element, rootClasses } = createHudUpdateHarness();
  ui.updateHUD({ momentumValue: 100, momentumRank: 'SSS', styleMultiplier: 3, styleAction: 'МУЛЬТИКИЛЛ', styleActionRemaining: 0.8, overdriveReady: true });

  assert.equal(element('[data-hud="momentum-rank"]').textContent, 'SSS');
  assert.equal(element('[data-hud="overdrive-status"]').textContent, 'ГОТОВ');
  assert.equal(element('[data-hud="overdrive-time"]').textContent, 'F // АКТИВИРОВАТЬ');
  assert.equal(rootClasses.has('is-overdrive-ready'), true);
  assert.equal(rootClasses.has('is-overdrive-active'), false);
});

test('HUD accepts MomentumSystem getState as the nested momentum object', () => {
  const { ui, element } = createHudUpdateHarness();
  ui.updateHUD({
    momentum: { momentum: 46, rank: 'A', multiplier: 1.6, lastAction: 'HEADHUNTER', overdrive: { ready: true, active: false, remaining: 0 } },
  });

  assert.equal(element('[data-hud="momentum-rank"]').textContent, 'A');
  assert.equal(element('[data-hud="momentum-action"]').textContent, 'HEADHUNTER');
  assert.equal(element('[data-hud-panel="momentum"]').attrs['aria-valuenow'], '46');
  assert.equal(element('[data-hud="overdrive-status"]').textContent, 'ГОТОВ');
});

test('input activation prompt only displays over active gameplay and can be dismissed', () => {
  const ui = Object.create(UIManager.prototype);
  const toggles = [];
  ui._ensureInit = () => {};
  ui.activeView = 'playing';
  ui.hud = { hidden: false };
  ui.screen = { hidden: true };
  ui.inputActivation = {
    hidden: true,
    classList: { toggle: (...args) => toggles.push(args) },
  };

  ui.showInputActivation();
  assert.equal(ui.inputActivationRequested, true);
  assert.equal(ui.inputActivation.hidden, false);
  assert.deepEqual(toggles.at(-1), ['is-active', true]);

  ui.activeView = 'pause';
  ui._syncInputActivation();
  assert.equal(ui.inputActivation.hidden, true);
  assert.deepEqual(toggles.at(-1), ['is-active', false]);

  ui.hideInputActivation();
  assert.equal(ui.inputActivationRequested, false);
  assert.equal(ui.inputActivation.hidden, true);
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
