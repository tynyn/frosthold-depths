// fpview.js
// WHAT: the ONE first-person renderer for overworld, town, and dungeon.
// WHY: spec requires zero per-map-kind branching in projection geometry —
// the only kind-specific inputs are the tileset (colors + wall-detail knobs)
// and which edge states are legal on that map. Everything else (nested-quad
// math, depth shading, door/secret rendering, per-cell wall texture) is
// identical for all three map kinds; motif/density differences come only
// from the numbers the active tileset supplies.

import { DELTA, LEFT_OF, RIGHT_OF, EDGE } from './data.js';
import {
  FPVIEW_MAX_DEPTH, FPVIEW_DEPTH_SHADE, FPVIEW_TORCH_WARMTH, FPVIEW_TORCH_FALLOFF,
  FPVIEW_TORCH_COLOR, FPVIEW_GRID_COLOR, FPVIEW_GRID_WIDTH,
} from './data.js';
import { hashRng } from './rng.js';

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// WHAT: darken an [r,g,b] triple by a depth-based factor, then blend in a
// torch-glow warmth that falls off with distance. WHY: this is the "torch
// falloff" cue — near faces brighten warm, far faces fade dark and neutral —
// layered on top of the existing linear depth darkening.
function shadeAndGlow(rgb, depth) {
  const darkFactor = Math.max(0.22, 1 - depth * FPVIEW_DEPTH_SHADE);
  const warmth = FPVIEW_TORCH_WARMTH * Math.exp(-depth * FPVIEW_TORCH_FALLOFF);
  const r = rgb[0] * darkFactor * (1 - warmth) + FPVIEW_TORCH_COLOR[0] * warmth;
  const g = rgb[1] * darkFactor * (1 - warmth) + FPVIEW_TORCH_COLOR[1] * warmth;
  const b = rgb[2] * darkFactor * (1 - warmth) + FPVIEW_TORCH_COLOR[2] * warmth;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function wallBaseRgb(edgeState, found, tileset) {
  if (edgeState === EDGE.DOOR) return hexToRgb(tileset.door || '#8a5a2e');
  if (edgeState === EDGE.SECRET && found) return hexToRgb(tileset.door || '#8a5a2e');
  return hexToRgb(tileset.wall); // WALL, or undiscovered SECRET — looks identical to a wall
}

// WHAT: geometric shrink of the view frustum at depth i (0 = right at the
// party's feet plane, larger = farther away). Accepts a fractional depth so
// the step-dolly tween can render at any point between two integer cells.
function planeAt(cx, cy, maxHalfW, maxHalfH, depth) {
  const SHRINK = 0.62;
  const s = Math.pow(SHRINK, depth);
  return { halfW: maxHalfW * s, halfH: maxHalfH * s };
}

function sideTrapPoints(cx, cy, near, far, side) {
  const sign = side === 'left' ? -1 : 1;
  return [
    [cx + sign * near.halfW, cy - near.halfH],
    [cx + sign * far.halfW, cy - far.halfH],
    [cx + sign * far.halfW, cy + far.halfH],
    [cx + sign * near.halfW, cy + near.halfH],
  ];
}

function frontRectPoints(cx, cy, far) {
  return [
    [cx - far.halfW, cy - far.halfH],
    [cx + far.halfW, cy - far.halfH],
    [cx + far.halfW, cy + far.halfH],
    [cx - far.halfW, cy + far.halfH],
  ];
}

function tracePath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

function boundsOf(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// WHAT: draw deterministic per-cell/per-edge wall texture (masonry banding,
// a crack, a moss/stain patch, an occasional torch sconce or rune) clipped
// to the face's own path. WHY: this is what makes a straight corridor read
// as many distinct cells instead of one repeating frame — the SAME
// (mapSeed, cellX, cellY, edgeDir) always draws the same detail, and no two
// different cells/edges draw the same detail. Only ever called for WALL (or
// undiscovered SECRET) faces — doors stay clean so they read as distinct.
function drawWallDetail(ctx, points, tileset, rng, depth) {
  const { x, y, w, h } = boundsOf(points);
  if (w < 2 || h < 2) return;
  const d = tileset.detail;
  ctx.save();
  tracePath(ctx, points);
  ctx.clip();

  const darkFactor = Math.max(0.22, 1 - depth * FPVIEW_DEPTH_SHADE);
  const bandRgb = hexToRgb(tileset.wall).map((c) => c * darkFactor * 0.65);
  ctx.strokeStyle = `rgb(${bandRgb[0] | 0},${bandRgb[1] | 0},${bandRgb[2] | 0})`;
  ctx.lineWidth = Math.max(1, h * 0.02);
  const bands = 2 + Math.floor(rng.next() * 2);
  for (let i = 1; i <= bands; i++) {
    const by = y + (h * i) / (bands + 1) + (rng.next() - 0.5) * h * 0.05;
    ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + w, by); ctx.stroke();
  }

  if (rng.chance(d.crackChance)) {
    const crackRgb = hexToRgb(tileset.wall).map((c) => c * darkFactor * 0.4);
    ctx.strokeStyle = `rgb(${crackRgb[0] | 0},${crackRgb[1] | 0},${crackRgb[2] | 0})`;
    ctx.lineWidth = Math.max(1, h * 0.012);
    let px = x + rng.next() * w, py = y + rng.next() * h * 0.3;
    ctx.beginPath(); ctx.moveTo(px, py);
    const segs = 3 + Math.floor(rng.next() * 2);
    for (let i = 0; i < segs; i++) {
      px += (rng.next() - 0.5) * w * 0.3;
      py += h * (0.55 / segs);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  if (rng.chance(d.mossChance)) {
    ctx.fillStyle = d.mossColor;
    const patches = 2 + Math.floor(rng.next() * 3);
    for (let i = 0; i < patches; i++) {
      const px = x + rng.next() * w, py = y + h * 0.5 + rng.next() * h * 0.45;
      const r = w * (0.05 + rng.next() * 0.09);
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  if (rng.chance(d.accentChance)) {
    const ax = x + w * (0.2 + rng.next() * 0.6);
    const ay = y + h * (0.3 + rng.next() * 0.3);
    if (rng.chance(0.6)) {
      const glowR = Math.max(2, w * 0.18);
      const grad = ctx.createRadialGradient(ax, ay, 0, ax, ay, glowR);
      grad.addColorStop(0, 'rgba(255,200,120,0.85)');
      grad.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(ax, ay, glowR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(40,26,16,0.9)';
      ctx.fillRect(ax - w * 0.02, ay, Math.max(1, w * 0.04), h * 0.12);
    } else {
      ctx.strokeStyle = tileset.door || '#8a5a2e';
      ctx.lineWidth = Math.max(1, h * 0.015);
      ctx.beginPath();
      ctx.moveTo(ax - w * 0.06, ay + h * 0.06);
      ctx.lineTo(ax, ay - h * 0.06);
      ctx.lineTo(ax + w * 0.06, ay + h * 0.06);
      ctx.moveTo(ax, ay - h * 0.02);
      ctx.lineTo(ax, ay + h * 0.08);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawSideTrap(ctx, cx, cy, near, far, side, tileset, edgeState, found, cellX, cellY, mapSeed, depth) {
  const points = sideTrapPoints(cx, cy, near, far, side);
  const rgb = wallBaseRgb(edgeState, found, tileset);
  const jitterRng = hashRng(mapSeed, cellX, cellY, side === 'left' ? 1 : 2);
  const jitter = 1 + (jitterRng.next() * 2 - 1) * tileset.detail.jitter;
  ctx.fillStyle = shadeAndGlow(rgb.map((c) => c * jitter), depth);
  tracePath(ctx, points);
  ctx.fill();
  if (edgeState !== EDGE.DOOR) {
    drawWallDetail(ctx, points, tileset, hashRng(mapSeed, cellX, cellY, side === 'left' ? 11 : 12), depth);
  }
}

function drawFrontRect(ctx, cx, cy, far, tileset, edgeState, cellX, cellY, mapSeed, depth) {
  const points = frontRectPoints(cx, cy, far);
  const rgb = wallBaseRgb(edgeState, true, tileset);
  const jitterRng = hashRng(mapSeed, cellX, cellY, 3);
  const jitter = 1 + (jitterRng.next() * 2 - 1) * tileset.detail.jitter;
  ctx.fillStyle = shadeAndGlow(rgb.map((c) => c * jitter), depth);
  tracePath(ctx, points);
  ctx.fill();
  if (edgeState !== EDGE.DOOR) {
    drawWallDetail(ctx, points, tileset, hashRng(mapSeed, cellX, cellY, 13), depth);
  }
}

// WHAT: floor/ceiling seam lines at each depth boundary, plus the two side
// rails already implied by the wall trapezoids. WHY: "seams visibly pass
// under the party as they step" — since every step recomputes depth 0 from
// the party's new cell, these lines visibly shift each frame, turning a
// static corridor into countable, visible progress.
function drawFloorCeilingGrid(ctx, cx, cy, maxHalfW, maxHalfH, sliceCount, depthOffset) {
  ctx.strokeStyle = FPVIEW_GRID_COLOR;
  ctx.lineWidth = FPVIEW_GRID_WIDTH;
  for (let d = 0; d <= sliceCount; d++) {
    const p = planeAt(cx, cy, maxHalfW, maxHalfH, d + depthOffset);
    ctx.beginPath(); ctx.moveTo(cx - p.halfW, cy + p.halfH); ctx.lineTo(cx + p.halfW, cy + p.halfH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - p.halfW, cy - p.halfH); ctx.lineTo(cx + p.halfW, cy - p.halfH); ctx.stroke();
  }
  const near = planeAt(cx, cy, maxHalfW, maxHalfH, depthOffset);
  const far = planeAt(cx, cy, maxHalfW, maxHalfH, sliceCount + depthOffset);
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sign * near.halfW, cy + near.halfH); ctx.lineTo(cx + sign * far.halfW, cy + far.halfH);
    ctx.moveTo(cx + sign * near.halfW, cy - near.halfH); ctx.lineTo(cx + sign * far.halfW, cy - far.halfH);
    ctx.stroke();
  }
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
      cellX: cxCell, cellY: cyCell,
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
// tileset = { sky, floor, wall, door?, detail } supplied by the active map.
// viewDepth optionally shortened (e.g. DARKNESS special squares). mapSeed is
// an opaque per-map identity number (main.js derives it once from the
// world seed + map name) used only to key deterministic wall-detail hashes.
// depthOffset (default 0) is the cosmetic step-dolly's fractional camera
// push — see main.js's dolly queue; it never changes turn timing or state,
// only where planeAt() renders each existing slice.
export function renderFPView(ctx, W, H, map, x, y, facing, tileset, viewDepth = FPVIEW_MAX_DEPTH, mapSeed = 0, depthOffset = 0) {
  ctx.fillStyle = tileset.sky;
  ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = tileset.floor;
  ctx.fillRect(0, H / 2, W, H / 2);

  const cx = W / 2, cy = H / 2;
  const maxHalfW = W / 2, maxHalfH = H / 2;

  const slices = collectSlices(map, x, y, facing, viewDepth);

  drawFloorCeilingGrid(ctx, cx, cy, maxHalfW, maxHalfH, slices.length, depthOffset);

  for (let i = slices.length - 1; i >= 0; i--) {
    const s = slices[i];
    const near = planeAt(cx, cy, maxHalfW, maxHalfH, s.depth + depthOffset);
    const far = planeAt(cx, cy, maxHalfW, maxHalfH, s.depth + 1 + depthOffset);

    if (s.leftWall !== EDGE.OPEN) {
      drawSideTrap(ctx, cx, cy, near, far, 'left', tileset, s.leftWall, s.secretL, s.cellX, s.cellY, mapSeed, s.depth + depthOffset);
    }
    if (s.rightWall !== EDGE.OPEN) {
      drawSideTrap(ctx, cx, cy, near, far, 'right', tileset, s.rightWall, s.secretR, s.cellX, s.cellY, mapSeed, s.depth + depthOffset);
    }
    if (s.blocked) {
      const frontEdgeState = s.doorForward ? EDGE.DOOR : EDGE.WALL;
      drawFrontRect(ctx, cx, cy, far, tileset, frontEdgeState, s.cellX, s.cellY, mapSeed, s.depth + 1 + depthOffset);
    }
  }
}
