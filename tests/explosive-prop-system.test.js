import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ExplosivePropSystem } from '../src/world/ExplosivePropSystem.js';
import { Arena } from '../src/world/Arena.js';
import { MAP_CONFIGS, MAP_ORDER } from '../src/configs/mapConfigs.js';
import { WeaponSystem } from '../src/combat/WeaponSystem.js';
import { EnemySystem } from '../src/combat/EnemySystem.js';
import { WEAPON_CONFIGS } from '../src/configs/weaponConfigs.js';
import { EventBus } from '../src/core/EventBus.js';

function harness(options = {}) {
  const world = new CANNON.World();
  const scene = new THREE.Scene();
  const arena = new Arena({ scene, mapId: 'sunken-relay' }).build(world);
  const eventBus = new EventBus();
  const system = new ExplosivePropSystem({ scene, world, arena, eventBus, map: 'sunken-relay', ...options });
  return { world, scene, arena, eventBus, system, dispose() { system.dispose(); arena.dispose(); } };
}

test('containers wait for the full warning fuse; repeated hits cannot shorten it', () => {
  const h = harness();
  const p = h.system.props[0];
  let warnings = 0;
  let explosions = 0;
  h.eventBus.on('arena:prop-armed', () => warnings++);
  h.eventBus.on('arena:prop-exploded', () => explosions++);
  assert.equal(h.system.damageBody(p.body, 16), true);
  assert.equal(p.state, 'idle');
  h.system.damageBody(p.body, 16);
  assert.equal(p.state, 'armed');
  assert.equal(p.ring.visible, true);
  assert.equal(p.remaining, p.fuse);
  assert.equal(h.system.damageBody(p.body, 900), false);
  h.system.update(0);
  h.system.update(NaN);
  assert.equal(p.remaining, p.fuse);
  h.system.update(0.99);
  assert.equal(explosions, 0);
  h.system.update(0.02);
  assert.equal(p.state, 'spent');
  assert.equal(p.visual.visible, false);
  assert.equal(h.world.bodies.includes(p.body), false);
  assert.equal(warnings, 2, 'nearby container starts a separate chain warning');
  assert.equal(explosions, 1);
  h.system.update(0.2);
  assert.equal(explosions, 1);
  h.dispose();
});

test('chain reactions receive their own full fuse in either configuration order', () => {
  for (const reverse of [false, true]) {
    const h = harness();
    const [source, target] = h.system.props;
    if (reverse) h.system.props.reverse();
    h.system.damageBody(source.body, 100);
    h.system.update(source.fuse);
    assert.equal(target.state, 'armed');
    assert.equal(target.remaining, target.fuse);
    h.system.update(target.fuse - 0.01);
    assert.equal(target.state, 'armed');
    h.system.update(0.02);
    assert.equal(target.state, 'spent');
    h.dispose();
  }
});

test('weapon ray hits physical containers, but does not shoot through closer enemies or cover', () => {
  const h = harness();
  const p = h.system.props[0];
  const origin = p.position.clone().add(new THREE.Vector3(0, 0, 4));
  const direction = new THREE.Vector3(0, 0, -1);
  const weapons = new WeaponSystem({ scene: h.scene, camera: new THREE.PerspectiveCamera(),
    arena: h.arena, explosiveSystem: h.system, effects: { spawnImpact() {} }, random: () => 1 });
  const result = weapons.traceShot(origin, direction, weapons.currentConfig);
  assert.equal(result.enemyHit, false);
  assert.ok(p.health < p.maxHealth);
  h.system.reset();
  weapons.enemySystem = { raycast: () => ({ distance: 1, point: origin.clone().add(direction), zone: 'body', enemy: {} }),
    damage: () => ({ applied: 1, killed: false }) };
  weapons.traceShot(origin, direction, weapons.currentConfig);
  assert.equal(p.health, p.maxHealth);
  weapons.enemySystem = null;
  const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(2, 2, 0.15)),
    position: new CANNON.Vec3(p.position.x, p.position.y, p.position.z + 2), collisionFilterGroup: 2 });
  h.world.addBody(wall);
  weapons.traceShot(origin, direction, weapons.currentConfig);
  assert.equal(p.health, p.maxHealth);
  weapons.dispose();
  h.dispose();
});

test('Nova impact blasts damage containers without reporting a false enemy hit', () => {
  const h = harness();
  const p = h.system.props[0];
  const weapons = new WeaponSystem({ scene: h.scene, camera: new THREE.PerspectiveCamera(),
    arena: h.arena, explosiveSystem: h.system, effects: { spawnExplosion() {} } });
  const config = Object.values(WEAPON_CONFIGS).find((weapon) => weapon.impactBlast);
  const result = weapons.applyImpactBlast(p.position.clone().add(new THREE.Vector3(0, 0, 0.6)), config);
  assert.equal(p.state, 'armed');
  assert.equal(result.hits, 0);
  weapons.dispose();
  h.dispose();
});

test('container bodies physically stop movement and remove collision after detonation', () => {
  const h = harness();
  const p = h.system.props[0];
  const actor = new CANNON.Body({ mass: 5, shape: new CANNON.Sphere(0.4), linearDamping: 0,
    position: new CANNON.Vec3(p.position.x, p.position.y, p.position.z + 4) });
  h.world.addBody(actor);
  for (let i = 0; i < 60; i++) { actor.velocity.z = -6; h.world.step(1 / 60); }
  assert.ok(actor.position.z >= p.position.z + 0.9, 'physical contact should stop the actor');
  h.system.damageBody(p.body, 100);
  h.system.update(1);
  for (let i = 0; i < 30; i++) { actor.velocity.z = -6; h.world.step(1 / 60); }
  assert.ok(actor.position.z < p.position.z - 0.8, 'spent container must leave no invisible collider');
  h.dispose();
});

test('cover blocks blast damage to player, enemies and chained containers', () => {
  const calls = [];
  const player = { position: new THREE.Vector3(-31, 0.8, 15),
    damage: (amount) => { calls.push(amount); return { healthDamage: amount }; } };
  const h = harness({ player });
  const [p, target] = h.system.props;
  const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.15, 3, 4)),
    position: new CANNON.Vec3(-33.5, 2, 15), collisionFilterGroup: 2 });
  h.world.addBody(wall);
  const enemies = [{ root: { position: player.position.clone() }, forward: new THREE.Vector3(0, 0, 1) }];
  h.system.enemySystem = { enemies, arena: h.arena, tempRadialDirection: new THREE.Vector3(),
    damage() { assert.fail('wall should stop enemy damage'); }, damageInRadius: EnemySystem.prototype.damageInRadius };
  h.system.damageBody(p.body, 100);
  h.system.update(1);
  assert.equal(calls.length, 0);
  assert.equal(target.health, target.maxHealth);
  h.dispose();
});

test('open blast uses radial falloff for player and enemies and supplies explosion kill credit', () => {
  const playerHits = [];
  const enemyHits = [];
  const player = { position: new THREE.Vector3(-35, 0.8, 17),
    damage: (amount) => { playerHits.push(amount); return { healthDamage: amount }; } };
  const h = harness({ player });
  const p = h.system.props[0];
  const enemy = (z) => ({ root: { position: new THREE.Vector3(-35, 0.8, z) }, forward: new THREE.Vector3(0, 0, 1) });
  h.system.enemySystem = { enemies: [enemy(16), enemy(20), enemy(23)], arena: h.arena,
    tempRadialDirection: new THREE.Vector3(), damageInRadius: EnemySystem.prototype.damageInRadius,
    damage(target, amount, context) { enemyHits.push({ amount, context }); return { applied: amount, killed: true }; } };
  let confirmation;
  h.eventBus.on('arena:prop-exploded', (event) => { confirmation = event; });
  h.system.damageBody(p.body, 100);
  h.system.update(1);
  assert.ok(Math.abs(playerHits[0] - p.playerDamage * (1 - 2 / p.radius * 0.72)) < 1e-8);
  assert.equal(enemyHits.length, 2);
  assert.ok(enemyHits[0].amount > enemyHits[1].amount);
  assert.equal(enemyHits[0].context.weapon, 'container-explosion');
  assert.equal(confirmation.kills, 2);
  h.dispose();
});

test('invulnerability never emits a phantom player damage confirmation', () => {
  const h = harness({ player: { position: new THREE.Vector3(-35, 0.8, 17), damage: () => ({ healthDamage: 0, armorDamage: 0 }) } });
  let hits = 0;
  h.eventBus.on('combat:player-hit', () => hits++);
  h.system.damageBody(h.system.props[0].body, 100);
  h.system.update(1);
  assert.equal(hits, 0);
  h.dispose();
});

test('reset, map changes and repeated disposal do not duplicate bodies or leak owned materials', () => {
  const h = harness();
  const initialBodies = h.world.bodies.length;
  const first = h.system.props[0];
  let materialsDisposed = 0;
  first.coreMaterial.addEventListener('dispose', () => materialsDisposed++);
  first.ringMaterial.addEventListener('dispose', () => materialsDisposed++);
  for (let i = 0; i < 5; i++) {
    h.system.damageBody(first.body, 100);
    h.system.update(1);
    h.system.reset();
    h.system.reset();
    assert.equal(h.world.bodies.length, initialBodies);
    assert.equal(first.health, first.maxHealth);
    assert.equal(first.ring.visible, false);
  }
  h.system.setMap('null-grid');
  assert.equal(materialsDisposed, 2);
  assert.equal(h.world.bodies.includes(first.body), false);
  assert.equal(h.world.bodies.length, initialBodies);
  h.system.dispose();
  h.system.dispose();
  h.system.update(1);
  assert.equal(h.world.bodies.length, initialBodies - 3);
  assert.equal(h.scene.children.includes(h.system.group), false);
  assert.throws(() => h.system.setMap('null-grid'), /disposed/);
  h.arena.dispose();
});

test('Reduced Motion keeps a static warning without changing fuse or damage', () => {
  const h = harness();
  const p = h.system.props[0];
  h.system.damageBody(p.body, 100);
  h.system.setReducedMotion(true);
  const intensity = p.coreMaterial.emissiveIntensity;
  h.system.update(0.5);
  assert.equal(p.coreMaterial.emissiveIntensity, intensity);
  assert.equal(p.ring.visible, true);
  assert.equal(p.remaining, 0.5);
  h.system.update(0.5);
  assert.equal(p.state, 'spent');
  h.dispose();
});

test('all containers have physical support and stay clear of map geometry before and after shifts', () => {
  for (const mapId of MAP_ORDER) {
    const scene = new THREE.Scene();
    const world = new CANNON.World();
    const arena = new Arena({ scene, mapId }).build(world);
    for (let phase = 0; phase < 2; phase++) {
      for (const prop of MAP_CONFIGS[mapId].explosives) {
        const center = new THREE.Vector3().fromArray(prop.position);
        for (const dx of [-0.56, 0, 0.56]) for (const dz of [-0.56, 0, 0.56]) {
          const sample = center.clone().add(new THREE.Vector3(dx, 0, dz));
          const height = arena.getSurfaceHeight(sample, { currentY: center.y + 1, above: 1, below: 2 });
          assert.ok(Math.abs(height - center.y) < 0.03, `${mapId}/${prop.id} phase ${phase}: base ${center.y}, surface ${height}`);
        }
        for (let angle = 0; angle < 16; angle++) {
          const dir = new THREE.Vector3(Math.sin(angle / 8 * Math.PI), 0, Math.cos(angle / 8 * Math.PI));
          const hit = arena.raycastWorld(center.clone().add(new THREE.Vector3(0, 0.8, 0)), dir, 0.9);
          assert.equal(hit.hit, false, `${prop.id}: intersects map geometry, phase ${phase}`);
        }
        for (const spawn of MAP_CONFIGS[mapId].spawns.player) {
          assert.ok(center.distanceTo(new THREE.Vector3().fromArray(spawn)) > 6, `${prop.id}: too close to player spawn`);
        }
      }
      arena.applyShift('all');
    }
    arena.dispose();
  }
});
