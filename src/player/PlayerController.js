import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const PLAYER_COLLISION_GROUP = 1;
const STATIC_WORLD_COLLISION_GROUP = 2;
const TAU = Math.PI * 2;

export const DEFAULT_PLAYER_CONFIG = Object.freeze({
  height: 1.8,
  radius: 0.42,
  mass: 8,
  walkSpeed: 6.8,
  sprintSpeed: 10.4,
  crouchSpeed: 4.1,
  groundAcceleration: 48,
  groundDeceleration: 58,
  airAcceleration: 15,
  jumpSpeed: 7.25,
  coyoteTime: 0.12,
  jumpBufferTime: 0.14,
  slideSpeed: 13.2,
  slideDuration: 0.62,
  slideCooldown: 0.45,
  dashSpeed: 17,
  dashDuration: 0.16,
  dashCooldown: 1.3,
  standingEyeOffset: 0.72,
  crouchingEyeOffset: 0.28,
  mouseSensitivity: 0.00215,
  maxPitch: Math.PI * 0.485,
  maxHealth: 100,
  maxArmor: 100,
  startingArmor: 35,
  armorAbsorption: 0.62,
  headBob: true,
  headBobScale: 1,
});

const TEMP_FORWARD = new THREE.Vector3();
const TEMP_RIGHT = new THREE.Vector3();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function asThreeVector(value, fallback = new THREE.Vector3()) {
  if (!value) return fallback.clone();
  return new THREE.Vector3(Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0);
}

function keyState(input, code) {
  const keys = input?.keys;
  if (keys instanceof Set) return keys.has(code);
  return Boolean(keys?.[code] ?? input?.[code]);
}

function normalizeConfig(config = {}) {
  const normalized = { ...config };
  if (normalized.walkSpeed == null && normalized.moveSpeed != null) normalized.walkSpeed = normalized.moveSpeed;
  if (normalized.jumpSpeed == null && normalized.jumpVelocity != null) normalized.jumpSpeed = normalized.jumpVelocity;
  if (normalized.height == null && normalized.standingHeight != null) normalized.height = normalized.standingHeight;
  if (normalized.maxArmor == null && normalized.maxShield != null) normalized.maxArmor = normalized.maxShield;
  if (normalized.startingArmor == null && normalized.maxShield != null) normalized.startingArmor = normalized.maxShield;
  return normalized;
}

function createPlayerModifiers() {
  return {
    moveSpeed: 1,
    dashCooldown: 1,
    dashDamageMultiplier: 1,
    killSpeed: 0,
    shieldOnHit: 0,
    lowHealthDamage: 0,
  };
}

/** Fixed-step FPS locomotion controller backed by a compound cannon-es capsule. */
export class PlayerController {
  constructor(optionsOrWorld = {}, legacyEventBus = null, legacyConfig = {}) {
    const options = optionsOrWorld?.addBody
      ? { world: optionsOrWorld, eventBus: legacyEventBus, config: legacyConfig }
      : optionsOrWorld;
    const {
      world,
      eventBus = null,
      camera = null,
      config = {},
      spawn = new THREE.Vector3(0, 1.05, 35),
    } = options ?? {};
    if (!world?.addBody) throw new Error('[PlayerController] A cannon-es World is required.');

    this.world = world;
    this.eventBus = eventBus;
    this.camera = camera;
    this.config = { ...DEFAULT_PLAYER_CONFIG, ...normalizeConfig(config) };
    this.initialSpawn = asThreeVector(spawn);
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = false;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isSliding = false;
    this.isDashing = false;
    this.isADS = false;
    this.invincible = false;
    this.dead = false;
    this.maxHealth = this.config.maxHealth;
    this.maxArmor = this.config.maxArmor;
    this._baseMaxHealth = this.maxHealth;
    this.health = this.maxHealth;
    this.armor = clamp(this.config.startingArmor, 0, this.maxArmor);
    this.lastDamageDirection = null;
    this.lastDamageAmount = 0;
    this.lastDamageCause = null;
    this.modifiers = createPlayerModifiers();
    this.anomaly = null;

    this._disposed = false;
    this._coyoteRemaining = 0;
    this._jumpBufferRemaining = 0;
    this._slideRemaining = 0;
    this._slideCooldownRemaining = 0;
    this._dashRemaining = 0;
    this._dashCooldownRemaining = 0;
    this._dashDirection = new THREE.Vector3(0, 0, -1);
    this._slideDirection = new THREE.Vector3(0, 0, -1);
    this._previousInput = { jump: false, crouch: false, dash: false };
    this._cameraHeight = this.config.standingEyeOffset;
    this._bobTime = 0;
    this._bobAmount = 0;
    this._previousVerticalVelocity = 0;
    this._speedBoostRemaining = 0;
    this._speedBoostScale = 1;
    this._aimAmount = 0;
    this._lastViewBob = { x: 0, y: 0 };
    this._positionView = new THREE.Vector3();
    this._velocityView = new THREE.Vector3();
    this._groundNormal = new THREE.Vector3(0, 1, 0);
    this._wishDirection = new THREE.Vector3();

    this.physicsMaterial = new CANNON.Material('player-frictionless');
    this.physicsMaterial.friction = 0;
    this.physicsMaterial.restitution = 0;
    this.body = this._createCapsuleBody(this.initialSpawn);
    this.world.addBody(this.body);
  }

  _createCapsuleBody(spawn) {
    const { height, radius, mass } = this.config;
    const cylinderHeight = Math.max(0.1, height - radius * 2);
    const body = new CANNON.Body({
      mass,
      material: this.physicsMaterial,
      position: new CANNON.Vec3(spawn.x, spawn.y, spawn.z),
      linearDamping: 0.045,
      angularDamping: 1,
      fixedRotation: true,
      allowSleep: false,
      collisionFilterGroup: PLAYER_COLLISION_GROUP,
      collisionFilterMask: -1,
    });
    body.name = 'player-capsule';
    body.userData = { player: true, damageable: true };

    const cylinder = new CANNON.Cylinder(radius, radius, cylinderHeight, 12);
    const rotateCylinderToY = new CANNON.Quaternion();
    rotateCylinderToY.setFromEuler(-Math.PI / 2, 0, 0);
    body.addShape(cylinder, new CANNON.Vec3(), rotateCylinderToY);
    const sphereOffset = cylinderHeight / 2;
    body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(0, sphereOffset, 0));
    body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(0, -sphereOffset, 0));
    body.updateMassProperties();
    return body;
  }

  fixedUpdate(input = {}, deltaSeconds = 1 / 60) {
    if (this._disposed || this.dead) return;
    const dt = clamp(Number(deltaSeconds) || 0, 0, 0.05);
    if (dt <= 0) return;

    const normalized = this._readInput(input);
    this._updateLook(normalized.lookX, normalized.lookY, input);
    this.isADS = normalized.ads;
    this._updateGroundState();
    this._tickTimers(dt);
    this._applyAnomalyGravity();

    const jumpPressed = normalized.jumpPressed
      ?? (normalized.jump && !this._previousInput.jump);
    const crouchPressed = normalized.crouchPressed
      ?? (normalized.crouch && !this._previousInput.crouch);
    const dashPressed = normalized.dashPressed
      ?? (normalized.dash && !this._previousInput.dash);
    this._previousInput.jump = normalized.jump;
    this._previousInput.crouch = normalized.crouch;
    this._previousInput.dash = normalized.dash;

    if (jumpPressed) this._jumpBufferRemaining = this.config.jumpBufferTime;
    if (this.grounded) this._coyoteRemaining = this.config.coyoteTime;

    const inputLength = Math.hypot(normalized.moveX, normalized.moveForward);
    const moveX = inputLength > 1 ? normalized.moveX / inputLength : normalized.moveX;
    const moveForward = inputLength > 1 ? normalized.moveForward / inputLength : normalized.moveForward;
    TEMP_FORWARD.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    TEMP_RIGHT.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this._wishDirection.copy(TEMP_FORWARD).multiplyScalar(moveForward)
      .addScaledVector(TEMP_RIGHT, moveX);
    if (this._wishDirection.lengthSq() > 1) this._wishDirection.normalize();

    this.isCrouching = normalized.crouch;
    this.isSprinting = normalized.sprint && !this.isCrouching && !this.isADS
      && moveForward > 0.2 && this._wishDirection.lengthSq() > 0.1;

    if (crouchPressed && this.grounded && normalized.sprint
      && moveForward > 0.2
      && this.horizontalSpeed > this.config.walkSpeed * 0.8
      && this._slideCooldownRemaining <= 0) {
      this._beginSlide();
    }
    if (dashPressed && this._dashCooldownRemaining <= 0 && !this.isSliding) {
      this._beginDash();
    }

    this._applyHorizontalMovement(dt);
    this._tryBufferedJump();
    this._previousVerticalVelocity = this.body.velocity.y;
  }

  _readInput(input) {
    const liveInput = typeof input.isDown === 'function';
    const down = (action) => liveInput ? Boolean(input.isDown(action)) : Boolean(input[action] ?? input.actions?.[action]);
    const pressed = (action) => liveInput
      ? Boolean(input.wasPressed?.(action))
      : input[`${action}Pressed`] ?? input.pressed?.[action];
    const move = input.move ?? input.movement ?? null;
    const moveX = Number((liveInput ? input.getAxis?.('left', 'right') : undefined)
      ?? input.moveX ?? input.strafe ?? move?.x
      ?? ((input.right || keyState(input, 'KeyD')) ? 1 : 0)
        - ((input.left || keyState(input, 'KeyA')) ? 1 : 0)) || 0;
    const moveForward = Number((liveInput ? input.getAxis?.('backward', 'forward') : undefined)
      ?? input.moveForward ?? input.moveY ?? input.forwardAxis
      ?? (move?.z != null ? -move.z : move?.y)
      ?? ((input.forward || keyState(input, 'KeyW')) ? 1 : 0)
        - ((input.backward || keyState(input, 'KeyS')) ? 1 : 0)) || 0;
    const look = (liveInput ? input.consumeLook?.() : null) ?? input.lookDelta ?? input.look ?? null;
    const actions = input.actions ?? {};
    const jump = down('jump') || keyState(input, 'Space');
    const crouch = down('crouch') || Boolean(input.crouch ?? actions.crouch
      ?? (keyState(input, 'ControlLeft') || keyState(input, 'KeyC')));
    const dash = down('dash') || Boolean(input.dash ?? actions.dash
      ?? (keyState(input, 'AltLeft') || keyState(input, 'KeyQ')));
    return {
      moveX: clamp(moveX, -1, 1),
      moveForward: clamp(moveForward, -1, 1),
      lookX: Number(input.lookX ?? input.mouseDeltaX ?? look?.x) || 0,
      lookY: Number(input.lookY ?? input.mouseDeltaY ?? look?.y) || 0,
      jump,
      jumpPressed: pressed('jump'),
      crouch,
      crouchPressed: pressed('crouch'),
      dash,
      dashPressed: pressed('dash'),
      sprint: down('sprint') || keyState(input, 'ShiftLeft'),
      ads: down('aim') || Boolean(input.ads ?? actions.ads ?? input.secondaryFire),
    };
  }

  _updateLook(deltaX, deltaY, input) {
    if (!deltaX && !deltaY) return;
    const sensitivity = this.config.mouseSensitivity
      * (this.isADS ? 0.72 : 1)
      * (Number(input.lookSensitivityScale) || 1);
    // InputManager already applies its invert-Y preference while accumulating look.
    const invert = typeof input.consumeLook === 'function' ? 1 : input.invertY ? -1 : 1;
    this.yaw -= deltaX * sensitivity;
    this.pitch -= deltaY * sensitivity * invert;
    this.pitch = clamp(this.pitch, -this.config.maxPitch, this.config.maxPitch);
    if (Math.abs(this.yaw) > Math.PI * 8) this.yaw %= TAU;
  }

  _updateGroundState() {
    const wasGrounded = this.grounded;
    let grounded = false;
    let bestNormalY = -1;
    const contacts = this.world.contacts ?? [];
    for (const contact of contacts) {
      let supportY = -1;
      if (contact.bi === this.body) supportY = -contact.ni.y;
      else if (contact.bj === this.body) supportY = contact.ni.y;
      if (supportY > 0.46 && supportY > bestNormalY) {
        grounded = true;
        bestNormalY = supportY;
        if (contact.bi === this.body) {
          this._groundNormal.set(-contact.ni.x, -contact.ni.y, -contact.ni.z);
        } else {
          this._groundNormal.set(contact.ni.x, contact.ni.y, contact.ni.z);
        }
      }
    }

    if (!grounded && this.body.velocity.y <= 1.2) {
      const rayStart = this.body.position;
      const rayEnd = new CANNON.Vec3(
        rayStart.x,
        rayStart.y - this.config.height / 2 - 0.22,
        rayStart.z,
      );
      const result = new CANNON.RaycastResult();
      this.world.raycastClosest(
        rayStart,
        rayEnd,
        {
          collisionFilterGroup: PLAYER_COLLISION_GROUP,
          collisionFilterMask: STATIC_WORLD_COLLISION_GROUP,
          skipBackfaces: true,
        },
        result,
      );
      if (result.hasHit && result.hitNormalWorld.y > 0.46) {
        grounded = true;
        this._groundNormal.set(
          result.hitNormalWorld.x,
          result.hitNormalWorld.y,
          result.hitNormalWorld.z,
        );
      }
    }

    this.grounded = grounded;
    if (grounded && !wasGrounded) {
      const impact = Math.max(0, -this._previousVerticalVelocity);
      this._emit('player:landed', { impact, hard: impact > 9 });
    }
  }

  _tickTimers(dt) {
    this._coyoteRemaining = Math.max(0, this._coyoteRemaining - dt);
    this._jumpBufferRemaining = Math.max(0, this._jumpBufferRemaining - dt);
    this._slideRemaining = Math.max(0, this._slideRemaining - dt);
    this._slideCooldownRemaining = Math.max(0, this._slideCooldownRemaining - dt);
    this._dashRemaining = Math.max(0, this._dashRemaining - dt);
    this._dashCooldownRemaining = Math.max(0, this._dashCooldownRemaining - dt);
    this._speedBoostRemaining = Math.max(0, this._speedBoostRemaining - dt);
    if (this._speedBoostRemaining <= 0) this._speedBoostScale = 1;
    if (this.isSliding && (this._slideRemaining <= 0 || !this.grounded)) {
      this.isSliding = false;
      this._emit('player:slideEnded', {});
    }
    if (this.isDashing && this._dashRemaining <= 0) {
      this.isDashing = false;
      this._emit('player:dashEnded', {});
    }
  }

  _applyAnomalyGravity() {
    const gravityScale = Number(this.anomaly?.gravityScale ?? 1);
    if (gravityScale === 1 || !Number.isFinite(gravityScale)) return;
    this.body.force.y += this.body.mass * this.world.gravity.y * (gravityScale - 1);
  }

  _beginSlide() {
    this.isSliding = true;
    this.isCrouching = true;
    this._slideRemaining = this.config.slideDuration;
    this._slideCooldownRemaining = this.config.slideDuration + this.config.slideCooldown;
    this._slideDirection.set(this.body.velocity.x, 0, this.body.velocity.z);
    if (this._slideDirection.lengthSq() < 0.1) this._slideDirection.copy(TEMP_FORWARD);
    this._slideDirection.normalize();
    this.body.velocity.x = this._slideDirection.x * this.config.slideSpeed;
    this.body.velocity.z = this._slideDirection.z * this.config.slideSpeed;
    this._emit('player:slideStarted', { duration: this.config.slideDuration });
  }

  _beginDash() {
    this.isDashing = true;
    this._dashRemaining = this.config.dashDuration;
    this._dashCooldownRemaining = this.config.dashCooldown
      * Math.max(0.1, this.modifiers.dashCooldown)
      * Math.max(0.1, Number(this.anomaly?.dashScale ?? 1));
    this._dashDirection.copy(this._wishDirection);
    if (this._dashDirection.lengthSq() < 0.05) this._dashDirection.copy(TEMP_FORWARD);
    this._dashDirection.normalize();
    this.body.velocity.x = this._dashDirection.x * this.config.dashSpeed;
    this.body.velocity.z = this._dashDirection.z * this.config.dashSpeed;
    this.body.velocity.y = Math.max(this.body.velocity.y, this.grounded ? 0.8 : -0.5);
    this._emit('player:dashStarted', {
      duration: this.config.dashDuration,
      cooldown: this._dashCooldownRemaining,
    });
  }

  _applyHorizontalMovement(dt) {
    if (this.isDashing) {
      this.body.velocity.x = this._dashDirection.x * this.config.dashSpeed;
      this.body.velocity.z = this._dashDirection.z * this.config.dashSpeed;
      return;
    }
    if (this.isSliding) {
      const progress = this._slideRemaining / this.config.slideDuration;
      const speed = THREE.MathUtils.lerp(this.config.walkSpeed, this.config.slideSpeed, progress);
      this.body.velocity.x = moveTowards(this.body.velocity.x, this._slideDirection.x * speed, 8 * dt);
      this.body.velocity.z = moveTowards(this.body.velocity.z, this._slideDirection.z * speed, 8 * dt);
      return;
    }

    let maxSpeed = this.config.walkSpeed;
    if (this.isSprinting) maxSpeed = this.config.sprintSpeed;
    if (this.isCrouching) maxSpeed = this.config.crouchSpeed;
    maxSpeed *= this.modifiers.moveSpeed
      * Math.max(0.1, Number(this.anomaly?.speedScale ?? 1))
      * this._speedBoostScale;
    if (this.isADS) maxSpeed *= 0.78;
    const targetX = this._wishDirection.x * maxSpeed;
    const targetZ = this._wishDirection.z * maxSpeed;
    const hasInput = this._wishDirection.lengthSq() > 0.001;
    const acceleration = this.grounded
      ? (hasInput ? this.config.groundAcceleration : this.config.groundDeceleration)
      : this.config.airAcceleration;
    const maxDelta = acceleration * dt;
    this.body.velocity.x = moveTowards(this.body.velocity.x, targetX, maxDelta);
    this.body.velocity.z = moveTowards(this.body.velocity.z, targetZ, maxDelta);
  }

  _tryBufferedJump() {
    if (this._jumpBufferRemaining <= 0 || this._coyoteRemaining <= 0 || this.isDashing) return;
    this.body.velocity.y = this.config.jumpSpeed;
    this.grounded = false;
    this._coyoteRemaining = 0;
    this._jumpBufferRemaining = 0;
    this.isSliding = false;
    this._emit('player:jumped', { speed: this.config.jumpSpeed });
  }

  update(cameraOrDelta = this.camera, maybeDelta = 1 / 60) {
    let camera = cameraOrDelta;
    let dt = maybeDelta;
    if (typeof cameraOrDelta === 'number') {
      dt = cameraOrDelta;
      camera = this.camera;
    }
    if (!camera || this._disposed) return;
    this.camera = camera;
    dt = clamp(Number(dt) || 0, 0, 0.1);

    const targetHeight = (this.isCrouching || this.isSliding)
      ? this.config.crouchingEyeOffset
      : this.config.standingEyeOffset;
    const smoothing = 1 - Math.exp(-dt * 14);
    this._cameraHeight = THREE.MathUtils.lerp(this._cameraHeight, targetHeight, smoothing);

    const planarSpeed = this.horizontalSpeed;
    const moving = this.grounded && planarSpeed > 0.45;
    const bobFrequency = this.isSprinting ? 13.5 : this.isCrouching ? 7 : 10.2;
    if (moving) this._bobTime += dt * bobFrequency * clamp(planarSpeed / this.config.walkSpeed, 0.55, 1.65);
    const bobTarget = moving && this.config.headBob ? 1 : 0;
    this._bobAmount = THREE.MathUtils.lerp(this._bobAmount, bobTarget, 1 - Math.exp(-dt * 9));
    const bobScale = this.config.headBobScale * (this.isADS ? 0.28 : 1);
    const bobY = Math.abs(Math.sin(this._bobTime)) * 0.046 * this._bobAmount * bobScale;
    const bobX = Math.sin(this._bobTime * 0.5) * 0.026 * this._bobAmount * bobScale;
    this._lastViewBob.x = bobX;
    this._lastViewBob.y = bobY;
    const roll = Math.sin(this._bobTime * 0.5) * 0.007 * this._bobAmount
      + (this.isSliding ? -0.035 : 0);

    // Game owns the fixed-step accumulator and calls world.step(dt) in simple
    // mode, where cannon-es does not refresh interpolatedPosition.
    const source = this.body.position;
    camera.position.set(source.x, source.y + this._cameraHeight + bobY, source.z);
    TEMP_RIGHT.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    camera.position.addScaledVector(TEMP_RIGHT, bobX);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, roll, 'YXZ');
    camera.updateMatrixWorld();
  }

  visualUpdate(camera = this.camera, deltaSeconds = 1 / 60) {
    this.update(camera, deltaSeconds);
  }

  setLook(yaw, pitch = this.pitch) {
    this.yaw = Number(yaw) || 0;
    this.pitch = clamp(Number(pitch) || 0, -this.config.maxPitch, this.config.maxPitch);
  }

  setHeadBobEnabled(enabled) {
    this.config.headBob = Boolean(enabled);
  }

  setAiming(amount) {
    this._aimAmount = clamp(typeof amount === 'boolean' ? Number(amount) : Number(amount) || 0, 0, 1);
    this.isADS = this._aimAmount > 0.15;
  }

  addRecoil(pitchKick = 0, yawKick = 0) {
    this.pitch = clamp(this.pitch + (Number(pitchKick) || 0), -this.config.maxPitch, this.config.maxPitch);
    this.yaw += Number(yawKick) || 0;
  }

  getViewBob() {
    return { ...this._lastViewBob };
  }

  setMouseSensitivity(value) {
    const numeric = Number(value);
    const radiansPerPixel = Number.isFinite(numeric) && numeric > 0.05
      ? DEFAULT_PLAYER_CONFIG.mouseSensitivity * numeric
      : numeric;
    this.config.mouseSensitivity = clamp(
      radiansPerPixel || DEFAULT_PLAYER_CONFIG.mouseSensitivity,
      0.0001,
      0.02,
    );
  }

  applyImpulse(impulse) {
    const value = asThreeVector(impulse);
    this.body.applyImpulse(new CANNON.Vec3(value.x, value.y, value.z));
  }

  teleport(position, { resetVelocity = true } = {}) {
    const target = asThreeVector(position, this.initialSpawn);
    this.body.position.set(target.x, target.y, target.z);
    this.body.previousPosition.copy(this.body.position);
    this.body.interpolatedPosition.copy(this.body.position);
    if (resetVelocity) {
      this.body.velocity.setZero();
      this.body.angularVelocity.setZero();
    }
    this.body.aabbNeedsUpdate = true;
    this.body.wakeUp();
  }

  takeDamage(amountOrOptions, source = null, metadata = {}) {
    if (this.dead) return { healthDamage: 0, armorDamage: 0, killed: true };
    if (this.invincible) return { healthDamage: 0, armorDamage: 0, killed: false, invincible: true };
    let amount = amountOrOptions;
    let options = metadata;
    if (typeof amountOrOptions === 'object') {
      options = amountOrOptions;
      amount = options.amount;
      source = options.sourcePosition ?? options.source ?? options.direction ?? null;
    }
    amount = Math.max(0, Number(amount) || 0);
    if (amount <= 0) return { healthDamage: 0, armorDamage: 0, killed: false };

    const absorption = options.bypassArmor ? 0 : clamp(
      Number(options.armorAbsorption ?? this.config.armorAbsorption),
      0,
      1,
    );
    const armorDamage = Math.min(this.armor, amount * absorption);
    const healthDamage = Math.min(this.health, amount - armorDamage);
    this.armor = clamp(this.armor - armorDamage, 0, this.maxArmor);
    this.health = clamp(this.health - healthDamage, 0, this.maxHealth);
    this.lastDamageAmount = healthDamage + armorDamage;
    this.lastDamageDirection = this._calculateDamageDirection(source, options.directionIsVector);
    this.lastDamageCause = options.cause ?? options.source ?? options.type ?? 'Критическое повреждение';

    const payload = {
      amount,
      healthDamage,
      armorDamage,
      health: this.health,
      armor: this.armor,
      direction: this.lastDamageDirection,
      type: options.type ?? 'generic',
    };
    this._emit('player:damaged', payload);
    this._emit('player:healthChanged', { health: this.health, armor: this.armor });
    if (this.health <= 0) {
      this.dead = true;
      this.body.velocity.setZero();
      this._emit('player:died', payload);
    }
    return { healthDamage, armorDamage, killed: this.dead };
  }

  damage(amount, context = {}) {
    return this.takeDamage(amount, context.position ?? context.sourcePosition ?? null, context);
  }

  setInvincible(enabled = true) {
    this.invincible = Boolean(enabled);
    this._emit('player:invincibleChanged', { enabled: this.invincible });
    return this.invincible;
  }

  _calculateDamageDirection(source, directionIsVector = false) {
    if (!source) return null;
    const worldDirection = asThreeVector(source);
    if (!directionIsVector) {
      worldDirection.sub(new THREE.Vector3(this.body.position.x, this.body.position.y, this.body.position.z));
    }
    worldDirection.y = 0;
    if (worldDirection.lengthSq() < 1e-6) return null;
    worldDirection.normalize();
    TEMP_FORWARD.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    TEMP_RIGHT.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const x = worldDirection.dot(TEMP_RIGHT);
    const y = worldDirection.dot(TEMP_FORWARD);
    return {
      x,
      y,
      angle: Math.atan2(x, y),
      world: worldDirection.clone(),
    };
  }

  heal(amount) {
    const before = this.health;
    this.health = clamp(this.health + Math.max(0, Number(amount) || 0), 0, this.maxHealth);
    const restored = this.health - before;
    if (restored > 0) this._emit('player:healthChanged', { health: this.health, armor: this.armor });
    return restored;
  }

  addArmor(amount) {
    const before = this.armor;
    this.armor = clamp(this.armor + Math.max(0, Number(amount) || 0), 0, this.maxArmor);
    const restored = this.armor - before;
    if (restored > 0) this._emit('player:healthChanged', { health: this.health, armor: this.armor });
    return restored;
  }

  modifyMaxHealth(amount, healByIncrease = false) {
    const increase = Number(amount) || 0;
    if (!increase) return this.maxHealth;
    this.maxHealth = Math.max(1, this.maxHealth + increase);
    this.config.maxHealth = this.maxHealth;
    if (healByIncrease && increase > 0) this.health = Math.min(this.maxHealth, this.health + increase);
    else this.health = Math.min(this.health, this.maxHealth);
    this._emit('player:healthChanged', { health: this.health, maxHealth: this.maxHealth, armor: this.armor });
    return this.maxHealth;
  }

  grantSpeedBoost(amount, duration = 3) {
    const boost = Math.max(0, Number(amount) || 0);
    this._speedBoostScale = Math.max(this._speedBoostScale, 1 + boost);
    this._speedBoostRemaining = Math.max(this._speedBoostRemaining, Number(duration) || 0);
    return { scale: this._speedBoostScale, remaining: this._speedBoostRemaining };
  }

  setAnomaly(anomaly) {
    this.anomaly = anomaly ? { ...anomaly } : null;
  }

  getDashState() {
    const total = this.config.dashCooldown
      * Math.max(0.1, this.modifiers.dashCooldown)
      * Math.max(0.1, Number(this.anomaly?.dashScale ?? 1));
    return {
      ready: total > 0 ? clamp(1 - this._dashCooldownRemaining / total, 0, 1) : 1,
      remaining: this._dashCooldownRemaining,
      duration: total,
      active: this.isDashing,
    };
  }

  reset(spawn = this.initialSpawn) {
    if (this._disposed) return;
    this.initialSpawn.copy(asThreeVector(spawn, this.initialSpawn));
    this.teleport(this.initialSpawn);
    this.maxHealth = this.config.maxHealth;
    this.maxArmor = this.config.maxArmor;
    this.modifiers = {
      moveSpeed: 1,
      dashCooldown: 1,
      dashDamageMultiplier: 1,
      killSpeed: 0,
      shieldOnHit: 0,
      lowHealthDamage: 0,
    };
    this.anomaly = null;
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = false;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isSliding = false;
    this.isDashing = false;
    this.isADS = false;
    this.dead = false;
    this.maxHealth = this._baseMaxHealth;
    this.config.maxHealth = this.maxHealth;
    this.health = this.maxHealth;
    this.armor = clamp(this.config.startingArmor, 0, this.maxArmor);
    this.lastDamageDirection = null;
    this.lastDamageAmount = 0;
    this.lastDamageCause = null;
    this.modifiers = createPlayerModifiers();
    this.anomaly = null;
    this._coyoteRemaining = 0;
    this._jumpBufferRemaining = 0;
    this._slideRemaining = 0;
    this._slideCooldownRemaining = 0;
    this._dashRemaining = 0;
    this._dashCooldownRemaining = 0;
    this._speedBoostRemaining = 0;
    this._speedBoostScale = 1;
    this._speedBoostRemaining = 0;
    this._speedBoostScale = 1;
    this._cameraHeight = this.config.standingEyeOffset;
    this._bobTime = 0;
    this._bobAmount = 0;
    this._previousInput = { jump: false, crouch: false, dash: false };
    this._emit('player:reset', { health: this.health, armor: this.armor });
  }

  get position() {
    return this._positionView.set(this.body.position.x, this.body.position.y, this.body.position.z);
  }

  get velocity() {
    return this._velocityView.set(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z);
  }

  get horizontalSpeed() {
    return Math.hypot(this.body.velocity.x, this.body.velocity.z);
  }

  get dashCooldownRemaining() {
    return this._dashCooldownRemaining;
  }

  get slideCooldownRemaining() {
    return this._slideCooldownRemaining;
  }

  get cameraForward() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();
  }

  get forward() {
    return this.cameraForward;
  }

  get speedNormalized() {
    return clamp(this.horizontalSpeed / Math.max(0.1, this.config.sprintSpeed), 0, 1.5);
  }

  get state() {
    if (this.dead) return 'dead';
    if (this.isDashing) return 'dash';
    if (this.isSliding) return 'slide';
    if (!this.grounded) return this.body.velocity.y > 0 ? 'jump' : 'fall';
    if (this.isCrouching) return 'crouch';
    if (this.isSprinting) return 'sprint';
    return this.horizontalSpeed > 0.3 ? 'move' : 'idle';
  }

  getState() {
    return {
      position: new THREE.Vector3(this.body.position.x, this.body.position.y, this.body.position.z),
      velocity: new THREE.Vector3(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z),
      yaw: this.yaw,
      pitch: this.pitch,
      grounded: this.grounded,
      crouching: this.isCrouching,
      sprinting: this.isSprinting,
      sliding: this.isSliding,
      dashing: this.isDashing,
      ads: this.isADS,
      health: this.health,
      armor: this.armor,
      dead: this.dead,
      invincible: this.invincible,
      dashCooldown: this._dashCooldownRemaining,
      slideCooldown: this._slideCooldownRemaining,
    };
  }

  _emit(type, payload) {
    if (typeof this.eventBus?.emit === 'function') this.eventBus.emit(type, payload);
    else if (typeof this.eventBus?.dispatchEvent === 'function') {
      this.eventBus.dispatchEvent({ type, ...payload });
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.world?.removeBody(this.body);
    this.camera = null;
    this.eventBus = null;
    this.world = null;
  }
}

export default PlayerController;
