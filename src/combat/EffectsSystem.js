import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function makePool(size, factory) {
  const items = Array.from({ length: size }, (_, index) => {
    const object = factory(index);
    object.visible = false;
    object.userData.life = 0;
    object.userData.duration = 1;
    return object;
  });
  let cursor = 0;
  return {
    items,
    next() {
      const item = items[cursor];
      cursor = (cursor + 1) % items.length;
      item.visible = true;
      item.userData.life = item.userData.duration;
      return item;
    },
  };
}

export class EffectsSystem {
  constructor({ scene, camera, eventBus, quality = 'high' }) {
    this.scene = scene;
    this.camera = camera;
    this.eventBus = eventBus;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'Pooled effects';
    this.scene.add(this.group);

    const multiplier = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
    const tracerGeometry = new THREE.CylinderGeometry(0.012, 0.026, 1, 5, 1, true);
    const particleGeometry = new THREE.IcosahedronGeometry(0.045, 0);
    const flashGeometry = new THREE.IcosahedronGeometry(0.16, 1);
    const ringGeometry = new THREE.RingGeometry(0.18, 0.25, 24);

    this.tracers = makePool(Math.floor(34 * multiplier), () => {
      const mesh = new THREE.Mesh(
        tracerGeometry,
        new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      mesh.userData.duration = 0.075;
      this.group.add(mesh);
      return mesh;
    });

    this.particles = makePool(Math.floor(110 * multiplier), () => {
      const mesh = new THREE.Mesh(
        particleGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffb34e, transparent: true, opacity: 1, depthWrite: false }),
      );
      mesh.userData.duration = 0.45;
      mesh.userData.velocity = new THREE.Vector3();
      mesh.userData.gravity = 7;
      this.group.add(mesh);
      return mesh;
    });

    this.flashes = makePool(Math.floor(20 * multiplier), () => {
      const mesh = new THREE.Mesh(
        flashGeometry,
        new THREE.MeshBasicMaterial({ color: 0xa7f6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.userData.duration = 0.11;
      this.group.add(mesh);
      return mesh;
    });

    this.rings = makePool(Math.floor(18 * multiplier), () => {
      const mesh = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({ color: 0xe960ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.userData.duration = 0.55;
      this.group.add(mesh);
      return mesh;
    });

    this.tempStart = new THREE.Vector3();
    this.tempEnd = new THREE.Vector3();
    this.tempDirection = new THREE.Vector3();
    this.tempMid = new THREE.Vector3();
    this.unsubscribeSettings = this.eventBus?.on?.('settings:changed', ({ settings }) => {
      if (settings?.graphics?.particles) this.quality = settings.graphics.particles;
    });
  }

  spawnMuzzle(position, direction, color = 0xa7f6ff, intensity = 1) {
    const flash = this.flashes.next();
    // Death flashes share this pool and use a longer lifetime. Restore the
    // muzzle duration whenever a pooled item changes role.
    flash.userData.duration = 0.11;
    flash.userData.life = flash.userData.duration;
    flash.position.copy(position).addScaledVector(direction, 0.16);
    flash.material.color.set(color);
    flash.scale.setScalar(0.65 + intensity * 0.45);
  }

  spawnTracer(start, end, color = 0x5ee7ff, width = 1) {
    const tracer = this.tracers.next();
    this.tempStart.copy(start);
    this.tempEnd.copy(end);
    this.tempDirection.subVectors(this.tempEnd, this.tempStart);
    const length = Math.max(0.01, this.tempDirection.length());
    this.tempMid.addVectors(this.tempStart, this.tempEnd).multiplyScalar(0.5);
    tracer.position.copy(this.tempMid);
    tracer.scale.set(width, length, width);
    tracer.quaternion.setFromUnitVectors(UP, this.tempDirection.normalize());
    tracer.material.color.set(color);
    tracer.material.opacity = 0.92;
    tracer.userData.life = tracer.userData.duration;
  }

  spawnImpact(point, normal = UP, color = 0xffb34e, count = 7) {
    const max = this.quality === 'low' ? Math.ceil(count * 0.45) : count;
    for (let index = 0; index < max; index += 1) {
      const particle = this.particles.next();
      particle.position.copy(point).addScaledVector(normal, 0.03);
      particle.material.color.set(color);
      particle.material.opacity = 1;
      particle.scale.setScalar(0.55 + Math.random() * 0.8);
      particle.userData.life = 0.24 + Math.random() * 0.32;
      particle.userData.duration = particle.userData.life;
      particle.userData.gravity = 4 + Math.random() * 5;
      particle.userData.velocity
        .copy(normal)
        .multiplyScalar(1.4 + Math.random() * 4)
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          Math.random() * 2.5,
          (Math.random() - 0.5) * 4,
        ));
    }
  }

  spawnEnemyDeath(position, color = 0xff4e86, scale = 1) {
    const flash = this.flashes.next();
    flash.position.copy(position);
    flash.material.color.set(color);
    flash.scale.setScalar(1.4 * scale);
    flash.userData.duration = 0.24;
    flash.userData.life = flash.userData.duration;
    this.spawnImpact(position, UP, color, Math.floor(18 * scale));
  }

  spawnExplosion(position, radius = 3, color = 0xff7b3d) {
    const ring = this.rings.next();
    ring.position.copy(position);
    ring.rotation.set(-Math.PI / 2, 0, 0);
    ring.material.color.set(color);
    ring.scale.setScalar(0.1);
    ring.userData.maxScale = radius * 4;
    ring.userData.duration = 0.55;
    ring.userData.life = ring.userData.duration;
    this.spawnEnemyDeath(position, color, Math.min(1.6, radius / 2));
    this.eventBus?.emit?.('effects:explosion', { position: position.clone(), radius });
  }

  spawnShiftPulse(position, radius = 30) {
    const ring = this.rings.next();
    ring.position.copy(position).add(new THREE.Vector3(0, 0.08, 0));
    ring.rotation.set(-Math.PI / 2, 0, 0);
    ring.material.color.set(0xd36bff);
    ring.material.opacity = 0.9;
    ring.scale.setScalar(0.2);
    ring.userData.maxScale = radius * 4;
    ring.userData.duration = 1.25;
    ring.userData.life = ring.userData.duration;
  }

  spawnOverdrivePulse(position, phase = 'start', intensity = 1) {
    const ending = phase === 'end' || phase === 'ended' || phase === false;
    const strength = Math.max(0.25, Number(intensity) || 1);
    const ring = this.rings.next();
    ring.position.copy(position);
    ring.position.y += 0.08;
    ring.rotation.set(-Math.PI / 2, 0, 0);
    ring.material.color.set(ending ? 0x64f4ff : 0xff48c7);
    ring.material.opacity = ending ? 0.68 : 0.95;
    ring.scale.setScalar(ending ? 0.7 : 0.12);
    ring.userData.maxScale = (ending ? 7 : 12) * strength;
    ring.userData.duration = ending ? 0.48 : 0.82;
    ring.userData.life = ring.userData.duration;
    this.eventBus?.emit?.('effects:overdrive-pulse', {
      phase: ending ? 'end' : 'start',
      intensity: strength,
      position: position.clone?.() ?? { ...position },
    });
    return ring;
  }

  update(dt) {
    for (const tracer of this.tracers.items) {
      if (!tracer.visible) continue;
      tracer.userData.life -= dt;
      tracer.material.opacity = Math.max(0, tracer.userData.life / tracer.userData.duration);
      if (tracer.userData.life <= 0) tracer.visible = false;
    }

    for (const particle of this.particles.items) {
      if (!particle.visible) continue;
      particle.userData.life -= dt;
      particle.userData.velocity.y -= particle.userData.gravity * dt;
      particle.position.addScaledVector(particle.userData.velocity, dt);
      particle.material.opacity = Math.max(0, particle.userData.life / particle.userData.duration);
      particle.scale.multiplyScalar(Math.max(0.92, 1 - dt * 3));
      if (particle.userData.life <= 0) particle.visible = false;
    }

    for (const flash of this.flashes.items) {
      if (!flash.visible) continue;
      flash.userData.life -= dt;
      const ratio = Math.max(0, flash.userData.life / flash.userData.duration);
      flash.material.opacity = ratio;
      flash.scale.multiplyScalar(1 + dt * 5);
      if (flash.userData.life <= 0) flash.visible = false;
    }

    for (const ring of this.rings.items) {
      if (!ring.visible) continue;
      ring.userData.life -= dt;
      const elapsed = 1 - Math.max(0, ring.userData.life / ring.userData.duration);
      const target = ring.userData.maxScale ?? 12;
      ring.scale.setScalar(Math.max(0.01, target * elapsed));
      ring.material.opacity = Math.max(0, (1 - elapsed) * 0.8);
      if (ring.userData.life <= 0) ring.visible = false;
    }
  }

  get activeCount() {
    return [this.tracers, this.particles, this.flashes, this.rings]
      .flatMap((pool) => pool.items)
      .reduce((count, object) => count + Number(object.visible), 0);
  }

  reset() {
    for (const pool of [this.tracers, this.particles, this.flashes, this.rings]) {
      for (const object of pool.items) object.visible = false;
    }
  }

  dispose() {
    this.reset();
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.scene.remove(this.group);
    for (const pool of [this.tracers, this.particles, this.flashes, this.rings]) {
      for (const object of pool.items) object.material.dispose();
      pool.items[0]?.geometry?.dispose();
    }
  }
}

export default EffectsSystem;
