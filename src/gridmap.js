// gridmap.js
// WHAT: the ONE GridMap type + the ONE movement model shared by overworld,
// town, and dungeon. WHY: the spec forbids a second movement/render path —
// every map kind must funnel through tryStep/turnLeft/turnRight below.

import { DIRS, DELTA, OPPOSITE, LEFT_OF, RIGHT_OF, EDGE } from './data.js';

// WHAT: one cell of a GridMap.
// WHY: walls are stored per-edge so passability is identical logic on every
// map kind — biome/terrain differences become nothing more than which edges
// a generator marks WALL vs OPEN.
function makeCell(terrain) {
  return {
    walls: { N: EDGE.WALL, E: EDGE.WALL, S: EDGE.WALL, W: EDGE.WALL },
    terrain: terrain || 'floor',
    special: null,
    explored: false,
    secretFound: { N: false, E: false, S: false, W: false },
  };
}

export class GridMap {
  constructor(width, height, kind, name) {
    this.width = width;
    this.height = height;
    this.kind = kind; // MAP_KIND.OVERWORLD | TOWN | DUNGEON
    this.name = name || kind;
    this.cells = new Array(width * height);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = makeCell();
    this.entry = { x: 0, y: 0, facing: 'N' };
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }

  cellAt(x, y) { return this.inBounds(x, y) ? this.cells[y * this.width + x] : null; }

  // WHAT: read an edge, treating out-of-bounds as an implicit map-boundary wall.
  getEdge(x, y, dir) {
    const c = this.cellAt(x, y);
    if (!c) return EDGE.WALL;
    return c.walls[dir];
  }

  // WHAT: set an edge and mirror it onto the neighboring cell's opposite edge.
  // WHY: a wall between two cells is one logical edge; both cells must agree
  // or movement checks from one side would desync from the other.
  setEdge(x, y, dir, state) {
    const c = this.cellAt(x, y);
    if (!c) return;
    c.walls[dir] = state;
    const { dx, dy } = DELTA[dir];
    const nx = x + dx, ny = y + dy;
    const n = this.cellAt(nx, ny);
    if (n) n.walls[OPPOSITE[dir]] = state;
  }

  // WHAT: is this edge currently crossable (accounting for discovered secrets)?
  isPassable(x, y, dir) {
    const c = this.cellAt(x, y);
    if (!c) return false;
    const state = c.walls[dir];
    if (state === EDGE.OPEN || state === EDGE.DOOR) return true;
    if (state === EDGE.SECRET) return c.secretFound[dir] === true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// THE ONE MOVEMENT MODEL — used unchanged by overworld, town, and dungeon.
// ---------------------------------------------------------------------------

// WHAT: rotate facing 90 degrees. WHY: turning is free — it never touches
// position or calls any turn-advance logic; callers re-render only.
export function turnLeft(facing) { return LEFT_OF[facing]; }
export function turnRight(facing) { return RIGHT_OF[facing]; }

// WHAT: attempt to move one cell along `dir` (absolute compass dir) from
// (x,y). Pure function — no side effects, no turn-advance. Returns
// { moved, x, y } so the caller (Game.step) decides what happens next.
export function tryMove(map, x, y, dir) {
  if (!map.isPassable(x, y, dir)) return { moved: false, x, y };
  const { dx, dy } = DELTA[dir];
  const nx = x + dx, ny = y + dy;
  if (!map.inBounds(nx, ny)) return { moved: false, x, y };
  return { moved: true, x: nx, y: ny };
}

// WHAT: forward/back step helpers built on tryMove + facing.
// WHY: "forward" moves along facing; "back" moves along the opposite
// heading but does NOT change facing (classic dungeon-crawler back-step).
export function tryStepForward(map, x, y, facing) { return tryMove(map, x, y, facing); }
export function tryStepBackward(map, x, y, facing) { return tryMove(map, x, y, OPPOSITE[facing]); }

export function allDirs() { return DIRS; }

// WHAT: BFS reachable set from (sx,sy) using only currently-passable edges.
// WHY: shared by every map kind's connectivity guarantee — dungeon
// stairs/rooms, overworld gates/mouths, town shops all use this one check.
export function floodFillReachable(map, sx, sy) {
  const key = (x, y) => `${x},${y}`;
  const seen = new Set([key(sx, sy)]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const dir of DIRS) {
      if (!map.isPassable(x, y, dir)) continue;
      const { dx, dy } = DELTA[dir];
      const nx = x + dx, ny = y + dy;
      const k = key(nx, ny);
      if (map.inBounds(nx, ny) && !seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
    }
  }
  return seen;
}
