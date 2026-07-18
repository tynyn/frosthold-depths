// town.js
// WHAT: walkable first-person TOWN layout — a street lattice with shopkeeper
// tiles wired to services.js. WHY: towns reuse the exact same GridMap +
// movement model; only the layout generator and tile specials differ.

import { GridMap } from './gridmap.js';
import { DIRS, EDGE, MAP_KIND, TOWN_SIZE } from './data.js';

const STREET_STEP = 4;

function isStreet(x, y) { return x % STREET_STEP === 0 || y % STREET_STEP === 0; }

export const SHOP_TYPES = ['TEMPLE', 'BLACKSMITH', 'MAGIC_SHOP', 'TAVERN', 'TRAINING_GROUNDS'];

// WHAT: build a town map whose streets form one fully-connected lattice —
// this makes "every shop reachable from the gate" true by construction, no
// separate flood-fill patch needed.
export function generateTown(rng, name) {
  const size = TOWN_SIZE;
  const map = new GridMap(size, size, MAP_KIND.TOWN, name);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isStreet(x, y)) continue;
      for (const dir of DIRS) {
        const delta = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[dir];
        const nx = x + delta[0], ny = y + delta[1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (isStreet(nx, ny)) map.setEdge(x, y, dir, EDGE.OPEN);
      }
    }
  }

  const streetCells = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (isStreet(x, y)) streetCells.push([x, y]);

  const gate = [0, 0];
  const used = new Set([`${gate[0]},${gate[1]}`]);
  const pickCell = () => {
    let cell;
    do { cell = rng.choice(streetCells); } while (used.has(`${cell[0]},${cell[1]}`));
    used.add(`${cell[0]},${cell[1]}`);
    return cell;
  };

  map.cellAt(gate[0], gate[1]).special = { type: 'GATE', payload: {} };
  map.entry = { x: gate[0], y: gate[1], facing: 'E' };

  const shopTiles = {};
  for (const shopType of SHOP_TYPES) {
    const [sx, sy] = pickCell();
    map.cellAt(sx, sy).special = { type: 'SHOPKEEPER', payload: { service: shopType } };
    shopTiles[shopType] = { x: sx, y: sy };
  }

  const npcLines = [
    'A weary guard nods. "Keep the peace inside the walls, traveler."',
    'A child chases a hoop past you, laughing.',
  ];
  const npcTiles = [];
  for (const line of npcLines) {
    const [nx, ny] = pickCell();
    map.cellAt(nx, ny).special = { type: 'NPC', payload: { text: line } };
    npcTiles.push({ x: nx, y: ny });
  }

  return { map, gate, shopTiles, npcTiles };
}
