import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DEFAULT_MAP_ID, MAP_CONFIGS, resolveMapConfig } from '../configs/mapConfigs.js';

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
    this.mapConfig = resolveMapConfig(options.mapId ?? options.map ?? DEFAULT_MAP_ID);
    this.mapId = this.mapConfig.id;
    this.world = null;
    this._built = false;
    this._disposed = false;
    this._elapsed = 0;
    this._spawnCursor = 0;
    this._pendingShift = null;
    this._shiftVersion = 0;

    this.root = new THREE.Group();
    this.root.name = `${this.mapId.toUpperCase().replace(/-/g, '_')}_ARENA`;
    this.scene?.add(this.root);

    this.staticBodies = [];
    // cannon-es only honors the player's zero-friction material when both
    // colliding bodies have materials; otherwise the sticky world default wins.
    this.collisionMaterial = new CANNON.Material('arena-surface');
    this.collisionMaterial.friction = 0.8;
    this.collisionMaterial.restitution = 0;
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
    this._applyMapPalette();
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
      // Mid-value albedos keep traversal readable under every camera angle.
      // Low-to-medium metalness is intentional: this procedural scene has no
      // reflection probe, so heavily metallic surfaces would render near-black.
      foundation: standard(0x283747, { roughness: 0.92, metalness: 0.16 }),
      floor: standard(0x526a7b, { roughness: 0.84, metalness: 0.2 }),
      elevated: standard(0x718196, { roughness: 0.72, metalness: 0.28 }),
      trim: standard(0x3d9ba5, { emissive: 0x087984, emissiveIntensity: 0.9, metalness: 0.32 }),
      structure: standard(0x455469, { roughness: 0.68, metalness: 0.34 }),
      cover: standard(0x6c637c, {
        roughness: 0.76,
        metalness: 0.22,
        emissive: 0x5f176f,
        emissiveIntensity: 0.07,
      }),
      bridge: standard(0x4f858b, {
        roughness: 0.66,
        metalness: 0.3,
        emissive: 0x0d9097,
        emissiveIntensity: 0.34,
      }),
      door: standard(0x896c43, {
        roughness: 0.72,
        metalness: 0.24,
        emissive: 0xb45c10,
        emissiveIntensity: 0.3,
      }),
      spire: standard(0x5c526f, {
        roughness: 0.58,
        metalness: 0.36,
        emissive: 0x5d20a0,
        emissiveIntensity: 0.48,
      }),
      objective: standard(0x987b3e, {
        roughness: 0.62,
        metalness: 0.26,
        emissive: 0xd98112,
        emissiveIntensity: 1.25,
      }),
      hologram: standard(0x43e7ed, {
        emissive: 0x19d8e2,
        emissiveIntensity: 1.85,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        roughness: 0.25,
        metalness: 0.1,
      }),
    };
  }

  _applyMapPalette() {
    const palette = this.mapConfig.palette;
    const set = (key, color, emissive = null) => {
      if (color != null) this.materials[key].color.setHex(color);
      if (emissive != null) this.materials[key].emissive.setHex(emissive);
    };
    set('foundation', palette.foundation);
    set('floor', palette.floor);
    set('elevated', palette.elevated);
    set('trim', palette.trim, palette.trimEmissive);
    set('structure', palette.structure);
    set('cover', palette.cover, palette.coverEmissive);
    set('bridge', palette.bridge, palette.bridgeEmissive);
    set('door', palette.door, palette.doorEmissive);
    set('spire', palette.spire, palette.spireEmissive);
    set('objective', palette.objective, palette.objectiveEmissive);
    set('hologram', palette.hologram, palette.hologramEmissive);
  }

  /**
   * Selects a data-driven arena variant. A built arena is rebuilt in-place by
   * default, preserving the THREE.Scene, cannon-es World and Arena instance.
   * Call this only between runs, after enemies/projectiles have been cleared.
   */
  setMap(map = DEFAULT_MAP_ID, options = {}) {
    if (this._disposed) throw new Error('[Arena] Cannot change a disposed arena.');
    const next = resolveMapConfig(map);
    if (!MAP_CONFIGS[next.id]) throw new Error(`[Arena] Unknown map: ${String(map)}`);
    if (next.id === this.mapId) {
      if (options.reset !== false) this.reset();
      return this;
    }
    const previousId = this.mapId;
    const shouldRebuild = options.rebuild ?? this._built;
    const activeWorld = this.world;
    if (this._built && !shouldRebuild) {
      throw new Error('[Arena] A built arena requires { rebuild: true } when changing maps.');
    }
    if (this._built) {
      this._removePhysicsBodies();
      this._clearVisualChildren(true);
      this._resetCollections();
      this._built = false;
    }
    this.mapConfig = next;
    this.mapId = next.id;
    this.root.name = `${this.mapId.toUpperCase().replace(/-/g, '_')}_ARENA`;
    this._applyMapPalette();
    if (shouldRebuild && activeWorld) this.build(activeWorld);
    this._emit('arena:mapChanged', {
      previousId,
      map: this.getMapInfo(),
      rebuilt: Boolean(shouldRebuild && activeWorld),
    });
    return this;
  }

  getMapInfo() {
    const { id, name, shortName, description } = this.mapConfig;
    return { id, name, shortName, description };
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
      map: this.getMapInfo(),
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
    this.ringDefinitions = [];
    this.shiftElements = { bridge: [], doors: [], cover: [] };
    this._animated = {};
  }

  _clearVisualChildren(disposeGeometry = false) {
    if (disposeGeometry) {
      const sharedGeometry = new Set(Object.values(this.geometries));
      const disposedGeometry = new Set();
      this.root.traverse((child) => {
        if (!child.geometry || sharedGeometry.has(child.geometry) || disposedGeometry.has(child.geometry)) return;
        disposedGeometry.add(child.geometry);
        child.geometry.dispose();
      });
    }
    while (this.root.children.length) this.root.remove(this.root.children[0]);
  }

  _buildFoundation() {
    const config = this.mapConfig.foundation;
    const foundationGeometry = config.shape === 'box'
      ? this.geometries.box
      : new THREE.CylinderGeometry(config.radius, config.radius, config.depth, 48);
    const foundation = new THREE.Mesh(foundationGeometry, this.materials.foundation);
    foundation.name = 'FOUNDATION_DISC';
    if (config.shape === 'box') foundation.scale.fromArray(config.size);
    foundation.position.y = config.y;
    foundation.receiveShadow = true;
    this.root.add(foundation);
    if (config.shape === 'box') {
      this._addStaticBox(
        'foundation-collider',
        new THREE.Vector3().fromArray(config.size),
        new THREE.Vector3(0, config.y, 0),
        new THREE.Quaternion(),
        { arenaSurface: true, blocksLineOfSight: false, role: 'foundation' },
      );
    } else {
      // Keep physics congruent with the visible disc. The old square collider
      // left invisible walkable corners outside the arena wall.
      this._addStaticCylinder(
        'foundation-collider',
        config.radius - 1,
        config.depth,
        new THREE.Vector3(0, config.y, 0),
        { arenaSurface: true, blocksLineOfSight: false, role: 'foundation' },
      );
    }

    if (config.glowRadius > 0) {
      const trenchGlow = new THREE.Mesh(
        new THREE.TorusGeometry(config.glowRadius, 0.09, 5, 96),
        this.materials.trim,
      );
      trenchGlow.name = 'BOUNDARY_GLOW';
      trenchGlow.rotation.x = Math.PI / 2;
      trenchGlow.position.y = config.y + config.depth * 0.5 + 0.07;
      this.root.add(trenchGlow);
    }
  }

  _buildRingRoutes() {
    const ringDefinitions = this.mapConfig.rings.map((ring) => ({
      ...ring,
      material: this.materials[ring.material] ?? this.materials.floor,
    }));
    this.ringDefinitions = ringDefinitions;

    for (let ringIndex = 0; ringIndex < ringDefinitions.length; ringIndex += 1) {
      const ring = ringDefinitions[ringIndex];
      const segmentLength = (TAU * ring.radius / ring.segments) * 1.06;
      const transforms = [];
      for (let index = 0; index < ring.segments; index += 1) {
        const angle = index / ring.segments * TAU + (ring.angleOffset ?? 0);
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
    for (const connection of this.mapConfig.connections) {
      const transforms = [];
      for (let index = 0; index < connection.count; index += 1) {
        const angle = (index + (connection.angleOffset ?? 0)) / connection.count * TAU;
        const slope = -Math.atan2(connection.rise, connection.length);
        transforms.push({
          name: `${connection.id}-${index}`,
          size: new THREE.Vector3(connection.width, connection.depth, Math.hypot(connection.length, connection.rise)),
          position: new THREE.Vector3(
            Math.cos(angle) * connection.radius,
            connection.y,
            Math.sin(angle) * connection.radius,
          ),
          rotation: new THREE.Euler(slope, Math.PI / 2 - angle, 0, 'YXZ'),
          userData: { arenaSurface: true, ramp: true },
        });
      }
      if (transforms.length) {
        this._addInstancedBoxes(
          `${connection.id.toUpperCase()}_ROUTES`,
          transforms,
          this.materials[connection.material] ?? this.materials.elevated,
        );
      }
    }
  }

  _buildSectorArchitecture() {
    const config = this.mapConfig.sectors;
    const boundary = this.mapConfig.foundation.boundary;
    const outerPanels = [];
    const pillars = [];
    const staticCover = [];
    for (let index = 0; index < boundary.count; index += 1) {
      const angle = index / boundary.count * TAU;
      outerPanels.push({
        name: `boundary-${index}`,
        size: new THREE.Vector3().fromArray(boundary.size),
        position: new THREE.Vector3(Math.cos(angle) * boundary.radius, boundary.y, Math.sin(angle) * boundary.radius),
        rotation: new THREE.Euler(0, -angle - Math.PI / 2, 0),
        userData: { arenaWall: true },
      });
    }
    if (outerPanels.length) this._addInstancedBoxes('BOUNDARY_PANELS', outerPanels, this.materials.structure);

    for (let sector = 0; sector < config.count; sector += 1) {
      const centerAngle = sector / config.count * TAU;
      this.sectors.push({
        id: `sector-${sector}`,
        index: sector,
        name: config.names[sector],
        center: new THREE.Vector3(Math.cos(centerAngle) * config.radius, 0.5, Math.sin(centerAngle) * config.radius),
        angle: centerAngle,
      });

      for (const [bandIndex, band] of config.pillarBands.entries()) {
        const angle = centerAngle + (band.angleOffset ?? (((bandIndex + sector) % 2) ? 0.08 : -0.08));
        pillars.push({
          name: `pillar-${sector}-${bandIndex}`,
          size: new THREE.Vector3().fromArray(band.size),
          position: new THREE.Vector3(Math.cos(angle) * band.radius, band.y, Math.sin(angle) * band.radius),
          rotation: new THREE.Euler(0, -angle, 0),
          userData: { arenaWall: true, sector },
        });
      }

      for (const [coverIndex, band] of config.coverBands.entries()) {
        const angle = centerAngle + (band.angleOffset ?? 0);
        staticCover.push({
          name: `static-cover-${sector}-${coverIndex}`,
          size: new THREE.Vector3().fromArray(band.size),
          position: new THREE.Vector3(Math.cos(angle) * band.radius, band.y, Math.sin(angle) * band.radius),
          rotation: new THREE.Euler(0, -angle - Math.PI / 2, 0),
          userData: { arenaWall: true, cover: true, sector },
        });
      }

      const beacon = new THREE.Mesh(this.geometries.cylinder, this.materials.objective);
      beacon.name = `SECTOR_BEACON_${sector}`;
      beacon.scale.fromArray(config.beacon.scale);
      beacon.position.set(
        Math.cos(centerAngle) * config.beacon.radius,
        config.beacon.y,
        Math.sin(centerAngle) * config.beacon.radius,
      );
      this.root.add(beacon);
    }
    if (pillars.length) this._addInstancedBoxes('BOUNDARY_PILLARS', pillars, this.materials.structure);
    if (staticCover.length) this._addInstancedBoxes('STATIC_COVER', staticCover, this.materials.cover);
    this._buildConfiguredBoxes();
  }

  _buildConfiguredBoxes() {
    for (const box of this.mapConfig.geometryBoxes) {
      const size = new THREE.Vector3().fromArray(box.size);
      const position = new THREE.Vector3().fromArray(box.position);
      const rotation = box.rotation
        ? new THREE.Euler(box.rotation[0] ?? 0, box.rotation[1] ?? 0, box.rotation[2] ?? 0, 'XYZ')
        : new THREE.Euler(0, box.rotationY ?? 0, 0);
      const mesh = new THREE.Mesh(this.geometries.box, this.materials[box.material] ?? this.materials.structure);
      mesh.name = box.name;
      mesh.scale.copy(size);
      mesh.position.copy(position);
      mesh.rotation.copy(rotation);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this._addStaticBox(box.name.toLowerCase(), size, position, mesh.quaternion, {
        arenaWall: box.wall ?? false,
        arenaSurface: box.surface ?? false,
        cover: box.material === 'cover',
        role: box.role ?? box.material ?? 'structure',
        ramp: box.name.endsWith('_RAMP'),
      });
    }
  }

  _buildCentralSpire() {
    const config = this.mapConfig.central;
    const center = new THREE.Vector3(config.position[0], 0, config.position[1]);
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(config.dais.radius, config.dais.bottomRadius, config.dais.height, 12),
      this.materials.structure,
    );
    dais.name = 'PHASE_DAIS';
    dais.position.set(center.x, config.dais.y, center.z);
    dais.receiveShadow = true;
    dais.castShadow = true;
    this.root.add(dais);
    this._addStaticCylinder('phase-dais', config.dais.radius, config.dais.height, dais.position);

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(config.core.topRadius, config.core.bottomRadius, config.core.height, 10, 1, false),
      this.materials.spire,
    );
    core.name = 'PHASE_SPIRE';
    core.position.set(center.x, config.core.y, center.z);
    core.castShadow = true;
    this.root.add(core);
    this._addStaticCylinder('phase-spire', config.core.colliderRadius, config.core.height, core.position);

    const haloGroup = new THREE.Group();
    haloGroup.name = 'PHASE_HALOS';
    for (let index = 0; index < config.halos.count; index += 1) {
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(config.halos.startRadius + index * config.halos.radiusStep, 0.055, 5, 48),
        index % 2 ? this.materials.hologram : this.materials.trim,
      );
      halo.rotation.x = Math.PI / 2 + (index - (config.halos.count - 1) * 0.5) * 0.14;
      halo.position.y = config.halos.startY + index * config.halos.yStep;
      haloGroup.add(halo);
    }
    haloGroup.position.set(center.x, 0, center.z);
    this.root.add(haloGroup);
    this._animated.spire = core;
    this._animated.halos = haloGroup;

    for (const [index, objective] of config.objectives.entries()) {
      const point = objective.position
        ? new THREE.Vector3().fromArray(objective.position)
        : new THREE.Vector3(
          center.x + Math.cos(objective.angle) * objective.radius,
          objective.y,
          center.z + Math.sin(objective.angle) * objective.radius,
        );
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
    const entries = this.mapConfig.shifts.bridges.entries;
    for (const [index, entry] of entries.entries()) {
      const angle = entry.angle ?? 0;
      const activePosition = entry.position
        ? new THREE.Vector3().fromArray(entry.position)
        : new THREE.Vector3(Math.cos(angle) * entry.radius, entry.activeY, Math.sin(angle) * entry.radius);
      activePosition.y = entry.activeY;
      const inactivePosition = activePosition.clone();
      inactivePosition.y = entry.inactiveY;
      const mesh = new THREE.Mesh(this.geometries.box, this.materials.bridge);
      mesh.name = `SHIFT_BRIDGE_${index}`;
      mesh.scale.fromArray(entry.size);
      mesh.rotation.y = entry.rotationY ?? Math.PI / 2 - angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);

      const states = entry.startActive
        ? [{ position: activePosition }, { position: inactivePosition }]
        : [{ position: inactivePosition }, { position: activePosition }];
      const body = this._createBoxBody(
        `shift-bridge-${index}`,
        new THREE.Vector3().fromArray(entry.size),
        states[0].position,
        mesh.quaternion,
        { shiftKind: 'bridge', arenaSurface: true },
      );
      this.shiftElements.bridge.push(this._createShiftRecord('bridge', mesh, body, states, index));
    }
  }

  _buildShiftDoors() {
    const config = this.mapConfig.shifts.doors;
    for (let index = 0; index < config.count; index += 1) {
      const angle = (index + (config.angleOffset ?? 0)) / config.count * TAU;
      const closed = new THREE.Vector3(Math.cos(angle) * config.radius, config.closedY, Math.sin(angle) * config.radius);
      const open = closed.clone();
      open.y = config.openY;
      const mesh = new THREE.Mesh(this.geometries.box, this.materials.door);
      mesh.name = `SHIFT_GATE_${index}`;
      mesh.scale.fromArray(config.size);
      mesh.rotation.y = -angle - Math.PI / 2;
      mesh.castShadow = true;
      this.root.add(mesh);
      const states = index % 2
        ? [{ position: closed }, { position: open }]
        : [{ position: open }, { position: closed }];
      const body = this._createBoxBody(
        `shift-door-${index}`,
        new THREE.Vector3().fromArray(config.size),
        states[0].position,
        mesh.quaternion,
        { shiftKind: 'doors', arenaWall: true },
      );
      this.shiftElements.doors.push(this._createShiftRecord('doors', mesh, body, states, index));
    }
  }

  _buildShiftCover() {
    const config = this.mapConfig.shifts.cover;
    const count = config.count;
    const mesh = new THREE.InstancedMesh(this.geometries.box, this.materials.cover, count);
    mesh.name = 'SHIFTING_COVER_BANK';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(mesh);

    for (let index = 0; index < count; index += 1) {
      const angle = index / count * TAU + config.angleOffset;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
      const origin = radial.clone().multiplyScalar(config.radii[index % config.radii.length]);
      origin.y = index % config.elevatedEvery === 0 ? config.elevatedY : config.baseY;
      const alternate = origin.clone().addScaledVector(tangent, index % 2 ? config.tangentDistance : -config.tangentDistance);
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle - Math.PI / 2, 0));
      const scale = new THREE.Vector3().fromArray(config.size);
      const states = [{ position: origin, quaternion, scale }, { position: alternate, quaternion, scale }];
      const body = this._createBoxBody(
        `shift-cover-${index}`,
        scale,
        origin,
        quaternion,
        { shiftKind: 'cover', arenaWall: true, cover: true },
      );
      const record = this._createShiftRecord('cover', mesh, body, states, index);
      record.instanceIndex = index;
      this.shiftElements.cover.push(record);
      this._setShiftRecordState(record, 0);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  _createShiftRecord(kind, mesh, body, states, index) {
    return {
      id: `${kind}-${index}`,
      kind,
      mesh,
      body,
      states: states.map((state) => ({
        position: state.position.clone(),
        quaternion: state.quaternion?.clone() ?? mesh.quaternion.clone(),
        scale: state.scale?.clone() ?? mesh.scale.clone(),
      })),
      state: 0,
      instanceIndex: null,
    };
  }

  _buildSpawnsAndNavigation() {
    const spawnConfig = this.mapConfig.spawns;
    // Player spawn values are body-centre positions for the PlayerController capsule.
    for (const point of spawnConfig.player) this.spawnPoints.push(new THREE.Vector3().fromArray(point));
    for (const band of spawnConfig.enemyBands) {
      for (let index = 0; index < band.count; index += 1) {
        const angle = index / band.count * TAU + (band.angleOffset ?? 0);
        this.enemySpawnPoints.push(new THREE.Vector3(
          Math.cos(angle) * band.radius,
          band.y,
          Math.sin(angle) * band.radius,
        ));
      }
    }
    for (const point of spawnConfig.enemyPoints ?? []) {
      this.enemySpawnPoints.push(new THREE.Vector3().fromArray(point));
    }

    const navigation = this.mapConfig.navigation;
    if (navigation.nodes) {
      for (const [index, node] of navigation.nodes.entries()) {
        this.waypoints.push({
          id: node.id,
          ring: node.ring ?? null,
          sector: node.sector ?? index % this.mapConfig.sectors.count,
          position: new THREE.Vector3().fromArray(node.position),
          enabled: true,
        });
      }
      for (const [a, b, kind = 'route'] of navigation.edges) {
        this.navigationEdges.push({
          a,
          b,
          kind,
          enabled: kind !== 'bridge-west',
        });
      }
      return;
    }

    const ringNodes = navigation.rings;
    const perRing = navigation.perRing;
    for (let ring = 0; ring < ringNodes.length; ring += 1) {
      for (let index = 0; index < perRing; index += 1) {
        const angle = index / perRing * TAU;
        this.waypoints.push({
          id: `r${ring}-${index}`,
          ring,
          sector: Math.floor(index / Math.max(1, perRing / this.mapConfig.sectors.count)),
          position: new THREE.Vector3(
            Math.cos(angle) * ringNodes[ring].radius,
            ringNodes[ring].y,
            Math.sin(angle) * ringNodes[ring].radius,
          ),
          enabled: true,
        });
        this.navigationEdges.push({
          a: `r${ring}-${index}`,
          b: `r${ring}-${(index + 1) % perRing}`,
          kind: 'ring',
          enabled: true,
        });
      }
    }
    for (let ring = 0; ring < ringNodes.length - 1; ring += 1) {
      for (let index = 0; index < perRing; index += navigation.connectionStep) {
        const isOuterConnection = ring === ringNodes.length - 2;
        const kind = isOuterConnection && index === navigation.bridgeIndices[0]
          ? 'bridge-east'
          : isOuterConnection && index === navigation.bridgeIndices[1]
            ? 'bridge-west'
            : 'ramp';
        this.navigationEdges.push({
          a: `r${ring}-${index}`,
          b: `r${ring + 1}-${index}`,
          kind,
          enabled: kind !== 'bridge-west',
        });
      }
    }
  }

  _addInstancedBoxes(name, transforms, material) {
    const mesh = new THREE.InstancedMesh(this.geometries.box, material, transforms.length);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const dummy = new THREE.Object3D();
    transforms.forEach((transform, index) => {
      dummy.position.copy(transform.position);
      dummy.rotation.copy(transform.rotation ?? new THREE.Euler());
      dummy.scale.copy(transform.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      this._createBoxBody(
        transform.name,
        transform.size,
        transform.position,
        dummy.quaternion,
        transform.userData,
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
    return mesh;
  }

  _addStaticBox(name, size, position, quaternion = new THREE.Quaternion(), userData = {}) {
    return this._createBoxBody(name, size, position, quaternion, userData);
  }

  _createBoxBody(name, size, position, quaternion = new THREE.Quaternion(), userData = {}) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: this.collisionMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      quaternion: new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
      collisionFilterGroup: ARENA_COLLISION_GROUP,
      collisionFilterMask: -1,
    });
    body.name = name;
    body.userData = { arena: true, blocksLineOfSight: true, ...userData };
    this.world.addBody(body);
    this.staticBodies.push(body);
    return body;
  }

  _addStaticCylinder(name, radius, height, position, userData = {}) {
    const upright = new CANNON.Quaternion();
    // cannon-es cylinders are Y-up already. Rotating by -90° laid every
    // collider on its side while the corresponding mesh remained upright.
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: this.collisionMaterial,
      shape: new CANNON.Cylinder(radius, radius, height, 16),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      quaternion: upright,
      collisionFilterGroup: ARENA_COLLISION_GROUP,
      collisionFilterMask: -1,
    });
    body.name = name;
    body.userData = { arena: true, blocksLineOfSight: true, ...userData };
    this.world.addBody(body);
    this.staticBodies.push(body);
    return body;
  }

  beginShift(type = 'all') {
    if (!this._built || this._pendingShift) return false;
    const normalized = normalizeShiftType(type);
    if (normalized !== 'all' && !this.shiftElements[normalized]?.length) return false;
    this._pendingShift = {
      type: normalized,
      elapsed: 0,
      duration: this.telegraphDuration,
      ready: false,
      blocked: false,
    };
    this._emit('arena:shiftTelegraph', {
      type: normalized,
      duration: this.telegraphDuration,
      affected: this._affectedShiftRecords(normalized).map((record) => record.id),
    });
    return { ...this._pendingShift };
  }

  update(deltaSeconds = 0, playerPosition = null) {
    if (!this._built || this._disposed) return;
    const dt = Math.min(0.25, Math.max(0, Number(deltaSeconds) || 0));
    this._elapsed += dt;
    if (this._animated.spire) this._animated.spire.rotation.y += dt * 0.22;
    if (this._animated.halos) {
      this._animated.halos.rotation.y -= dt * 0.4;
      this._animated.halos.children.forEach((halo, index) => {
        halo.rotation.z += dt * (index % 2 ? -0.27 : 0.31);
      });
    }
    this.materials.hologram.opacity = 0.28 + smoothPulse(this._elapsed * 0.35) * 0.16;

    const pending = this._pendingShift;
    if (!pending) return;
    pending.elapsed = Math.min(pending.duration, pending.elapsed + dt);
    const progress = pending.duration > 0 ? pending.elapsed / pending.duration : 1;
    const pulse = 0.5 + smoothPulse(this._elapsed) * (1 + progress * 2.2);
    this._setTelegraphIntensity(pending.type, pulse);

    if (pending.elapsed >= pending.duration && !pending.ready) {
      pending.ready = true;
      this._emit('arena:shiftReady', { type: pending.type });
    }
    if (pending.ready && this.autoApplyShifts) {
      const trackedPosition = playerPosition ?? this.getPlayerPosition?.() ?? null;
      this.applyShift(pending.type, trackedPosition);
    }
  }

  applyShift(type = this._pendingShift?.type ?? 'all', playerPosition = null) {
    if (!this._built) return false;
    const normalized = normalizeShiftType(type);
    const records = this._affectedShiftRecords(normalized);
    if (!records.length) return false;
    const player = playerPosition ? asThreeVector(playerPosition) : null;
    const skipped = [];
    let applied = 0;
    for (const record of records) {
      if (player && this._wouldEndangerPlayer(record, player)) {
        skipped.push(record.id);
        continue;
      }
      this._setShiftRecordState(record, record.state ? 0 : 1);
      applied += 1;
    }
    if (skipped.length) {
      this._emit('arena:shiftBlocked', {
        type: normalized,
        reason: 'player-overlap',
        skipped,
        partial: applied > 0,
      });
    }
    if (!applied) {
      this._pendingShift = null;
      this._setTelegraphIntensity('all', 0);
      return false;
    }
    this._syncNavigationState();
    this._shiftVersion += 1;
    this._pendingShift = null;
    this._setTelegraphIntensity('all', 0);
    this.world.broadphase.dirty = true;
    this._emit('arena:shiftApplied', {
      type: normalized,
      version: this._shiftVersion,
      applied,
      skipped,
    });
    return true;
  }

  _affectedShiftRecords(type) {
    if (type === 'all') return Object.values(this.shiftElements).flat();
    return this.shiftElements[type] ?? [];
  }

  _wouldEndangerPlayer(record, player) {
    const nextState = record.states[record.state ? 0 : 1];
    const currentState = record.states[record.state];
    const size = nextState.scale;
    const targetHorizontal = horizontalDistanceSquared(nextState.position, player);
    const targetRadius = Math.max(size.x, size.z) * 0.58 + 0.65;
    const targetVertical = Math.abs(nextState.position.y - player.y) < size.y * 0.5 + 1.1;
    if (targetHorizontal < targetRadius * targetRadius && targetVertical) return true;

    // Never retract a bridge from directly beneath the capsule.
    if (record.kind === 'bridge' && nextState.position.y < -2) {
      const currentRadius = Math.max(currentState.scale.x, currentState.scale.z) * 0.55;
      if (horizontalDistanceSquared(currentState.position, player) < currentRadius * currentRadius
        && player.y > currentState.position.y
        && player.y < currentState.position.y + 2.2) return true;
    }
    return false;
  }

  _setShiftRecordState(record, stateIndex) {
    const state = record.states[stateIndex];
    record.state = stateIndex;
    if (record.instanceIndex == null) {
      record.mesh.position.copy(state.position);
      record.mesh.quaternion.copy(state.quaternion);
      record.mesh.scale.copy(state.scale);
      record.mesh.updateMatrixWorld();
    } else {
      const matrix = new THREE.Matrix4().compose(state.position, state.quaternion, state.scale);
      record.mesh.setMatrixAt(record.instanceIndex, matrix);
      record.mesh.instanceMatrix.needsUpdate = true;
    }
    record.body.position.set(state.position.x, state.position.y, state.position.z);
    record.body.quaternion.set(
      state.quaternion.x,
      state.quaternion.y,
      state.quaternion.z,
      state.quaternion.w,
    );
    record.body.aabbNeedsUpdate = true;
    record.body.updateAABB();
  }

  _setTelegraphIntensity(type, intensity) {
    const kinds = type === 'all' ? ['bridge', 'doors', 'cover'] : [type];
    if (kinds.includes('bridge')) this.materials.bridge.emissiveIntensity = 0.34 + intensity * 0.9;
    if (kinds.includes('doors')) this.materials.door.emissiveIntensity = 0.3 + intensity * 1.05;
    if (kinds.includes('cover')) this.materials.cover.emissiveIntensity = 0.07 + intensity * 0.7;
    if (intensity === 0) {
      this.materials.bridge.emissiveIntensity = 0.34;
      this.materials.door.emissiveIntensity = 0.3;
      this.materials.cover.emissiveIntensity = 0.07;
    }
  }

  _syncNavigationState() {
    const eastEnabled = this.shiftElements.bridge[0]?.state === 0;
    const westEnabled = this.shiftElements.bridge[1]?.state === 1;
    for (const edge of this.navigationEdges) {
      if (edge.kind === 'bridge-east') edge.enabled = eastEnabled;
      if (edge.kind === 'bridge-west') edge.enabled = westEnabled;
    }
  }

  /**
   * Returns the actual horizontal play area inside the visible boundary.
   * Consumers should use this instead of assuming that every map is circular.
   */
  getMovementBounds(margin = 1.25) {
    const safeMargin = Math.max(0, Number(margin) || 0);
    const foundation = this.mapConfig.foundation;
    if (foundation.shape === 'box') {
      const halfWidth = foundation.size[0] * 0.5;
      const halfDepth = foundation.size[2] * 0.5;
      return {
        shape: 'box',
        minX: -Math.max(0, halfWidth - safeMargin),
        maxX: Math.max(0, halfWidth - safeMargin),
        minZ: -Math.max(0, halfDepth - safeMargin),
        maxZ: Math.max(0, halfDepth - safeMargin),
      };
    }

    const boundary = foundation.boundary;
    const visibleInnerRadius = boundary?.count > 0
      ? boundary.radius - (boundary.size?.[2] ?? 0) * 0.5
      : foundation.radius - 1;
    return {
      shape: 'disc',
      centerX: 0,
      centerZ: 0,
      radius: Math.max(0, visibleInnerRadius - safeMargin),
    };
  }

  /**
   * Finds the highest traversable physics surface below/near a position.
   * The bounded window prevents ground-following actors from snapping onto a
   * gantry several metres above their current route.
   */
  getSurfaceHeight(position, options = {}) {
    if (!this.world) return null;
    const point = asThreeVector(position);
    const currentY = Number.isFinite(options.currentY) ? options.currentY : point.y;
    const defaultAbove = Math.max(2, this.mapConfig.bounds.maxY - currentY + 2);
    const defaultBelow = Math.max(2, currentY - this.mapConfig.bounds.minY + 2);
    const above = Math.max(0, Number.isFinite(options.above) ? options.above : defaultAbove);
    const below = Math.max(0, Number.isFinite(options.below) ? options.below : defaultBelow);
    const from = new CANNON.Vec3(point.x, currentY + above, point.z);
    const to = new CANNON.Vec3(point.x, currentY - below, point.z);
    let surfaceY = -Infinity;

    this.world.raycastAll(
      from,
      to,
      {
        skipBackfaces: false,
        collisionFilterMask: ARENA_COLLISION_GROUP,
        collisionFilterGroup: -1,
        checkCollisionResponse: true,
      },
      (result) => {
        if (!result.body?.userData?.arenaSurface) return;
        const hitY = result.hitPointWorld.y;
        if (hitY <= from.y + 1e-4 && hitY >= to.y - 1e-4) surfaceY = Math.max(surfaceY, hitY);
      },
    );
    return Number.isFinite(surfaceY) ? surfaceY : null;
  }

  getSafePlayerSpawn() {
    if (!this.spawnPoints.length) return new THREE.Vector3(0, 1.05, 35);
    return this.spawnPoints[0].clone();
  }

  getEnemySpawn(playerPosition, cameraForward) {
    if (!this.enemySpawnPoints.length) return new THREE.Vector3(0, 0.05, -35);
    const player = asThreeVector(playerPosition);
    const forward = asThreeVector(cameraForward, new THREE.Vector3(0, 0, -1)).setY(0).normalize();
    const candidates = this.enemySpawnPoints.map((position, index) => {
      const toSpawn = position.clone().sub(player);
      const distanceSq = toSpawn.lengthSq();
      const viewDot = toSpawn.setY(0).normalize().dot(forward);
      const visible = distanceSq < 48 * 48 && this.hasLineOfSight(
        player.clone().add(new THREE.Vector3(0, 0.45, 0)),
        position.clone().add(new THREE.Vector3(0, 0.65, 0)),
      );
      return { position, index, distanceSq, viewDot, visible };
    }).filter((candidate) => candidate.distanceSq > 15 * 15);

    candidates.sort((a, b) => {
      const scoreA = (a.visible ? -1000 : 0) - a.viewDot * 140 + Math.min(a.distanceSq, 3600) * 0.08;
      const scoreB = (b.visible ? -1000 : 0) - b.viewDot * 140 + Math.min(b.distanceSq, 3600) * 0.08;
      return scoreB - scoreA;
    });
    const topCount = Math.min(4, candidates.length);
    const chosen = candidates[this._spawnCursor % Math.max(1, topCount)] ?? { position: this.enemySpawnPoints[0] };
    this._spawnCursor += 1;
    return chosen.position.clone();
  }

  raycastWorld(origin, direction, maxDistance = 120, options = {}) {
    if (!this.world) return { hit: false, hasHit: false };
    if (typeof maxDistance === 'object') {
      options = maxDistance;
      maxDistance = options.maxDistance ?? 120;
    }
    const start = asThreeVector(origin);
    const rayDirection = asThreeVector(direction, new THREE.Vector3(0, 0, -1));
    if (rayDirection.lengthSq() < 1e-8) return { hit: false, hasHit: false };
    rayDirection.normalize();
    const end = start.clone().addScaledVector(rayDirection, Math.max(0, maxDistance));
    const result = new CANNON.RaycastResult();
    const hit = this.world.raycastClosest(
      new CANNON.Vec3(start.x, start.y, start.z),
      new CANNON.Vec3(end.x, end.y, end.z),
      {
        skipBackfaces: options.skipBackfaces ?? true,
        collisionFilterMask: options.collisionFilterMask ?? ARENA_COLLISION_GROUP,
        collisionFilterGroup: options.collisionFilterGroup ?? -1,
        checkCollisionResponse: options.checkCollisionResponse ?? true,
      },
      result,
    );
    if (!hit || !result.hasHit) return { hit: false, hasHit: false, distance: Infinity };
    return {
      hit: true,
      hasHit: true,
      distance: result.distance,
      point: new THREE.Vector3(result.hitPointWorld.x, result.hitPointWorld.y, result.hitPointWorld.z),
      normal: new THREE.Vector3(result.hitNormalWorld.x, result.hitNormalWorld.y, result.hitNormalWorld.z),
      body: result.body,
      shape: result.shape,
    };
  }

  hasLineOfSight(from, to) {
    const origin = asThreeVector(from);
    const destination = asThreeVector(to);
    const offset = destination.clone().sub(origin);
    const distance = offset.length();
    if (distance < 0.01) return true;
    const hit = this.raycastWorld(origin, offset, Math.max(0, distance - 0.12));
    return !hit.hit;
  }

  getNavigationTarget(from, to, mode = 'chase') {
    const origin = asThreeVector(from);
    const normalizedMode = String(mode).toLowerCase();
    let destination = asThreeVector(to);
    if (!to && normalizedMode === 'patrol' && this.waypoints.length) {
      const startIndex = this.waypoints.reduce((bestIndex, node, index) => (
        node.position.distanceToSquared(origin) < this.waypoints[bestIndex].position.distanceToSquared(origin)
          ? index
          : bestIndex
      ), 0);
      destination = this.waypoints[(startIndex + 4 + (this._spawnCursor++ % 5)) % this.waypoints.length].position.clone();
    }
    if (normalizedMode !== 'flank' && normalizedMode !== 'retreat'
      && this.hasLineOfSight(origin.clone().add(UP), destination.clone().add(UP))) {
      return destination;
    }

    const enabledNodes = this.waypoints.filter((node) => node.enabled);
    if (!enabledNodes.length) return destination;
    const nearest = (point) => enabledNodes.reduce((best, node) => (
      node.position.distanceToSquared(point) < best.position.distanceToSquared(point) ? node : best
    ), enabledNodes[0]);
    const start = nearest(origin);
    let goal = nearest(destination);

    if (normalizedMode === 'flank') {
      const approach = origin.clone().sub(destination).setY(0).normalize();
      const side = new THREE.Vector3(-approach.z, 0, approach.x);
      goal = enabledNodes
        .filter((node) => node.position.distanceTo(destination) > 7 && node.position.distanceTo(destination) < 22)
        .sort((a, b) => b.position.clone().sub(destination).normalize().dot(side)
          - a.position.clone().sub(destination).normalize().dot(side))[0] ?? goal;
    } else if (normalizedMode === 'retreat') {
      goal = enabledNodes
        .filter((node) => node.position.distanceTo(origin) < 24)
        .sort((a, b) => b.position.distanceToSquared(destination) - a.position.distanceToSquared(destination))[0] ?? goal;
    }

    const path = this._findPath(start.id, goal.id);
    if (path.length < 2) return goal.position.clone();
    const next = this.waypoints.find((node) => node.id === path[1]);
    return next?.position.clone() ?? goal.position.clone();
  }

  _findPath(startId, goalId) {
    if (startId === goalId) return [startId];
    const nodeMap = new Map(this.waypoints.map((node) => [node.id, node]));
    const adjacency = new Map(this.waypoints.map((node) => [node.id, []]));
    for (const edge of this.navigationEdges) {
      if (!edge.enabled || !nodeMap.get(edge.a)?.enabled || !nodeMap.get(edge.b)?.enabled) continue;
      adjacency.get(edge.a)?.push(edge.b);
      adjacency.get(edge.b)?.push(edge.a);
    }

    const open = new Set([startId]);
    const cameFrom = new Map();
    const g = new Map([[startId, 0]]);
    const f = new Map([[startId, nodeMap.get(startId).position.distanceTo(nodeMap.get(goalId).position)]]);
    while (open.size) {
      let current = null;
      for (const id of open) if (current == null || (f.get(id) ?? Infinity) < (f.get(current) ?? Infinity)) current = id;
      if (current === goalId) {
        const path = [current];
        while (cameFrom.has(current)) {
          current = cameFrom.get(current);
          path.unshift(current);
        }
        return path;
      }
      open.delete(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        const tentative = (g.get(current) ?? Infinity)
          + nodeMap.get(current).position.distanceTo(nodeMap.get(neighbor).position);
        if (tentative >= (g.get(neighbor) ?? Infinity)) continue;
        cameFrom.set(neighbor, current);
        g.set(neighbor, tentative);
        f.set(neighbor, tentative + nodeMap.get(neighbor).position.distanceTo(nodeMap.get(goalId).position));
        open.add(neighbor);
      }
    }
    return [startId];
  }

  getDebugData() {
    return {
      map: this.getMapInfo(),
      bounds: { ...this.mapConfig.bounds },
      rings: this.ringDefinitions?.map((ring) => ({ ...ring, material: undefined })) ?? [],
      colliderCount: this.staticBodies.length,
      colliders: this.staticBodies.map((body) => ({
        name: body.name,
        position: new THREE.Vector3(body.position.x, body.position.y, body.position.z),
        userData: { ...body.userData },
      })),
      playerSpawns: this.spawnPoints.map((point) => point.clone()),
      enemySpawns: this.enemySpawnPoints.map((point) => point.clone()),
      objectives: this.objectivePoints.map((point) => ({ ...point, position: point.position.clone() })),
      waypoints: this.waypoints.map((node) => ({ ...node, position: node.position.clone() })),
      edges: this.navigationEdges.map((edge) => ({ ...edge })),
      pendingShift: this._pendingShift ? { ...this._pendingShift } : null,
      shiftVersion: this._shiftVersion,
    };
  }

  reset() {
    if (!this._built) return;
    this._pendingShift = null;
    this._elapsed = 0;
    this._spawnCursor = 0;
    this._shiftVersion = 0;
    for (const records of Object.values(this.shiftElements)) {
      for (const record of records) this._setShiftRecordState(record, 0);
    }
    this._syncNavigationState();
    this._setTelegraphIntensity('all', 0);
    if (this.world) this.world.broadphase.dirty = true;
  }

  _removePhysicsBodies() {
    if (!this.world) return;
    for (const body of this.staticBodies) this.world.removeBody(body);
    this.staticBodies.length = 0;
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
    this._removePhysicsBodies();
    this.root.removeFromParent();
    const sharedGeometry = new Set(Object.values(this.geometries));
    const disposedGeometry = new Set();
    this.root.traverse((child) => {
      if (!child.geometry || sharedGeometry.has(child.geometry) || disposedGeometry.has(child.geometry)) return;
      disposedGeometry.add(child.geometry);
      child.geometry.dispose();
    });
    Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
    this._clearVisualChildren();
    this._resetCollections();
    this.world = null;
    this.scene = null;
  }
}

export default Arena;
