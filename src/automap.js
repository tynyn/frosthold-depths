// automap.js
// WHAT: top-down auto-map overlay that fills in as cells are explored.
// WHY: shared across all three map kinds — reads the same `facing`/position
// state fpview uses, with no per-kind branching.

import {
  EDGE, AUTOMAP_WALL_COLOR, AUTOMAP_DOOR_COLOR, AUTOMAP_SPECIAL_COLOR, AUTOMAP_SHOP_COLOR,
} from './data.js';

// WHAT: mark a cell (and reveal its walls) as explored.
// WHY: called once per step so the auto-map only shows visited territory.
export function markExplored(map, x, y) {
  const c = map.cellAt(x, y);
  if (c) c.explored = true;
}

const FACING_ARROW = { N: '^', E: '>', S: 'v', W: '<' };

// WHAT: which color an edge draws in — a door (or a found secret door)
// reads as visually distinct from a plain wall; an undiscovered secret
// still looks exactly like a wall, matching the FPV rule that secrets carry
// no visual tell until searched out.
function edgeColor(edgeState, found) {
  if (edgeState === EDGE.DOOR) return AUTOMAP_DOOR_COLOR;
  if (edgeState === EDGE.SECRET && found) return AUTOMAP_DOOR_COLOR;
  return AUTOMAP_WALL_COLOR;
}

// WHAT: draw the explored portion of `map` into ctx, centered on the party.
export function renderAutoMap(ctx, W, H, map, x, y, facing) {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  const cellPx = Math.min(W, H) / (Math.max(map.width, map.height) + 1);
  const originX = W / 2 - (x + 0.5) * cellPx;
  const originY = H / 2 - (y + 0.5) * cellPx;

  ctx.lineWidth = 2;

  for (let cy = 0; cy < map.height; cy++) {
    for (let cx = 0; cx < map.width; cx++) {
      const cell = map.cellAt(cx, cy);
      if (!cell.explored) continue;
      const px = originX + cx * cellPx;
      const py = originY + cy * cellPx;
      ctx.fillStyle = '#123';
      ctx.fillRect(px, py, cellPx, cellPx);

      // Each edge draws in its own color — a cell can have a door on one
      // side and a plain wall on another, so this can't be one strokeStyle
      // for the whole cell the way the wall-only version was.
      const edges = [
        ['N', cell.walls.N, () => { ctx.moveTo(px, py); ctx.lineTo(px + cellPx, py); }],
        ['S', cell.walls.S, () => { ctx.moveTo(px, py + cellPx); ctx.lineTo(px + cellPx, py + cellPx); }],
        ['W', cell.walls.W, () => { ctx.moveTo(px, py); ctx.lineTo(px, py + cellPx); }],
        ['E', cell.walls.E, () => { ctx.moveTo(px + cellPx, py); ctx.lineTo(px + cellPx, py + cellPx); }],
      ];
      for (const [dir, state, drawLine] of edges) {
        if (state === EDGE.OPEN) continue;
        ctx.strokeStyle = edgeColor(state, cell.secretFound[dir]);
        ctx.beginPath();
        drawLine();
        ctx.stroke();
      }

      if (cell.special) {
        ctx.fillStyle = cell.special.type === 'SHOPKEEPER' ? AUTOMAP_SHOP_COLOR : AUTOMAP_SPECIAL_COLOR;
        ctx.fillRect(px + cellPx * 0.35, py + cellPx * 0.35, cellPx * 0.3, cellPx * 0.3);
      }
    }
  }

  ctx.fillStyle = '#ff3a3a';
  ctx.font = `${Math.max(12, cellPx * 0.8)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(FACING_ARROW[facing], originX + (x + 0.5) * cellPx, originY + (y + 0.5) * cellPx);
}
