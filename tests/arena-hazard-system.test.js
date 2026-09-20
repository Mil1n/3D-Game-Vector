import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { EventBus } from '../src/core/EventBus.js';
import { MAP_CONFIGS, MAP_ORDER } from '../src/configs/mapConfigs.js';
import { Arena } from '../src/world/Arena.js';
import { ArenaHazardSystem, HAZARD_STATES } from '../src/world/ArenaHazardSystem.js';

const STEP = 1 / 60;

function pointInside(zone) {
  return zone.position.clone().add(new THREE.Vector3(0, 1, 0));
}

function pointOutside(zone) {
  return zone.position.clone().add(new THREE.Vector3(zone.radius + 1, 1, 0));
}

function captureEvents(eventBus, names) {
  const events = [];
  const unsubscribers = names.map((name) => eventBus.on(name, (payload) => events.push({ name, payload })));
  return { events, dispose: () => unsubscribers.forEach((unsubscribe) => unsubscribe()) };
}

test('every arena builds a distinct readable environmental hazard', () => {
  const scene = new THREE.Scene();
  const system = new ArenaHazardSystem({ scene, map: MAP_ORDER[0] });

  for (const mapId of MAP_ORDER) {
    system.setMap(mapId);
    const expected = MAP_CONFIGS[mapId].hazards.zones.length;
    const debug = system.getDebugData();
    assert.equal(system.mapId, mapId);
    assert.equal(system.zones.length, expected);
    assert.equal(system.group.children.length, expected);
    assert.equal(debug.zoneCount, expected);
    for (const zone of system.zones) {
      assert.equal(zone.visual.userData.arenaHazard.id, zone.id);
      assert.ok(zone.visual.getObjectByName('HAZARD_FIELD'));
      assert.ok(zone.visual.getObjectByName('HAZARD_RING'));
      assert.equal(zone.pylons.children.length, 8);
      assert.equal(zone.state, HAZARD_STATES.COOLDOWN);
      assert.equal(zone.remaining, zone.initialDelay);
    }
  }

  system.dispose();
  assert.equal(scene.children.includes(system.group), false);
});

test('hazards telegraph before activation and apply bounded periodic damage only while active', () => {
  const eventBus = new EventBus();
  const calls = [];
  const player = {
    damage(amount, context) {
      calls.push({ amount, context });
      return { healthDamage: 5, armorDamage: 2, killed: false };
    },
  };
  const captured = captureEvents(eventBus, [
    'arena:hazard-warning',
    'arena:hazard-activated',
    'arena:hazard-hit',
    'combat:player-hit',
    'arena:hazard-ended',
  ]);
  const system = new ArenaHazardSystem({ scene: new THREE.Scene(), eventBus, player, map: 'null-grid' });
  const zone = system.zones[0];
  zone.tickInterval = 0.2;
  const inside = pointInside(zone);
  const outside = pointOutside(zone);

  zone.remaining = 0.01;
  assert.equal(system.update(0.02, inside), 0);
  assert.equal(zone.state, HAZARD_STATES.WARNING);
  assert.equal(calls.length, 0, 'warning phase must never damage the player');

  zone.remaining = 0.01;
  assert.equal(system.update(0.02, inside), 1);
  assert.equal(zone.state, HAZARD_STATES.ACTIVE);
  assert.equal(calls.length, 1, 'entering an active field should apply one immediate tick');
  assert.equal(calls[0].amount, zone.damage);
  assert.equal(calls[0].context.cause, zone.cause);
  assert.equal(calls[0].context.type, 'environmental');

  system.update(0.05, outside);
  system.update(0.05, inside);
  assert.equal(calls.length, 1, 'a quick out/in boundary step must not bypass the tick interval');
  assert.equal(system.update(0.11, inside), 1);
  assert.equal(calls.length, 2);

  zone.remaining = 0.01;
  assert.equal(system.update(0.02, inside), 0);
  assert.equal(zone.state, HAZARD_STATES.COOLDOWN);
  assert.equal(calls.length, 2, 'cooldown phase must stop damage immediately');

  assert.deepEqual(
    captured.events.filter(({ name }) => name !== 'arena:hazard-hit' && name !== 'combat:player-hit')
      .map(({ name }) => name),
    ['arena:hazard-warning', 'arena:hazard-activated', 'arena:hazard-ended'],
  );
  assert.equal(captured.events.filter(({ name }) => name === 'arena:hazard-hit').length, 2);
  assert.equal(captured.events.filter(({ name }) => name === 'combat:player-hit').length, 2);
  const hitPayload = captured.events.find(({ name }) => name === 'arena:hazard-hit')?.payload;
  assert.equal(hitPayload?.phase, 'damage');
  assert.equal(hitPayload?.damage, 7, 'hit payload reports applied health and armor damage');
  assert.equal(hitPayload?.duration, zone.activeDuration);
  assert.equal(hitPayload?.color, zone.activeColor);

  const eventCount = captured.events.length;
  player.damage = () => ({ healthDamage: 0, armorDamage: 0, killed: false, invincible: true });
  zone.state = HAZARD_STATES.ACTIVE;
  zone.remaining = 10;
  zone.damageRemaining = 0;
  assert.equal(system.update(STEP, inside), 0, 'an invincible player must not produce a semantic hit');
  assert.equal(captured.events.length, eventCount);
  captured.dispose();
  system.dispose();
});

test('hazard trigger volume rejects players outside its radius or vertical layer', () => {
  const calls = [];
  const player = {
    damage(...args) {
      calls.push(args);
      return { healthDamage: args[0], armorDamage: 0, killed: false };
    },
  };
  const system = new ArenaHazardSystem({ scene: new THREE.Scene(), player, map: 'sky-foundry' });
  const zone = system.zones[0];
  zone.state = HAZARD_STATES.ACTIVE;
  zone.remaining = 10;

  assert.equal(system.update(STEP, pointOutside(zone)), 0);
  assert.equal(system.update(STEP, zone.position.clone().add(new THREE.Vector3(0, zone.triggerHeight + 0.5, 0))), 0);
  assert.equal(calls.length, 0);
  assert.equal(system.update(STEP, pointInside(zone)), 1);
  assert.equal(calls.length, 1);
  system.dispose();
});

test('reduced motion makes hazard presentation static without disabling its state or damage', () => {
  const calls = [];
  const player = {
    damage(...args) {
      calls.push(args);
      return { healthDamage: args[0], armorDamage: 0, killed: false };
    },
  };
  const system = new ArenaHazardSystem({ scene: new THREE.Scene(), player, map: 'sunken-relay' });
  const zone = system.zones[0];
  zone.state = HAZARD_STATES.WARNING;
  zone.remaining = 10;
  system.update(0.1, null);

  assert.equal(system.setReducedMotion(true), true);
  const staticPose = {
    ringScale: zone.ring.scale.x,
    markerHeight: zone.pylons.children[0].scale.y,
    opacity: zone.disc.material.opacity,
  };
  for (let frame = 0; frame < 20; frame += 1) system.update(STEP, null);
  assert.deepEqual({
    ringScale: zone.ring.scale.x,
    markerHeight: zone.pylons.children[0].scale.y,
    opacity: zone.disc.material.opacity,
  }, staticPose);

  zone.state = HAZARD_STATES.ACTIVE;
  zone.remaining = 10;
  zone.damageRemaining = 0;
  assert.equal(system.update(STEP, pointInside(zone)), 1);
  assert.equal(calls.length, 1, 'reduced motion must not change hazard gameplay');

  assert.equal(system.setReducedMotion(false), false);
  const animatedScale = zone.ring.scale.x;
  system.update(0.1, null);
  assert.notEqual(zone.ring.scale.x, animatedScale, 'live re-enable should resume the pulse');
  system.dispose();
});

test('reset, map changes and dispose clear runtime state and release visual resources', () => {
  const scene = new THREE.Scene();
  const system = new ArenaHazardSystem({ scene, map: 'null-grid' });
  const first = system.zones[0];
  first.state = HAZARD_STATES.ACTIVE;
  first.remaining = 0.4;
  first.damageRemaining = 0.2;
  first.inside = true;

  system.reset();
  assert.equal(first.state, HAZARD_STATES.COOLDOWN);
  assert.equal(first.remaining, first.initialDelay);
  assert.equal(first.damageRemaining, 0);
  assert.equal(first.inside, false);

  let disposedMaterials = 0;
  for (const material of first.materials) {
    const dispose = material.dispose.bind(material);
    material.dispose = () => { disposedMaterials += 1; dispose(); };
  }
  system.setMap('sky-foundry');
  assert.equal(disposedMaterials, first.materials.length);
  assert.equal(system.mapId, 'sky-foundry');
  assert.ok(system.zones.every(({ state, remaining, initialDelay }) => (
    state === HAZARD_STATES.COOLDOWN && remaining === initialDelay
  )));

  system.dispose();
  system.dispose();
  assert.equal(scene.children.includes(system.group), false);
  assert.equal(system.zones.length, 0);
  assert.equal(system.update(STEP, new THREE.Vector3()), 0);
  assert.throws(() => system.setMap('null-grid'), /disposed system/i);
});

test('configured hazard discs sit entirely on their declared physical surface', () => {
  const samples = 12;
  for (const mapId of MAP_ORDER) {
    const scene = new THREE.Scene();
    const world = new CANNON.World();
    const arena = new Arena({ scene, mapId }).build(world);
    for (const config of MAP_CONFIGS[mapId].hazards.zones) {
      const center = new THREE.Vector3().fromArray(config.position);
      for (let index = -1; index < samples; index += 1) {
        const point = center.clone();
        if (index >= 0) {
          const angle = index / samples * Math.PI * 2;
          point.x += Math.sin(angle) * config.radius * 0.9;
          point.z += Math.cos(angle) * config.radius * 0.9;
        }
        const surface = arena.getSurfaceHeight(point, {
          currentY: config.position[1] + 1,
          above: 1.5,
          below: 2.5,
        });
        assert.ok(Number.isFinite(surface), `${mapId}/${config.id}: hazard sample needs physical support`);
        assert.ok(
          Math.abs(surface - config.position[1]) < 0.03,
          `${mapId}/${config.id}: expected y=${config.position[1]}, got ${surface}`,
        );
      }
    }
    arena.dispose();
  }
});
