// dungeon.js
// WHAT: procedural dungeon generator (recursive-backtracker maze + braid +
// rooms + doors/secrets + stairs) plus the deepest-level forced-boss room.
// WHY: single generator reused for every depth; the boss level differs only
// in reserving one sealed room with exactly one entrance (the trigger zone).

import { GridMap, tryMove, floodFillReachable } from './gridmap.js';
import {
  DIRS, DELTA, EDGE, MAP_KIND,
  DUNGEON_SIZE, DUNGEON_BRAID_CHANCE, DUNGEON_ROOM_COUNT, DUNGEON_ROOM_MIN_SIZE,
  DUNGEON_ROOM_MAX_SIZE, DUNGEON_DOOR_CHANCE, DUNGEON_SECRET_CHANCE, DUNGEON_MAX_DEPTH,
  DUNGEON_ROOM_STOCK_MONSTER_CHANCE, DUNGEON_ROOM_STOCK_TRAP_CHANCE, DUNGEON_ROOM_STOCK_SPECIAL_CHANCE,
  DUNGEON_ROOM_TREASURE_WITH_MONSTER_CHANCE, DUNGEON_ROOM_HIDDEN_TREASURE_CHANCE, DUNGEON_ROOM_SPECIAL_TYPES,
  DUNGEON_CORRIDOR_FLAVOR_DENSITY, DUNGEON_CORRIDOR_FLAVOR_TYPES,
  DUNGEON_DAMAGE_TRAP_DMG, DUNGEON_FOUNTAIN_SP, DUNGEON_CHEST_TRAP_CHANCE,
  DUNGEON_CHEST_GOLD, DUNGEON_CHEST_GEM_CHANCE,
} from './data.js';

const key = (x, y) => `${x},${y}`;
const edgeKey = (x, y, dir) => `${x},${y},${dir}`;

// WHAT: recursive-backtracker perfect maze over cells not in `skip`.
// WHY: guarantees a single spanning tree — full connectivity by construction.
function carveMaze(map, rng, start, skip) {
  const w = map.width, h = map.height;
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));
  for (const k of skip) { const [sx, sy] = k.split(',').map(Number); visited[sy][sx] = true; }
  visited[start.y][start.x] = true;
  const stack = [{ x: start.x, y: start.y }];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = [];
    for (const dir of DIRS) {
      const { dx, dy } = DELTA[dir];
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && !visited[ny][nx]) options.push({ dir, nx, ny });
    }
    if (!options.length) { stack.pop(); continue; }
    const pick = rng.choice(options);
    map.setEdge(cur.x, cur.y, pick.dir, EDGE.OPEN);
    visited[pick.ny][pick.nx] = true;
    stack.push({ x: pick.nx, y: pick.ny });
  }
}

// WHAT: knock a wall from ~braidChance of dead-ends to create loops.
// WHY: pure mazes feel like corridors; braiding gives room to maneuver.
// Returns the set of edge keys it opened, so secret doors can later be
// restricted to these (non-bridge, always-bypassable) edges only.
function braidMaze(map, rng, chance, skip) {
  const braided = new Set();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (skip.has(key(x, y))) continue;
      const openCount = DIRS.filter((d) => map.getEdge(x, y, d) === EDGE.OPEN).length;
      if (openCount !== 1) continue;
      if (!rng.chance(chance)) continue;
      const candidates = DIRS.filter((d) => {
        if (map.getEdge(x, y, d) !== EDGE.WALL) return false;
        const { dx, dy } = DELTA[d];
        const nx = x + dx, ny = y + dy;
        if (!map.inBounds(nx, ny)) return false;
        if (skip.has(key(nx, ny))) return false;
        return true;
      });
      if (!candidates.length) continue;
      const dir = rng.choice(candidates);
      map.setEdge(x, y, dir, EDGE.OPEN);
      braided.add(edgeKey(x, y, dir));
      const { dx, dy } = DELTA[dir];
      braided.add(edgeKey(x + dx, y + dy, DIRS.find((d) => DELTA[d].dx === -dx && DELTA[d].dy === -dy)));
    }
  }
  return braided;
}

function carveRooms(map, rng, count, skip) {
  const rooms = [];
  let attempts = 0;
  while (rooms.length < count && attempts < count * 20) {
    attempts++;
    const rw = rng.int(DUNGEON_ROOM_MIN_SIZE, DUNGEON_ROOM_MAX_SIZE);
    const rh = rng.int(DUNGEON_ROOM_MIN_SIZE, DUNGEON_ROOM_MAX_SIZE);
    const rx = rng.int(1, Math.max(1, map.width - rw - 2));
    const ry = rng.int(1, Math.max(1, map.height - rh - 2));
    let overlapsSkip = false;
    for (let y = ry; y < ry + rh && !overlapsSkip; y++) {
      for (let x = rx; x < rx + rw; x++) if (skip.has(key(x, y))) { overlapsSkip = true; break; }
    }
    if (overlapsSkip) continue;
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        for (const dir of DIRS) {
          const { dx, dy } = DELTA[dir];
          const nx = x + dx, ny = y + dy;
          if (nx >= rx && nx < rx + rw && ny >= ry && ny < ry + rh) map.setEdge(x, y, dir, EDGE.OPEN);
        }
      }
    }
    rooms.push({ x: rx, y: ry, w: rw, h: rh });
  }
  return rooms;
}

// WHAT: convert a fraction of OPEN edges to DOOR; a sub-fraction of the
// *braided* edges become SECRET. WHY: secrets only ever sit on loop edges
// (never on the spanning tree), so a secret door can never be the sole path
// to anywhere — undiscovered secrets never soft-lock the level.
function placeDoors(map, rng, braided, skip) {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (skip.has(key(x, y))) continue;
      for (const dir of ['E', 'S']) {
        if (map.getEdge(x, y, dir) !== EDGE.OPEN) continue;
        if (!rng.chance(DUNGEON_DOOR_CHANCE)) continue;
        const isBraid = braided.has(edgeKey(x, y, dir));
        if (isBraid && rng.chance(DUNGEON_SECRET_CHANCE)) map.setEdge(x, y, dir, EDGE.SECRET);
        else map.setEdge(x, y, dir, EDGE.DOOR);
      }
    }
  }
}

function bfsDistances(map, sx, sy) {
  const dist = new Map([[key(sx, sy), 0]]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.shift();
    const d = dist.get(key(x, y));
    for (const dir of DIRS) {
      if (!map.isPassable(x, y, dir)) continue;
      const { dx, dy } = DELTA[dir];
      const nx = x + dx, ny = y + dy;
      const k = key(nx, ny);
      if (!dist.has(k)) { dist.set(k, d + 1); queue.push([nx, ny]); }
    }
  }
  return dist;
}

// WHAT: reserve a sealed 3x3 room with exactly one connecting edge (the
// "throat"). WHY: this is the boss trigger zone — its only doorway to the
// rest of the level, so entering the zone can never be routed around.
function reserveBossRoom(map, rng) {
  const rw = 3, rh = 3;
  const rx = map.width - rw - 1;
  const ry = map.height - rh - 1;
  const skip = new Set();
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) skip.add(key(x, y));

  // open the room interior fully (one big room)
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      for (const dir of DIRS) {
        const { dx, dy } = DELTA[dir];
        const nx = x + dx, ny = y + dy;
        if (nx >= rx && nx < rx + rw && ny >= ry && ny < ry + rh) map.setEdge(x, y, dir, EDGE.OPEN);
      }
    }
  }
  // pick one boundary cell/dir whose neighbor lies outside the room and in bounds
  const candidates = [];
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      for (const dir of DIRS) {
        const { dx, dy } = DELTA[dir];
        const nx = x + dx, ny = y + dy;
        if (!map.inBounds(nx, ny)) continue;
        if (nx >= rx && nx < rx + rw && ny >= ry && ny < ry + rh) continue; // interior, skip
        candidates.push({ x, y, dir, outX: nx, outY: ny });
      }
    }
  }
  const throat = rng.choice(candidates);
  return { rect: { x: rx, y: ry, w: rw, h: rh }, skip, throat };
}

const FLAVOR_MESSAGES = ['The walls are cold here.', 'Something scratched these stones long ago.', 'A faint draft chills your torch.'];

function makeChestPayload(rng) {
  const trapped = rng.chance(DUNGEON_CHEST_TRAP_CHANCE);
  const gold = rng.int(DUNGEON_CHEST_GOLD[0], DUNGEON_CHEST_GOLD[1]);
  const gems = rng.chance(DUNGEON_CHEST_GEM_CHANCE) ? 1 : 0;
  return { type: 'CHEST', payload: { trapped, gold, gems, opened: false } };
}

function buildRoomSpecial(type, rng, teleportTargets) {
  switch (type) {
    case 'TELEPORTER': {
      const [tx, ty] = rng.choice(teleportTargets);
      return { type, payload: { x: tx, y: ty } };
    }
    case 'FOUNTAIN':
      return { type, payload: { sp: DUNGEON_FOUNTAIN_SP, used: false } };
    case 'MESSAGE':
      return { type, payload: { text: rng.choice(FLAVOR_MESSAGES) } };
    default:
      return { type, payload: {} };
  }
}

// WHAT: classic "stock the dungeon" procedure — one stocking roll per
// carved room (monster / trap / special feature / empty), with treasure as
// a separate sub-roll rather than baked into a flat per-cell density.
function stockRooms(map, rng, rooms, entryKey, stairsDownKey, teleportTargets) {
  for (const room of rooms) {
    const cells = [];
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const k = key(x, y);
        if (k === entryKey || k === stairsDownKey) continue;
        cells.push([x, y]);
      }
    }
    if (!cells.length) continue;
    const [mx, my] = rng.choice(cells);
    const roll = rng.next();
    if (roll < DUNGEON_ROOM_STOCK_MONSTER_CHANCE) {
      map.cellAt(mx, my).special = { type: 'ENCOUNTER', payload: {} };
      if (rng.chance(DUNGEON_ROOM_TREASURE_WITH_MONSTER_CHANCE)) {
        const others = cells.filter(([cx, cy]) => cx !== mx || cy !== my);
        if (others.length) {
          const [tx, ty] = rng.choice(others);
          map.cellAt(tx, ty).special = makeChestPayload(rng);
        }
      }
    } else if (roll < DUNGEON_ROOM_STOCK_MONSTER_CHANCE + DUNGEON_ROOM_STOCK_TRAP_CHANCE) {
      map.cellAt(mx, my).special = { type: 'DAMAGE_TRAP', payload: { dmg: [DUNGEON_DAMAGE_TRAP_DMG[0], DUNGEON_DAMAGE_TRAP_DMG[1]] } };
    } else if (roll < DUNGEON_ROOM_STOCK_MONSTER_CHANCE + DUNGEON_ROOM_STOCK_TRAP_CHANCE + DUNGEON_ROOM_STOCK_SPECIAL_CHANCE) {
      map.cellAt(mx, my).special = buildRoomSpecial(rng.choice(DUNGEON_ROOM_SPECIAL_TYPES), rng, teleportTargets);
    } else if (rng.chance(DUNGEON_ROOM_HIDDEN_TREASURE_CHANCE)) {
      map.cellAt(mx, my).special = makeChestPayload(rng);
    }
  }
}

// WHAT: sparse atmospheric dressing in corridors (outside stocked rooms) —
// darkness patches and flavor text only, never mechanical content. Rooms
// carry all the monsters/traps/treasure via stockRooms above.
function scatterCorridorFlavor(map, rng, roomCellSet, reserved, entryKey, stairsDownKey) {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const k = key(x, y);
      if (reserved && reserved.has(k)) continue;
      if (roomCellSet.has(k)) continue;
      if (k === entryKey || k === stairsDownKey) continue;
      if (!rng.chance(DUNGEON_CORRIDOR_FLAVOR_DENSITY)) continue;
      const type = rng.choice(DUNGEON_CORRIDOR_FLAVOR_TYPES);
      const cell = map.cellAt(x, y);
      if (type === 'DARKNESS') cell.dark = true;
      else cell.special = { type, payload: { text: rng.choice(FLAVOR_MESSAGES) } };
    }
  }
}

// WHAT: generate one full dungeon level. depth is 1-based; the deepest level
// (depth === maxDepth) reserves the boss room instead of stairs down. WHY:
// maxDepth is a parameter (not always the global constant) so secondary,
// shallower dungeon mouths can cap out early without ever spawning a boss —
// only the one designated "main" dungeon complex goes all the way down.
export function generateDungeonLevel(depth, rng, maxDepth = DUNGEON_MAX_DEPTH) {
  const size = DUNGEON_SIZE;
  const map = new GridMap(size, size, MAP_KIND.DUNGEON, `Dungeon L${depth}`);
  const isBossLevel = depth >= maxDepth;

  let boss = null;
  const skip = new Set();
  if (isBossLevel) {
    boss = reserveBossRoom(map, rng);
    for (const k of boss.skip) skip.add(k);
  }

  const start = { x: 0, y: 0 };
  carveMaze(map, rng, start, skip);
  const braided = braidMaze(map, rng, DUNGEON_BRAID_CHANCE, skip);
  const roomCount = rng.int(DUNGEON_ROOM_COUNT[0], DUNGEON_ROOM_COUNT[1]);
  const rooms = carveRooms(map, rng, roomCount, skip);
  placeDoors(map, rng, braided, skip);

  if (isBossLevel) {
    map.setEdge(boss.throat.x, boss.throat.y, boss.throat.dir, EDGE.OPEN);
  }

  // entry facing: whichever direction is open from (0,0)
  const entryDir = DIRS.find((d) => map.getEdge(0, 0, d) === EDGE.OPEN || map.getEdge(0, 0, d) === EDGE.DOOR) || 'S';
  map.entry = { x: 0, y: 0, facing: entryDir };
  map.cellAt(0, 0).special = { type: 'STAIRS_UP', payload: {} };

  let stairsDown = null;
  if (!isBossLevel) {
    const dist = bfsDistances(map, 0, 0);
    let best = null, bestDist = -1;
    for (const [k, d] of dist) {
      if (skip.has(k)) continue;
      if (d > bestDist) { bestDist = d; best = k; }
    }
    const [dx, dy] = best.split(',').map(Number);
    stairsDown = { x: dx, y: dy };
    map.cellAt(dx, dy).special = { type: 'STAIRS_DOWN', payload: { nextDepth: depth + 1 } };
  }

  const entryKey = key(0, 0);
  const stairsDownKey = stairsDown ? key(stairsDown.x, stairsDown.y) : null;
  const roomCellSet = new Set();
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roomCellSet.add(key(x, y));
  }
  const teleportTargets = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const k = key(x, y);
      if (k === entryKey || k === stairsDownKey) continue;
      if (isBossLevel && boss.skip.has(k)) continue;
      teleportTargets.push([x, y]);
    }
  }
  stockRooms(map, rng, rooms, entryKey, stairsDownKey, teleportTargets);
  scatterCorridorFlavor(map, rng, roomCellSet, isBossLevel ? boss.skip : null, entryKey, stairsDownKey);

  let bossZone = null;
  if (isBossLevel) {
    bossZone = new Set(boss.skip);
    for (const k of bossZone) {
      const [x, y] = k.split(',').map(Number);
      map.cellAt(x, y).special = map.cellAt(x, y).special || { type: 'BOSS_ZONE', payload: {} };
    }
  }

  return { map, entry: map.entry, stairsDown, bossZone, boss, depth, rooms };
}

// WHAT: verify every room/stairs-down/boss-trigger-zone cell is reachable
// from the level entry using only currently-legal (non-secret) passability.
// Used by dungeon generation sanity + the connectivity test script.
export function verifyLevelConnectivity(level) {
  const { map, entry, stairsDown, bossZone, rooms } = level;
  const reachable = floodFillReachable(map, entry.x, entry.y);
  if (stairsDown && !reachable.has(key(stairsDown.x, stairsDown.y))) return false;
  if (bossZone) {
    for (const k of bossZone) if (!reachable.has(k)) return false;
  }
  if (rooms) {
    for (const r of rooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (!reachable.has(key(x, y))) return false;
        }
      }
    }
  }
  return true;
}

// WHAT: assert the boss trigger zone has exactly one connecting edge to the
// rest of the level (the "throat") — i.e. removing it makes the zone
// unreachable. This is the no-bypass guarantee the spec requires.
export function verifyBossUnavoidable(level) {
  if (!level.boss) return true;
  const { map, entry, boss } = level;
  const saved = map.getEdge(boss.throat.x, boss.throat.y, boss.throat.dir);
  map.setEdge(boss.throat.x, boss.throat.y, boss.throat.dir, EDGE.WALL);
  const reachableWithoutThroat = floodFillReachable(map, entry.x, entry.y);
  map.setEdge(boss.throat.x, boss.throat.y, boss.throat.dir, saved);
  for (const k of boss.skip) if (reachableWithoutThroat.has(k)) return false;
  return true;
}
