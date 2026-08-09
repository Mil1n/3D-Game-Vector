const deepFreeze = (value) => {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
};

const NULL_PALETTE = {
  foundation: 0x283747,
  floor: 0x526a7b,
  elevated: 0x718196,
  trim: 0x3d9ba5,
  trimEmissive: 0x087984,
  structure: 0x455469,
  cover: 0x6c637c,
  coverEmissive: 0x5f176f,
  bridge: 0x4f858b,
  bridgeEmissive: 0x0d9097,
  door: 0x896c43,
  doorEmissive: 0xb45c10,
  spire: 0x5c526f,
  spireEmissive: 0x5d20a0,
  objective: 0x987b3e,
  objectiveEmissive: 0xd98112,
  hologram: 0x43e7ed,
  hologramEmissive: 0x19d8e2,
};

const NULL_LATTICE = {
  id: 'null-grid',
  name: 'Нулевая решётка',
  shortName: 'РЕШЁТКА',
  description: 'Трёхкольцевой фазовый полигон с симметричными маршрутами.',
  palette: NULL_PALETTE,
  bounds: { radius: 46, minY: -1.1, maxY: 15 },
  foundation: {
    shape: 'disc', radius: 47, depth: 1.2, y: -1.7, glowRadius: 43.5,
    boundary: { count: 40, radius: 45.2, size: [7.2, 5.5, 0.8], y: 1.7 },
  },
  rings: [
    { radius: 10, width: 5, segments: 16, top: 0.05, material: 'floor' },
    { radius: 21, width: 5.5, segments: 24, top: 2.55, material: 'elevated' },
    { radius: 35, width: 6.5, segments: 32, top: 0.05, material: 'floor' },
  ],
  connections: [
    { id: 'ascent', count: 6, angleOffset: 0, radius: 15.5, y: 1.25, length: 7.2, rise: 2.5, width: 3.6, depth: 0.65, material: 'elevated' },
    { id: 'descent', count: 6, angleOffset: 0.5, radius: 28, y: 1.25, length: 9, rise: -2.5, width: 3.8, depth: 0.65, material: 'floor' },
  ],
  sectors: {
    count: 6,
    names: ['INGRESS', 'RELAY', 'FRACTURE', 'FOUNDRY', 'ARCHIVE', 'NULL'],
    radius: 27,
    pillarBands: [
      { radius: 16.5, size: [1.4, 5.4, 1.4], y: 2 },
      { radius: 30.5, size: [1.4, 5.4, 1.4], y: 2 },
      { radius: 40.5, size: [1.4, 7.5, 1.4], y: 2.75 },
    ],
    coverBands: [
      { radius: 37, angleOffset: -0.22, size: [3.4, 2.2, 1.05], y: 1.1 },
      { radius: 12.3, angleOffset: 0, size: [3.4, 1.6, 1.05], y: 0.8 },
      { radius: 37, angleOffset: 0.22, size: [3.4, 2.2, 1.05], y: 1.1 },
    ],
    beacon: { radius: 42.4, y: 2.2, scale: [0.14, 2.7, 0.14] },
  },
  geometryBoxes: [],
  central: {
    position: [0, 0],
    dais: { radius: 5.1, bottomRadius: 5.6, height: 1.1, y: 0.15 },
    core: { topRadius: 1.25, bottomRadius: 2.2, colliderRadius: 1.65, height: 14, y: 7.65 },
    halos: { count: 4, startRadius: 2.4, radiusStep: 0.55, startY: 3.5, yStep: 2.15 },
    objectives: [
      { angle: Math.PI / 6, radius: 7.7, y: 0.65 },
      { angle: Math.PI / 6 + Math.PI * 2 / 3, radius: 7.7, y: 0.65 },
      { angle: Math.PI / 6 + Math.PI * 4 / 3, radius: 7.7, y: 0.65 },
      { angle: Math.PI / 3, radius: 21, y: 3.15 },
      { angle: Math.PI * 4 / 3, radius: 35, y: 0.65 },
    ],
  },
  shifts: {
    bridges: {
      entries: [
        { angle: 0, radius: 15.5, activeY: 1.28, inactiveY: -4.2, size: [4.4, 0.62, 6.4], startActive: true },
        { angle: Math.PI, radius: 15.5, activeY: 1.28, inactiveY: -4.2, size: [4.4, 0.62, 6.4], startActive: false },
      ],
    },
    doors: { count: 4, angleOffset: 0.5, radius: 28.2, closedY: 2.1, openY: 6.6, size: [5.2, 4.1, 0.7] },
    cover: { count: 12, angleOffset: 0.12, radii: [32, 24.5], baseY: 1.05, elevatedEvery: 3, elevatedY: 3.55, tangentDistance: 3.8, size: [3.2, 2.1, 1.05] },
  },
  spawns: {
    player: [[0, 1.05, 35], [-30.3, 1.05, 17.5], [30.3, 1.05, -17.5]],
    enemyBands: [
      { radius: 21, y: 3.55, count: 6, angleOffset: Math.PI / 18 },
      { radius: 36, y: 1.05, count: 12, angleOffset: Math.PI / 18 },
    ],
  },
  navigation: {
    perRing: 12,
    rings: [{ radius: 10, y: 1.05 }, { radius: 21, y: 3.55 }, { radius: 35, y: 1.05 }],
    connectionStep: 2,
    bridgeIndices: [0, 6],
  },
};

const ZENITH_FORGE = {
  id: 'sky-foundry',
  name: 'Небесная литейная',
  shortName: 'ЗЕНИТ',
  description: 'Вертикальная литейная башня: пять лучей, три высоты и открытые прострелы.',
  palette: {
    ...NULL_PALETTE,
    foundation: 0x39352e,
    floor: 0x735c45,
    elevated: 0x9a8061,
    trim: 0xf3a73c,
    trimEmissive: 0xff6a00,
    structure: 0x554c43,
    cover: 0x6d5750,
    coverEmissive: 0x8f2819,
    bridge: 0x876d45,
    bridgeEmissive: 0xe77c16,
    door: 0x8d4532,
    doorEmissive: 0xff3d18,
    spire: 0x756148,
    spireEmissive: 0xff8c16,
    objective: 0x7d8d47,
    objectiveEmissive: 0xcfff2e,
    hologram: 0xffc45c,
    hologramEmissive: 0xff8c22,
  },
  bounds: { radius: 44, minY: -1.1, maxY: 19 },
  foundation: {
    shape: 'disc', radius: 45, depth: 1.2, y: -1.7, glowRadius: 41,
    boundary: { count: 30, radius: 43, size: [9.2, 8.2, 1], y: 3.05 },
  },
  rings: [
    { radius: 8.5, width: 6, segments: 15, top: 0.05, material: 'floor' },
    { radius: 19, width: 5, segments: 20, top: 4.05, material: 'elevated', angleOffset: Math.PI / 20 },
    { radius: 33, width: 7, segments: 25, top: 7.05, material: 'elevated' },
  ],
  connections: [
    { id: 'forge-lifts', count: 5, angleOffset: 0, radius: 13.8, y: 2.05, length: 8.4, rise: 4, width: 4.2, depth: 0.7, material: 'bridge' },
    { id: 'zenith-ramps', count: 5, angleOffset: 0.5, radius: 26, y: 5.55, length: 10.5, rise: 3, width: 4, depth: 0.7, material: 'elevated' },
  ],
  sectors: {
    count: 5,
    names: ['CRUCIBLE', 'QUENCH', 'HAMMER', 'VENT', 'CROWN'],
    radius: 27,
    pillarBands: [
      { radius: 14.8, size: [1.8, 9.5, 1.8], y: 3.75 },
      { radius: 27.5, size: [2.2, 12, 2.2], y: 5.4 },
      { radius: 39.5, size: [1.6, 13, 1.6], y: 5.7 },
    ],
    coverBands: [
      { radius: 20, angleOffset: -0.28, size: [4.6, 3, 1.2], y: 5.55 },
      { radius: 33, angleOffset: 0.18, size: [5.2, 2.8, 1.25], y: 8.45 },
    ],
    beacon: { radius: 40.2, y: 5, scale: [0.18, 4.8, 0.18] },
  },
  geometryBoxes: [
    { name: 'SMELTER_NORTH', size: [7, 10, 7], position: [0, 4, -25], material: 'structure', wall: true },
    { name: 'SMELTER_SOUTH_EAST', size: [6, 8, 6], position: [22, 3, 15], material: 'structure', wall: true },
    { name: 'SMELTER_SOUTH_WEST', size: [6, 8, 6], position: [-22, 3, 15], material: 'structure', wall: true },
  ],
  central: {
    position: [0, 0],
    dais: { radius: 4.6, bottomRadius: 5.8, height: 1.2, y: 0.2 },
    core: { topRadius: 1.8, bottomRadius: 2.7, colliderRadius: 2, height: 18, y: 9.7 },
    halos: { count: 5, startRadius: 2.8, radiusStep: 0.42, startY: 4.2, yStep: 2.5 },
    objectives: [
      { angle: 0, radius: 6.7, y: 0.65 },
      { angle: Math.PI * 2 / 5, radius: 19, y: 4.65 },
      { angle: Math.PI * 6 / 5, radius: 33, y: 7.65 },
      { angle: Math.PI * 4 / 5, radius: 19, y: 4.65 },
      { angle: Math.PI * 8 / 5, radius: 33, y: 7.65 },
    ],
  },
  shifts: {
    bridges: {
      entries: [
        { angle: 0, radius: 13.8, activeY: 2.05, inactiveY: -4.4, size: [4.5, 0.7, 7], startActive: true },
        { angle: Math.PI * 4 / 5, radius: 25.8, activeY: 5.6, inactiveY: -4.4, size: [4.2, 0.7, 8], startActive: false },
      ],
    },
    doors: { count: 5, angleOffset: 0, radius: 25.5, closedY: 6.1, openY: 12.8, size: [5, 4.8, 0.8] },
    cover: { count: 10, angleOffset: 0.22, radii: [31.5, 18.5], baseY: 5.1, elevatedEvery: 2, elevatedY: 8.15, tangentDistance: 4.8, size: [4.2, 2.5, 1.2] },
  },
  spawns: {
    player: [[0, 8.05, 33], [-31.4, 8.05, 10.2], [19.4, 8.05, -26.7]],
    enemyBands: [
      { radius: 19, y: 5.05, count: 10, angleOffset: 0.15 },
      { radius: 33, y: 8.05, count: 10, angleOffset: 0 },
    ],
  },
  navigation: {
    perRing: 10,
    rings: [{ radius: 8.5, y: 1.05 }, { radius: 19, y: 5.05 }, { radius: 33, y: 8.05 }],
    connectionStep: 2,
    bridgeIndices: [0, 4],
  },
};

const FRACTURE_YARD = {
  id: 'sunken-relay',
  name: 'Затонувший ретранслятор',
  shortName: 'РЕТРАНСЛЯТОР',
  description: 'Прямоугольный грузовой двор с длинными линиями огня и тесными контейнерными проходами.',
  palette: {
    ...NULL_PALETTE,
    foundation: 0x30413d,
    floor: 0x536f67,
    elevated: 0x6f8d80,
    trim: 0x6fe9b2,
    trimEmissive: 0x18b978,
    structure: 0x405b59,
    cover: 0x59666f,
    coverEmissive: 0x244975,
    bridge: 0x3c8a75,
    bridgeEmissive: 0x27e1a0,
    door: 0x687aa0,
    doorEmissive: 0x4d6fff,
    spire: 0x506775,
    spireEmissive: 0x24a8d9,
    objective: 0x7c925c,
    objectiveEmissive: 0xa9f14a,
    hologram: 0x6dffe0,
    hologramEmissive: 0x21e8b6,
  },
  bounds: { radius: 54, minY: 0, maxY: 12 },
  foundation: {
    shape: 'box', size: [96, 1.2, 76], depth: 1.2, y: -0.6, glowRadius: 0,
    boundary: { count: 0, radius: 0, size: [0, 0, 0], y: 0 },
  },
  rings: [],
  connections: [],
  sectors: {
    count: 4,
    names: ['DEPOT', 'BREACH', 'STACKS', 'GANTRY'],
    radius: 31,
    pillarBands: [],
    coverBands: [
      { radius: 24, angleOffset: -0.35, size: [5.5, 2.4, 1.3], y: 1.2 },
      { radius: 35, angleOffset: 0.2, size: [4.2, 3.4, 1.4], y: 1.7 },
    ],
    beacon: { radius: 41, y: 2.4, scale: [0.18, 3.2, 0.18] },
  },
  geometryBoxes: [
    { name: 'NORTH_WALL', size: [96, 6, 1], position: [0, 3, -38], material: 'structure', wall: true },
    { name: 'SOUTH_WALL', size: [96, 6, 1], position: [0, 3, 38], material: 'structure', wall: true },
    { name: 'WEST_WALL', size: [1, 6, 76], position: [-48, 3, 0], material: 'structure', wall: true },
    { name: 'EAST_WALL', size: [1, 6, 76], position: [48, 3, 0], material: 'structure', wall: true },
    { name: 'CARGO_A', size: [13, 4.5, 5], position: [-28, 2.25, -20], rotationY: 0.08, material: 'cover', wall: true },
    { name: 'CARGO_B', size: [15, 5.5, 5], position: [25, 2.75, -18], rotationY: -0.1, material: 'cover', wall: true },
    { name: 'CARGO_C', size: [16, 3.5, 5], position: [-25, 1.75, 19], rotationY: -0.05, material: 'cover', wall: true },
    { name: 'CARGO_D', size: [12, 6, 5], position: [29, 3, 20], rotationY: 0.12, material: 'cover', wall: true },
    { name: 'DIVIDER_WEST', size: [2, 3.2, 18], position: [-12, 1.6, -7], material: 'structure', wall: true },
    { name: 'DIVIDER_EAST', size: [2, 3.2, 18], position: [12, 1.6, 7], material: 'structure', wall: true },
    { name: 'GANTRY_NORTH', size: [18, 1, 4], position: [0, 4.5, -25], material: 'elevated', surface: true },
    { name: 'GANTRY_SOUTH', size: [18, 1, 4], position: [0, 4.5, 25], material: 'elevated', surface: true },
  ],
  central: {
    position: [0, 0],
    dais: { radius: 4.2, bottomRadius: 5, height: 0.9, y: 0.45 },
    core: { topRadius: 1, bottomRadius: 1.8, colliderRadius: 1.4, height: 9, y: 4.95 },
    halos: { count: 3, startRadius: 2, radiusStep: 0.65, startY: 3.2, yStep: 1.7 },
    objectives: [
      { position: [-34, 0.6, 26], y: 0.6 },
      { position: [35, 0.6, -25], y: 0.6 },
      { position: [0, 0.6, 0], y: 0.6 },
      { position: [-34, 0.6, -27], y: 0.6 },
      { position: [35, 0.6, 26], y: 0.6 },
    ],
  },
  shifts: {
    bridges: {
      entries: [
        { position: [-18, 0.35, 0], rotationY: Math.PI / 2, activeY: 0.35, inactiveY: -4.2, size: [5, 0.7, 10], startActive: true },
        { position: [18, 0.35, 0], rotationY: Math.PI / 2, activeY: 0.35, inactiveY: -4.2, size: [5, 0.7, 10], startActive: false },
      ],
    },
    doors: { count: 4, angleOffset: 0, radius: 15.5, closedY: 2.4, openY: 7.6, size: [6.2, 4.8, 0.8] },
    cover: { count: 14, angleOffset: 0.08, radii: [30, 20], baseY: 1.2, elevatedEvery: 99, elevatedY: 1.2, tangentDistance: 5.6, size: [4.8, 2.4, 1.25] },
  },
  spawns: {
    player: [[-41, 1.05, 30], [41, 1.05, -30], [-41, 1.05, -30]],
    enemyBands: [
      { radius: 25, y: 1.05, count: 12, angleOffset: 0.1 },
      { radius: 42, y: 1.05, count: 12, angleOffset: 0.22 },
    ],
  },
  navigation: {
    nodes: [
      { id: 'nw', position: [-38, 1.05, -29] }, { id: 'n1', position: [-14, 1.05, -29] },
      { id: 'n2', position: [14, 1.05, -29] }, { id: 'ne', position: [38, 1.05, -29] },
      { id: 'w1', position: [-38, 1.05, -10] }, { id: 'c1', position: [-14, 1.05, -10] },
      { id: 'c2', position: [14, 1.05, -10] }, { id: 'e1', position: [38, 1.05, -10] },
      { id: 'w2', position: [-38, 1.05, 10] }, { id: 'c3', position: [-14, 1.05, 10] },
      { id: 'c4', position: [14, 1.05, 10] }, { id: 'e2', position: [38, 1.05, 10] },
      { id: 'sw', position: [-38, 1.05, 29] }, { id: 's1', position: [-14, 1.05, 29] },
      { id: 's2', position: [14, 1.05, 29] }, { id: 'se', position: [38, 1.05, 29] },
    ],
    edges: [
      ['nw', 'n1'], ['n1', 'n2', 'bridge-east'], ['n2', 'ne'],
      ['w1', 'c1'], ['c1', 'c2'], ['c2', 'e1'],
      ['w2', 'c3'], ['c3', 'c4'], ['c4', 'e2'],
      ['sw', 's1'], ['s1', 's2', 'bridge-west'], ['s2', 'se'],
      ['nw', 'w1'], ['w1', 'w2'], ['w2', 'sw'],
      ['n1', 'c1'], ['c1', 'c3'], ['c3', 's1'],
      ['n2', 'c2'], ['c2', 'c4'], ['c4', 's2'],
      ['ne', 'e1'], ['e1', 'e2'], ['e2', 'se'],
    ],
  },
};

export const DEFAULT_MAP_ID = NULL_LATTICE.id;

export const MAP_CONFIGS = deepFreeze({
  [NULL_LATTICE.id]: NULL_LATTICE,
  [ZENITH_FORGE.id]: ZENITH_FORGE,
  [FRACTURE_YARD.id]: FRACTURE_YARD,
});

export const MAP_ORDER = deepFreeze([
  NULL_LATTICE.id,
  ZENITH_FORGE.id,
  FRACTURE_YARD.id,
]);

export const MAP_ALIASES = deepFreeze({
  'null-lattice': 'null-grid',
  'zenith-forge': 'sky-foundry',
  'fracture-yard': 'sunken-relay',
});

export function resolveMapId(map = DEFAULT_MAP_ID) {
  const requested = typeof map === 'string' ? map : map?.id;
  const id = MAP_ALIASES[requested] ?? requested;
  return MAP_CONFIGS[id] ? id : DEFAULT_MAP_ID;
}

export function resolveMapConfig(map = DEFAULT_MAP_ID) {
  if (map && typeof map === 'object' && map.id && MAP_CONFIGS[map.id] === map) return map;
  return MAP_CONFIGS[resolveMapId(map)];
}

export default MAP_CONFIGS;
