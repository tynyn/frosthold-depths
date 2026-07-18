// test/connectivity.mjs
// WHAT: generates 50 seeded overworlds and 50 seeded dungeons (including a
// deepest/boss level for each) and asserts full connectivity — every town
// gate, dungeon mouth, room, and stairs-down is reachable, and every path
// from the boss level's entry to the boss room passes through its single
// trigger-zone throat (no bypass). WHY: the spec requires this exact check
// to be run after M1/M2/M4/M6 and after any map-generation change.
//
// Run with: node test/connectivity.mjs

import { RNG } from '../src/rng.js';
import { floodFillReachable } from '../src/gridmap.js';
import { generateDungeonLevel, verifyLevelConnectivity, verifyBossUnavoidable } from '../src/dungeon.js';
import { generateOverworld } from '../src/overworld.js';
import { DUNGEON_MAX_DEPTH } from '../src/data.js';

const SEED_COUNT = 50;
let failures = 0;

function fail(label, detail) {
  failures++;
  console.error(`FAIL [${label}]`, detail);
}

// ---------------------------------------------------------------------------
// Overworlds: every town gate + dungeon mouth reachable from the start tile.
// ---------------------------------------------------------------------------
for (let seed = 1; seed <= SEED_COUNT; seed++) {
  const rng = new RNG(seed);
  const ow = generateOverworld(rng.fork(1), `Test-${seed}`);
  const reachable = floodFillReachable(ow.map, ow.start.x, ow.start.y);
  for (const g of ow.townGates) {
    if (!reachable.has(`${g.x},${g.y}`)) fail('overworld town-gate', { seed, gate: g });
  }
  for (const m of ow.dungeonMouths) {
    if (!reachable.has(`${m.x},${m.y}`)) fail('overworld dungeon-mouth', { seed, mouth: m });
  }
}
console.log(`Overworld connectivity checked across ${SEED_COUNT} seeds.`);

// ---------------------------------------------------------------------------
// Dungeons: normal level (rooms + stairs-down reachable) and the boss level
// (rooms + boss zone reachable, AND the boss zone is unavoidable).
// ---------------------------------------------------------------------------
for (let seed = 1; seed <= SEED_COUNT; seed++) {
  const rng = new RNG(seed);

  const level1 = generateDungeonLevel(1, rng.fork(1));
  if (!verifyLevelConnectivity(level1)) fail('dungeon level1 connectivity', { seed });

  const bossLevel = generateDungeonLevel(DUNGEON_MAX_DEPTH, rng.fork(2));
  if (!verifyLevelConnectivity(bossLevel)) fail('dungeon boss-level connectivity', { seed });
  if (!verifyBossUnavoidable(bossLevel)) fail('dungeon boss-level unavoidable', { seed });
}
console.log(`Dungeon connectivity + boss-unavoidability checked across ${SEED_COUNT} seeds.`);

if (failures > 0) {
  console.error(`\n${failures} connectivity failure(s).`);
  process.exit(1);
} else {
  console.log('\nAll connectivity checks passed.');
}
