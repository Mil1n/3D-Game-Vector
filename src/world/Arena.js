import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const ARENA_COLLISION_GROUP = 2;

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

function asThreeVector(value, fallback = new THREE.Vector3()) {
  if (!value) return fallback.clone();
  return new THREE.Vector3(Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0);
}

function horizontalDistanceSquared(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function smoothPulse(time) {
  return 0.5 + Math.sin(time * 8) * 0.5;
}

function normalizeShiftType(type) {
  const key = String(type ?? 'all').toLowerCase().replace(/[\s_]+/g, '-');
  if (key === 'lowgravity' || key === 'low-gravity') return 'bridge';
  if (key === 'ionstorm' || key === 'ion-storm') return 'cover';
  if (key === 'storm') return 'cover';
  if (key === 'kineticsurge' || key === 'kinetic-surge') return 'all';
  if (key === 'overclock') return 'all';
  if (key === 'supplyvault' || key === 'supply-vault') return 'doors';
  if (key.includes('bridge') || key.includes('route') || key === 'reroute') return 'bridge';
  if (key.includes('door') || key.includes('gate') || key.includes('supply')) return 'doors';
  if (key.includes('cover') || key.includes('wall')) return 'cover';
  return key === 'all' || key === 'reality' || key === 'shift' ? 'all' : key;
}

/** Procedural three-ring combat arena and its static cannon-es collision world. */
export class Arena {
  constructor(sceneOrOptions = {}) {
    const options = sceneOrOptions?.isScene ? { scene: sceneOrOptions } : sceneOrOptions;
    this.scene = options.scene ?? null;
    this.eventBus = options.eventBus ?? null;
    this.telegraphDuration = Math.max(1, options.telegraphDuration ?? 5);
    // RunDirector normally owns the exact apply moment; opt in only for standalone demos.
    this.autoApplyShifts = options.autoApplyShifts ?? false;
    this.getPlayerPosition = options.getPlayerPosition ?? null;
    this.world = null;
    this._built = false;
    this._disposed = false;
    this._elapsed = 0;
    this._spawnCursor = 0;
    this._pendingShift = null;
    this._shiftVersion = 0;

    this.root = new THREE.Group();
    this.root.name = 'NULL_LATTICE_ARENA';
    this.scene?.add(this.root);

    this.staticBodies = [];
    this.spawnPoints = [];
    this.enemySpawnPoints = [];
    this.waypoints = [];
    this.objectivePoints = [];
    this.sectors = [];
    this.navigationEdges = [];
    this.shiftElements = { bridge: [], doors: [], cover: [] };

    this.geometries = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 16, 1, false),
      lowCylinder: new THREE.CylinderGeometry(1, 1, 1, 12, 1, false),
    };
    this.materials = this._createMaterials();
    this._animated = {};
  }

  _createMaterials() {
    const standard = (color, options = {}) => new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.72,
      metalness: options.metalness ?? 0.64,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      side: options.side ?? THREE.FrontSide,
    });
    return {
      foundation: standard(0x090d14, { roughness: 0.9, metalness: 0.35 }),
      floor: standard(0x19232c, { roughness: 0.8, metalness: 0.58 }),
      elevated: standard(0x222a36, { roughness: 0.68, metalness: 0.72 }),
      trim: standard(0x0a7380, { emissive: 0x12c9d6, emissiveIntensity: 2.2 }),
      structure: standard(0x111822, { roughness: 0.55, metalness: 0.82 }),
      cover: standard(0x1b2630, { emissive: 0x8d27b7, emissiveIntensity: 0.18 }),
      bridge: standard(0x14343a, { emissive: 0x16e3ed, emissiveIntensity: 0.65 }),
      door: standard(0x382b13, { emissive: 0xff9b21, emissiveIntensity: 0.6 }),
      spire: standard(0x171020, { emissive: 0x842ee5, emissiveIntensity: 1.35 }),
      objective: standard(0x543b0e, { emissive: 0xffbd32, emissiveIntensity: 2.3 }),
      hologram: standard(0x19d8e2, {
        emissive: 0x19d8e2,
        emissiveIntensity: 3,
        transparent: true,
        opacity: 0.36,
        side: THREE.DoubleSide,
        roughness: 0.25,
      }),
    };
  }

  build(world) {
    if (this._disposed) throw new Error('[Arena] Cannot build a disposed arena.');
    if (!world?.addBody) throw new Error('[Arena] build(world) requires a cannon-es World.');
    if (this._built) {
      if (this.world === world) {
        this.reset();
        return this;
      }
      this._removePhysicsBodies();
      this._clearVisualChildren();
      this._resetCollections();
    }
    this.world = world;
    if (!this.root.parent) this.scene?.add(this.root);

    this._buildFoundation();
    this._buildRingRoutes();
    this._buildVerticalConnections();
    this._buildSectorArchitecture();
    this._buildCentralSpire();
    this._buildShiftElements();
    this._buildSpawnsAndNavigation();
    this._built = true;
    this.reset();
    this._emit('arena:built', {
      spawnCount: this.enemySpawnPoints.length,
      waypointCount: this.waypoints.length,
      colliderCount: this.staticBodies.length,
    });
    return this;
  }

  _resetCollections() {
    this.staticBodies.length = 0;
    this.spawnPoints.length = 0;
    this.enemySpawnPoints.length = 0;
    this.waypoints.length = 0;
    this.objectivePoints.length = 0;
    this.sectors.length = 0;
    this.navigationEdges.length = 0;
    this.shiftElements = { bridge: [], doors: [], cover: [] };
    this._animated = {};
  }

  _clearVisualChildren() {
    while (this.root.children.length) this.root.remove(this.root.children[0]);
  }

  _buildFoundation() {
    const foundation = new THREE.Mesh(
      new THREE.CylinderGeometry(47, 47, 1.2, 48),
      this.materials.foundation,
    );
    foundation.name = 'FOUNDATION_DISC';
    foundation.position.y = -1.7;
    foundation.receiveShadow = true;
    this.root.add(foundation);
    this._addStaticBox('foundation-collider', new THREE.Vector3(92, 1.2, 92), new THREE.Vector3(0, -1.7, 0));

    const trenchGlow = new THREE.Mesh(
      new THREE.TorusGeometry(43.5, 0.09, 5, 96),
      this.materials.trim,
    );
    trenchGlow.name = 'BOUNDARY_GLOW';
    trenchGlow.rotation.x = Math.PI / 2;
    trenchGlow.position.y = -1.03;
    this.root.add(trenchGlow);
  }

  _buildRingRoutes() {
    const ringDefinitions = [
      { radius: 10, width: 5, segments: 16, top: 0.05, material: this.materials.floor },
      { radius: 21, width: 5.5, segments: 24, top: 2.55, material: this.materials.elevated },
      { radius: 35, width: 6.5, segments: 32, top: 0.05, material: this.materials.floor },
    ];
    this.ringDefinitions = ringDefinitions;

    for (let ringIndex = 0; ringIndex < ringDefinitions.length; ringIndex += 1) {
      const ring = ringDefinitions[ringIndex];
      const segmentLength = (TAU * ring.radius / ring.segments) * 1.06;
      const transforms = [];
      for (let index = 0; index < ring.segments; index += 1) {
        const angle = index / ring.segments * TAU;
        transforms.push({
          name: `ring-${ringIndex}-${index}`,
          size: new THREE.Vector3(ring.width, 0.9, segmentLength),
          position: new THREE.Vector3(
            Math.cos(angle) * ring.radius,
            ring.top - 0.45,
            Math.sin(angle) * ring.radius,
          ),
          rotation: new THREE.Euler(0, -angle, 0),
          userData: { arenaSurface: true, ring: ringIndex },
        });
      }
      this._addInstancedBoxes(`RING_ROUTE_${ringIndex}`, transforms, ring.material);

      const routeLine = new THREE.Mesh(
        new THREE.TorusGeometry(ring.radius, 0.075, 5, ring.segments * 4),
        this.materials.trim,
      );
      routeLine.name = `RING_NAV_LINE_${ringIndex}`;
      routeLine.rotation.x = Math.PI / 2;
      routeLine.position.y = ring.top + 0.035;
      this.root.add(routeLine);
    }
  }

  _buildVerticalConnections() {
    const rampTransforms = [];
    for (let sector = 0; sector < 6; sector += 1) {
      const angle = sector / 6 * TAU;
      const length = 7.2;
      const rise = 2.5;
      const slope = -Math.atan2(rise, length);
      const radius = 15.5;
      rampTransforms.push({
        name: `inner-ramp-${sector}`,
        size: new THREE.Vector3(3.6, 0.65, Math.hypot(length, rise)),
        position: new THREE.Vector3(Math.cos(angle) * radius, 1.25, Math.sin(angle) * radius),
        rotation: new THREE.Euler(slope, Math.PI / 2 - angle, 0, 'YXZ'),
        userData: { arenaSurface: true, ramp: true },
      });
    }
    this._addInstancedBoxes('ASCENT_RAMPS', rampTransforms, this.materials.elevated);

    const bridgeTransforms = [];
    for (let sector = 0; sector < 6; sector += 1) {
      const angle = (sector + 0.5) / 6 * TAU;
      const length = 9;
      const rise = -2.5;
      const slope = -Math.atan2(rise, length);
      const radius = 28;
      bridgeTransforms.push({
        name: `outer-ramp-${sector}`,
        size: new THREE.Vector3(3.8, 0.65, Math.hypot(length, rise)),
        position: new THREE.Vector3(Math.cos(angle) * radius, 1.25, Math.sin(angle) * radius),
        rotation: new THREE.Euler(slope, Math.PI / 2 - angle, 0, 'YXZ'),
        userData: { arenaSurface: true, ramp: true },
      });
    }
    this._addInstancedBoxes('DESCENT_RAMPS', bridgeTransforms, this.materials.floor);
  }

  _buildSectorArchitecture() {
    const outerPanels = [];
    const pillars = [];
    const staticCover = [];
    for (let index = 0; index < 40; index += 1) {
      const angle = index / 40 * TAU;
      outerPanels.push({
        name: `boundary-${index}`,
        size: new THREE.Vector3(7.2, 5.5, 0.8),
        position: new THREE.Vector3(Math.cos(angle) * 45.2, 1.7, Math.sin(angle) * 45.2),
        rotation: new THREE.Euler(0, -angle - Math.PI / 2, 0),
        userData: { arenaWall: true },
      });
    }
    this._addInstancedBoxes('BOUNDARY_PANELS', outerPanels, this.materials.structure);

    for (let sector = 0; sector < 6; sector += 1) {
      const centerAngle = sector / 6 * TAU;
      this.sectors.push({
        id: `sector-${sector}`,
        index: sector,
        name: ['INGRESS', 'RELAY', 'FRACTURE', 'FOUNDRY', 'ARCHIVE', 'NULL'][sector],
        center: new THREE.Vector3(Math.cos(centerAngle) * 27, 0.5, Math.sin(centerAngle) * 27),
        angle: centerAngle,
      });

      for (const radius of [16.5, 30.5, 40.5]) {
        const offset = (radius + sector) % 2 ? 0.08 : -0.08;
        const angle = centerAngle + offset;
        pillars.push({
          name: `pillar-${sector}-${radius}`,
          size: new THREE.Vector3(1.4, radius === 40.5 ? 7.5 : 5.4, 1.4),
          position: new THREE.Vector3(Math.cos(angle) * radius, radius === 40.5 ? 2.75 : 2, Math.sin(angle) * radius),
          rotation: new THREE.Euler(0, -angle, 0),
          userData: { arenaWall: true, sector },
        });
      }

      for (let coverIndex = 0; coverIndex < 3; coverIndex += 1) {
        const angle = centerAngle + (coverIndex - 1) * 0.22;
        const radius = coverIndex === 1 ? 12.3 : 37;
        staticCover.push({
          name: `static-cover-${sector}-${coverIndex}`,
          size: new THREE.Vector3(3.4, coverIndex === 1 ? 1.6 : 2.2, 1.05),
          position: new THREE.Vector3(Math.cos(angle) * radius, coverIndex === 1 ? 0.8 : 1.1, Math.sin(angle) * radius),
          rotation: new THREE.Euler(0, -angle - Math.PI / 2, 0),
          userData: { arenaWall: true, cover: true, sector },
        });
      }

      const beacon = new THREE.Mesh(this.geometries.cylinder, this.materials.objective);
      beacon.name = `SECTOR_BEACON_${sector}`;
      beacon.scale.set(0.14, 2.7, 0.14);
      beacon.position.set(Math.cos(centerAngle) * 42.4, 2.2, Math.sin(centerAngle) * 42.4);
      this.root.add(beacon);
    }
    this._addInstancedBoxes('BOUNDARY_PILLARS', pillars, this.materials.structure);
    this._addInstancedBoxes('STATIC_COVER', staticCover, this.materials.cover);
  }

  _buildCentralSpire() {
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(5.1, 5.6, 1.1, 12),
      this.materials.structure,
    );
    dais.name = 'PHASE_DAIS';
    dais.position.y = 0.15;
    dais.receiveShadow = true;
    dais.castShadow = true;
    this.root.add(dais);
    this._addStaticCylinder('phase-dais', 5.1, 1.1, new THREE.Vector3(0, 0.15, 0));

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 2.2, 14, 10, 1, false),
      this.materials.spire,
    );
    core.name = 'PHASE_SPIRE';
    core.position.y = 7.65;
    core.castShadow = true;
    this.root.add(core);
    this._addStaticCylinder('phase-spire', 1.65, 14, new THREE.Vector3(0, 7.65, 0));

    const haloGroup = new THREE.Group();
    haloGroup.name = 'PHASE_HALOS';
    for (let index = 0; index < 4; index += 1) {
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(2.4 + index * 0.55, 0.055, 5, 48),
        index % 2 ? this.materials.hologram : this.materials.trim,
      );
      halo.rotation.x = Math.PI / 2 + (index - 1.5) * 0.14;
      halo.position.y = 3.5 + index * 2.15;
      haloGroup.add(halo);
    }
    this.root.add(haloGroup);
    this._animated.spire = core;
    this._animated.halos = haloGroup;

    for (let index = 0; index < 3; index += 1) {
      const angle = index / 3 * TAU + Math.PI / 6;
      const point = new THREE.Vector3(Math.cos(angle) * 7.7, 0.65, Math.sin(angle) * 7.7);
      this.objectivePoints.push({
        id: `phase-node-${index}`,
        type: 'phase-node',
        position: point,
        radius: 3.25,
      });
      const node = new THREE.Mesh(this.geometries.lowCylinder, this.materials.objective);
      node.name = `PHASE_NODE_${index}`;
      node.scale.set(0.8, 0.6, 0.8);
      node.position.copy(point);
      this.root.add(node);
      this._addStaticCylinder(`phase-node-${index}`, 0.8, 0.6, point);
    }
  }

  _buildShiftElements() {
    this._buildShiftBridges();
    this._buildShiftDoors();
    this._buildShiftCover();
  }

  _buildShiftBridges() {
    for (let index = 0; index < 2; index += 1) {
      const angle = index * Math.PI;
      const activePosition = new THREE.Vector3(Math.cos(angle) * 15.5, 1.28, Math.sin(angle) * 15.5);
      const inactivePosition = activePosition.clone();
      inactivePosition.y = -4.2;
      const mesh = new THREE.Mesh(this.geometries.box, this.materials.bridge);
      mesh.name = `SHIFT_BRIDGE_${index}`;
      mesh.scale.set(4.4, 0.62, 6.4);
      mesh.rotation.y = Math.PI / 2 - angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);

      const states = index === 0
        ? [{ position: activePosition }, { position: inactivePosition }]
        : [{ position: inactivePosition }, { position: activePosition }];
      const body = this._createBoxBody(
        `shift-bridge-${index}`,
        new THREE.Vector3(4.4, 0.62, 6.4),
        stÛ½{¶‰žËkºwµç@€€€Ñ¡¥Ì¹}…¹¥µ…Ñ•¹¡…±½Ì¹É½Ñ…Ñ¥½¸¹ä€´ô‘Ð€¨€À¸Ðì(€€€€€Ñ¡¥Ì¹}…¹¥µ…Ñ•¹¡…±½Ì¹¡¥±‘É•¸¹™½É…  ¡¡…±¼°¥¹‘•à¤€ôøì(€€€€€€€¡…±¼¹É½Ñ…Ñ¥½¸¹è€¬ô‘Ð€¨€¡¥¹‘•à€”€È€ü€´À¸ÈÜ€è€À¸ÌÄ¤ì(€€€€€ô¤ì(€€€ô(€€€Ñ¡¥Ì¹µ…Ñ•É¥…±Ì¹¡½±½É…´¹½Á…¥Ñä€ô€À¸Èà€¬Íµ½½Ñ¡AÕ±Í”¡Ñ¡¥Ì¹}•±…ÁÍ•€¨€À¸ÌÔ¤€¨€À¸ÄØì((€€€½¹ÍÐÁ•¹‘¥¹œ€ôÑ¡¥Ì¹}Á•¹‘¥¹M¡¥™Ðì(€€€¥˜€ …Á•¹‘¥¹œ¤É•ÑÕÉ¸ì(€€€Á•¹‘¥¹œ¹•±…ÁÍ•€ô5…Ñ ¹µ¥¸¡Á•¹‘¥¹œ¹‘ÕÉ…Ñ¥½¸°Á•¹‘¥¹œ¹•±…ÁÍ•€¬‘Ð¤ì(€€€½¹ÍÐÁÉ½É•ÍÌ€ôÁ•¹‘¥¹œ¹‘ÕÉ…Ñ¥½¸€ø€À€üÁ•¹‘¥¹œ¹•±…ÁÍ•€¼Á•¹‘¥¹œ¹‘ÕÉ…Ñ¥½¸€è€Äì(€€€½¹ÍÐÁÕ±Í”€ô€À¸Ô€¬Íµ½½Ñ¡AÕ±Í”¡Ñ¡¥Ì¹}•±…ÁÍ•¤€¨€ Ä€¬ÁÉ½É•ÍÌ€¨€È¸È¤ì(€€€Ñ¡¥Ì¹}Í•ÑQ•±•É…Á¡%¹Ñ•¹Í¥Ñä¡Á•¹‘¥¹œ¹ÑåÁ”°ÁÕ±Í”¤ì((€€€¥˜€¡Á•¹‘¥¹œ¹•±…ÁÍ•€øôÁ•¹‘¥¹œ¹‘ÕÉ…Ñ¥½¸€˜˜€…Á•¹‘¥¹œ¹É•…‘ä¤ì(€€€€€Á•¹‘¥¹œ¹É•…‘ä€ôÑÉÕ”ì(€€€€€Ñ¡¥Ì¹}•µ¥Ð …É•¹„éÍ¡¥™ÑI•…‘äœ°ìÑåÁ”èÁ•¹‘¥¹œ¹ÑåÁ”ô¤ì(€€€ô(€€€¥˜€¡Á•¹‘¥¹œ¹É•…‘ä€˜˜Ñ¡¥Ì¹…ÕÑ½ÁÁ±åM¡¥™ÑÌ¤ì(€€€€€½¹ÍÐÑÉ…­•‘A½Í¥Ñ¥½¸€ôÁ±…å•ÉA½Í¥Ñ¥½¸€üüÑ¡¥Ì¹•ÑA±…å•ÉA½Í¥Ñ¥½¸ü¸ ¤€üü¹Õ±°ì(€€€€€Ñ¡¥Ì¹…ÁÁ±åM¡¥™Ð¡Á•¹‘¥¹œ¹ÑåÁ”°ÑÉ…­•‘A½Í¥Ñ¥½¸¤ì(€€€ô(€ô((€…ÁÁ±åM¡¥™Ð¡ÑåÁ”€ôÑ¡¥Ì¹}Á•¹‘¥¹M¡¥™Ðü¹ÑåÁ”€üü€…±°œ°Á±…å•ÉA½Í¥Ñ¥½¸€ô¹Õ±°¤ì(€€€¥˜€ …Ñ¡¥Ì¹}‰Õ¥±Ð¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐ¹½Éµ…±¥é•€ô¹½Éµ…±¥é•M¡¥™ÑQåÁ”¡ÑåÁ”¤ì(€€€½¹ÍÐÉ•½É‘Ì€ôÑ¡¥Ì¹}…™™•Ñ•‘M¡¥™ÑI•½É‘Ì¡¹½Éµ…±¥é•¤ì(€€€¥˜€ …É•½É‘Ì¹±•¹Ñ ¤É•ÑÕÉ¸™…±Í”ì(€€€½¹ÍÐÁ±…å•È€ôÁ±…å•ÉA½Í¥Ñ¥½¸€ü…ÍQ¡É••Y•Ñ½È¡Á±…å•ÉA½Í¥Ñ¥½¸¤€è¹Õ±°ì(€€€½¹ÍÐÍ­¥ÁÁ•€ômtì(€€€±•Ð…ÁÁ±¥•€ô€Àì(€€€™½È€¡½¹ÍÐÉ•½É½˜É•½É‘Ì¤ì(€€€€€¥˜€¡Á±…å•È€˜˜Ñ¡¥Ì¹}Ý½Õ±‘¹‘…¹•ÉA±…å•È¡É•½É°Á±…å•È¤¤ì(€€€€€€€Í­¥ÁÁ•¹ÁÕÍ ¡É•½É¹¥¤ì(€€€€€€€½¹Ñ¥¹Õ”ì(€€€€€ô(€€€€€Ñ¡¥Ì¹}Í•ÑM¡¥™ÑI•½É‘MÑ…Ñ”¡É•½É°É•½É¹ÍÑ…Ñ”€ü€À€è€Ä¤ì(€€€€€…ÁÁ±¥•€¬ô€Äì(€€€ô(€€€¥˜€¡Í­¥ÁÁ•¹±•¹Ñ ¤ì(€€€€€Ñ¡¥Ì¹}•µ¥Ð …É•¹„éÍ¡¥™Ñ	±½­•œ°ì(€€€€€€€ÑåÁ”è¹½Éµ…±¥é•°(€€€€€€€É•…Í½¸è€Á±…å•Èµ½Ù•É±…Àœ°(€€€€€€€Í­¥ÁÁ•°(€€€€€€€Á…ÉÑ¥…°è…ÁÁ±¥•€ø€À°(€€€€€ô¤ì(€€€ô(€€€¥˜€ ……ÁÁ±¥•¤ì(€€€€€Ñ¡¥Ì¹}Á•¹‘¥¹M¡¥™Ð€ô¹Õ±°ì(€€€€€Ñ¡¥Ì¹}Í•ÑQ•±•É…Á¡%¹Ñ•¹Í¥Ñä …±°œ°€À¤ì(€€€€€É•ÑÕÉ¸™…±Í”ì(€€€ô(€€€Ñ¡¥Ì¹}Íå¹9…Ù¥…Ñ¥½¹MÑ…Ñ” ¤ì(€€€Ñ¡¥Ì¹}Í¡¥™ÑY•ÉÍ¥½¸€¬ô€Äì(€€€Ñ¡¥Ì¹}Á•¹‘¥¹M¡¥™Ð€ô¹Õ±°ì(€€€Ñ¡¥Ì¹}Í•ÑQ•±•É…Á¡%¹Ñ•¹Í¥Ñä …±°œ°€À¤ì(€€€Ñ¡¥Ì¹Ý½É±¹‰É½…‘Á¡…Í”¹‘¥ÉÑä€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹}•µ¥Ð …É•¹„éÍ¡¥™ÑÁÁ±¥•œ°ì(€€€€€ÑåÁ”è¹½Éµ…±¥é•°(€€€€€Ù•ÉÍ¥½¸èÑ¡¥Ì¹}Í¡¥™ÑY•ÉÍ¥½¸°(€€€€€…ÁÁ±¥•°(€€€€€Í­¥ÁÁ•°(€€€ô¤ì(€€€É•ÑÕÉ¸ÑÉÕ”ì(€ô((€}…™™•Ñ•‘M¡¥™ÑI•½É‘Ì¡ÑåÁ”¤ì(€€€¥˜€¡ÑåÁ”€ôôô€…±°œ¤É•ÑÕÉ¸=‰©•Ð¹Ù…±Õ•Ì¡Ñ¡¥Ì¹Í¡¥™Ñ±•µ•¹ÑÌ¤¹™±…Ð ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹Í¡¥™Ñ±•µ•¹ÑÍmÑåÁ•t€üümtì(€ô((€}Ý½Õ±‘¹‘…¹•ÉA±…å•È¡É•½É°Á±…å•È¤ì(€€€½¹ÍÐ¹•áÑMÑ…Ñ”€ôÉ•½É¹ÍÑ…Ñ•ÍmÉ•½É¹ÍÑ…Ñ”€ü€À€è€Åtì(€€€½¹ÍÐÕÉÉ•¹ÑMÑ…Ñ”€ôÉ•½É¹ÍÑ…Ñ•ÍmÉ•½É¹ÍÑ…Ñ•tì(€€€½¹ÍÐÍ¥é”€ô¹•áÑMÑ…Ñ”¹Í…±”ì(€€€½¹ÍÐÑ…É•Ñ!½É¥é½¹Ñ…°€ô¡½É¥é½¹Ñ…±¥ÍÑ…¹•MÅÕ…É•¡¹•áÑMÑ…Ñ”¹Á½Í¥Ñ¥½¸°Á±…å•È¤ì(€€€½¹ÍÐÑ…É•ÑI…‘¥ÕÌ€ô5…Ñ ¹µ…à¡Í¥é”¹à°Í¥é”¹è¤€¨€À¸Ôà€¬€À¸ØÔì(€€€½¹ÍÐÑ…É•ÑY•ÉÑ¥…°€ô5…Ñ ¹…‰Ì¡¹•áÑMÑ…Ñ”¹Á½Í¥Ñ¥½¸¹ä€´Á±…å•È¹ä¤€ðÍ¥é”¹ä€¨€À¸Ô€¬€Ä¸Äì(€€€¥˜€¡Ñ…É•Ñ!½É¥é½¹Ñ…°€ðÑ…É•ÑI…‘¥ÕÌ€¨Ñ…É•ÑI…‘¥ÕÌ€˜˜Ñ…É•ÑY•ÉÑ¥…°¤É•ÑÕÉ¸ÑÉÕ”ì((€€€€¼¼9•Ù•ÈÉ•ÑÉ…Ð„‰É¥‘”™É½´‘¥É•Ñ±ä‰•¹•…Ñ Ñ¡”…ÁÍÕ±”¸(€€€¥˜€¡É•½É¹­¥¹€ôôô€‰É¥‘”œ€˜˜¹•áÑMÑ…Ñ”¹Á½Í¥Ñ¥½¸¹ä€ð€´È¤ì(€€€€€½¹ÍÐÕÉÉ•¹ÑI…‘¥ÕÌ€ô5…Ñ ¹µ…à¡ÕÉÉ•¹ÑMÑ…Ñ”¹Í…±”¹à°ÕÉÉ•¹ÑMÑ…Ñ”¹Í…±”¹è¤€¨€À¸ÔÔì(€€€€€¥˜€¡¡½É¥é½¹Ñ…±¥ÍÑ…¹•MÅÕ…É•¡ÕÉÉ•¹ÑMÑ…Ñ”¹Á½Í¥Ñ¥½¸°Á±…å•È¤€ðÕÉÉ•¹ÑI…‘¥ÕÌ€¨ÕÉÉ•¹ÑI…‘¥ÕÌ(€€€€€€€€˜˜Á±…å•È¹ä€øÕÉÉ•¹ÑMÑ…Ñ”¹Á½Í¥Ñ¥½¸¹ä(€€€€€€€€˜˜Á±…å•È¹ä€ðÕÉÉ•¹ÑMÑ…Ñ”¹Á½Í¥Ñ¥½¸¹ä€¬€È¸È¤É•ÑÕÉ¸ÑÉÕ”ì(€€€ô(€€€É•ÑÕÉ¸™…±Í”ì(€ô((€}Í•ÑM¡¥™ÑI•½É‘MÑ…Ñ”¡É•½É°ÍÑ…Ñ•%¹‘•à¤ì(€€€½¹ÍÐÍÑ…Ñ”€ôÉ•½É¹ÍÑ…Ñ•ÍmÍÑ…Ñ•%¹‘•átì(€€€É•½É¹ÍÑ…Ñ”€ôÍÑ…Ñ•%¹‘•àì(€€€¥˜€¡É•½É¹¥¹ÍÑ…¹•%¹‘•à€ôô¹Õ±°¤ì(€€€€€É•½É¹µ•Í ¹Á½Í¥Ñ¥½¸¹½Áä¡ÍÑ…Ñ”¹Á½Í¥Ñ¥½¸¤ì(€€€€€É•½É¹µ•Í ¹ÅÕ…Ñ•É¹¥½¸¹½Áä¡ÍÑ…Ñ”¹ÅÕ…Ñ•É¹¥½¸¤ì(€€€€€É•½É¹µ•Í ¹Í…±”¹½Áä¡ÍÑ…Ñ”¹Í…±”¤ì(€€€€€É•½É¹µ•Í ¹ÕÁ‘…Ñ•5…ÑÉ¥á]½É± ¤ì(€€€ô•±Í”ì(€€€€€½¹ÍÐµ…ÑÉ¥à€ô¹•ÜQ!I¹5…ÑÉ¥àÐ ¤¹½µÁ½Í”¡ÍÑ…Ñ”¹Á½Í¥Ñ¥½¸°ÍÑ…Ñ”¹ÅÕ…Ñ•É¹¥½¸°ÍÑ…Ñ”¹Í…±”¤ì(€€€€€É•½É¹µ•Í ¹Í•Ñ5…ÑÉ¥áÐ¡É•½É¹¥¹ÍÑ…¹•%¹‘•à°µ…ÑÉ¥à¤ì(€€€€€É•½É¹µ•Í ¹¥¹ÍÑ…¹•5…ÑÉ¥à¹¹••‘ÍUÁ‘…Ñ”€ôÑÉÕ”ì(€€€ô(€€€É•½É¹‰½‘ä¹Á½Í¥Ñ¥½¸¹Í•Ð¡ÍÑ…Ñ”¹Á½Í¥Ñ¥½¸¹à°ÍÑ…Ñ”¹Á½Í¥Ñ¥½¸¹ä°ÍÑ…Ñ”¹Á½Í¥Ñ¥½¸¹è¤ì(€€€É•½É¹‰½‘ä¹ÅÕ…Ñ•É¹¥½¸¹Í•Ð (€€€€€ÍÑ…Ñ”¹ÅÕ…Ñ•É¹¥½¸¹à°(€€€€€ÍÑ…Ñ”¹ÅÕ…Ñ•É¹¥½¸¹ä°(€€€€€ÍÑ…Ñ”¹ÅÕ…Ñ•É¹¥½¸¹è°(€€€€€ÍÑ…Ñ”¹ÅÕ…Ñ•É¹¥½¸¹Ü°(€€€€¤ì(€€€É•½É¹‰½‘ä¹……‰‰9••‘ÍUÁ‘…Ñ”€ôÑÉÕ”ì(€€€É•½É¹‰½‘ä¹ÕÁ‘…Ñ•	 ¤ì(€ô((€}Í•ÑQ•±•É…Á¡%¹Ñ•¹Í¥Ñä¡ÑåÁ”°¥¹Ñ•¹Í¥Ñä¤ì(€€€½¹ÍÐ­¥¹‘Ì€ôÑåÁ”€ôôô€…±°œ€ül‰É¥‘”œ°€‘½½ÉÌœ°€½Ù•Èt€èmÑåÁ•tì(€€€¥˜€¡­¥¹‘Ì¹¥¹±Õ‘•Ì ‰É¥‘”œ¤¤Ñ¡¥Ì¹µ…Ñ•É¥…±Ì¹‰É¥‘”¹•µ¥ÍÍ¥Ù•%¹Ñ•¹Í¥Ñä€ô€À¸ØÔ€¬¥¹Ñ•¹Í¥Ñä€¨€Ä¸Øì(€€€¥˜€¡­¥¹‘Ì¹¥¹±Õ‘•Ì ‘½½ÉÌœ¤¤Ñ¡¥Ì¹µ…Ñ•É¥…±Ì¹‘½½È¹•µ¥ÍÍ¥Ù•%¹Ñ•¹Í¥Ñä€ô€À¸Ø€¬¥¹Ñ•¹Í¥Ñä€¨€Ä¸àì(€€€¥˜€¡­¥¹‘Ì¹¥¹±Õ‘•Ì ½Ù•Èœ¤¤Ñ¡¥Ì¹µ…Ñ•É¥…±Ì¹½Ù•È¹•µ¥ÍÍ¥Ù•%¹Ñ•¹Í¥Ñä€ô€À¸Äà€¬¥¹Ñ•¹Í¥Ñä€¨€Ä¸Èì(€€€¥˜€¡¥¹Ñ•¹Í¥Ñä€ôôô€À¤ì(€€€€€Ñ¡¥Ì¹µ…Ñ•É¥…±Ì¹‰É¥‘”¹•µ¥ÍÍ¥Ù•%¹Ñ•¹Í¥Ñä€ô€À¸ØÔì(€€€€€Ñ¡¥Ì¹µ…Ñ•É¥…±Ì¹‘½½È¹•µ¥ÍÍ¥Ù•%¹Ñ•¹Í¥Ñä€ô€À¸Øì(€€€€€Ñ¡¥Ì¹µ…Ñ•É¥…±Ì¹½Ù•È¹•µ¥ÍÍ¥Ù•%¹Ñ•¹Í¥Ñä€ô€À¸Äàì(€€€ô(€ô((€}Íå¹9…Ù¥…Ñ¥½¹MÑ…Ñ” ¤ì(€€€½¹ÍÐ•…ÍÑ¹…‰±•€ôÑ¡¥Ì¹Í¡¥™Ñ±•µ•¹ÑÌ¹‰É¥‘•lÁtü¹ÍÑ…Ñ”€ôôô€Àì(€€€½¹ÍÐÝ•ÍÑ¹…‰±•€ôÑ¡¥Ì¹Í¡¥™Ñ±•µ•¹ÑÌ¹‰É¥‘•lÅtü¹ÍÑ…Ñ”€ôôô€Äì(€€€™½È€¡½¹ÍÐ•‘”½˜Ñ¡¥Ì¹¹…Ù¥…Ñ¥½¹‘•Ì¤ì(€€€€€¥˜€¡•‘”¹­¥¹€ôôô€‰É¥‘”µ•…ÍÐœ¤•‘”¹•¹…‰±•€ô•…ÍÑ¹…‰±•ì(€€€€€¥˜€¡•‘”¹­¥¹€ôôô€‰É¥‘”µÝ•ÍÐœ¤•‘”¹•¹…‰±•€ôÝ•ÍÑ¹…‰±•ì(€€€ô(€ô((€•ÑM…™•A±…å•ÉMÁ…Ý¸ ¤ì(€€€¥˜€ …Ñ¡¥Ì¹ÍÁ…Ý¹A½¥¹ÑÌ¹±•¹Ñ ¤É•ÑÕÉ¸¹•ÜQ!I¹Y•Ñ½ÈÌ À°€Ä¸ÀÔ°€ÌÔ¤ì(€€€É•ÑÕÉ¸Ñ¡¥Ì¹ÍÁ…Ý¹A½¥¹ÑÍlÁt¹±½¹” ¤ì(€ô((€•Ñ¹•µåMÁ…Ý¸¡Á±…å•ÉA½Í¥Ñ¥½¸°…µ•É…½ÉÝ…É¤ì(€€€¥˜€ …Ñ¡¥Ì¹•¹•µåMÁ…Ý¹A½¥¹ÑÌ¹±•¹Ñ ¤É•ÑÕÉ¸¹•ÜQ!I¹Y•Ñ½ÈÌ À°€À¸ÀÔ°€´ÌÔ¤ì(€€€½¹ÍÐÁ±…å•È€ô…ÍQ¡É••Y•Ñ½È¡Á±…å•ÉA½Í¥Ñ¥½¸¤ì(€€€½¹ÍÐ™½ÉÝ…É€ô…ÍQ¡É••Y•Ñ½È¡…µ•É…½ÉÝ…É°¹•ÜQ!I¹Y•Ñ½ÈÌ À°€À°€´Ä¤¤¹Í•Ñd À¤¹¹½Éµ…±¥é” ¤ì(€€€½¹ÍÐ…¹‘¥‘…Ñ•Ì€ôÑ¡¥Ì¹•¹•µåMÁ…Ý¹A½¥¹ÑÌ¹µ…À ¡Á½Í¥Ñ¥½¸°¥¹‘•à¤€ôøì(€€€€€½¹ÍÐÑ½MÁ…Ý¸€ôÁ½Í¥Ñ¥½¸¹±½¹” ¤¹ÍÕˆ¡Á±…å•È¤ì(€€€€€½¹ÍÐ‘¥ÍÑ…¹•MÄ€ôÑ½MÁ…Ý¸¹±•¹Ñ¡MÄ ¤ì(€€€€€½¹ÍÐÙ¥•Ý½Ð€ôÑ½MÁ…Ý¸¹Í•Ñd À¤¹¹½Éµ…±¥é” ¤¹‘½Ð¡™½ÉÝ…É¤ì(€€€€€½¹ÍÐÙ¥Í¥‰±”€ô‘¥ÍÑ…¹•MÄ€ð€Ðà€¨€Ðà€˜˜Ñ¡¥Ì¹¡…Í1¥¹•=™M¥¡Ð (€€€€€€€Á±…å•È¹±½¹” ¤¹…‘¡¹•ÜQ!I¹Y•Ñ½ÈÌ À°€À¸ÐÔ°€À¤¤°(€€€€€€€Á½Í¥Ñ¥½¸¹±½¹” ¤¹…‘¡¹•ÜQ!I¹Y•Ñ½ÈÌ À°€À¸ØÔ°€À¤¤°(€€€€€€¤ì(€€€€€É•ÑÕÉ¸ìÁ½Í¥Ñ¥½¸°¥¹‘•à°‘¥ÍÑ…¹•MÄ°Ù¥•Ý½Ð°Ù¥Í¥‰±”ôì(€€€ô¤¹™¥±Ñ•È ¡…¹‘¥‘…Ñ”¤€ôø…¹‘¥‘…Ñ”¹‘¥ÍÑ…¹•MÄ€ø€ÄÔ€¨€ÄÔ¤ì((€€€…¹‘¥‘…Ñ•Ì¹Í½ÉÐ ¡„°ˆ¤€ôøì(€€€€€½¹ÍÐÍ½É•€ô€¡„¹Ù¥Í¥‰±”€ü€´ÄÀÀÀ€è€À¤€´„¹Ù¥•Ý½Ð€¨€ÄÐÀ€¬5…Ñ ¹µ¥¸¡„¹‘¥ÍÑ…¹•MÄ°€ÌØÀÀ¤€¨€À¸Ààì(€€€€€½¹ÍÐÍ½É•€ô€¡ˆ¹Ù¥Í¥‰±”€ü€´ÄÀÀÀ€è€À¤€´ˆ¹Ù¥•Ý½Ð€¨€ÄÐÀ€¬5…Ñ ¹µ¥¸¡ˆ¹‘¥ÍÑ…¹•MÄ°€ÌØÀÀ¤€¨€À¸Ààì(€€€€€É•ÑÕÉ¸Í½É•€´Í½É•ì(€€€ô¤ì(€€€½¹ÍÐÑ½Á½Õ¹Ð€ô5…Ñ ¹µ¥¸ Ð°…¹‘¥‘…Ñ•Ì¹±•¹Ñ ¤ì(€€€½¹ÍÐ¡½Í•¸€ô…¹‘¥‘…Ñ•ÍmÑ¡¥Ì¹}ÍÁ…Ý¹ÕÉÍ½È€”5…Ñ ¹µ…à Ä°Ñ½Á½Õ¹Ð¥t€üüìÁ½Í¥Ñ¥½¸èÑ¡¥Ì¹•¹•µåMÁ…Ý¹A½¥¹ÑÍlÁtôì(€€€Ñ¡¥Ì¹}ÍÁ…Ý¹ÕÉÍ½È€¬ô€Äì(€€€É•ÑÕÉ¸¡½Í•¸¹Á½Í¥Ñ¥½¸¹±½¹” ¤ì(€ô((€É…å…ÍÑ]½É±¡½É¥¥¸°‘¥É•Ñ¥½¸°µ…á¥ÍÑ…¹”€ô€ÄÈÀ°½ÁÑ¥½¹Ì€ôíô¤ì(€€€¥˜€ …Ñ¡¥Ì¹Ý½É±¤É•ÑÕÉ¸ì¡¥Ðè™…±Í”°¡…Í!¥Ðè™…±Í”ôì(€€€¥˜€¡ÑåÁ•½˜µ…á¥ÍÑ…¹”€ôôô€½‰©•Ðœ¤ì(€€€€€½ÁÑ¥½¹Ì€ôµ…á¥ÍÑ…¹”ì(€€€€€µ…á¥ÍÑ…¹”€ô½ÁÑ¥½¹Ì¹µ…á¥ÍÑ…¹”€üü€ÄÈÀì(€€€ô(€€€½¹ÍÐÍÑ…ÉÐ€ô…ÍQ¡É••Y•Ñ½È¡½É¥¥¸¤ì(€€€½¹ÍÐÉ…å¥É•Ñ¥½¸€ô…ÍQ¡É••Y•Ñ½È¡‘¥É•Ñ¥½¸°¹•ÜQ!I¹Y•Ñ½ÈÌ À°€À°€´Ä¤¤ì(€€€¥˜€¡É…å¥É•Ñ¥½¸¹±•¹Ñ¡MÄ ¤€ð€Å”´à¤É•ÑÕÉ¸ì¡¥Ðè™…±Í”°¡…Í!¥Ðè™…±Í”ôì(€€€É…å¥É•Ñ¥½¸¹¹½Éµ…±¥é” ¤ì(€€€½¹ÍÐ•¹€ôÍÑ…ÉÐ¹±½¹” ¤¹…‘‘M…±•‘Y•Ñ½È¡É…å¥É•Ñ¥½¸°5…Ñ ¹µ…à À°µ…á¥ÍÑ…¹”¤¤ì(€€€½¹ÍÐÉ•ÍÕ±Ð€ô¹•Ü99=8¹I…å…ÍÑI•ÍÕ±Ð ¤ì(€€€½¹ÍÐ¡¥Ð€ôÑ¡¥Ì¹Ý½É±¹É…å…ÍÑ±½Í•ÍÐ (€€€€€¹•Ü99=8¹Y•ŒÌ¡ÍÑ…ÉÐ¹à°ÍÑ…ÉÐ¹ä°ÍÑ…ÉÐ¹è¤°(€€€€€¹•Ü99=8¹Y•ŒÌ¡•¹¹à°•¹¹ä°•¹¹è¤°(€€€€€ì(€€€€€€€Í­¥Á	…­™…•Ìè½ÁÑ¥½¹Ì¹Í­¥Á	…­™…•Ì€üüÑÉÕ”°(€€€€€€€½±±¥Í¥½¹¥±Ñ•É5…Í¬è½ÁÑ¥½¹Ì¹½±±¥Í¥½¹¥±Ñ•É5…Í¬€üüI9}=11%M%=9}I=U@°(€€€€€€€½±±¥Í¥½¹¥±Ñ•ÉÉ½ÕÀè½ÁÑ¥½¹Ì¹½±±¥Í¥½¹¥±Ñ•ÉÉ½ÕÀ€üü€´Ä°(€€€€€€€¡•­½±±¥Í¥½¹I•ÍÁ½¹Í”è½ÁÑ¥½¹Ì¹¡•­½±±¥Í¥½¹I•ÍÁ½¹Í”€üüÑÉÕ”°(€€€€€ô°(€€€€€É•ÍÕ±Ð°(€€€€¤ì(€€€¥˜€ …¡¥Ðñð€…É•ÍÕ±Ð¹¡…Í!¥Ð¤É•ÑÕÉ¸ì¡¥Ðè™…±Í”°¡…Í!¥Ðè™…±Í”°‘¥ÍÑ…¹”è%¹™¥¹¥Ñäôì(€€€É•ÑÕÉ¸ì(€€€€€¡¥ÐèÑÉÕ”°(€€€€€¡…Í!¥ÐèÑÉÕ”°(€€€€€‘¥ÍÑ…¹”èÉ•ÍÕ±Ð¹‘¥ÍÑ…¹”°(€€€€€Á½¥¹Ðè¹•ÜQ!I¹Y•Ñ½ÈÌ¡É•ÍÕ±Ð¹¡¥ÑA½¥¹Ñ]½É±¹à°É•ÍÕ±Ð¹¡¥ÑA½¥¹Ñ]½É±¹ä°É•ÍÕ±Ð¹¡¥ÑA½¥¹Ñ]½É±¹è¤°(€€€€€¹½Éµ…°è¹•ÜQ!I¹Y•Ñ½ÈÌ¡É•ÍÕ±Ð¹¡¥Ñ9½Éµ…±]½É±¹à°É•ÍÕ±Ð¹¡¥Ñ9½Éµ…±]½É±¹ä°É•ÍÕ±Ð¹¡¥Ñ9½Éµ…±]½É±¹è¤°(€€€€€‰½‘äèÉ•ÍÕ±Ð¹‰½‘ä°(€€€€€Í¡…Á”èÉ•ÍÕ±Ð¹Í¡…Á”°(€€€ôì(€ô((€¡…Í1¥¹•=™M¥¡Ð¡™É½´°Ñ¼¤ì(€€€½¹ÍÐ½É¥¥¸€ô…ÍQ¡É••Y•Ñ½È¡™É½´¤ì(€€€½¹ÍÐ‘•ÍÑ¥¹…Ñ¥½¸€ô…ÍQ¡É••Y•Ñ½È¡Ñ¼¤ì(€€€½¹ÍÐ½™™Í•Ð€ô‘•ÍÑ¥¹…Ñ¥½¸¹±½¹” ¤¹ÍÕˆ¡½É¥¥¸¤ì(€€€½¹ÍÐ‘¥ÍÑ…¹”€ô½™™Í•Ð¹±•¹Ñ  ¤ì(€€€¥˜€¡‘¥ÍÑ…¹”€ð€À¸ÀÄ¤É•ÑÕÉ¸ÑÉÕ”ì(€€€½¹ÍÐ¡¥Ð€ôÑ¡¥Ì¹É…å…ÍÑ]½É±¡½É¥¥¸°½™™Í•Ð°5…Ñ ¹µ…à À°‘¥ÍÑ…¹”€´€À¸ÄÈ¤¤ì(€€€É•ÑÕÉ¸€…¡¥Ð¹¡¥Ðì(€ô((€•Ñ9…Ù¥…Ñ¥½¹Q…É•Ð¡™É½´°Ñ¼°µ½‘”€ô€¡…Í”œ¤ì(€€€½¹ÍÐ½É¥¥¸€ô…ÍQ¡É••Y•Ñ½È¡™É½´¤ì(€€€½¹ÍÐ¹½Éµ…±¥é•‘5½‘”€ôMÑÉ¥¹œ¡µ½‘”¤¹Ñ½1½Ý•É…Í” ¤ì(€€€±•Ð‘•ÍÑ¥¹…Ñ¥½¸€ô…ÍQ¡É••Y•Ñ½È¡Ñ¼¤ì(€€€¥˜€ …Ñ¼€˜˜¹½Éµ…±¥é•‘5½‘”€ôôô€Á…ÑÉ½°œ€˜˜Ñ¡¥Ì¹Ý…åÁ½¥¹ÑÌ¹±•¹Ñ ¤ì(€€€€€½¹ÍÐÍÑ…ÉÑ%¹‘•à€ôÑ¡¥Ì¹Ý…åÁ½¥¹ÑÌ¹É•‘Õ” ¡‰•ÍÑ%¹‘•à°¹½‘”°¥¹‘•à¤€ôø€ (€€€€€€€¹½‘”¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡½É¥¥¸¤€ðÑ¡¥Ì¹Ý…åÁ½¥¹ÑÍm‰•ÍÑ%¹‘•át¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡½É¥¥¸¤(€€€€€€€€€€ü¥¹‘•à(€€€€€€€€€€è‰•ÍÑ%¹‘•à(€€€€€€¤°€À¤ì(€€€€€‘•ÍÑ¥¹…Ñ¥½¸€ôÑ¡¥Ì¹Ý…åÁ½¥¹ÑÍl¡ÍÑ…ÉÑ%¹‘•à€¬€Ð€¬€¡Ñ¡¥Ì¹}ÍÁ…Ý¹ÕÉÍ½È¬¬€”€Ô¤¤€”Ñ¡¥Ì¹Ý…åÁ½¥¹ÑÌ¹±•¹Ñ¡t¹Á½Í¥Ñ¥½¸¹±½¹” ¤ì(€€€ô(€€€¥˜€¡¹½Éµ…±¥é•‘5½‘”€„ôô€™±…¹¬œ€˜˜¹½Éµ…±¥é•‘5½‘”€„ôô€É•ÑÉ•…Ðœ(€€€€€€˜˜Ñ¡¥Ì¹¡…Í1¥¹•=™M¥¡Ð¡½É¥¥¸¹±½¹” ¤¹…‘¡U@¤°‘•ÍÑ¥¹…Ñ¥½¸¹±½¹” ¤¹…‘¡U@¤¤¤ì(€€€€€É•ÑÕÉ¸‘•ÍÑ¥¹…Ñ¥½¸ì(€€€ô((€€€½¹ÍÐ•¹…‰±•‘9½‘•Ì€ôÑ¡¥Ì¹Ý…åÁ½¥¹ÑÌ¹™¥±Ñ•È ¡¹½‘”¤€ôø¹½‘”¹•¹…‰±•¤ì(€€€¥˜€ …•¹…‰±•‘9½‘•Ì¹±•¹Ñ ¤É•ÑÕÉ¸‘•ÍÑ¥¹…Ñ¥½¸ì(€€€½¹ÍÐ¹•…É•ÍÐ€ô€¡Á½¥¹Ð¤€ôø•¹…‰±•‘9½‘•Ì¹É•‘Õ” ¡‰•ÍÐ°¹½‘”¤€ôø€ (€€€€€¹½‘”¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Á½¥¹Ð¤€ð‰•ÍÐ¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡Á½¥¹Ð¤€ü¹½‘”€è‰•ÍÐ(€€€€¤°•¹…‰±•‘9½‘•ÍlÁt¤ì(€€€½¹ÍÐÍÑ…ÉÐ€ô¹•…É•ÍÐ¡½É¥¥¸¤ì(€€€±•Ð½…°€ô¹•…É•ÍÐ¡‘•ÍÑ¥¹…Ñ¥½¸¤ì((€€€¥˜€¡¹½Éµ…±¥é•‘5½‘”€ôôô€™±…¹¬œ¤ì(€€€€€½¹ÍÐ…ÁÁÉ½… €ô½É¥¥¸¹±½¹” ¤¹ÍÕˆ¡‘•ÍÑ¥¹…Ñ¥½¸¤¹Í•Ñd À¤¹¹½Éµ…±¥é” ¤ì(€€€€€½¹ÍÐÍ¥‘”€ô¹•ÜQ!I¹Y•Ñ½ÈÌ µ…ÁÁÉ½… ¹è°€À°…ÁÁÉ½… ¹à¤ì(€€€€€½…°€ô•¹…‰±•‘9½‘•Ì(€€€€€€€€¹™¥±Ñ•È ¡¹½‘”¤€ôø¹½‘”¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q¼¡‘•ÍÑ¥¹…Ñ¥½¸¤€ø€Ü€˜˜¹½‘”¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q¼¡‘•ÍÑ¥¹…Ñ¥½¸¤€ð€ÈÈ¤(€€€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹Á½Í¥Ñ¥½¸¹±½¹” ¤¹ÍÕˆ¡‘•ÍÑ¥¹…Ñ¥½¸¤¹¹½Éµ…±¥é” ¤¹‘½Ð¡Í¥‘”¤(€€€€€€€€€€´„¹Á½Í¥Ñ¥½¸¹±½¹” ¤¹ÍÕˆ¡‘•ÍÑ¥¹…Ñ¥½¸¤¹¹½Éµ…±¥é” ¤¹‘½Ð¡Í¥‘”¤¥lÁt€üü½…°ì(€€€ô•±Í”¥˜€¡¹½Éµ…±¥é•‘5½‘”€ôôô€É•ÑÉ•…Ðœ¤ì(€€€€€½…°€ô•¹…‰±•‘9½‘•Ì(€€€€€€€€¹™¥±Ñ•È ¡¹½‘”¤€ôø¹½‘”¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q¼¡½É¥¥¸¤€ð€ÈÐ¤(€€€€€€€€¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡‘•ÍÑ¥¹…Ñ¥½¸¤€´„¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q½MÅÕ…É•¡‘•ÍÑ¥¹…Ñ¥½¸¤¥lÁt€üü½…°ì(€€€ô((€€€½¹ÍÐÁ…Ñ €ôÑ¡¥Ì¹}™¥¹‘A…Ñ ¡ÍÑ…ÉÐ¹¥°½…°¹¥¤ì(€€€¥˜€¡Á…Ñ ¹±•¹Ñ €ð€È¤É•ÑÕÉ¸½…°¹Á½Í¥Ñ¥½¸¹±½¹” ¤ì(€€€½¹ÍÐ¹•áÐ€ôÑ¡¥Ì¹Ý…åÁ½¥¹ÑÌ¹™¥¹ ¡¹½‘”¤€ôø¹½‘”¹¥€ôôôÁ…Ñ¡lÅt¤ì(€€€É•ÑÕÉ¸¹•áÐü¹Á½Í¥Ñ¥½¸¹±½¹” ¤€üü½…°¹Á½Í¥Ñ¥½¸¹±½¹” ¤ì(€ô((€}™¥¹‘A…Ñ ¡ÍÑ…ÉÑ%°½…±%¤ì(€€€¥˜€¡ÍÑ…ÉÑ%€ôôô½…±%¤É•ÑÕÉ¸mÍÑ…ÉÑ%‘tì(€€€½¹ÍÐ¹½‘•5…À€ô¹•Ü5…À¡Ñ¡¥Ì¹Ý…åÁ½¥¹ÑÌ¹µ…À ¡¹½‘”¤€ôøm¹½‘”¹¥°¹½‘•t¤¤ì(€€€½¹ÍÐ…‘©…•¹ä€ô¹•Ü5…À¡Ñ¡¥Ì¹Ý…åÁ½¥¹ÑÌ¹µ…À ¡¹½‘”¤€ôøm¹½‘”¹¥°mut¤¤ì(€€€™½È€¡½¹ÍÐ•‘”½˜Ñ¡¥Ì¹¹…Ù¥…Ñ¥½¹‘•Ì¤ì(€€€€€¥˜€ …•‘”¹•¹…‰±•ñð€…¹½‘•5…À¹•Ð¡•‘”¹„¤ü¹•¹…‰±•ñð€…¹½‘•5…À¹•Ð¡•‘”¹ˆ¤ü¹•¹…‰±•¤½¹Ñ¥¹Õ”ì(€€€€€…‘©…•¹ä¹•Ð¡•‘”¹„¤ü¹ÁÕÍ ¡•‘”¹ˆ¤ì(€€€€€…‘©…•¹ä¹•Ð¡•‘”¹ˆ¤ü¹ÁÕÍ ¡•‘”¹„¤ì(€€€ô((€€€½¹ÍÐ½Á•¸€ô¹•ÜM•Ð¡mÍÑ…ÉÑ%‘t¤ì(€€€½¹ÍÐ…µ•É½´€ô¹•Ü5…À ¤ì(€€€½¹ÍÐœ€ô¹•Ü5…À¡mmÍÑ…ÉÑ%°€Áut¤ì(€€€½¹ÍÐ˜€ô¹•Ü5…À¡mmÍÑ…ÉÑ%°¹½‘•5…À¹•Ð¡ÍÑ…ÉÑ%¤¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q¼¡¹½‘•5…À¹•Ð¡½…±%¤¹Á½Í¥Ñ¥½¸¥ut¤ì(€€€Ý¡¥±”€¡½Á•¸¹Í¥é”¤ì(€€€€€±•ÐÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€™½È€¡½¹ÍÐ¥½˜½Á•¸¤¥˜€¡ÕÉÉ•¹Ð€ôô¹Õ±°ñð€¡˜¹•Ð¡¥¤€üü%¹™¥¹¥Ñä¤€ð€¡˜¹•Ð¡ÕÉÉ•¹Ð¤€üü%¹™¥¹¥Ñä¤¤ÕÉÉ•¹Ð€ô¥ì(€€€€€¥˜€¡ÕÉÉ•¹Ð€ôôô½…±%¤ì(€€€€€€€½¹ÍÐÁ…Ñ €ômÕÉÉ•¹Ñtì(€€€€€€€Ý¡¥±”€¡…µ•É½´¹¡…Ì¡ÕÉÉ•¹Ð¤¤ì(€€€€€€€€€ÕÉÉ•¹Ð€ô…µ•É½´¹•Ð¡ÕÉÉ•¹Ð¤ì(€€€€€€€€€Á…Ñ ¹Õ¹Í¡¥™Ð¡ÕÉÉ•¹Ð¤ì(€€€€€€€ô(€€€€€€€É•ÑÕÉ¸Á…Ñ ì(€€€€€ô(€€€€€½Á•¸¹‘•±•Ñ”¡ÕÉÉ•¹Ð¤ì(€€€€€™½È€¡½¹ÍÐ¹•¥¡‰½È½˜…‘©…•¹ä¹•Ð¡ÕÉÉ•¹Ð¤€üümt¤ì(€€€€€€€½¹ÍÐÑ•¹Ñ…Ñ¥Ù”€ô€¡œ¹•Ð¡ÕÉÉ•¹Ð¤€üü%¹™¥¹¥Ñä¤(€€€€€€€€€€¬¹½‘•5…À¹•Ð¡ÕÉÉ•¹Ð¤¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q¼¡¹½‘•5…À¹•Ð¡¹•¥¡‰½È¤¹Á½Í¥Ñ¥½¸¤ì(€€€€€€€¥˜€¡Ñ•¹Ñ…Ñ¥Ù”€øô€¡œ¹•Ð¡¹•¥¡‰½È¤€üü%¹™¥¹¥Ñä¤¤½¹Ñ¥¹Õ”ì(€€€€€€€…µ•É½´¹Í•Ð¡¹•¥¡‰½È°ÕÉÉ•¹Ð¤ì(€€€€€€€œ¹Í•Ð¡¹•¥¡‰½È°Ñ•¹Ñ…Ñ¥Ù”¤ì(€€€€€€€˜¹Í•Ð¡¹•¥¡‰½È°Ñ•¹Ñ…Ñ¥Ù”€¬¹½‘•5…À¹•Ð¡¹•¥¡‰½È¤¹Á½Í¥Ñ¥½¸¹‘¥ÍÑ…¹•Q¼¡¹½‘•5…À¹•Ð¡½…±%¤¹Á½Í¥Ñ¥½¸¤¤ì(€€€€€€€½Á•¸¹…‘¡¹•¥¡‰½È¤ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸mÍÑ…ÉÑ%‘tì(€ô((€•Ñ•‰Õ…Ñ„ ¤ì(€€€É•ÑÕÉ¸ì(€€€€€‰½Õ¹‘ÌèìÉ…‘¥ÕÌè€ÐØ°µ¥¹dè€´Ä¸Ä°µ…ádè€ÄÔô°(€€€€€É¥¹ÌèÑ¡¥Ì¹É¥¹•™¥¹¥Ñ¥½¹Ìü¹µ…À ¡É¥¹œ¤€ôø€¡ì€¸¸¹É¥¹œ°µ…Ñ•É¥…°èÕ¹‘•™¥¹•ô¤¤€üümt°(€€€€€½±±¥‘•É½Õ¹ÐèÑ¡¥Ì¹ÍÑ…Ñ¥	½‘¥•Ì¹±•¹Ñ °(€€€€€½±±¥‘•ÉÌèÑ¡¥Ì¹ÍÑ…Ñ¥	½‘¥•Ì¹µ…À ¡‰½‘ä¤€ôø€¡ì(€€€€€€€¹…µ”è‰½‘ä¹¹…µ”°(€€€€€€€Á½Í¥Ñ¥½¸è¹•ÜQ!I¹Y•Ñ½ÈÌ¡‰½‘ä¹Á½Í¥Ñ¥½¸¹à°‰½‘ä¹Á½Í¥Ñ¥½¸¹ä°‰½‘ä¹Á½Í¥Ñ¥½¸¹è¤°(€€€€€€€ÕÍ•É…Ñ„èì€¸¸¹‰½‘ä¹ÕÍ•É…Ñ„ô°(€€€€€ô¤¤°(€€€€€Á±…å•ÉMÁ…Ý¹ÌèÑ¡¥Ì¹ÍÁ…Ý¹A½¥¹ÑÌ¹µ…À ¡Á½¥¹Ð¤€ôøÁ½¥¹Ð¹±½¹” ¤¤°(€€€€€•¹•µåMÁ…Ý¹ÌèÑ¡¥Ì¹•¹•µåMÁ…Ý¹A½¥¹ÑÌ¹µ…À ¡Á½¥¹Ð¤€ôøÁ½¥¹Ð¹±½¹” ¤¤°(€€€€€½‰©•Ñ¥Ù•ÌèÑ¡¥Ì¹½‰©•Ñ¥Ù•A½¥¹ÑÌ¹µ…À ¡Á½¥¹Ð¤€ôø€¡ì€¸¸¹Á½¥¹Ð°Á½Í¥Ñ¥½¸èÁ½¥¹Ð¹Á½Í¥Ñ¥½¸¹±½¹” ¤ô¤¤°(€€€€€Ý…åÁ½¥¹ÑÌèÑ¡¥Ì¹Ý…åÁ½¥¹ÑÌ¹µ…À ¡¹½‘”¤€ôø€¡ì€¸¸¹¹½‘”°Á½Í¥Ñ¥½¸è¹½‘”¹Á½Í¥Ñ¥½¸¹±½¹” ¤ô¤¤°(€€€€€•‘•ÌèÑ¡¥Ì¹¹…Ù¥…Ñ¥½¹‘•Ì¹µ…À ¡•‘”¤€ôø€¡ì€¸¸¹•‘”ô¤¤°(€€€€€Á•¹‘¥¹M¡¥™ÐèÑ¡¥Ì¹}Á•¹‘¥¹M¡¥™Ð€üì€¸¸¹Ñ¡¥Ì¹}Á•¹‘¥¹M¡¥™Ðô€è¹Õ±°°(€€€€€Í¡¥™ÑY•ÉÍ¥½¸èÑ¡¥Ì¹}Í¡¥™ÑY•ÉÍ¥½¸°(€€€ôì(€ô((€É•Í•Ð ¤ì(€€€¥˜€ …Ñ¡¥Ì¹}‰Õ¥±Ð¤É•ÑÕÉ¸ì(€€€Ñ¡¥Ì¹}Á•¹‘¥¹M¡¥™Ð€ô¹Õ±°ì(€€€Ñ¡¥Ì¹}•±…ÁÍ•€ô€Àì(€€€Ñ¡¥Ì¹}ÍÁ…Ý¹ÕÉÍ½È€ô€Àì(€€€Ñ¡¥Ì¹}Í¡¥™ÑY•ÉÍ¥½¸€ô€Àì(€€€™½È€¡½¹ÍÐÉ•½É‘Ì½˜=‰©•Ð¹Ù…±Õ•Ì¡Ñ¡¥Ì¹Í¡¥™Ñ±•µ•¹ÑÌ¤¤ì(€€€€€™½È€¡½¹ÍÐÉ•½É½˜É•½É‘Ì¤Ñ¡¥Ì¹}Í•ÑM¡¥™ÑI•½É‘MÑ…Ñ”¡É•½É°€À¤ì(€€€ô(€€€Ñ¡¥Ì¹}Íå¹9…Ù¥…Ñ¥½¹MÑ…Ñ” ¤ì(€€€Ñ¡¥Ì¹}Í•ÑQ•±•É…Á¡%¹Ñ•¹Í¥Ñä …±°œ°€À¤ì(€€€¥˜€¡Ñ¡¥Ì¹Ý½É±¤Ñ¡¥Ì¹Ý½É±¹‰É½…‘Á¡…Í”¹‘¥ÉÑä€ôÑÉÕ”ì(€ô((€}É•µ½Ù•A¡åÍ¥Í	½‘¥•Ì ¤ì(€€€¥˜€ …Ñ¡¥Ì¹Ý½É±¤É•ÑÕÉ¸ì(€€€™½È€¡½¹ÍÐ‰½‘ä½˜Ñ¡¥Ì¹ÍÑ…Ñ¥	½‘¥•Ì¤Ñ¡¥Ì¹Ý½É±¹É•µ½Ù•	½‘ä¡‰½‘ä¤ì(€€€Ñ¡¥Ì¹ÍÑ…Ñ¥	½‘¥•Ì¹±•¹Ñ €ô€Àì(€ô((€}•µ¥Ð¡ÑåÁ”°Á…å±½…¤ì(€€€¥˜€¡ÑåÁ•½˜Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌü¹•µ¥Ð€ôôô€™Õ¹Ñ¥½¸œ¤Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌ¹•µ¥Ð¡ÑåÁ”°Á…å±½…¤ì(€€€•±Í”¥˜€¡ÑåÁ•½˜Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌü¹‘¥ÍÁ…Ñ¡Ù•¹Ð€ôôô€™Õ¹Ñ¥½¸œ¤ì(€€€€€Ñ¡¥Ì¹•Ù•¹Ñ	ÕÌ¹‘¥ÍÁ…Ñ¡Ù•¹Ð¡ìÑåÁ”°€¸¸¹Á…å±½…ô¤ì(€€€ô(€ô((€‘¥ÍÁ½Í” ¤ì(€€€¥˜€¡Ñ¡¥Ì¹}‘¥ÍÁ½Í•¤É•ÑÕÉ¸ì(€€€Ñ¡¥Ì¹}‘¥ÍÁ½Í•€ôÑÉÕ”ì(€€€Ñ¡¥Ì¹}É•µ½Ù•A¡åÍ¥Í	½‘¥•Ì ¤ì(€€€Ñ¡¥Ì¹É½½Ð¹É•µ½Ù•É½µA…É•¹Ð ¤ì(€€€½¹ÍÐÍ¡…É•‘•½µ•ÑÉä€ô¹•ÜM•Ð¡=‰©•Ð¹Ù…±Õ•Ì¡Ñ¡¥Ì¹•½µ•ÑÉ¥•Ì¤¤ì(€€€½¹ÍÐ‘¥ÍÁ½Í•‘•½µ•ÑÉä€ô¹•ÜM•Ð ¤ì(€€€Ñ¡¥Ì¹É½½Ð¹ÑÉ…Ù•ÉÍ” ¡¡¥±¤€ôøì(€€€€€¥˜€ …¡¥±¹•½µ•ÑÉäñðÍ¡…É•‘•½µ•ÑÉä¹¡…Ì¡¡¥±¹•½µ•ÑÉä¤ñð‘¥ÍÁ½Í•‘•½µ•ÑÉä¹¡…Ì¡¡¥±¹•½µ•ÑÉä¤¤É•ÑÕÉ¸ì(€€€€€‘¥ÍÁ½Í•‘•½µ•ÑÉä¹…‘¡¡¥±¹•½µ•ÑÉä¤ì(€€€€€¡¥±¹•½µ•ÑÉä¹‘¥ÍÁ½Í” ¤ì(€€€ô¤ì(€€€=‰©•Ð¹Ù…±Õ•Ì¡Ñ¡¥Ì¹•½µ•ÑÉ¥•Ì¤¹™½É…  ¡•½µ•ÑÉä¤€ôø•½µ•ÑÉä¹‘¥ÍÁ½Í” ¤¤ì(€€€=‰©•Ð¹Ù…±Õ•Ì¡Ñ¡¥Ì¹µ…Ñ•É¥…±Ì¤¹™½É…  ¡µ…Ñ•É¥…°¤€ôøµ…Ñ•É¥…°¹‘¥ÍÁ½Í” ¤¤ì(€€€Ñ¡¥Ì¹}±•…ÉY¥ÍÕ…±¡¥±‘É•¸ ¤ì(€€€Ñ¡¥Ì¹}É•Í•Ñ½±±•Ñ¥½¹Ì ¤ì(€€€Ñ¡¥Ì¹Ý½É±€ô¹Õ±°ì(€€€Ñ¡¥Ì¹Í•¹”€ô¹Õ±°ì(€ô)ô()•áÁ½ÉÐ‘•™…Õ±ÐÉ•¹„ì(