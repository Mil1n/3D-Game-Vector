import * as THREE from 'three';
import { WEAPON_CONFIGS, WEAPON_ORDER } from '../configs/weaponConfigs.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MAX_HIT_STOP_DURATION = 0.075;
const FIRE_INPUT_BUFFER = 0.12;
const MAX_SWAY_LOOK_SPEED = 6;
const MAX_SWAY_YAW = 0.072;
const MAX_SWAY_PITCH = 0.052;
const SWAY_YAW_PER_SPEED = 0.012;
const SWAY_PITCH_PER_SPEED = 0.009;
const SWAY_POSITION_X = 0.38;
const SWAY_POSITION_Y = 0.28;
const SWAY_ROLL_SCALE = 0.34;
const SWAY_REST_EPSILON = 0.00001;
const MIN_AIR_MOTION_LANDING_IMPACT = 2.5;
const MAX_AIR_MOTION_LANDING_IMPACT = 24;
const MAX_AIR_MOTION_VELOCITY = 2.4;
const MIN_AIR_MOTION_OFFSET = -0.085;
const MAX_AIR_MOTION_OFFSET = 0.02;
const AIR_MOTION_POSITION_Z = 0.46;
const AIR_MOTION_PITCH_SCALE = 0.62;
const AIR_MOTION_REST_EPSILON = 0.0001;

function hitStopValue(profile, key) {
  const value = Number(profile?.[key]);
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, MAX_HIT_STOP_DURATION) : 0;
}

function resolveConfig(id) {
  const config = Array.isArray(WEAPON_CONFIGS)
    ? WEAPON_CONFIGS.find((entry) => entry.id === id)
    : WEAPON_CONFIGS[id];
  if (!config) throw new Error(`[WeaponSystem] Missing weapon config: ${id}`);
  return config;
}

function createWeaponModel(config) {
  const group = new THREE.Group();
  group.name = `Viewmodel ${config.id}`;
  const weaponColor = config.color ?? 0x5ee7ff;
  const shell = new THREE.MeshStandardMaterial({
    color: 0x263a43,
    emissive: 0x0b1418,
    emissiveIntensity: 0.9,
    roughness: 0.38,
    metalness: 0.68,
  });
  const shellLight = new THREE.MeshStandardMaterial({
    color: 0x455c66,
    emissive: 0x18272d,
    emissiveIntensity: 0.78,
    roughness: 0.44,
    metalness: 0.56,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x0c1419,
    emissive: 0x020405,
    emissiveIntensity: 0.65,
    roughness: 0.52,
    metalness: 0.58,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: weaponColor,
    emissive: weaponColor,
    emissiveIntensity: 0.42,
    roughness: 0.28,
    metalness: 0.58,
  });
  const glow = new THREE.MeshBasicMaterial({ color: weaponColor, toneMapped: false });
  const sleeve = new THREE.MeshStandardMaterial({
    color: 0x173047,
    emissive: 0x07131f,
    emissiveIntensity: 0.72,
    roughness: 0.72,
    metalness: 0.22,
  });
  const glove = new THREE.MeshStandardMaterial({
    color: 0x111820,
    emissive: 0x030608,
    emissiveIntensity: 0.62,
    roughness: 0.82,
    metalness: 0.18,
  });
  const armor = new THREE.MeshStandardMaterial({
    color: 0x587384,
    emissive: 0x14242d,
    emissiveIntensity: 0.65,
    roughness: 0.46,
    metalness: 0.54,
  });
  shell.name = 'weapon-shell';
  shellLight.name = 'weapon-shell-light';
  dark.name = 'weapon-dark';
  accent.name = 'weapon-accent';
  glow.name = 'weapon-glow';
  sleeve.name = 'operator-sleeve';
  glove.name = 'operator-glove';
  armor.name = 'operator-armor';
  const details = [];
  const armParts = [];
  const pulseParts = [];
  const spinParts = [];
  const motionParts = [];
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const addMesh = (
    geometry,
    position,
    material = shell,
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
    metadata = {},
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...scale);
    mesh.name = metadata.name ?? `${config.id} weapon part`;
    mesh.userData.viewModelRole = metadata.role ?? 'weapon';
    if (metadata.armSide) {
      mesh.userData.armSide = metadata.armSide;
      armParts.push(mesh);
    }
    group.add(mesh);
    details.push(mesh);
    return mesh;
  };
  const addBox = (size, position, material = shell, rotation = [0, 0, 0], metadata = {}) => (
    addMesh(boxGeometry, position, material, rotation, size, metadata)
  );
  const addCylinder = (
    radiusTop,
    radiusBottom,
    length,
    position,
    material = shell,
    rotation = [Math.PI / 2, 0, 0],
    segments = 10,
    metadata = {},
  ) => addMesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments, 1, false),
    position,
    material,
    rotation,
    [1, 1, 1],
    metadata,
  );
  const addSphere = (radius, position, material = glow, scale = [1, 1, 1]) => (
    addMesh(new THREE.SphereGeometry(radius, 12, 8), position, material, [0, 0, 0], scale)
  );
  const addTorus = (radius, tube, position, material = glow, rotation = [0, 0, 0]) => {
    return addMesh(new THREE.TorusGeometry(radius, tube, 7, 18), position, material, rotation);
  };
  const pulse = (mesh, { amplitude = 0.06, speed = 4, phase = 0 } = {}) => {
    pulseParts.push({ mesh, amplitude, speed, phase, baseScale: mesh.scale.clone() });
    return mesh;
  };
  const spin = (mesh, speed = 1) => {
    spinParts.push({ mesh, speed, baseRotation: mesh.rotation.clone() });
    return mesh;
  };
  const motion = (mesh, {
    reloadOffset = [0, 0, 0],
    reloadRotation = [0, 0, 0],
    recoilOffset = [0, 0, 0],
  } = {}) => {
    const baseQuaternion = mesh.quaternion.clone();
    const targetQuaternion = baseQuaternion.clone().multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...reloadRotation)),
    );
    motionParts.push({
      mesh,
      basePosition: mesh.position.clone(),
      baseQuaternion,
      targetQuaternion,
      reloadOffset: new THREE.Vector3(...reloadOffset),
      recoilOffset: new THREE.Vector3(...recoilOffset),
    });
    return mesh;
  };
  const addLimb = ({ start, end, radiusStart, radiusEnd, material, name, side, role }) => {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    const length = direction.length();
    const mesh = addMesh(
      new THREE.CylinderGeometry(radiusEnd, radiusStart, length, 8, 1, false),
      from.clone().add(to).multiplyScalar(0.5).toArray(),
      material,
      [0, 0, 0],
      [1, 1, 1],
      { name, role, armSide: side },
    );
    mesh.quaternion.setFromUnitVectors(WORLD_UP, direction.normalize());
    return mesh;
  };

  const modelStyle = config.model ?? config.id;
  let defaultMuzzleZ = -1.4;
  if (modelStyle === 'scatter') {
    defaultMuzzleZ = -1.23;
    addBox([0.27, 0.22, 0.46], [0, 0, -0.28]);
    addBox([0.25, 0.035, 0.61], [0, 0.145, -0.62], accent);
    addCylinder(0.048, 0.048, 0.78, [-0.073, 0.07, -0.77], dark);
    addCylinder(0.048, 0.048, 0.78, [0.073, 0.07, -0.77], dark);
    addCylinder(0.066, 0.066, 0.62, [0, -0.055, -0.67], shellLight);
    addCylinder(0.068, 0.068, 0.09, [-0.073, 0.07, -1.18], accent);
    addCylinder(0.068, 0.068, 0.09, [0.073, 0.07, -1.18], accent);
    motion(addBox([0.28, 0.14, 0.24], [0, -0.045, -0.7], shellLight, [0, 0, 0], {
      name: 'SG-4 reciprocating pump',
    }), { reloadOffset: [0, -0.015, 0.2], recoilOffset: [0, 0, 0.08] });
    for (let groove = 0; groove < 3; groove += 1) {
      addBox([0.292, 0.026, 0.022], [0, 0.02, -0.62 - groove * 0.075], dark);
    }
    addBox([0.15, 0.3, 0.16], [0, -0.2, -0.17], dark, [-0.24, 0, 0]);
    addBox([0.19, 0.09, 0.18], [0, -0.13, -0.4], shellLight, [0.12, 0, 0]);
    addBox([0.035, 0.075, 0.045], [0, 0.205, -0.35], glow);
    addBox([0.052, 0.115, 0.24], [-0.155, 0.07, -0.36], dark, [0, 0, -0.08]);
    addBox([0.052, 0.115, 0.24], [0.155, 0.07, -0.36], dark, [0, 0, 0.08]);
    addCylinder(0.024, 0.024, 0.2, [-0.166, 0.085, -0.5], accent, [Math.PI / 2, 0, 0], 8);
    addCylinder(0.024, 0.024, 0.2, [0.166, 0.085, -0.5], accent, [Math.PI / 2, 0, 0], 8);
  } else if (modelStyle === 'rail') {
    defaultMuzzleZ = -1.59;
    addBox([0.2, 0.21, 0.86], [0, -0.005, -0.48]);
    addBox([0.055, 0.075, 1.18], [-0.14, 0.09, -0.77], shellLight);
    addBox([0.055, 0.075, 1.18], [0.14, 0.09, -0.77], shellLight);
    addBox([0.026, 0.032, 1.08], [-0.14, 0.15, -0.78], accent);
    addBox([0.026, 0.032, 1.08], [0.14, 0.15, -0.78], accent);
    addCylinder(0.032, 0.032, 0.72, [0, 0.05, -1.19], dark, [Math.PI / 2, 0, 0], 8);
    for (let coil = 0; coil < 3; coil += 1) {
      spin(addTorus(0.105 - coil * 0.008, 0.014, [0, 0.05, -0.81 - coil * 0.2], accent), 0.7 + coil * 0.22);
    }
    addCylinder(0.064, 0.064, 0.32, [0, 0.225, -0.39], dark);
    pulse(addCylinder(0.052, 0.052, 0.018, [0, 0.225, -0.56], glow), { amplitude: 0.045, speed: 3.2 });
    addBox([0.18, 0.065, 0.36], [0, 0.15, -0.35], shellLight);
    addBox([0.16, 0.28, 0.18], [0, -0.2, -0.18], dark, [-0.2, 0, 0]);
    addCylinder(0.062, 0.044, 0.13, [0, 0.05, -1.52], accent);
    motion(addBox([0.17, 0.24, 0.13], [0, -0.205, -0.44], accent, [0.12, 0, 0], {
      name: 'ARX charge cassette',
    }), { reloadOffset: [0, -0.32, 0.08], reloadRotation: [0.12, 0, 0.16] });
    addBox([0.055, 0.17, 0.34], [-0.185, 0.015, -0.45], dark, [0, 0, -0.12]);
    addBox([0.055, 0.17, 0.34], [0.185, 0.015, -0.45], dark, [0, 0, 0.12]);
    addTorus(0.075, 0.012, [0, 0.225, -0.59], glow, [0, 0, 0]);
  } else if (modelStyle === 'plasma-smg') {
    defaultMuzzleZ = -1.04;
    addBox([0.27, 0.22, 0.48], [0, 0.005, -0.3]);
    addBox([0.31, 0.12, 0.32], [0, 0.075, -0.46], shellLight);
    pulse(addSphere(0.115, [0, 0.055, -0.38], accent, [0.82, 0.82, 1.18]), { amplitude: 0.08, speed: 5.2 });
    addBox([0.035, 0.13, 0.44], [-0.155, 0.055, -0.42], accent);
    addBox([0.035, 0.13, 0.44], [0.155, 0.055, -0.42], accent);
    addCylinder(0.092, 0.078, 0.4, [0, 0.055, -0.73], dark);
    spin(addTorus(0.103, 0.018, [0, 0.055, -0.58], glow), 1.35);
    spin(addTorus(0.087, 0.015, [0, 0.055, -0.88], glow), -1.55);
    addCylinder(0.105, 0.092, 0.12, [0, 0.055, -0.97], accent);
    addBox([0.145, 0.27, 0.16], [0, -0.19, -0.18], dark, [-0.2, 0, 0]);
    motion(addBox([0.19, 0.22, 0.12], [0, -0.17, -0.43], accent, [0.12, 0, 0], {
      name: 'PX-7 plasma cell',
    }), { reloadOffset: [0, -0.27, 0.06], reloadRotation: [0.08, 0, -0.18] });
    addTorus(0.055, 0.011, [0, 0.205, -0.32], glow);
    addBox([0.04, 0.16, 0.23], [-0.19, 0.045, -0.63], shellLight, [0.08, 0, -0.08]);
    addBox([0.04, 0.16, 0.23], [0.19, 0.045, -0.63], shellLight, [0.08, 0, 0.08]);
    addBox([0.025, 0.08, 0.18], [-0.225, 0.04, -0.66], glow);
    addBox([0.025, 0.08, 0.18], [0.225, 0.04, -0.66], glow);
  } else if (modelStyle === 'nova-cannon') {
    defaultMuzzleZ = -1.44;
    addBox([0.36, 0.31, 0.58], [0, -0.005, -0.31]);
    addBox([0.42, 0.1, 0.72], [0, 0.16, -0.58], shellLight);
    addBox([0.08, 0.24, 0.66], [-0.2, 0.02, -0.61], dark, [0, 0, -0.14]);
    addBox([0.08, 0.24, 0.66], [0.2, 0.02, -0.61], dark, [0, 0, 0.14]);
    pulse(addSphere(0.16, [0, 0.05, -0.57], accent, [0.88, 0.88, 1.15]), { amplitude: 0.09, speed: 3.6 });
    addCylinder(0.105, 0.095, 0.72, [0, 0.05, -0.95], dark, [Math.PI / 2, 0, 0], 12);
    for (let coil = 0; coil < 3; coil += 1) {
      spin(addTorus(0.16 - coil * 0.017, 0.025 - coil * 0.002, [0, 0.05, -0.78 - coil * 0.2], glow), 0.8 + coil * 0.35);
    }
    addCylinder(0.15, 0.125, 0.18, [0, 0.05, -1.34], accent, [Math.PI / 2, 0, 0], 12);
    addCylinder(0.13, 0.13, 0.27, [0, -0.17, -0.39], dark, [0, 0, Math.PI / 2], 12);
    addBox([0.21, 0.32, 0.21], [0, -0.23, -0.17], dark, [-0.18, 0, 0]);
    addBox([0.25, 0.045, 0.38], [0, 0.245, -0.38], accent);
    motion(addCylinder(0.105, 0.105, 0.26, [0, -0.255, -0.48], accent, [0, 0, Math.PI / 2], 12, {
      name: 'HMX-1 implosion cartridge',
    }), { reloadOffset: [0, -0.3, 0.1], reloadRotation: [0, 0.24, 0.1] });
    addCylinder(0.07, 0.07, 0.38, [-0.235, 0.11, -0.53], shellLight, [Math.PI / 2, 0, 0], 10);
    addCylinder(0.07, 0.07, 0.38, [0.235, 0.11, -0.53], shellLight, [Math.PI / 2, 0, 0], 10);
    addBox([0.032, 0.09, 0.48], [-0.28, 0.135, -0.56], glow, [0, 0, -0.08]);
    addBox([0.032, 0.09, 0.48], [0.28, 0.135, -0.56], glow, [0, 0, 0.08]);
  } else {
    defaultMuzzleZ = -1.4;
    addBox([0.23, 0.2, 0.64], [0, 0, -0.36]);
    addBox([0.18, 0.09, 0.74], [0, 0.13, -0.5], shellLight);
    addBox([0.2, 0.16, 0.42], [0, 0.025, -0.82], dark);
    addCylinder(0.037, 0.037, 0.43, [0, 0.055, -1.12], dark, [Math.PI / 2, 0, 0], 8);
    addCylinder(0.066, 0.052, 0.14, [0, 0.055, -1.32], accent);
    addBox([0.028, 0.065, 0.7], [-0.125, 0.1, -0.59], accent);
    addBox([0.028, 0.065, 0.7], [0.125, 0.1, -0.59], accent);
    addBox([0.15, 0.3, 0.17], [0, -0.21, -0.17], dark, [-0.22, 0, 0]);
    motion(addBox([0.17, 0.29, 0.13], [0, -0.2, -0.45], shellLight, [0.15, 0, 0], {
      name: 'VX-9 pulse magazine',
    }), { reloadOffset: [0, -0.31, 0.07], reloadRotation: [0.08, 0, -0.16] });
    addBox([0.16, 0.05, 0.33], [0, 0.205, -0.33], dark);
    pulse(addCylinder(0.048, 0.048, 0.02, [0, 0.205, -0.51], glow), { amplitude: 0.05, speed: 4.3 });
    addBox([0.035, 0.08, 0.045], [0, 0.235, -0.16], accent);
    addBox([0.045, 0.12, 0.34], [-0.15, 0.015, -0.42], shellLight, [0, 0, -0.08]);
    addBox([0.045, 0.12, 0.34], [0.15, 0.015, -0.42], shellLight, [0, 0, 0.08]);
    addBox([0.022, 0.055, 0.24], [-0.178, 0.035, -0.47], glow);
    addBox([0.022, 0.055, 0.24], [0.178, 0.035, -0.47], glow);
  }

  const armRig = config.viewModel?.armRig ?? {
    rightOrigin: [0.26, -0.72, 0.28],
    rightGrip: [0.03, -0.22, -0.13],
    leftOrigin: [-0.42, -0.72, 0.22],
    leftGrip: [-0.08, -0.13, -0.52],
    rightRotation: [-0.18, 0, -0.05],
    leftRotation: [0.12, 0, 0.06],
  };
  const handMeshes = {};
  const buildArm = (side, origin, grip, rotation) => {
    const originVector = new THREE.Vector3(...origin);
    const gripVector = new THREE.Vector3(...grip);
    const direction = gripVector.clone().sub(originVector).normalize();
    const forearmEnd = gripVector.clone().addScaledVector(direction, -0.08);
    const cuffStart = gripVector.clone().addScaledVector(direction, -0.16);
    const cuffEnd = gripVector.clone().addScaledVector(direction, -0.045);
    const pieces = [];
    pieces.push(addLimb({
      start: origin,
      end: forearmEnd.toArray(),
      radiusStart: 0.115,
      radiusEnd: 0.078,
      material: sleeve,
      name: `${side} armored sleeve`,
      side,
      role: 'sleeve',
    }));
    pieces.push(addLimb({
      start: cuffStart.toArray(),
      end: cuffEnd.toArray(),
      radiusStart: 0.09,
      radiusEnd: 0.085,
      material: armor,
      name: `${side} wrist guard`,
      side,
      role: 'cuff',
    }));
    const palm = addBox(
      [0.14, 0.1, 0.19],
      grip,
      glove,
      rotation,
      { name: `${side} grip hand`, role: 'hand', armSide: side },
    );
    pieces.push(palm);
    pieces.push(addBox(
      [0.115, 0.07, 0.105],
      [gripVector.x, gripVector.y - 0.025, gripVector.z - 0.095],
      glove,
      rotation,
      { name: `${side} curled fingers`, role: 'hand', armSide: side },
    ));
    pieces.push(addBox(
      [0.115, 0.028, 0.12],
      [gripVector.x, gripVector.y + 0.058, gripVector.z - 0.012],
      side === 'left' ? armor : accent,
      rotation,
      { name: `${side} knuckle plate`, role: 'hand-armor', armSide: side },
    ));
    if (side === 'left') {
      for (const piece of pieces) {
        motion(piece, {
          reloadOffset: [-0.055, -0.14, 0.095],
          reloadRotation: [0.03, 0, -0.08],
        });
      }
    }
    handMeshes[side] = palm;
    return pieces;
  };
  buildArm('right', armRig.rightOrigin, armRig.rightGrip, armRig.rightRotation ?? [-0.18, 0, -0.05]);
  buildArm('left', armRig.leftOrigin, armRig.leftGrip, armRig.leftRotation ?? [0.12, 0, 0.06]);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(
    0,
    0.06,
    config.viewModel?.muzzleZ ?? defaultMuzzleZ,
  );
  group.add(muzzle);
  group.userData.muzzle = muzzle;
  group.userData.materials = [shell, shellLight, dark, accent, glow, sleeve, glove, armor];
  group.userData.modelStyle = modelStyle;
  group.userData.partCount = details.length;
  group.userData.weaponPartCount = details.length - armParts.length;
  group.userData.armPartCount = armParts.length;
  group.userData.armParts = armParts;
  group.userData.hands = handMeshes;
  group.userData.gripAnchors = {
    right: new THREE.Vector3(...armRig.rightGrip),
    left: new THREE.Vector3(...armRig.leftGrip),
  };
  group.userData.pulseParts = pulseParts;
  group.userData.spinParts = spinParts;
  group.userData.motionParts = motionParts;
  group.userData.animationTime = 0;
  group.userData.equipAmount = 0;
  group.userData.basePosition = new THREE.Vector3(...(config.viewModel?.basePosition ?? [0.43, -0.36, -0.72]));
  group.userData.adsPosition = new THREE.Vector3(...(config.viewModel?.adsPosition ?? [0, -0.245, -0.62]));
  group.userData.baseYaw = config.viewModel?.baseYaw ?? 0.12;
  group.position.copy(group.userData.basePosition);
  group.rotation.y = group.userData.baseYaw;
  group.scale.setScalar(config.viewModel?.scale ?? 0.92);
  group.traverse((child) => {
    child.frustumCulled = false;
    // Viewmodels ignore world depth, so paint their own far parts first to
    // preserve a readable internal silhouette without wall clipping.
    child.renderOrder = 100 + Math.round((child.position.z + 2) * 100);
    if (child.isMesh) {
      child.material.depthTest = false;
      child.material.depthWrite = false;
    }
  });
  return group;
}

export class WeaponSystem {
  constructor({
    camera,
    scene,
    eventBus,
    audioManager,
    effects,
    arena,
    player,
    enemySystem = null,
    random = Math.random,
  }) {
    this.camera = camera;
    this.scene = scene;
    this.eventBus = eventBus;
    this.audio = audioManager;
    this.effects = effects;
    this.arena = arena;
    this.player = player;
    this.enemySystem = enemySystem;
    this.random = typeof random === 'function' ? random : Math.random;
    this.disposed = false;
    this.enabled = false;
    this.weaponOrder = [...WEAPON_ORDER];
    this.index = 0;
    this.cooldown = 0;
    this.cooldownKind = null;
    this.reloadRemaining = 0;
    this.reloadDuration = 0;
    this.recoilKick = 0;
    this.modelKick = 0;
    this.modelSideKick = 0;
    this.modelRollKick = 0;
    this.recoilIntensity = 1;
    this.modelSwayYaw = 0;
    this.modelSwayPitch = 0;
    this.modelAirOffset = 0;
    this.modelAirVelocity = 0;
    this.swayIntensity = 0.8;
    this.adsAmount = 0;
    this.triggerReleased = true;
    this.firePressConsumed = false;
    this.fireBufferRemaining = 0;
    this.infiniteAmmo = false;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.shotSequence = 0;
    this.modifiers = this.defaultModifiers();
    this.runtimeModifiers = this.defaultRuntimeModifiers();
    this.ammo = new Map();
    this.models = new Map();
    this.tempOrigin = new THREE.Vector3();
    this.tempDirection = new THREE.Vector3();
    this.tempRight = new THREE.Vector3();
    this.tempUp = new THREE.Vector3();
    this.tempEnd = new THREE.Vector3();
    this.tempMuzzle = new THREE.Vector3();
    this.tempModelPosition = new THREE.Vector3();
    this.tempLookDelta = new THREE.Vector2();
    this.tempViewBob = new THREE.Vector2();
    this.motionUnsubscribers = [];

    for (const id of this.weaponOrder) {
      const config = resolveConfig(id);
      this.ammo.set(id, { magazine: config.magazine, reserve: config.reserve });
      const model = createWeaponModel(config);
      model.visible = false;
      this.camera.add(model);
      this.models.set(id, model);
    }
    this.currentModel.visible = this.enabled;
    this.subscribeViewmodelMotion();
  }

  defaultModifiers() {
    return {
      damage: 1,
      reloadMultiplier: 1,
      shotgunPellets: 0,
      railRicochet: 0,
      critChance: 0,
      headshotExplosion: 0,
      lowHealthDamage: 0,
      railAnomalyMultiplier: 1,
    };
  }

  defaultRuntimeModifiers() {
    return {
      overdrive: false,
      fireRate: 1,
      reloadSpeed: 1,
      switchSpeed: 1,
      equipSpeed: 1,
      impact: 1,
    };
  }

  setEnemySystem(enemySystem) {
    this.enemySystem = enemySystem;
  }

  get currentId() {
    return this.weaponOrder[this.index];
  }

  get currentConfig() {
    return resolveConfig(this.currentId);
  }

  get currentAmmo() {
    return this.ammo.get(this.currentId);
  }

  get currentModel() {
    return this.models.get(this.currentId);
  }

  setEnabled(enabled) {
    if (this.disposed) return false;
    const wasEnabled = this.enabled;
    this.enabled = Boolean(enabled);
    if (this.enabled && !wasEnabled) this.primeEquipPose(this.currentModel);
    if (!this.enabled) {
      this.clearInputBuffer();
      this.clearViewmodelMotion();
      this.restoreModelParts(this.currentModel);
    }
    this.currentModel.visible = this.enabled;
    return this.enabled;
  }

  clearInputBuffer() {
    this.triggerReleased = true;
    this.firePressConsumed = false;
    this.fireBufferRemaining = 0;
  }

  setRecoilIntensity(intensity = 1, reducedMotion = false) {
    const numeric = Number(intensity);
    this.recoilIntensity = reducedMotion === true
      ? 0
      : THREE.MathUtils.clamp(Number.isFinite(numeric) ? numeric : 1, 0, 1);
    if (this.recoilIntensity <= 0) this.clearModelRecoil();
    return this.getRecoilState();
  }

  setSwayIntensity(intensity = 0.8, reducedMotion = false) {
    const numeric = Number(intensity);
    this.swayIntensity = reducedMotion === true
      ? 0
      : THREE.MathUtils.clamp(Number.isFinite(numeric) ? numeric : 0.8, 0, 1);
    if (this.swayIntensity <= 0) this.clearModelSway();
    return this.getSwayState();
  }

  subscribeViewmodelMotion() {
    if (this.motionUnsubscribers.length > 0 || typeof this.eventBus?.on !== 'function') return;
    this.motionUnsubscribers.push(
      this.eventBus.on('player:jumped', (event = {}) => this.onPlayerJumped(event)),
      this.eventBus.on('player:landed', (event = {}) => this.onPlayerLanded(event)),
    );
  }

  addAirMotionImpulse(strength) {
    if (this.disposed || !this.enabled || this.swayIntensity <= 0) return false;
    const numeric = Number(strength);
    if (!Number.isFinite(numeric) || numeric <= 0) return false;
    const profile = this.currentConfig.viewModel?.sway;
    const amount = THREE.MathUtils.clamp(Number(profile?.amount ?? 1), 0.25, 1.6);
    const adsMultiplier = THREE.MathUtils.clamp(Number(profile?.adsMultiplier ?? 0.28), 0.1, 1);
    const scale = amount
      * this.swayIntensity
      * THREE.MathUtils.lerp(1, adsMultiplier, this.adsAmount);
    this.modelAirVelocity = THREE.MathUtils.clamp(
      this.modelAirVelocity - numeric * scale,
      -MAX_AIR_MOTION_VELOCITY,
      MAX_AIR_MOTION_VELOCITY,
    );
    return true;
  }

  onPlayerJumped({ speed } = {}) {
    const numeric = Number(speed);
    if (!Number.isFinite(numeric)) return false;
    const jumpSpeed = THREE.MathUtils.clamp(numeric, 0, 12);
    if (jumpSpeed <= 0) return false;
    return this.addAirMotionImpulse(0.38 * jumpSpeed / 7.25);
  }

  onPlayerLanded({ impact } = {}) {
    const numeric = Number(impact);
    if (!Number.isFinite(numeric)) return false;
    const landingImpact = THREE.MathUtils.clamp(numeric, 0, MAX_AIR_MOTION_LANDING_IMPACT);
    if (landingImpact <= MIN_AIR_MOTION_LANDING_IMPACT) return false;
    const severity = (landingImpact - MIN_AIR_MOTION_LANDING_IMPACT)
      / (MAX_AIR_MOTION_LANDING_IMPACT - MIN_AIR_MOTION_LANDING_IMPACT);
    return this.addAirMotionImpulse(0.34 + severity * 1.5);
  }

  clearModelRecoil({ snap = true } = {}) {
    this.modelKick = 0;
    this.modelSideKick = 0;
    this.modelRollKick = 0;
    if (snap && !this.disposed && this.models.size > 0 && this.currentModel) {
      this.animateModel(0, { snap: true });
    }
  }

  clearModelSway({ snap = true } = {}) {
    this.modelSwayYaw = 0;
    this.modelSwayPitch = 0;
    this.tempLookDelta.set(0, 0);
    this.clearModelAirMotion({ snap: false });
    if (snap && !this.disposed && this.models.size > 0 && this.currentModel) {
      this.animateModel(0, { snap: true });
    }
  }

  clearModelAirMotion({ snap = true } = {}) {
    this.modelAirOffset = 0;
    this.modelAirVelocity = 0;
    if (snap && !this.disposed && this.models.size > 0 && this.currentModel) {
      this.animateModel(0, { snap: true });
    }
  }

  clearViewmodelMotion({ snap = true } = {}) {
    this.clearModelRecoil({ snap: false });
    this.clearModelSway({ snap: false });
    if (snap && !this.disposed && this.models.size > 0 && this.currentModel) {
      this.animateModel(0, { snap: true });
    }
  }

  randomUnit() {
    const value = Number(this.random());
    return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0.5;
  }

  getRecoilState() {
    return {
      spread: this.recoilKick,
      modelKick: this.modelKick,
      modelSide: this.modelSideKick,
      modelRoll: this.modelRollKick,
      intensity: this.recoilIntensity,
    };
  }

  getSwayState() {
    return {
      positionX: -this.modelSwayYaw * SWAY_POSITION_X,
      positionY: this.modelSwayPitch * SWAY_POSITION_Y,
      pitch: this.modelSwayPitch,
      yaw: this.modelSwayYaw,
      roll: -this.modelSwayYaw * SWAY_ROLL_SCALE,
      intensity: this.swayIntensity,
      enabled: this.swayIntensity > 0,
    };
  }

  getAirMotionState() {
    return {
      offset: this.modelAirOffset,
      velocity: this.modelAirVelocity,
      positionY: this.modelAirOffset,
      positionZ: -this.modelAirOffset * AIR_MOTION_POSITION_Z,
      pitch: this.modelAirOffset * AIR_MOTION_PITCH_SCALE,
      intensity: this.swayIntensity,
      enabled: this.swayIntensity > 0,
    };
  }

  restoreModelParts(model) {
    for (const part of model.userData.motionParts ?? []) {
      part.mesh.position.copy(part.basePosition);
      part.mesh.quaternion.copy(part.baseQuaternion);
    }
  }

  primeEquipPose(model) {
    model.userData.equipAmount = 1;
    model.position.copy(model.userData.basePosition);
    model.position.x += 0.13;
    model.position.y -= 0.42;
    model.position.z += 0.08;
    model.rotation.set(0.16, model.userData.baseYaw + 0.24, 0.2);
  }

  reset() {
    if (this.disposed) return;
    this.cooldown = 0;
    this.cooldownKind = null;
    this.reloadRemaining = 0;
    this.reloadDuration = 0;
    this.recoilKick = 0;
    this.clearViewmodelMotion({ snap: false });
    this.adsAmount = 0;
    this.clearInputBuffer();
    this.index = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.shotSequence = 0;
    this.modifiers = this.defaultModifiers();
    this.runtimeModifiers = this.defaultRuntimeModifiers();
    for (const id of this.weaponOrder) {
      const config = resolveConfig(id);
      this.ammo.set(id, { magazine: config.magazine, reserve: config.reserve });
      const model = this.models.get(id);
      model.visible = false;
      model.position.copy(model.userData.basePosition);
      model.rotation.set(0, model.userData.baseYaw, 0);
      model.userData.animationTime = 0;
      model.userData.equipAmount = 0;
      this.restoreModelParts(model);
      for (const part of model.userData.pulseParts ?? []) part.mesh.scale.copy(part.baseScale);
      for (const part of model.userData.spinParts ?? []) part.mesh.rotation.copy(part.baseRotation);
    }
    this.currentModel.visible = this.enabled;
    this.emitState();
  }

  applyModifiers(effects) {
    if (effects.reloadMultiplier) {
      const previousDuration = this.reloadDuration;
      const progress = this.reloadRemaining > 0 && previousDuration > 0
        ? THREE.MathUtils.clamp(1 - this.reloadRemaining / previousDuration, 0, 1)
        : 0;
      this.modifiers.reloadMultiplier *= effects.reloadMultiplier;
      if (this.reloadRemaining > 0) {
        this.reloadDuration = this.getReloadDuration();
        this.reloadRemaining = this.reloadDuration * (1 - progress);
      }
    }
    if (effects.damageMultiplier) this.modifiers.damage *= effects.damageMultiplier;
    if (effects.shotgunPellets) this.modifiers.shotgunPellets += effects.shotgunPellets;
    if (effects.railRicochet) this.modifiers.railRicochet += effects.railRicochet;
    if (effects.critChance) this.modifiers.critChance += effects.critChance;
    if (effects.headshotExplosion) this.modifiers.headshotExplosion = Math.max(this.modifiers.headshotExplosion, effects.headshotExplosion);
    if (effects.lowHealthDamage) this.modifiers.lowHealthDamage += effects.lowHealthDamage;
  }

  setOverdrive(active, effects = {}) {
    const previousDuration = this.reloadDuration;
    const previousProgress = this.reloadRemaining > 0 && previousDuration > 0
      ? THREE.MathUtils.clamp(1 - this.reloadRemaining / previousDuration, 0, 1)
      : 0;
    const enabled = Boolean(active);
    const reloadTimeMultiplier = Number(effects.reloadTimeMultiplier ?? 0.62);
    const switchTimeMultiplier = Number(effects.weaponSwitchTimeMultiplier ?? 0.55);
    const previousFireRate = this.runtimeModifiers.fireRate;
    const previousSwitchSpeed = this.runtimeModifiers.switchSpeed;
    this.runtimeModifiers = enabled ? {
      overdrive: true,
      fireRate: THREE.MathUtils.clamp(Number(effects.fireRateMultiplier ?? 1.35), 1, 3),
      reloadSpeed: 1 / THREE.MathUtils.clamp(
        Number.isFinite(reloadTimeMultiplier) ? reloadTimeMultiplier : 0.62,
        0.25,
        1,
      ),
      switchSpeed: 1 / THREE.MathUtils.clamp(
        Number.isFinite(switchTimeMultiplier) ? switchTimeMultiplier : 0.55,
        0.25,
        1,
      ),
      equipSpeed: 1 / THREE.MathUtils.clamp(
        Number.isFinite(switchTimeMultiplier) ? switchTimeMultiplier : 0.55,
        0.25,
        1,
      ),
      impact: THREE.MathUtils.clamp(Number(effects.impactMultiplier ?? 1.4), 1, 3),
    } : this.defaultRuntimeModifiers();
    if (this.reloadRemaining > 0) {
      this.reloadDuration = this.getReloadDuration();
      this.reloadRemaining = this.reloadDuration * (1 - previousProgress);
    }
    if (this.cooldown > 0 && this.cooldownKind === 'fire') {
      this.cooldown *= previousFireRate / this.runtimeModifiers.fireRate;
    } else if (this.cooldown > 0 && this.cooldownKind === 'switch') {
      this.cooldown *= previousSwitchSpeed / this.runtimeModifiers.switchSpeed;
    }
    this.eventBus?.emit?.('weapon:overdrive-changed', {
      active: this.runtimeModifiers.overdrive,
      ...this.runtimeModifiers,
    });
    this.emitState();
    return { ...this.runtimeModifiers };
  }

  getReloadDuration(config = this.currentConfig) {
    return config.reloadTime * this.modifiers.reloadMultiplier / this.runtimeModifiers.reloadSpeed;
  }

  update(dt, input) {
    if (this.disposed) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown === 0) this.cooldownKind = null;
    const modelRecovery = Math.max(4, (this.currentConfig.recoil?.recovery ?? 12) * 1.5);
    this.modelKick = THREE.MathUtils.damp(this.modelKick, 0, modelRecovery, dt);
    this.modelSideKick = THREE.MathUtils.damp(this.modelSideKick, 0, modelRecovery, dt);
    this.modelRollKick = THREE.MathUtils.damp(this.modelRollKick, 0, modelRecovery, dt);
    this.recoilKick = THREE.MathUtils.damp(this.recoilKick, 0, this.currentConfig.recoil?.recovery ?? 12, dt);

    if (!this.enabled) return;
    if (input.wasPressed?.('weapon1')) this.switchTo(0);
    if (input.wasPressed?.('weapon2')) this.switchTo(1);
    if (input.wasPressed?.('weapon3')) this.switchTo(2);
    if (input.wasPressed?.('weapon4')) this.switchTo(3);
    if (input.wasPressed?.('weapon5')) this.switchTo(4);
    const wheel = input.consumeWheel?.() ?? 0;
    if (wheel) this.switchTo((this.index + Math.sign(wheel) + this.weaponOrder.length) % this.weaponOrder.length);

    if (this.reloadRemaining > 0) {
      this.reloadRemaining -= dt;
      if (this.reloadRemaining <= 0) this.finishReload();
    } else if (input.wasPressed?.('reload')) {
      this.startReload();
    }

    const aiming = Boolean(input.isDown?.('aim'));
    this.adsAmount = THREE.MathUtils.damp(this.adsAmount, aiming ? 1 : 0, 14, dt);
    this.player?.setAiming?.(this.adsAmount);
    this.updateModelSway(dt);
    this.updateModelAirMotion(dt);
    this.fireBufferRemaining = Math.max(0, this.fireBufferRemaining - dt);
    const firePressedEdge = Boolean(input.wasPressed?.('fire'));
    if (!firePressedEdge) this.firePressConsumed = false;
    if (firePressedEdge && !this.firePressConsumed) {
      this.firePressConsumed = true;
      this.fireBufferRemaining = FIRE_INPUT_BUFFER;
    }
    const triggerHeld = Boolean(input.isDown?.('fire'));
    if (input.wasReleased?.('fire')) this.triggerReleased = true;
    const trigger = triggerHeld || this.fireBufferRemaining > 0;
    const config = this.currentConfig;
    const canTrigger = config.automatic ? trigger : trigger && this.triggerReleased;
    const fired = canTrigger && this.reloadRemaining <= 0 && this.tryFire(aiming);
    if (fired) this.fireBufferRemaining = 0;
    if (!trigger) this.triggerReleased = true;
    else if (!config.automatic && fired) this.triggerReleased = false;

    this.animateModel(dt, aiming);
  }

  updateModelSway(dt) {
    this.tempLookDelta.set(0, 0);
    const lookDelta = this.player?.getLookDelta?.(this.tempLookDelta) ?? this.tempLookDelta;
    const yawDelta = Number.isFinite(lookDelta?.x) ? lookDelta.x : 0;
    const pitchDelta = Number.isFinite(lookDelta?.y) ? lookDelta.y : 0;
    const delta = THREE.MathUtils.clamp(Number(dt) || 0, 0, 0.05);
    if (delta <= 0 || this.swayIntensity <= 0) return;

    const profile = this.currentConfig.viewModel?.sway;
    const amount = THREE.MathUtils.clamp(Number(profile?.amount ?? 1), 0.25, 1.6);
    const recovery = THREE.MathUtils.clamp(Number(profile?.recovery ?? 10), 4, 24);
    const adsMultiplier = THREE.MathUtils.clamp(Number(profile?.adsMultiplier ?? 0.28), 0.1, 1);
    const scale = this.swayIntensity
      * amount
      * THREE.MathUtils.lerp(1, adsMultiplier, this.adsAmount);
    const yawSpeed = THREE.MathUtils.clamp(yawDelta / delta, -MAX_SWAY_LOOK_SPEED, MAX_SWAY_LOOK_SPEED);
    const pitchSpeed = THREE.MathUtils.clamp(pitchDelta / delta, -MAX_SWAY_LOOK_SPEED, MAX_SWAY_LOOK_SPEED);
    const targetYaw = THREE.MathUtils.clamp(
      -yawSpeed * SWAY_YAW_PER_SPEED * scale,
      -MAX_SWAY_YAW * scale,
      MAX_SWAY_YAW * scale,
    );
    const targetPitch = THREE.MathUtils.clamp(
      -pitchSpeed * SWAY_PITCH_PER_SPEED * scale,
      -MAX_SWAY_PITCH * scale,
      MAX_SWAY_PITCH * scale,
    );
    this.modelSwayYaw = THREE.MathUtils.damp(this.modelSwayYaw, targetYaw, recovery, delta);
    this.modelSwayPitch = THREE.MathUtils.damp(this.modelSwayPitch, targetPitch, recovery, delta);
    if (Math.abs(this.modelSwayYaw) < SWAY_REST_EPSILON && yawDelta === 0) this.modelSwayYaw = 0;
    if (Math.abs(this.modelSwayPitch) < SWAY_REST_EPSILON && pitchDelta === 0) this.modelSwayPitch = 0;
  }

  updateModelAirMotion(dt) {
    const delta = THREE.MathUtils.clamp(Number(dt) || 0, 0, 0.05);
    if (delta <= 0 || (this.modelAirOffset === 0 && this.modelAirVelocity === 0)) return;
    if (this.swayIntensity <= 0) {
      this.clearModelAirMotion({ snap: false });
      return;
    }
    const recovery = THREE.MathUtils.clamp(
      Number(this.currentConfig.viewModel?.sway?.recovery ?? 10),
      4,
      24,
    );
    const damping = Math.exp(-recovery * delta);
    const springVelocity = this.modelAirVelocity + recovery * this.modelAirOffset;
    this.modelAirOffset = THREE.MathUtils.clamp(
      (this.modelAirOffset + springVelocity * delta) * damping,
      MIN_AIR_MOTION_OFFSET,
      MAX_AIR_MOTION_OFFSET,
    );
    this.modelAirVelocity = THREE.MathUtils.clamp(
      (this.modelAirVelocity - recovery * springVelocity * delta) * damping,
      -MAX_AIR_MOTION_VELOCITY,
      MAX_AIR_MOTION_VELOCITY,
    );
    if (Math.abs(this.modelAirOffset) < AIR_MOTION_REST_EPSILON
      && Math.abs(this.modelAirVelocity) < AIR_MOTION_REST_EPSILON) {
      this.modelAirOffset = 0;
      this.modelAirVelocity = 0;
    }
  }

  animateModel(dt, { snap = false } = {}) {
    const model = this.currentModel;
    const config = this.currentConfig;
    this.tempViewBob.set(0, 0);
    const bob = this.player?.getViewBob?.(this.tempViewBob) ?? this.tempViewBob;
    const reloadDuration = this.reloadDuration || this.getReloadDuration(config);
    const reloadProgress = this.reloadRemaining > 0 && reloadDuration > 0
      ? THREE.MathUtils.clamp(1 - this.reloadRemaining / reloadDuration, 0, 1)
      : 0;
    const reloadArc = this.reloadRemaining > 0 ? Math.sin(reloadProgress * Math.PI) : 0;
    const equipAmount = model.userData.equipAmount ?? 0;
    model.userData.equipAmount = THREE.MathUtils.damp(
      equipAmount,
      0,
      (4 / Math.max(0.12, config.equipTime ?? 0.3)) * this.runtimeModifiers.equipSpeed,
      dt,
    );
    const poseAds = this.adsAmount * (1 - reloadArc);
    const bobScale = 1 - poseAds * 0.75;
    this.tempModelPosition
      .copy(model.userData.basePosition)
      .lerp(model.userData.adsPosition, poseAds);
    this.tempModelPosition.x += (bob.x ?? 0) * bobScale;
    this.tempModelPosition.x -= this.modelSwayYaw * SWAY_POSITION_X;
    this.tempModelPosition.x += this.modelSideKick * 0.018;
    this.tempModelPosition.x += reloadArc * 0.11 + equipAmount * 0.13;
    this.tempModelPosition.y += (bob.y ?? 0) * bobScale
      + this.modelSwayPitch * SWAY_POSITION_Y
      + this.modelAirOffset
      - this.modelKick * 0.025
      - reloadArc * 0.18
      - equipAmount * 0.42;
    this.tempModelPosition.z += this.modelKick * 0.04
      - this.modelAirOffset * AIR_MOTION_POSITION_Z
      + reloadArc * 0.06
      + equipAmount * 0.08;
    model.position.lerp(this.tempModelPosition, snap ? 1 : 1 - Math.exp(-dt * 15));
    model.rotation.x = this.modelSwayPitch
      + this.modelAirOffset * AIR_MOTION_PITCH_SCALE
      - this.modelKick * 0.055
      + reloadArc * 0.3
      + equipAmount * 0.16;
    model.rotation.y = THREE.MathUtils.lerp(model.userData.baseYaw, 0, poseAds)
      + this.modelSwayYaw
      + this.modelSideKick * 0.035
      + reloadArc * 0.4
      + equipAmount * 0.24;
    model.rotation.z = -this.modelSwayYaw * SWAY_ROLL_SCALE
      + this.modelRollKick * 0.045
      + reloadArc * 0.3
      + equipAmount * 0.2;
    model.userData.animationTime += dt;
    for (const part of model.userData.pulseParts ?? []) {
      const amount = 1 + Math.sin(model.userData.animationTime * part.speed + part.phase) * part.amplitude;
      part.mesh.scale.copy(part.baseScale).multiplyScalar(amount);
    }
    for (const part of model.userData.spinParts ?? []) {
      part.mesh.rotation.copy(part.baseRotation);
      part.mesh.rotation.z = (
        part.baseRotation.z + model.userData.animationTime * part.speed
      ) % (Math.PI * 2);
    }
    const recoilAmount = THREE.MathUtils.clamp(this.modelKick, 0, 1);
    for (const part of model.userData.motionParts ?? []) {
      part.mesh.position
        .copy(part.basePosition)
        .addScaledVector(part.reloadOffset, reloadArc)
        .addScaledVector(part.recoilOffset, recoilAmount);
      part.mesh.quaternion.copy(part.baseQuaternion).slerp(part.targetQuaternion, reloadArc);
    }
    model.visible = this.enabled;
  }

  switchTo(index) {
    if (this.disposed) return false;
    if (index < 0 || index >= this.weaponOrder.length || index === this.index) return false;
    const previousModel = this.currentModel;
    this.restoreModelParts(previousModel);
    previousModel.position.copy(previousModel.userData.basePosition);
    previousModel.rotation.set(0, previousModel.userData.baseYaw, 0);
    previousModel.userData.equipAmount = 0;
    previousModel.visible = false;
    this.index = index;
    const nextModel = this.currentModel;
    this.restoreModelParts(nextModel);
    this.primeEquipPose(nextModel);
    nextModel.visible = this.enabled;
    this.reloadRemaining = 0;
    this.reloadDuration = 0;
    this.clearViewmodelMotion();
    const switchCooldown = 0.18 / this.runtimeModifiers.switchSpeed;
    if (switchCooldown >= this.cooldown) {
      this.cooldown = switchCooldown;
      this.cooldownKind = 'switch';
    }
    this.audio?.playUI?.('switch');
    this.eventBus?.emit?.('weapon:changed', this.getState());
    this.emitState();
    return true;
  }

  tryFire(aiming) {
    if (this.disposed) return false;
    const config = this.currentConfig;
    const ammo = this.currentAmmo;
    if (this.cooldown > 0) return false;
    if (ammo.magazine <= 0) {
      this.cooldown = 0.2;
      this.cooldownKind = 'empty';
      this.audio?.playWeapon?.('empty', { pitch: 0.95 + this.randomUnit() * 0.08 });
      this.eventBus?.emit?.('weapon:empty', { weapon: config.id });
      return false;
    }

    if (!this.infiniteAmmo) ammo.magazine -= 1;
    this.cooldown = 1 / (config.fireRate * this.runtimeModifiers.fireRate);
    this.cooldownKind = 'fire';
    const configuredKick = config.viewModel?.kick;
    const modelKick = configuredKick ?? (config.id === 'scatter' ? 1.4 : config.id === 'rail' ? 1.65 : 0.48);
    const recoilPitch = (config.recoil?.pitch ?? 0.012) * (0.85 + this.randomUnit() * 0.3);
    const recoilYawRange = config.recoil?.yaw ?? 0.004;
    const recoilYaw = recoilYawRange * (this.randomUnit() - 0.5) * 2;
    const adsModelScale = THREE.MathUtils.lerp(1, 0.52, this.adsAmount);
    const modelImpulse = modelKick * this.recoilIntensity * adsModelScale;
    const lateral = recoilYawRange > 0 ? recoilYaw / recoilYawRange : 0;
    this.modelKick = Math.min(2.2, this.modelKick + modelImpulse);
    this.modelSideKick = THREE.MathUtils.clamp(
      this.modelSideKick + lateral * modelImpulse * 0.42,
      -1.35,
      1.35,
    );
    this.modelRollKick = THREE.MathUtils.clamp(
      this.modelRollKick - lateral * modelImpulse * 0.34,
      -1,
      1,
    );
    this.recoilKick = Math.min(3, this.recoilKick + 1);
    this.shotsFired += 1;
    this.shotSequence += 1;
    const shotId = this.shotSequence;
    this.camera.getWorldPosition(this.tempOrigin);
    if (typeof this.player?.getAimDirection === 'function') {
      this.player.getAimDirection(this.tempDirection);
    } else {
      this.camera.getWorldDirection(this.tempDirection);
    }
    this.currentModel.userData.muzzle.getWorldPosition(this.tempMuzzle);
    const movement = this.player?.speedNormalized ?? 0;
    const baseSpread = aiming ? config.adsSpread : config.spread;
    const spread = baseSpread + movement * (config.moveSpread ?? config.spread * 0.8) + Math.max(0, this.recoilKick - 1) * (config.spreadGrowth ?? 0.0015);
    const pellets = (config.pellets ?? 1) + (config.id === 'scatter' ? this.modifiers.shotgunPellets : 0);
    let anyHit = false;
    let headshot = false;
    let lethalHeadshot = false;
    let killed = false;
    let critical = false;
    let hitCount = 0;
    let totalDamage = 0;
    let blastHits = 0;
    let lastPoint = null;
    let lastResult = null;
    const traceThisShot = (config.tracerEvery ?? 1) <= 1 || this.shotsFired % config.tracerEvery === 0;
    for (let pellet = 0; pellet < pellets; pellet += 1) {
      const direction = this.spreadDirection(this.tempDirection, spread, pellet, pellets);
      const result = this.traceShot(this.tempOrigin, direction, config, { shotId });
      lastResult = result;
      if (result.enemyHit) {
        anyHit = true;
        headshot ||= result.zone === 'head';
        lethalHeadshot ||= result.zone === 'head' && result.killed;
        killed ||= result.killed || result.secondaryKilled;
        critical ||= result.critical;
        hitCount += 1 + result.secondaryHits;
        totalDamage += result.damage + result.secondaryDamage;
      }
      lastPoint = result.point;
      if (traceThisShot && (pellet < 5 || config.id !== 'scatter')) {
        const tracerWidth = config.vfx?.tracerWidth ?? (config.id === 'rail' ? 1.8 : 1);
        this.effects.spawnTracer(
          this.tempMuzzle,
          result.point,
          config.color,
          tracerWidth * this.runtimeModifiers.impact,
        );
      }
    }
    if (config.impactBlast && lastResult?.point) {
      const blast = this.applyImpactBlast(lastResult.point, config, { shotId });
      blastHits = blast.hits;
      hitCount += blast.hits;
      totalDamage += blast.totalDamage;
      anyHit ||= blast.hits > 0;
      killed ||= blast.killed;
    }
    if (headshot && !lethalHeadshot) {
      this.eventBus?.emit?.('combat:precision-hit', { weapon: config.id, enemyType: lastResult?.enemy?.type });
    }
    if (anyHit) this.shotsHit += 1;
    const muzzleIntensity = config.vfx?.muzzleIntensity ?? (config.id === 'rail' ? 1.5 : 1);
    this.effects.spawnMuzzle(
      this.tempMuzzle,
      this.tempDirection,
      config.color,
      muzzleIntensity * this.runtimeModifiers.impact,
    );
    this.player?.addRecoil?.(recoilPitch, recoilYaw, config.recoil?.recovery ?? 12);
    this.audio?.playWeapon?.(config.sound ?? config.id, { position: this.tempOrigin, pitch: 0.96 + this.randomUnit() * 0.08 });
    if (anyHit) {
      this.eventBus?.emit?.('combat:impact', {
        shotId,
        weapon: config.id,
        damage: totalDamage,
        hitCount,
        headshot,
        killed,
        critical,
        blastHits,
        hitStop: this.resolveHitStopDuration(config, { headshot, killed, critical, blastHits }),
        point: lastPoint?.clone?.(),
      });
    }
    this.eventBus?.emit?.('combat:shot', {
      shotId,
      weapon: config.id,
      origin: this.tempOrigin.clone(),
      direction: this.tempDirection.clone(),
      loudness: config.loudness ?? (config.id === 'rail' ? 1.35 : 1),
      hit: anyHit,
      headshot,
      point: lastPoint?.clone?.(),
    });
    this.eventBus?.emit?.('weapon:fired', this.getState());
    this.emitState();
    return true;
  }

  resolveHitStopDuration(config = this.currentConfig, context = {}) {
    const profile = config?.hitStop;
    let duration = hitStopValue(profile, 'body');
    if (context.headshot) duration = Math.max(duration, hitStopValue(profile, 'headshot'));
    if (context.killed) duration = Math.max(duration, hitStopValue(profile, 'kill'));
    if (context.critical) duration = Math.max(duration, hitStopValue(profile, 'critical'));
    if (Number(context.blastHits) > 0) duration = Math.max(duration, hitStopValue(profile, 'blast'));
    return THREE.MathUtils.clamp(duration, 0, MAX_HIT_STOP_DURATION);
  }

  spreadDirection(base, spread, pellet, pellets) {
    const direction = base.clone();
    this.tempRight.crossVectors(direction, WORLD_UP).normalize();
    if (this.tempRight.lengthSq() < 0.1) this.tempRight.set(1, 0, 0);
    this.tempUp.crossVectors(this.tempRight, direction).normalize();
    const ring = pellets > 1 ? Math.sqrt((pellet + this.randomUnit()) / pellets) : this.randomUnit();
    const angle = this.randomUnit() * Math.PI * 2;
    direction
      .addScaledVector(this.tempRight, Math.cos(angle) * spread * ring)
      .addScaledVector(this.tempUp, Math.sin(angle) * spread * ring)
      .normalize();
    return direction;
  }

  traceShot(origin, direction, config, { shotId = null } = {}) {
    const worldHit = this.arena?.raycastWorld?.(origin, direction, config.range);
    const worldDistance = Number.isFinite(worldHit?.distance) ? worldHit.distance : config.range;
    const enemyHit = this.enemySystem?.raycast?.(origin, direction, worldDistance);
    const hit = enemyHit && enemyHit.distance <= worldDistance ? enemyHit : null;
    const distance = hit?.distance ?? worldDistance;
    const point = hit?.point?.clone?.() ?? origin.clone().addScaledVector(direction, distance);
    if (hit) {
      const falloffRange = Math.max(1, config.falloffEnd - config.falloffStart);
      const falloff = 1 - THREE.MathUtils.clamp((distance - config.falloffStart) / falloffRange, 0, 1) * (1 - (config.minDamageMultiplier ?? 0.45));
      const zoneMultiplier = hit.zone === 'head' ? (config.headMultiplier ?? 1.8) : hit.zone === 'limb' ? 0.78 : 1;
      const randomCrit = this.randomUnit() < this.modifiers.critChance ? 1.65 : 1;
      const lowHealthBonus = (this.player?.health ?? 100) / (this.player?.maxHealth ?? 100) < 0.35 ? 1 + this.modifiers.lowHealthDamage : 1;
      const anomalyMultiplier = config.id === 'rail' ? this.modifiers.railAnomalyMultiplier : 1;
      const damage = config.damage * falloff * zoneMultiplier * randomCrit * lowHealthBonus * this.modifiers.damage * anomalyMultiplier;
      const outcome = this.enemySystem.damage(hit.enemy, damage, {
        source: 'player', weapon: config.id, zone: hit.zone, point, direction,
      });
      const reportedDamage = Number(outcome?.applied);
      const appliedDamage = Number.isFinite(reportedDamage) ? Math.max(0, reportedDamage) : damage;
      this.eventBus?.emit?.('combat:damage-dealt', {
        damage: appliedDamage,
        weapon: config.id,
        enemyType: hit.enemy?.type,
        zone: hit.zone,
        killed: Boolean(outcome?.killed),
      });
      if (hit.zone === 'head' && this.player?.modifiers?.shieldOnHit > 0) {
        this.player.addArmor?.(this.player.modifiers.shieldOnHit);
      }
      this.effects.spawnImpact(
        point,
        direction.clone().negate(),
        hit.zone === 'head' ? 0xffdc78 : config.color,
        hit.zone === 'head' ? Math.max(12, config.vfx?.impactCount ?? 0) : (config.vfx?.impactCount ?? 6),
      );
      this.eventBus?.emit?.('combat:hit', {
        shotId,
        weapon: config.id,
        damage,
        zone: hit.zone,
        killed: Boolean(outcome?.killed),
        critical: randomCrit > 1,
        point: point.clone(),
      });
      const ricochet = config.id === 'rail' && this.modifiers.railRicochet > 0
        ? this.applyRailRicochet(hit.enemy, point, damage * 0.48, config, { shotId })
        : null;
      return {
        point,
        enemyHit: true,
        enemy: hit.enemy,
        zone: hit.zone,
        killed: Boolean(outcome?.killed),
        critical: randomCrit > 1,
        damage: appliedDamage,
        secondaryHits: ricochet ? 1 : 0,
        secondaryKilled: Boolean(ricochet?.killed),
        secondaryDamage: Number(ricochet?.damage) || 0,
      };
    }
    if (worldHit) {
      this.effects.spawnImpact(
        point,
        worldHit.normal ?? direction.clone().negate(),
        worldHit.material === 'energy' ? 0xd36bff : config.color ?? 0x7fe5f0,
        config.vfx?.impactCount ?? 4,
      );
      this.audio?.playEffect?.('impact', { position: point, material: worldHit.material ?? 'metal' });
    }
    return {
      point,
      enemyHit: false,
      zone: null,
      killed: false,
      critical: false,
      damage: 0,
      secondaryHits: 0,
      secondaryKilled: false,
      secondaryDamage: 0,
    };
  }

  applyImpactBlast(point, config, { shotId = null } = {}) {
    const blast = config.impactBlast;
    if (!blast || !point) return { hits: 0, kills: 0, killed: false, radius: 0, damage: 0, totalDamage: 0 };
    const lowHealthBonus = (this.player?.health ?? 100) / (this.player?.maxHealth ?? 100) < 0.35
      ? 1 + this.modifiers.lowHealthDamage
      : 1;
    const damage = blast.damage * this.modifiers.damage * lowHealthBonus;
    const radius = blast.radius;
    const reported = this.enemySystem?.damageInRadius?.(point, radius, damage, {
      source: 'player',
      weapon: `${config.id}-blast`,
      zone: 'body',
      direction: this.tempDirection.clone(),
      returnSummary: true,
    }) ?? 0;
    const summary = reported && typeof reported === 'object' ? reported : null;
    const hits = Math.max(0, Math.floor(Number(summary?.hits ?? reported) || 0));
    const kills = Math.min(hits, Math.max(0, Math.floor(Number(summary?.kills) || 0)));
    const reportedDamage = Number(summary?.damage);
    const totalDamage = Number.isFinite(reportedDamage) ? Math.max(0, reportedDamage) : damage * hits;
    this.effects.spawnExplosion?.(point, radius, blast.color ?? config.color);
    this.audio?.playEffect?.('explosion', { position: point, pitch: 0.78, volume: 0.92 });
    this.eventBus?.emit?.('combat:blast', {
      shotId,
      weapon: config.id,
      point: point.clone(),
      radius,
      damage,
      totalDamage,
      hits,
      kills,
    });
    return { hits, kills, killed: kills > 0, radius, damage, totalDamage };
  }

  applyRailRicochet(sourceEnemy, sourcePoint, damage, config, { shotId = null } = {}) {
    const target = this.enemySystem?.enemies
      ?.filter((enemy) => !enemy.dead && enemy !== sourceEnemy)
      .filter((enemy) => enemy.root.position.distanceToSquared(sourcePoint) <= 14 ** 2)
      .filter((enemy) => this.arena?.hasLineOfSight?.(sourcePoint, enemy.root.position.clone().add(new THREE.Vector3(0, 1, 0))) ?? true)
      .sort((a, b) => a.root.position.distanceToSquared(sourcePoint) - b.root.position.distanceToSquared(sourcePoint))[0];
    if (!target) return null;
    const targetPoint = target.root.position.clone().add(new THREE.Vector3(0, target.type === 'warden' ? 1.45 : 1.05, 0));
    const direction = targetPoint.clone().sub(sourcePoint).normalize();
    const outcome = this.enemySystem.damage(target, damage, {
      source: 'player', weapon: `${config.id}-ricochet`, zone: 'body', point: targetPoint, direction,
    });
    const reportedDamage = Number(outcome?.applied);
    const appliedDamage = Number.isFinite(reportedDamage) ? Math.max(0, reportedDamage) : damage;
    this.effects.spawnTracer(sourcePoint, targetPoint, config.color, 1.45);
    this.effects.spawnImpact(targetPoint, direction.clone().negate(), config.color, 8);
    this.eventBus?.emit?.('combat:hit', {
      shotId,
      weapon: config.id,
      damage,
      zone: 'body',
      killed: Boolean(outcome?.killed),
      ricochet: true,
      point: targetPoint.clone(),
    });
    return { damage: appliedDamage, killed: Boolean(outcome?.killed) };
  }

  startReload() {
    const config = this.currentConfig;
    const ammo = this.currentAmmo;
    if (this.reloadRemaining > 0 || ammo.magazine >= config.magazine || ammo.reserve <= 0) return false;
    this.reloadDuration = this.getReloadDuration(config);
    this.reloadRemaining = this.reloadDuration;
    this.audio?.playWeapon?.('reload', { duration: this.reloadRemaining, variant: config.id });
    this.eventBus?.emit?.('weapon:reload-start', { weapon: config.id, duration: this.reloadRemaining });
    return true;
  }

  finishReload() {
    const config = this.currentConfig;
    const ammo = this.currentAmmo;
    const required = config.magazine - ammo.magazine;
    const moved = Math.min(required, ammo.reserve);
    ammo.magazine += moved;
    ammo.reserve -= moved;
    this.reloadRemaining = 0;
    this.reloadDuration = 0;
    this.eventBus?.emit?.('weapon:reload-complete', this.getState());
    this.emitState();
  }

  addAmmo(amount = 20, weaponId = this.currentId) {
    const config = resolveConfig(weaponId);
    const ammo = this.ammo.get(weaponId);
    ammo.reserve = Math.min(config.maxReserve ?? config.reserve * 2, ammo.reserve + amount);
    this.emitState();
  }

  setInfiniteAmmo(enabled) {
    this.infiniteAmmo = Boolean(enabled);
    this.emitState();
    return this.infiniteAmmo;
  }

  getState() {
    const config = this.currentConfig;
    const ammo = this.currentAmmo;
    return {
      id: config.id,
      weapon: config.shortName ?? config.name,
      name: config.name,
      ammo: ammo.magazine,
      reserve: ammo.reserve,
      magazine: config.magazine,
      reload: this.reloadRemaining > 0,
      reloadProgress: this.reloadRemaining > 0
        ? 1 - this.reloadRemaining / Math.max(0.001, this.reloadDuration || this.getReloadDuration(config))
        : 0,
      ads: this.adsAmount,
      overdrive: this.runtimeModifiers.overdrive,
    };
  }

  emitState() {
    this.eventBus?.emit?.('weapon:state', this.getState());
  }

  getAccuracy() {
    return this.shotsFired > 0 ? this.shotsHit / this.shotsFired : 0;
  }

  dispose() {
    if (this.disposed) return;
    this.clearViewmodelMotion({ snap: false });
    for (const unsubscribe of this.motionUnsubscribers) unsubscribe?.();
    this.motionUnsubscribers.length = 0;
    const geometries = new Set();
    const materials = new Set();
    for (const model of this.models.values()) {
      this.camera.remove(model);
      model.traverse((object) => {
        if (object.isMesh) geometries.add(object.geometry);
      });
      for (const material of model.userData.materials ?? []) materials.add(material);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.models.clear();
    this.disposed = true;
  }
}

export default WeaponSystem;
