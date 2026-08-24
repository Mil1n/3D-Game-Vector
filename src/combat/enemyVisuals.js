import * as THREE from 'three';

const FALLBACK_COLORS = Object.freeze({
  trooper: 0xffa43a,
  hunter: 0xca69ff,
  warden: 0xf34c8f,
});

// Arena spawn/navigation points use the same body-centre convention as the
// player capsule: their Y coordinate sits one metre above the supporting
// surface. Keep that gameplay root stable and lower only the authored rig so
// the feet, shields and death animation meet the actual floor.
export const ENEMY_GROUND_OFFSET = 1;

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);

function rememberTransform(object) {
  object.userData.basePosition = object.position.clone();
  object.userData.baseRotation = object.rotation.clone();
  object.userData.baseScale = object.scale.clone();
  return object;
}

function restoreTransform(object) {
  if (!object) return;
  object.position.copy(object.userData.basePosition);
  object.rotation.copy(object.userData.baseRotation);
  object.scale.copy(object.userData.baseScale);
}

function place(object, position = null, rotation = null, scale = null) {
  if (position) object.position.set(...position);
  if (rotation) object.rotation.set(...rotation);
  if (scale) object.scale.set(...scale);
  return rememberTransform(object);
}

function makeMaterials(type, accentValue) {
  const accent = new THREE.Color(accentValue ?? FALLBACK_COLORS[type] ?? 0xff684d);
  const armorColors = {
    trooper: 0x34434b,
    hunter: 0x252736,
    warden: 0x493754,
  };
  const armorLightColors = {
    trooper: 0x52636a,
    hunter: 0x3d3552,
    warden: 0x684a72,
  };
  const armor = new THREE.MeshStandardMaterial({
    color: armorColors[type] ?? armorColors.trooper,
    emissive: accent,
    emissiveIntensity: type === 'hunter' ? 0.24 : 0.16,
    roughness: 0.48,
    metalness: 0.62,
  });
  const armorLight = new THREE.MeshStandardMaterial({
    color: armorLightColors[type] ?? armorLightColors.trooper,
    roughness: 0.4,
    metalness: 0.72,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x11191e,
    roughness: 0.7,
    metalness: 0.36,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: type === 'warden' ? 2.1 : 1.7,
    roughness: 0.2,
    metalness: 0.22,
  });
  glow.userData.baseEmissiveIntensity = glow.emissiveIntensity;
  return { armor, armorLight, dark, glow, all: [armor, armorLight, dark, glow] };
}

function makeBuilder(root, visualRoot, hitMeshes) {
  const mesh = (parent, geometry, material, options = {}) => {
    const object = new THREE.Mesh(geometry, material);
    object.name = options.name ?? geometry.type;
    object.castShadow = options.castShadow ?? false;
    object.receiveShadow = options.receiveShadow ?? false;
    place(object, options.position, options.rotation, options.scale);
    if (options.hitZone) {
      object.userData.hitZone = options.hitZone;
      hitMeshes.push(object);
    }
    parent.add(object);
    return object;
  };
  const group = (parent = visualRoot, name = 'part', options = {}) => {
    const object = new THREE.Group();
    object.name = name;
    place(object, options.position, options.rotation, options.scale);
    parent.add(object);
    return object;
  };
  const anchor = (parent, name, position) => {
    const object = new THREE.Object3D();
    object.name = name;
    object.position.set(...position);
    parent.add(object);
    return object;
  };
  return { mesh, group, anchor, root };
}

function addShield(type, config, visualRoot, materials, builder) {
  if (!(config.shield > 0)) return null;
  const shieldMaterial = new THREE.MeshBasicMaterial({
    color: type === 'warden' ? 0xb56cff : config.color ?? FALLBACK_COLORS[type],
    transparent: true,
    opacity: type === 'warden' ? 0.18 : 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  shieldMaterial.userData.minOpacity = type === 'warden' ? 0.08 : 0.035;
  shieldMaterial.userData.maxOpacity = shieldMaterial.opacity;
  materials.all.push(shieldMaterial);
  return builder.mesh(visualRoot, new THREE.SphereGeometry(1, 18, 12), shieldMaterial, {
    name: `${type}-shield`,
    position: type === 'warden' ? [0, 1.72, 0] : [0, 1.13, 0],
    scale: type === 'warden' ? [1.58, 1.7, 1.35] : [0.82, 1.1, 0.74],
    castShadow: false,
  });
}

function buildTrooper(root, visualRoot, config, materials, builder) {
  const { mesh, group, anchor } = builder;
  const legs = [];
  const legGeometry = new THREE.BoxGeometry(0.24, 0.82, 0.28);
  for (const side of [-1, 1]) {
    const leg = group(visualRoot, side < 0 ? 'left-leg' : 'right-leg', { position: [side * 0.24, 0.42, 0] });
    mesh(leg, legGeometry, materials.dark, { name: 'leg-armor', hitZone: 'limb' });
    legs.push(leg);
  }

  mesh(visualRoot, new THREE.BoxGeometry(0.62, 0.3, 0.4), materials.dark, {
    name: 'pelvis', position: [0, 0.82, 0], hitZone: 'body',
  });
  const body = mesh(visualRoot, new THREE.BoxGeometry(0.82, 0.82, 0.48), materials.armor, {
    name: 'torso', position: [0, 1.3, 0], hitZone: 'body',
  });
  mesh(visualRoot, new THREE.BoxGeometry(0.58, 0.27, 0.11), materials.armorLight, {
    name: 'chest-plate', position: [0, 1.4, 0.29],
  });
  const shoulderGeometry = new THREE.BoxGeometry(0.32, 0.25, 0.38);
  for (const side of [-1, 1]) {
    mesh(visualRoot, shoulderGeometry, materials.armorLight, {
      name: 'shoulder', position: [side * 0.55, 1.48, 0], rotation: [0, 0, side * 0.08],
    });
  }
  const head = mesh(visualRoot, new THREE.BoxGeometry(0.43, 0.34, 0.4), materials.dark, {
    name: 'helmet', position: [0, 1.91, 0], hitZone: 'head',
  });
  const visor = mesh(visualRoot, new THREE.BoxGeometry(0.34, 0.085, 0.055), materials.glow, {
    name: 'visor', position: [0, 1.94, 0.225],
  });

  const weapon = group(visualRoot, 'burst-rifle', { position: [0.46, 1.25, 0.27], rotation: [-0.04, -0.08, 0] });
  mesh(weapon, new THREE.BoxGeometry(0.25, 0.22, 0.72), materials.dark, {
    name: 'receiver', position: [0, 0, 0.24], hitZone: 'limb',
  });
  mesh(weapon, new THREE.CylinderGeometry(0.055, 0.075, 0.82, 7), materials.armorLight, {
    name: 'barrel', position: [0, 0.01, 0.91], rotation: [Math.PI / 2, 0, 0],
  });
  const telegraphLights = [];
  for (let index = 0; index < 3; index += 1) {
    telegraphLights.push(mesh(weapon, new THREE.BoxGeometry(0.075, 0.06, 0.1), materials.glow, {
      name: `burst-light-${index + 1}`, position: [0, 0.13, 0.36 + index * 0.18], scale: [0.72, 0.72, 0.72],
    }));
  }
  const muzzle = anchor(weapon, 'muzzle', [0, 0.01, 1.34]);
  return { body, head, visor, legs, weapon, telegraphLights, muzzle };
}

function buildHunter(root, visualRoot, config, materials, builder) {
  const { mesh, group, anchor } = builder;
  const body = mesh(visualRoot, new THREE.OctahedronGeometry(0.62, 0), materials.armor, {
    name: 'hunter-body', position: [0, 1.05, 0], scale: [0.86, 1.12, 0.76], hitZone: 'body',
  });
  mesh(visualRoot, new THREE.BoxGeometry(0.62, 0.22, 0.48), materials.armorLight, {
    name: 'carapace', position: [0, 1.18, -0.2], rotation: [-0.16, 0, 0],
  });
  const head = mesh(visualRoot, new THREE.ConeGeometry(0.34, 0.64, 3), materials.glow, {
    name: 'hunter-head', position: [0, 1.57, 0.34], rotation: [Math.PI / 2, 0, 0], hitZone: 'head',
  });
  const core = mesh(visualRoot, new THREE.OctahedronGeometry(0.18, 0), materials.glow, {
    name: 'phase-core', position: [0, 1.08, 0.5],
  });

  const legs = [];
  const legGeometry = new THREE.BoxGeometry(0.18, 0.86, 0.2);
  for (const side of [-1, 1]) {
    const leg = group(visualRoot, side < 0 ? 'left-stilt' : 'right-stilt', {
      position: [side * 0.34, 0.52, -0.02], rotation: [0.08, 0, side * -0.2],
    });
    mesh(leg, legGeometry, materials.dark, { name: 'stilt', hitZone: 'limb' });
    legs.push(leg);
  }

  const blades = [];
  const bladeTips = [];
  const bladeGeometry = new THREE.ConeGeometry(0.115, 1.08, 4);
  for (const side of [-1, 1]) {
    const blade = group(visualRoot, side < 0 ? 'left-blade' : 'right-blade', {
      position: [side * 0.58, 1.14, 0.26], rotation: [0.08, 0, side * 0.46],
    });
    mesh(blade, bladeGeometry, materials.glow, { name: 'phase-blade', position: [0, -0.17, 0.12], hitZone: 'limb' });
    bladeTips.push(anchor(blade, 'blade-tip', [0, -0.73, 0.12]));
    blade.userData.side = side;
    blades.push(blade);
  }

  const fins = [];
  const finGeometry = new THREE.BoxGeometry(0.07, 0.48, 0.24);
  for (const side of [-1, 0, 1]) {
    const fin = mesh(visualRoot, finGeometry, materials.glow, {
      name: 'phase-fin', position: [side * 0.25, 1.27 + Math.abs(side) * 0.03, -0.43], rotation: [-0.22, 0, side * -0.2],
    });
    fin.userData.side = side;
    fins.push(fin);
  }
  const coreAnchor = anchor(core, 'core-anchor', [0, 0, 0.22]);
  return { body, head, core, coreAnchor, legs, blades, bladeTips, fins };
}

function buildWarden(root, visualRoot, config, materials, builder) {
  const { mesh, group, anchor } = builder;
  const body = mesh(visualRoot, new THREE.BoxGeometry(1.46, 1.42, 0.82), materials.armor, {
    name: 'citadel-body', position: [0, 1.42, 0], scale: [1, 1, 0.92], hitZone: 'body',
  });
  const head = mesh(visualRoot, new THREE.OctahedronGeometry(0.39, 0), materials.glow, {
    name: 'warden-head', position: [0, 2.38, 0.06], scale: [1, 1.1, 0.85], hitZone: 'head',
  });
  const coreMaterial = materials.glow.clone();
  coreMaterial.emissiveIntensity = 2.35;
  coreMaterial.userData.baseEmissiveIntensity = coreMaterial.emissiveIntensity;
  materials.all.push(coreMaterial);
  const core = mesh(visualRoot, new THREE.IcosahedronGeometry(0.34, 1), coreMaterial, {
    name: 'rift-reactor', position: [0, 1.47, 0.55],
  });
  const orbAnchor = anchor(core, 'orb-origin', [0, 0, 0.42]);

  const legs = [];
  const legGeometry = new THREE.BoxGeometry(0.46, 0.92, 0.52);
  for (const side of [-1, 1]) {
    const leg = group(visualRoot, side < 0 ? 'left-pillar-leg' : 'right-pillar-leg', { position: [side * 0.43, 0.48, 0] });
    mesh(leg, legGeometry, materials.dark, { name: 'pillar-leg', hitZone: 'limb' });
    legs.push(leg);
  }

  const pylons = [];
  const telegraphLights = [];
  const pylonGeometry = new THREE.BoxGeometry(0.34, 1.18, 0.42);
  const nodeGeometry = new THREE.OctahedronGeometry(0.11, 0);
  for (const side of [-1, 1]) {
    const pylon = group(visualRoot, side < 0 ? 'left-pylon' : 'right-pylon', { position: [side * 1.02, 1.66, -0.03] });
    mesh(pylon, pylonGeometry, materials.armorLight, { name: 'pylon-armor', hitZone: 'limb' });
    for (let index = 0; index < 2; index += 1) {
      const light = mesh(pylon, nodeGeometry, materials.glow, {
        name: `orb-node-${index + 1}`, position: [0, 0.28 - index * 0.52, 0.26], scale: [0.72, 0.72, 0.72],
      });
      telegraphLights.push(light);
    }
    pylon.userData.side = side;
    pylons.push(pylon);
  }

  const panels = [];
  for (const side of [-1, 1]) {
    const panel = group(visualRoot, side < 0 ? 'left-panel' : 'right-panel', {
      position: [side * 0.7, 1.58, 0.12], rotation: [0, side * -0.12, side * 0.06],
    });
    mesh(panel, new THREE.BoxGeometry(0.38, 0.86, 0.16), materials.armorLight, { name: 'phase-panel' });
    panel.userData.side = side;
    panels.push(panel);
  }

  const crown = group(visualRoot, 'broken-crown', { position: [0, 2.82, 0] });
  const crownGeometry = new THREE.TorusGeometry(0.55, 0.075, 5, 14, Math.PI * 0.48);
  for (let index = 0; index < 3; index += 1) {
    mesh(crown, crownGeometry, materials.glow, {
      name: `crown-segment-${index + 1}`, rotation: [0, 0, index * (Math.PI * 2 / 3)],
    });
  }
  return { body, head, core, orbAnchor, legs, pylons, panels, crown, telegraphLights };
}

export function makeEnemyVisual(type, config) {
  const root = new THREE.Group();
  root.name = `${config.name ?? type}`;
  const visualRoot = new THREE.Group();
  visualRoot.name = `${type}-visual-root`;
  visualRoot.position.y = -ENEMY_GROUND_OFFSET;
  rememberTransform(visualRoot);
  root.add(visualRoot);
  const hitMeshes = [];
  const materials = makeMaterials(type, config.color);
  const builder = makeBuilder(root, visualRoot, hitMeshes);

  let visualParts;
  if (type === 'hunter') visualParts = buildHunter(root, visualRoot, config, materials, builder);
  else if (type === 'warden') visualParts = buildWarden(root, visualRoot, config, materials, builder);
  else visualParts = buildTrooper(root, visualRoot, config, materials, builder);

  const shield = addShield(type, config, visualRoot, materials, builder);
  visualParts.visualRoot = visualRoot;
  visualParts.shield = shield;
  root.userData.materials = materials.all;
  root.userData.shield = shield;
  root.userData.visualParts = visualParts;
  root.userData.glowMaterial = materials.glow;
  root.userData.groundOffset = ENEMY_GROUND_OFFSET;
  return { root, hitMeshes };
}

function windupFor(enemy, kind) {
  const pending = enemy.pendingAttack;
  if (!pending || pending.kind !== kind) return 0;
  return clamp01(1 - pending.remaining / Math.max(0.001, pending.duration ?? enemy.telegraph ?? 0.001));
}

function recoveryFor(enemy, kind) {
  if (!enemy.visualRecovery || enemy.visualRecovery.kind !== kind) return 0;
  return clamp01(enemy.visualRecovery.remaining / Math.max(0.001, enemy.visualRecovery.duration));
}

function animateLegs(legs, time, motion, amplitude, rate) {
  const stride = Math.sin(time * rate) * amplitude * motion;
  legs?.forEach((leg, index) => {
    restoreTransform(leg);
    leg.rotation.x += index % 2 === 0 ? stride : -stride;
  });
}

function animateTrooper(enemy, parts, time, motion) {
  animateLegs(parts.legs, time, motion, 0.42, 8.4);
  const windup = windupFor(enemy, 'burst');
  const recoil = recoveryFor(enemy, 'burst');
  restoreTransform(parts.weapon);
  parts.weapon.rotation.x += -windup * 0.15 + recoil * 0.17;
  parts.weapon.position.y -= Math.sin(windup * Math.PI) * 0.045;
  const charge = windup * parts.telegraphLights.length;
  parts.telegraphLights.forEach((light, index) => {
    restoreTransform(light);
    const active = clamp01(charge - index);
    light.scale.multiplyScalar(0.72 + active * 0.72 + recoil * 0.18);
  });
  restoreTransform(parts.visor);
  parts.visor.scale.x *= 0.92 + Math.sin(time * 3.2) * 0.08 + windup * 0.18;
}

function animateHunter(enemy, parts, time, motion) {
  animateLegs(parts.legs, time, motion, 0.58, 11.5);
  const windup = windupFor(enemy, 'melee');
  const strike = recoveryFor(enemy, 'melee');
  parts.visualRoot.rotation.x -= 0.08 + motion * 0.12;
  parts.blades.forEach((blade) => {
    restoreTransform(blade);
    const side = blade.userData.side;
    blade.rotation.z += side * (windup * 0.58 - strike * 0.92);
    blade.rotation.x += Math.sin(time * 4 + side) * 0.035;
  });
  parts.fins.forEach((fin, index) => {
    restoreTransform(fin);
    fin.rotation.y += Math.sin(time * 5.4 + index * 0.8) * (0.14 + motion * 0.08);
  });
  restoreTransform(parts.core);
  const pulse = 1 + Math.sin(time * 7.5) * 0.08 + windup * 0.35 + strike * 0.16;
  parts.core.scale.multiplyScalar(pulse);
}

function animateWarden(enemy, parts, time, motion) {
  animateLegs(parts.legs, time, motion, 0.19, 5.1);
  const orbWindup = windupFor(enemy, 'orbVolley');
  const hazardWindup = windupFor(enemy, 'hazard');
  const recovery = Math.max(recoveryFor(enemy, 'orbVolley'), recoveryFor(enemy, 'hazard'));
  const phase = enemy.elitePhase ?? 1;
  restoreTransform(parts.crown);
  parts.crown.position.y += (phase - 1) * 0.12 + hazardWindup * 0.1;
  parts.crown.rotation.z += time * (0.28 + phase * 0.14) + hazardWindup * 0.7;
  parts.pylons.forEach((pylon) => {
    restoreTransform(pylon);
    const side = pylon.userData.side;
    pylon.position.x += side * ((phase - 1) * 0.1 + orbWindup * 0.15);
    pylon.rotation.z += side * (orbWindup * 0.1 + hazardWindup * 0.06);
  });
  parts.panels.forEach((panel) => {
    restoreTransform(panel);
    panel.rotation.y += panel.userData.side * ((phase - 1) * 0.2 + hazardWindup * 0.12);
  });
  restoreTransform(parts.core);
  const corePulse = 1 + Math.sin(time * (4.2 + phase)) * (0.06 + phase * 0.015) + Math.max(orbWindup, hazardWindup) * 0.42 + recovery * 0.12;
  parts.core.scale.multiplyScalar(corePulse);
  parts.core.material.emissiveIntensity = parts.core.material.userData.baseEmissiveIntensity + (phase - 1) * 0.35 + Math.max(orbWindup, hazardWindup) * 2.4;
  const charge = orbWindup * parts.telegraphLights.length;
  parts.telegraphLights.forEach((light, index) => {
    restoreTransform(light);
    const orbCharge = clamp01(charge - index);
    const hazardPulse = hazardWindup > 0 ? 0.35 + Math.sin(time * 16 + index) * 0.18 : 0;
    light.scale.multiplyScalar(0.72 + orbCharge * 0.76 + hazardPulse);
  });
}

export function updateEnemyVisual(enemy, dt) {
  const parts = enemy.root.userData.visualParts;
  if (!parts) return;
  enemy.visualTime = (enemy.visualTime ?? 0) + dt;
  if (enemy.visualRecovery) {
    enemy.visualRecovery.remaining = Math.max(0, enemy.visualRecovery.remaining - dt);
    if (enemy.visualRecovery.remaining <= 0) enemy.visualRecovery = null;
  }
  const speed = enemy.velocity?.length?.() ?? 0;
  const motion = clamp01(speed / Math.max(0.1, enemy.config.speed ?? 4));
  restoreTransform(parts.visualRoot);
  parts.visualRoot.position.y += Math.sin(enemy.visualTime * (enemy.type === 'hunter' ? 5.6 : 3.8) + enemy.bobOffset) * (enemy.type === 'hunter' ? 0.035 : 0.015);
  if (enemy.type === 'hunter') animateHunter(enemy, parts, enemy.visualTime, motion);
  else if (enemy.type === 'warden') animateWarden(enemy, parts, enemy.visualTime, motion);
  else animateTrooper(enemy, parts, enemy.visualTime, motion);

  const reaction = enemy.hitReaction;
  if (reaction?.remaining > 0 && reaction.strength > 0) {
    reaction.remaining = Math.max(0, reaction.remaining - Math.max(0, dt));
    const life = clamp01(reaction.remaining / Math.max(0.001, reaction.duration));
    const envelope = life * life;
    const forwardX = Number.isFinite(enemy.forward?.x) ? enemy.forward.x : Math.sin(enemy.root.rotation.y);
    const forwardZ = Number.isFinite(enemy.forward?.z) ? enemy.forward.z : Math.cos(enemy.root.rotation.y);
    const localX = reaction.worldX * forwardZ - reaction.worldZ * forwardX;
    const localZ = reaction.worldX * forwardX + reaction.worldZ * forwardZ;
    const kick = reaction.strength * envelope;
    parts.visualRoot.position.x += localX * kick * 0.085;
    parts.visualRoot.position.y += reaction.worldY * kick * 0.04;
    parts.visualRoot.position.z += localZ * kick * 0.075;
    parts.visualRoot.rotation.x += (localZ * 0.14 - reaction.worldY * 0.055) * kick;
    parts.visualRoot.rotation.y += localX * localZ * kick * 0.045;
    parts.visualRoot.rotation.z -= localX * kick * 0.13;
    if (reaction.remaining <= 0) reaction.strength = 0;
  }

  const activeWindup = enemy.pendingAttack
    ? clamp01(1 - enemy.pendingAttack.remaining / Math.max(0.001, enemy.pendingAttack.duration ?? 0.001))
    : 0;
  const glow = enemy.root.userData.glowMaterial;
  if (glow) glow.emissiveIntensity = glow.userData.baseEmissiveIntensity + activeWindup * 2.1;
}

export function getEnemyAnchorPosition(enemy, key, fallbackHeight) {
  const anchor = enemy.root.userData.visualParts?.[key];
  if (!anchor?.getWorldPosition) return enemy.root.position.clone().add(new THREE.Vector3(0, fallbackHeight, 0));
  enemy.root.updateMatrixWorld(true);
  return anchor.getWorldPosition(new THREE.Vector3());
}

export function disposeEnemyVisual(root) {
  const geometries = new Set();
  const materials = new Set(root.userData.materials ?? []);
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
    else if (object.material) materials.add(object.material);
  });
  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((material) => material.dispose?.());
}
