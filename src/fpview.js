// fpview.js
// WHAT: the ONE first-person renderer for overworld, town, and dungeon.
// WHY: spec requires zero per-map-kind branching in projection geometry —
// the only kind-specific inputs are the tileset (colors) and which edge
// states are legal on that map. Everything else (nested-quad math, depth
// shading, door/secret rendering) is identical for all three map kinds.

import { DELTA, LEFT_OF, RIGHT_OF, EDGE } from './data.js';
import { FPVIEW_MAX_DEPTH, FPVIEW_DEPTH_SHADE } from './data.js';

// WHAT: darken a "#rrggbb" color by a depth-based factor.
// WHY: receding corridor cells must read as farther away.
function shade(hex, depth) {
  const factor = Math.max(0.22, 1 - depth * FPVIEW_DEPTH_SHADE);
  const r = parseInt(hex.slice(1, 3), 16) * factor;
  const g = parseInt(hex.slice(3, 5), 16) * factor;
  const b = parseInt(hex.slice(5, 7), 16) * factor;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function wallColorFor(edgeState, found, tileset) {
  if (edgeState === EDGE.DOOR) return tileset.door || '#8a5a2e';
  if (edgeState === EDGE.SECRET && found) return tileset.door || '#8a5a2e';
  return tileset.wall; // WALL, or undiscovered SECRET — looks identical to a wall
}

// WHAT: geometric shrink of the view frustum at depth i (0 = right at the
// party's feet plane, larger = farther away).
function planeAt(cx, cy, maxHalfW, maxHalfH, depth) {
  const SHRINK = 0.62;
  const s = Math.pow(SHRINK, depth);
  return { halfW: maxHalfW * s, halfH: maxHalfH * s };
}

function drawSideTrap(ctx, cx, cy, near, far, side, color) {
  const sign = side === 'left' ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(cx + sign * near.halfW, cy - near.halfH);
  ctx.lineTo(cx + sign * far.halfW, cy - far.halfH);
  ctx.lineTo(cx + sign * far.halfW, cy + far.halfH);
  ctx.lineTo(cx + sign * near.halfW, cy + near.halfH);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawFrontRect(ctx, cx, cy, far, color) {
  ctx.fillStyle = color;
  ctx.fillRect(cx - far.halfW, cy - far.halfH, far.halfW * 2, far.halfH * 2);
}

// WHAT: walk forward from (x,y) along `facing` collecting one "slice" per
// cell until view depth is reached or a blocked forward edge stops the walk.
// This is the only place that reads map edges for rendering purposes — it is
// identical no matter what map.kind is.
function collectSlices(map, x, y, facing, viewDepth) {
  const left = LEFT_OF[facing];
  const right = RIGHT_OF[facing];
  const { dx, dy } = DELTA[facing];
  let cxCell = x, cyCell = y;
  const slices = [];
  for (let d = 0; d < viewDepth; d++) {
    const cell = map.cellAt(cxCell, cyCell);
    if (!cell) break;
    const leftWall = map.getEdge(cxCell, cyCell, left);
    const rightWall = map.getEdge(cxCell, cyCell, right);
    const passableForward = map.isPassable(cxCell, cyCell, facing);
    const forwardEdge = map.getEdge(cxCell, cyCell, facing);
    slices.push({
      depth: d,
      leftWall, rightWall,
      secretL: cell.secretFound[left],
      secretR: cell.secretFound[right],
      blocked: !passableForward,
      doorForward: forwardEdge === EDGE.DOOR || (forwardEdge === EDGE.SECRET && cell.secretFound[facing]),
    });
    if (!passableForward) break;
    cxCell += dx; cyCell += dy;
  }
  return slices;
}

// WHAT: render the first-person view of `map` from (x,y,facing) into ctx.
// tileset = { sky, floor, wall, door? } colors supplied by the active map.
// viewDepth optionally shortened (e.g. DARKNESS special squares).
export function renderFPView(ctx, W, H, map, x, y, facing, tileset, viewDepth = FPVIEW_MAX_DEPTH) {
  ctx.fillStyle = tileset.sky;
  ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = tileset.floor;
  ctx.fillRect(0, H / 2, W, H / 2);

  const cx = W / 2, cy = H / 2;
  const maxHalfW = W / 2, maxHalfH = H / 2;

  const slices = collectSlices(map, x, y, facing, viewDepth);

  for (let i = slices.length - 1; i >= 0; i--) {
    const s = slices[i];
    const near = planeAt(cx, cy, maxHalfW, maxHalfH, s.depth);
    const far = planeAt(cx, cy, maxHalfW, maxHalfH, s.depth + 1);

    if (s.leftWall !== EDGE.OPEN) {
      drawSideTrap(ctx, cx, cy, near, far, 'left', shade(wallColorFor(s.leftWall, s.secretL, tileset), s.depth));
    }
    if (s.rightWall !== EDGE.OPEN) {
      drawSideTrap(ctx, cx, cy, near, far, 'right', shade(wallColorFor(s.rightWall, s.secretR, tileset), s.depth));
    }
    if (s.blocked) {
      const frontEdgeState = s.doorForward ? EDGE.DOOR : EDGE.WALL;
      drawFrontRect(ctx, cx, cy, far, shade(wallColorFor(frontEdgeState, true, tileset), s.depth + 1));
    }
  }
}
