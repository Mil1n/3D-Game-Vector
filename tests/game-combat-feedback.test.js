import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/EventBus.js';
import { Game } from '../src/core/Game.js';

test('Game emits one tiered HUD and audio confirmation per aggregate combat impact', () => {
  const eventBus = new EventBus();
  const markers = [];
  const confirmations = [];
  let crosshairCalls = 0;
  const game = {
    eventBus,
    unsubscribers: [],
    ui: {
      setHitmarker: (payload) => markers.push(payload),
      setCrosshair: () => { crosshairCalls += 1; },
    },
    audio: { playCombatConfirmation: (payload) => confirmations.push(payload) },
  };
  Game.prototype.registerEvents.call(game);

  for (let pellet = 0; pellet < 8; pellet += 1) {
    eventBus.emit('combat:hit', { shotId: 1, zone: pellet === 0 ? 'head' : 'body', killed: pellet === 0 });
  }
  assert.equal(markers.length, 0);
  assert.equal(confirmations.length, 0);
  assert.equal(crosshairCalls, 0);

  const body = { shotId: 1, hitCount: 8, headshot: false, critical: false, killed: false };
  const precision = { shotId: 2, hitCount: 1, headshot: true, critical: false, killed: false };
  const critical = { shotId: 3, hitCount: 1, headshot: false, critical: true, killed: false };
  const lethalHeadshot = { shotId: 4, hitCount: 2, headshot: true, critical: true, killed: true, blastHits: 1 };
  eventBus.emit('combat:impact', body);
  eventBus.emit('combat:impact', precision);
  eventBus.emit('combat:impact', critical);
  eventBus.emit('combat:impact', lethalHeadshot);

  assert.deepEqual(markers.map(({ type }) => type), ['body', 'headshot', 'headshot', 'kill']);
  assert.deepEqual(markers.map(({ shotId }) => shotId), [1, 2, 3, 4]);
  assert.deepEqual(confirmations, [body, precision, critical, lethalHeadshot]);
  assert.equal(crosshairCalls, 0);

  game.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  eventBus.emit('combat:impact', { shotId: 5, killed: true });
  assert.equal(markers.length, 4);
  assert.equal(confirmations.length, 4);
});
