import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { WeaponSystem } from '../src/combat/WeaponSystem.js';
import { WEAPON_ORDER } from '../src/configs/weaponConfigs.js';

const noopEffects = {
  spawnTracer() {},
  spawnMuzzle() {},
  spawnImpact() {},
  spawnExplosion() {},
};

test('WeaponSystem creates and switches across the five configured weapons', () => {
  const camera = new THREE.PerspectiveCamera();
  const weapons = new WeaponSystem({
    camera,
    scene: new THREE.Scene(),
    eventBus: { emit() {} },
    audioManager: { playUI() {} },
    effects: noopEffects,
    arena: null,
    player: null,
  });

  assert.deepEqual(weapons.weaponOrder, [...WEAPON_ORDER]);
  assert.equal(weapons.models.size, 5);
  assert.equal(weapons.currentId, 'carbine');
  assert.equal(weapons.switchTo(3), true);
  assert.equal(weapons.currentId, 'plasma');
  assert.equal(weapons.switchTo(4), true);
  assert.equal(weapons.currentId, 'nova');
  assert.equal(weapons.switchTo(5), false);
  assert.equal(weapons.currentId, 'nova');

  weapons.reset();
  assert.equal(weapons.currentId, 'carbine');

  weapons.setEnabled(true);
  const inputFor = (pressed, wheel = 0) => ({
    wasPressed: (action) => action === pressed,
    isDown: () => false,
    consumeWheel: () => wheel,
  });
  weapons.update(1 / 60, inputFor('weapon4'));
  assert.equal(weapons.currentId, 'plasma');
  weapons.update(1 / 60, inputFor('weapon5'));
  assert.equal(weapons.currentId, 'nova');
  weapons.update(1 / 60, inputFor(null, 1));
  assert.equal(weapons.currentId, 'carbine');

  let blastCall = null;
  weapons.setEnemySystem({
    damageInRadius: (...args) => {
      blastCall = args;
      return 2;
    },
  });
  weapons.switchTo(4);
  const blast = weapons.applyImpactBlast(new THREE.Vector3(1, 2, 3), weapons.currentConfig);
  assert.equal(blast.hits, 2);
  assert.equal(blast.radius, 5.2);
  assert.equal(blastCall[3].weapon, 'nova-blast');

  weapons.dispose();
});
