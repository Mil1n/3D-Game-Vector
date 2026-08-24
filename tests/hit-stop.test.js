import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../src/core/EventBus.js';
import { HitStopController } from '../src/core/HitStopController.js';

const fullSettings = (hitStop = 1, reducedMotion = false) => ({
  gameplay: { hitStop },
  accessibility: { reducedMotion },
});

test('resolved impacts trigger bounded hit-stop while weak and invalid impacts are ignored', () => {
  const eventBus = new EventBus();
  const controller = new HitStopController({ eventBus, settings: fullSettings() });

  eventBus.emit('combat:impact', { shotId: 1, hitStop: 0 });
  eventBus.emit('combat:impact', { shotId: 2, hitStop: Number.NaN });
  assert.equal(controller.active, false);

  eventBus.emit('combat:impact', { shotId: 3, hitStop: 0.04 });
  assert.equal(controller.active, true);
  assert.equal(controller.getState().remaining, 0.04);
  assert.equal(controller.getState().triggerCount, 1);

  controller.request(10, { shotId: 4 });
  assert.equal(controller.getState().remaining, 0.075);
  controller.dispose();
});

test('requests coalesce by maximum duration and duplicate shot IDs cannot stack', () => {
  const controller = new HitStopController({ settings: fullSettings() });

  assert.equal(controller.request(0.04, { shotId: 'scatter-1' }), true);
  assert.equal(controller.request(0.04, { shotId: 'scatter-1' }), false);
  assert.equal(controller.request(0.02, { shotId: 'scatter-2' }), false);
  assert.equal(controller.getState().remaining, 0.04);
  assert.equal(controller.getState().triggerCount, 1);

  assert.equal(controller.request(0.06, { shotId: 'nova-1' }), true);
  assert.equal(controller.getState().remaining, 0.06);
  assert.equal(controller.getState().triggerCount, 2);
  controller.dispose();
});

test('hit-stop expires from unscaled real time and returns the playable frame fraction', () => {
  const controller = new HitStopController({ settings: fullSettings() });
  controller.request(0.05);

  assert.equal(controller.update(0.02), 0);
  assert.ok(Math.abs(controller.getState().remaining - 0.03) < 1e-12);
  const finalMultiplier = controller.update(0.04);
  assert.ok(Math.abs(finalMultiplier - 0.25) < 1e-12);
  assert.equal(controller.active, false);
  assert.equal(controller.update(0.02), 1);

  controller.request(0.05);
  assert.ok(Math.abs(controller.update(0.5) - 0.9) < 1e-12);
  controller.dispose();
});

test('duration and simulated time remain frame-rate independent', () => {
  const runAt = (fps) => {
    const controller = new HitStopController({ settings: fullSettings() });
    const frameDelta = 1 / fps;
    controller.request(0.06);
    let elapsed = 0;
    let simulated = 0;
    while (controller.active && elapsed < 1) {
      simulated += frameDelta * controller.update(frameDelta);
      elapsed += frameDelta;
    }
    controller.dispose();
    return { elapsed, simulated, frameDelta };
  };

  for (const fps of [30, 60, 144]) {
    const result = runAt(fps);
    assert.ok(result.elapsed >= 0.06);
    assert.ok(result.elapsed <= 0.06 + result.frameDelta + 1e-12);
    assert.ok(Math.abs(result.simulated - (result.elapsed - 0.06)) <= 1e-12);
  }
});

test('intensity, reduced motion and trigger gating immediately suppress active stops', () => {
  let playing = true;
  const controller = new HitStopController({
    settings: fullSettings(0.5),
    canTrigger: () => playing,
  });

  controller.request(0.06);
  assert.ok(Math.abs(controller.getState().remaining - 0.03) < 1e-12);
  controller.applySettings(fullSettings(0, false));
  assert.equal(controller.active, false);
  assert.equal(controller.update(0.01), 1);

  controller.applySettings(fullSettings(1, false));
  controller.request(0.04, { shotId: 2 });
  controller.applySettings(fullSettings(1, true));
  assert.equal(controller.active, false);

  controller.applySettings(fullSettings(1, false));
  playing = false;
  assert.equal(controller.request(0.04, { shotId: 3 }), false);
  assert.equal(controller.active, false);
  controller.dispose();
});

test('reset and dispose are idempotent and release event listeners', () => {
  const eventBus = new EventBus();
  const controller = new HitStopController({ eventBus, settings: fullSettings() });
  assert.equal(eventBus.listenerCount('combat:impact'), 1);

  eventBus.emit('combat:impact', { shotId: 1, hitStop: 0.04 });
  controller.reset();
  assert.deepEqual(controller.getState(), {
    active: false,
    enabled: true,
    intensity: 1,
    remaining: 0,
    lastDuration: 0,
    multiplier: 1,
    triggerCount: 0,
  });

  controller.dispose();
  controller.dispose();
  assert.equal(eventBus.listenerCount('combat:impact'), 0);
  eventBus.emit('combat:impact', { shotId: 2, hitStop: 0.05 });
  assert.equal(controller.update(0.01), 1);
  assert.equal(controller.active, false);
});

test('the per-frame update path uses delta time without timers or constructor allocations', () => {
  const source = HitStopController.prototype.update.toString();
  assert.doesNotMatch(source, /setTimeout|setInterval|requestAnimationFrame/);
  assert.doesNotMatch(source, /\bnew\s+[A-Z]/);
});
