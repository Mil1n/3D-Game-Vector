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
  bounds: { radius: 60, minY: -1.1, maxY: 15 },
  foundation: {
    shape: 'disc', radius: 61, depth: 1.2, y: -1.7, glowRadius: 56.6,
    boundary: { count: 52, radius: 58.8, size: [7.2, 5.5, 0.9], y: 1.7 },
  },
  rings: [
    { radius: 12, width: 6, segments: 18, top: 0.05, material: 'floor' },
    { radius: 27, width: 7, segments: 30, top: 2.55, material: 'elevated' },
    { radius: 46, width: 8, segments: 40, top: 0.05, material: 'floor' },
  ],
  connections: [
    { id: 'ascent', count: 6, angleOffset: 0, radius: 19.25, y: 1.25, length: 9.2, rise: 2.5, width: 4.2, depth: 0.65, material: 'elevated' },
    { id: 'descent', count: 6, angleOffset: 0.5, radius: 36.25, y: 1.25, length: 12.2, rise: -2.5, width: 4.4, depth: 0.65, material: 'floor' },
  ],
  sectors: {
    count: 6,
    names: ['INGRESS', 'RELAY', 'FRACTURE', 'FOUNDRY', 'ARCHIVE', 'NULL'],
    radius: 35,
    pillarBands: [
      { radius: 20.5, size: [1.6, 5.4, 1.6], y: 2 },
      { radius: 38.5, size: [1.6, 5.4, 1.6], y: 2 },
      { radius: 53.5, size: [1.6, 7.5, 1.6], y: 2.75 },
    ],
    coverBands: [
      { radius: 48, angleOffset: -0.18, size: [4.2, 2.2, 1.1], y: 1.1 },
      { radius: 12.4, angleOffset: 0.16, size: [3.8, 1.6, 1.1], y: 0.8 },
      { radius: 48, angleOffset: 0.18, size: [4.2, 2.2, 1.1], y: 1.1 },
    ],
    beacon: { radius: 56.2, y: 2.2, scale: [0.14, 2.7, 0.14] },
  },
  geometryBoxes: [],
  central: {
    position: [0, 0],
    dais: { radius: 5.1, bottomRadius: 5.6, height: 1.1, y: 0.15 },
    core: { topRadius: 1.25, bottomRadius: 2.2, colliderRadius: 1.65, height: 14, y: 7.65 },
    halos: { count: 4, startRadius: 2.4, radiusStep: 0.55, startY: 3.5, yStep: 2.15 },
    objectives: [
      { angle: Math.PI / 6, radius: 9, y: 0.65 },
      { angle: Math.PI / 6 + Math.PI * 2 / 3, radius: 9, y: 0.65 },
      { angle: Math.PI / 6 + Math.PI * 4 / 3, radius: 9, y: 0.65 },
      { angle: Math.PI / 3, radius: 27, y: 3.15 },
      { angle: Math.PI * 4 / 3, radius: 46, y: 0.65 },
    ],
  },
  shifts: {
    bridges: {
      entries: [
        { angle: 0, radius: 19.25, activeY: 1.28, inactiveY: -4.2, size: [4.8, 0.62, 8.4], startActive: true },
        { angle: Math.PI, radius: 19.25, activeY: 1.28, inactiveY: -4.2, size: [4.8, 0.62, 8.4], startActive: false },
      ],
    },
    doors: { count: 4, angleOffset: 0.5, radius: 36.4, closedY: 2.1, openY: -3.2, size: [5.8, 4.1, 0.8] },
    cover: { count: 12, angleOffset: 0.26, radii: [42.5, 32], baseY: 1.05, elevatedEvery: 3, elevatedY: 3.55, tangentDistance: 4.8, size: [3.8, 2.1, 1.1] },
  },
  spawns: {
    player: [[0, 1.05, 46], [-39.8, 1.05, 23], [39.8, 1.05, -23]],
    enemyBands: [
      { radius: 27, y: 3.55, count: 8, angleOffset: Math.PI / 24 },
      { radius: 47, y: 1.05, count: 16, angleOffset: Math.PI / 24 },
    ],
  },
  navigation: {
    perRing: 12,
    rings: [{ radius: 12, y: 1.05 }, { radius: 27, y: 3.55 }, { radius: 46, y: 1.05 }],
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
  bounds: { radius: 58, minY: -1.1, maxY: 19 },
  foundation: {
    shape: 'disc', radius: 59, depth: 1.2, y: -1.7, glowRadius: 54.5,
    boundary: { count: 40, radius: 57, size: [9, 8.2, 1], y: 3.05 },
  },
  rings: [
    { radius: 10.5, width: 7, segments: 16, top: 0.05, material: 'floor' },
    { radius: 25, width: 6, segments: 25, top: 4.05, material: 'elevated', angleOffset: Math.PI / 25 },
    { radius: 43, width: 8, segments: 35, top: 7.05, material: 'elevated' },
  ],
  connections: [
    { id: 'forge-lifts', count: 5, angleOffset: 0, radius: 17.75, y: 2.05, length: 9.1, rise: 4, width: 4.8, depth: 0.7, material: 'bridge' },
    { id: 'zenith-ramps', count: 5, angleOffset: 0.5, radius: 34, y: 5.55, length: 12.5, rise: 3, width: 4.8, depth: 0.7, material: 'elevated' },
  ],
  sectors: {
    count: 5,
    names: ['CRUCIBLE', 'QUENCH', 'HAMMER', 'VENT', 'CROWN'],
    radius: 35,
    pillarBands: [
      { radius: 19, size: [1.8, 9.5, 1.8], y: 3.75 },
      { radius: 35, size: [2.2, 12, 2.2], y: 5.4 },
      { radius: 51.5, size: [1.8, 13, 1.8], y: 5.7 },
    ],
    coverBands: [
      { radius: 25.5, angleOffset: -0.24, size: [5.2, 3, 1.2], y: 5.55 },
      { radius: 43.5, angleOffset: 0.15, size: [5.8, 2.8, 1.25], y: 8.45 },
    ],
    beacon: { radius: 54.2, y: 5, scale: [0.18, 4.8, 0.18] },
  },
  geometryBoxes: [
    { name: 'SMELTER_NORTH', role: 'structure', size: [8, 10, 8], position: [0, 5, -32.5], material: 'structure', wall: true },
    { name: 'SMELTER_SOUTH_EAST', role: 'structure', size: [7, 8, 7], position: [28.5, 4, 19.5], material: 'structure', wall: true },
    { name: 'SMELTER_SOUTH_WEST', role: 'structure', size: [7, 8, 7], position: [-28.5, 4, 19.5], material: 'structure', wall: true },
  ],
  central: {
    position: [0, 0],
    dais: { radius: 4.6, bottomRadius: 5.8, height: 1.2, y: 0.2 },
    core: { topRadius: 1.8, bottomRadius: 2.7, colliderRadius: 2, height: 18, y: 9.7 },
    halos: { count: 5, startRadius: 2.8, radiusStep: 0.42, startY: 4.2, yStep: 2.5 },
    objectives: [
      { angle: 0, radius: 7.8, y: 0.65 },
      { angle: Math.PI * 2 / 5, radius: 25, y: 4.65 },
      { angle: Math.PI * 6 / 5, radius: 43, y: 7.65 },
      { angle: Math.PI * 4 / 5, radius: 25, y: 4.65 },
      { angle: Math.PI * 8 / 5, radius: 43, y: 7.65 },
    ],
  },
  shifts: {
    bridges: {
      entries: [
        { angle: 0, radius: 17.75, activeY: 2.05, inactiveY: -4.4, size: [5.2, 0.7, 8.6], startActive: true },
        { angle: Math.PI * 4 / 5, radius: 34, activeY: 5.6, inactiveY: -4.4, size: [5.2, 0.7, 10], startActive: false },
      ],
    },
    doors: { count: 5, angleOffset: 0, radius: 33.5, closedY: 6.1, openY: -4, size: [5.8, 4.8, 0.8] },
    cover: { count: 10, angleOffset: 0, radii: [43.5, 25], baseY: 5.1, elevatedEvery: 2, elevatedY: 8.15, tangentDistance: 6, size: [4.8, 2.5, 1.2] },
  },
  spawns: {
    player: [[0, 8.05, 43], [-40.9, 8.05, 13.3], [25.3, 8.05, -34.8]],
    enemyBands: [
      { radius: 25, y: 5.05, count: 10, angleOffset: 0.15 },
      { radius: 43, y: 8.05, count: 15, angleOffset: 0 },
    ],
  },
  navigation: {
    perRing: 10,
    rings: [{ radius: 10.5, y: 1.05 }, { radius: 25, y: 5.05 }, { radius: 43, y: 8.05 }],
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
  bounds: { radius: 70, minY: 0, maxY: 12 },
  foundation: {
    shape: 'box', size: [124, 1.2, 100], depth: 1.2, y: -0.6, glowRadius: 0,
    boundary: { count: 0, radius: 0, size: [0, 0, 0], y: 0 },
  },
  rings: [],
  connections: [],
  sectors: {
    count: 4,
    names: ['DEPOT', 'BREACH', 'STACKS', 'GANTRY'],
    radius: 40,
    pillarBands: [],
    coverBands: [
      { radius: 31, angleOffset: -0.35, size: [6.2, 2.4, 1.3], y: 1.2 },
      { radius: 45, angleOffset: 0.2, size: [5.2, 3.4, 1.4], y: 1.7 },
    ],
    beacon: { radius: 53, y: 2.4, scale: [0.18, 3.2, 0.18] },
  },
  geometryBoxes: [
    { name: 'NORTH_WALL', role: 'boundary', size: [124, 6, 1], position: [0, 3, -50], material: 'structure', wall: true },
    { name: 'SOUTH_WALL', role: 'boundary', size: [124, 6, 1], position: [0, 3, 50], material: 'structure', wall: true },
    { name: 'WEST_WALL', role: 'boundary', size: [1, 6, 100], position: [-62, 3, 0], material: 'structure', wall: true },
    { name: 'EAST_WALL', role: 'boundary', size: [1, 6, 100], position: [62, 3, 0], material: 'structure', wall: true },
    { name: 'CARGO_A', role: 'cover', size: [17, 4.5, 5.5], position: [-39, 2.25, -27], material: 'cover', wall: true },
    { name: 'CARGO_B', role: 'cover', size: [19, 5.5, 5.5], position: [36, 2.75, -25], material: 'cover', wall: true },
    { name: 'CARGO_C', role: 'cover', size: [20, 3.5, 5.5], position: [-35, 1.75, 27], material: 'cover', wall: true },
    { name: 'CARGO_D', role: 'cover', size: [16, 6, 5.5], position: [41, 3, 28], material: 'cover', wall: true },
    { name: 'DIVIDER_WEST', role: 'structure', size: [2, 3.2, 23], position: [-16, 1.6, -9], material: 'structure', wall: true },
    { name: 'DIVIDER_EAST', role: 'structure', size: [2, 3.2, 23], position: [16, 1.6, 9], material: 'structure', wall: true },
    { name: 'GANTRY_NORTH', role: 'surface', size: [24, 1, 5], position: [0, 4.5, -34], material: 'elevated', surface: true },
    { name: 'GANTRY_SOUTH', role: 'surface', size: [24, 1, 5], position: [0, 4.5, 34], material: 'elevated', surface: true },
    { name: 'GANTRY_NW_SUPPORT', role: 'support', size: [2, 4, 2], position: [-9, 2, -34], material: 'structure', wall: true },
    { name: 'GANTRY_NE_SUPPORT', role: 'support', size: [2, 4, 2], position: [9, 2, -34], material: 'structure', wall: true },
    { name: 'GANTRY_SW_SUPPORT', role: 'support', size: [2, 4, 2], position: [-9, 2, 34], material: 'structure', wall: true },
    { name: 'GANTRY_SE_SUPPORT', role: 'support', size: [2, 4, 2], position: [9, 2, 34], material: 'structure', wall: true },
    { name: 'GANTRY_NORTH_RAMP', role: 'surface', size: [4.5, 0.7, 10.1], position: [0, 2.25, -27.2], rotation: [0.464, 0, 0], material: 'bridge', surface: true },
    { name: 'GANTRY_SOUTH_RAMP', role: 'surface', size: [4.5, 0.7, 10.1], position: [0, 2.25, 27.2], rotation: [-0.464, 0, 0], material: 'bridge', surface: true },
  ],
  central: {
    position: [0, 0],
    dais: { radius: 4.2, bottomRadius: 5, height: 0.9, y: 0.45 },
    core: { topRadius: 1, bottomRadius: 1.8, colliderRadius: 1.4, height: 9, y: 4.95 },
    halos: { count: 3, startRadius: 2, radiusStep: 0.65, startY: 3.2, yStep: 1.7 },
    objectives: [
      { position: [-48, 0.6, 36], y: 0.6 },
      { position: [48, 0.6, -36], y: 0.6 },
      { position: [0, 0.6, 0], y: 0.6 },
      { position: [-48, 0.6, -36], y: 0.6 },
      { position: [48, 0.6, 36], y: 0.6 },
    ],
  },
  shifts: {
    bridges: {
      entries: [
        { position: [-23, 0.35, 0], rotationY: Math.PI / 2, activeY: 0.35, inactiveY: -4.2, size: [5.5, 0.7, 13], startActive: true },
        { position: [23, 0.35, 0], rotationY: Math.PI / 2, activeY: 0.35, inactiveY: -4.2, size: [5.5, 0.7, 13], startActive: false },
      ],
    },
    doors: { count: 4, angleOffset: 0, radius: 20, closedY: 2.4, openY: -3.2, size: [7, 4.8, 0.8] },
    cover: { count: 12, angleOffset: 0.22, radii: [41, 27], baseY: 1.2, elevatedEvery: 99, elevatedY: 1.2, tangentDistance: 7, size: [5.5, 2.4, 1.25] },
  },
  spawns: {
    player: [[-54, 1.05, 42], [54, 1.05, -42], [-54, 1.05, -42]],
    enemyPoints: [
      [-52, 1.05, -40], [-35, 1.05, -40], [-18, 1.05, -40], [18, 1.05, -40], [35, 1.05, -40], [52, 1.05, -40],
      [-52, 1.05, 40], [-35, 1.05, 40], [-18, 1.05, 40], [18, 1.05, 40], [35, 1.05, 40], [52, 1.05, 40],
      [-52, 1.05, -24], [-52, 1.05, -8], [-52, 1.05, 8], [-52, 1.05, 24],
      [52, 1.05, -24], [52, 1.05, -8], [52, 1.05, 8], [52, 1.05, 24],
      [-27, 1.05, -14], [27, 1.05, -14], [-27, 1.05, 14], [27, 1.05, 14],
    ],
    enemyBands: [],
  },
  navigation: {
    nodes: [
      { id: 'nw', position: [-52, 1.05, -39] }, { id: 'n1', position: [-18, 1.05, -39] },
      { id: 'n2', position: [18, 1.05, -39] }, { id: 'ne', position: [52, 1.05, -39] },
      { id: 'w1', position: [-52, 1.05, -13] }, { id: 'c1', position: [-18, 1.05, -13] },
      { id: 'c2', position: [18, 1.05, -13] }, { id: 'e1', position: [52, 1.05, -13] },
      { id: 'w2', position: [-52, 1.05, 13] }, { id: 'c3', position: [-18, 1.05, 13] },
      { id: 'c4', position: [18, 1.05, 13] }, { id: 'e2', position: [52, 1.05, 13] },
      { id: 'sw', position: [-52, 1.05, 39] }, { id: 's1', position: [-18, 1.05, 39] },
      { id: 's2', position: [18, 1.05, 39] }, { id: 'se', position: [52, 1.05, 39] },
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
