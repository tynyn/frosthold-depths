// overworld.js
// WHAT: procedural first-person overworld — terrain via value-noise, biomes,
// per-edge passability (WATER/MOUNTAIN edges walled, identical dungeon
// model), random encounters, and well-spaced town gates / dungeon mouths.
// WHY: reuses the exact same GridMap + movement model as town/dungeon; only
// the generator and tileset/encounter policy are overworld-specific.

import { GridMap, floodFillReachable } from './gridmap.js';
import {
  DIRS, MAP_KIND, OVERWORLD_SIZE, OVERWORLD_NOISE_SCALE, OVERWORLD_MOISTURE_SCALE,
  OVERWORLD_TOWN_GATES, OVERWORLD_DUNGEON_MOUTHS, OVERWORLD_MIN_FEATURE_SPACING,
  BIOME_DANGER, OVERWORLD_SIGNPOST_MESSAGES, OVERWORLD_SHRINE_BUFF,
  OVERWORLD_CACHE_GOLD, OVERWORLD_OASIS_HEAL_FRACTION,
} from './data.js';

// WHAT: smooth 2D value noise — a coarse lattice of random values bilinearly
// interpolated up to full resolution. WHY: gives continuous elevation /
// moisture fields from the seeded RNG without any external noise library.
function valueNoise(width, height, rng, scale) {
  const cellSize = Math.max(2, Math.round(1 / scale));
  const gw = Math.ceil(width / cellSize) + 2;
  const gh = Math.ceil(height / cellSize) + 2;
  const lattice = Array.from({ length: gh }, () => Array.from({ length: gw }, () => rng.next()));
  const lerp = (a, b, t) => a + (b - a) * t;
  const out = Array.from({ length: height }, () => new Array(width).fill(0));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = x / cellSize, gy = y / cellSize;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = gx - x0, ty = gy - y0;
      const top = lerp(lattice[y0][x0], lattice[y0][x0 + 1], tx);
      const bot = lerp(lattice[y0 + 1][x0], lattice[y0 + 1][x0 + 1], tx);
      out[y][x] = lerp(top, bot, ty);
    }
  }
  return out;
}

function biomeFor(elevation, moisture) {
  if (elevation < 0.30) return 'WATER';
  if (elevation > 0.82) return 'MOUNTAIN';
  if (elevation > 0.62) return 'HILLS';
  if (moisture < 0.25) return 'DESERT';
  if (moisture < 0.55) return 'PLAINS';
  if (moisture < 0.75) return 'FOREST';
  return 'SWAMP';
}

const BLOCKING_BIOMES = new Set(['WATER', 'MOUNTAIN']);

function key(x, y) { return `${x},${y}`; }

// WHAT: place `count` features on already-reachable walkable cells, spaced
// at least `minSpacing` apart. WHY: placing only from the reachable set
// makes "every gate/mouth is reachable" true by construction, not by luck.
function placeFeatures(rng, candidates, count, minSpacing, taken) {
  const placed = [];
  let attempts = 0;
  while (placed.length < count && attempts < candidates.length * 4) {
    attempts++;
    const [x, y] = rng.choice(candidates);
    const k = key(x, y);
    if (taken.has(k)) continue;
    const farEnough = placed.every((p) => Math.abs(p[0] - x) + Math.abs(p[1] - y) >= minSpacing)
      && [...taken].every((tk) => { const [tx, ty] = tk.split(',').map(Number); return Math.abs(tx - x) + Math.abs(ty - y) >= minSpacing; });
    if (!farEnough) continue;
    placed.push([x, y]);
    taken.add(k);
  }
  return placed;
}

export function generateOverworld(rng, name = 'Wilderness') {
  const size = OVERWORLD_SIZE;
  const map = new GridMap(size, size, MAP_KIND.OVERWORLD, name);

  const elevationNoise = valueNoise(size, size, rng.fork(1), OVERWORLD_NOISE_SCALE);
  const moistureNoise = valueNoise(size, size, rng.fork(2), OVERWORLD_MOISTURE_SCALE);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      map.cellAt(x, y).terrain = biomeFor(elevationNoise[y][x], moistureNoise[y][x]);
    }
  }

  // Passability: WALL any edge touching a WATER or MOUNTAIN cell; OPEN
  // otherwise. Identical dungeon movement model — no terrain-glide.
  const DELTA2 = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = map.cellAt(x, y);
      for (const dir of DIRS) {
        const [dx, dy] = DELTA2[dir];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const neighbor = map.cellAt(nx, ny);
        const blocked = BLOCKING_BIOMES.has(cell.terrain) || BLOCKING_BIOMES.has(neighbor.terrain);
        map.setEdge(x, y, dir, blocked ? 'WALL' : 'OPEN');
      }
    }
  }

  // find a walkable starting cell near the center
  let start = null;
  for (let r = 0; r < size && !start; r++) {
    for (let dy = -r; dy <= r && !start; dy++) {
      for (let dx = -r; dx <= r && !start; dx++) {
        const x = Math.floor(size / 2) + dx, y = Math.floor(size / 2) + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (!BLOCKING_BIOMES.has(map.cellAt(x, y).terrain)) start = { x, y };
      }
    }
  }
  map.entry = { x: start.x, y: start.y, facing: 'N' };

  const reachable = floodFillReachable(map, start.x, start.y);
  const candidates = [...reachable].map((k) => k.split(',').map(Number))
    .filter(([x, y]) => !(x === start.x && y === start.y));

  const taken = new Set([key(start.x, start.y)]);
  const townCount = rng.int(OVERWORLD_TOWN_GATES[0], OVERWORLD_TOWN_GATES[1]);
  const mouthCount = rng.int(OVERWORLD_DUNGEON_MOUTHS[0], OVERWORLD_DUNGEON_MOUTHS[1]);

  const townGates = placeFeatures(rng, candidates, townCount, OVERWORLD_MIN_FEATURE_SPACING, taken)
    .map((pos, i) => ({ x: pos[0], y: pos[1], townId: i }));
  const dungeonMouths = placeFeatures(rng, candidates, mouthCount, OVERWORLD_MIN_FEATURE_SPACING, taken)
    .map((pos, i) => ({ x: pos[0], y: pos[1], mouthId: i }));

  for (const g of townGates) map.cellAt(g.x, g.y).special = { type: 'TOWN_GATE', payload: { townId: g.townId } };
  for (const m of dungeonMouths) map.cellAt(m.x, m.y).special = { type: 'DUNGEON_MOUTH', payload: { mouthId: m.mouthId } };

  const extraCount = Math.min(candidates.length - taken.size, 6);
  const extras = placeFeatures(rng, candidates, extraCount, OVERWORLD_MIN_FEATURE_SPACING, taken);
  const specialTypes = ['SIGNPOST', 'SIGNPOST', 'SHRINE', 'CACHE', 'CACHE', 'OASIS'];
  extras.forEach(([x, y], i) => {
    const type = specialTypes[i % specialTypes.length];
    const cell = map.cellAt(x, y);
    if (type === 'SIGNPOST') cell.special = { type, payload: { text: rng.choice(OVERWORLD_SIGNPOST_MESSAGES) } };
    else if (type === 'SHRINE') cell.special = { type, payload: { ...OVERWORLD_SHRINE_BUFF, used: false } };
    else if (type === 'CACHE') cell.special = { type, payload: { gold: rng.int(OVERWORLD_CACHE_GOLD[0], OVERWORLD_CACHE_GOLD[1]), used: false } };
    else if (type === 'OASIS') cell.special = { type, payload: { fraction: OVERWORLD_OASIS_HEAL_FRACTION, used: false } };
  });

  return { map, start, townGates, dungeonMouths };
}

// WHAT: per-biome random-encounter chance for the current step.
export function encounterChanceForCell(map, x, y) {
  const biome = map.cellAt(x, y).terrain;
  return BIOME_DANGER[biome] || 0;
}
