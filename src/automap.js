// automap.js
// WHAT: top-down auto-map overlay that fills in as cells are explored.
// WHY: shared across all three map kinds — reads the same `facing`/position
// state fpview uses, with no per-kind branching.

import { EDGE } from './data.js';

// WHAT: mark a cell (and reveal its walls) as explored.
// WHY: called once per step so the auto-map only shows visited territory.
export function markExplored(map, x, y) {
  const c = map.cellAt(x, y);
  if (c) c.explored = true;
}

const FACING_ARROW = { N: '^', E: '>', S: 'v', W: '<' };

// WHAT: draw the explored portion of `map` into ctx, centered on the party.
export function renderAutoMap(ctx, W, H, map, x, y, facing) {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  const cellPx = Math.min(W, H) / (Math.max(map.width, map.height) + 1);
  const originX = W / 2 - (x + 0.5) * cellPx;
  const originY = H / 2 - (y + 0.5) * cellPx;

  ctx.strokeStyle = '#3ad6ff';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#123';

  for (let cy = 0; cy < map.height; cy++) {
    for (let cx = 0; cx < map.width; cx++) {
      const cell = map.cellAt(cx, cy);
      if (!cell.explored) continue;
      const px = originX + cx * cellPx;
      const py = originY + cy * cellPx;
      ctx.fillRect(px, py, cellPx, cellPx);

      ctx.beginPath();
      if (cell.walls.N !== EDGE.OPEN) { ctx.moveTo(px, py); ctx.lineTo(px + cellPx, py); }
      if (cell.walls.S !== EDGE.OPEN) { ctx.moveTo(px, py + cellPx); ctx.lineTo(px + cellPx, py + cellPx); }
      if (cell.walls.W !== EDGE.OPEN) { ctx.moveTo(px, py); ctx.lineTo(px, py + cellPx); }
      if (cell.walls.E !== EDGE.OPEN) { ctx.moveTo(px + cellPx, py); ctx.lineTo(px + cellPx, py + cellPx); }
      ctx.stroke();

      if (cell.special) {
        ctx.fillStyle = '#ffd23a';
        ctx.fillRect(px + cellPx * 0.35, py + cellPx * 0.35, cellPx * 0.3, cellPx * 0.3);
        ctx.fillStyle = '#123';
      }
    }
  }

  ctx.fillStyle = '#ff3a3a';
  ctx.font = `${Math.max(12, cellPx * 0.8)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(FACING_ARROW[facing], originX + (x + 0.5) * cellPx, originY + (y + 0.5) * cellPx);
}
