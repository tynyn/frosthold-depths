// save.js
// WHAT: serialize Game.state to/from localStorage save slots (max
// SAVE_SLOT_COUNT). WHY: GridMap/RNG instances carry prototype methods
// that don't survive JSON.stringify/parse, and a dungeon level carries two
// `Set` fields (bossZone, boss.skip) that JSON can't round-trip at all —
// this is the one place that knows how to flatten and rebuild those
// shapes; everywhere else in the game keeps using live GridMap/RNG
// instances and real Sets. Saving is only ever offered from FIELD mode
// (see main.js's openSaveMenu) — mid-combat/shop/chargen state is never
// captured, so this module never has to serialize any of that.

import { SAVE_SLOT_COUNT, SAVE_STORAGE_PREFIX, MAP_KIND } from './data.js';
import { reviveGridMap } from './gridmap.js';
import { RNG } from './rng.js';

// WHAT: pick an arbitrary new world seed. WHY: Math.random() (not the
// game's own seeded RNG) is correct here — the whole point is a seed the
// player couldn't have reproduced on purpose, and nothing downstream of
// picking it needs to be reproducible itself.
export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function serializeLevel(level) {
  return {
    map: level.map,
    entry: level.entry,
    stairsDown: level.stairsDown,
    bossZone: level.bossZone ? [...level.bossZone] : null,
    boss: level.boss ? { rect: level.boss.rect, skip: [...level.boss.skip], throat: level.boss.throat } : null,
    depth: level.depth,
    rooms: level.rooms,
    bossDefeated: !!level.bossDefeated,
  };
}

function deserializeLevel(saved) {
  return {
    map: reviveGridMap(saved.map),
    entry: saved.entry,
    stairsDown: saved.stairsDown,
    bossZone: saved.bossZone ? new Set(saved.bossZone) : null,
    boss: saved.boss ? { rect: saved.boss.rect, skip: new Set(saved.boss.skip), throat: saved.boss.throat } : null,
    depth: saved.depth,
    rooms: saved.rooms,
    bossDefeated: saved.bossDefeated,
  };
}

function serializeMouthState(m) {
  const levels = {};
  for (const [depth, level] of Object.entries(m.levels)) levels[depth] = serializeLevel(level);
  return { levels, rngRootSeed: m.rngRoot.seed, maxDepth: m.maxDepth };
}

function deserializeMouthState(saved) {
  const levels = {};
  for (const [depth, level] of Object.entries(saved.levels)) levels[depth] = deserializeLevel(level);
  return { levels, rngRoot: new RNG(saved.rngRootSeed), maxDepth: saved.maxDepth };
}

// WHAT: a short human-readable summary of a save — shown in the slot list
// so picking one to load/overwrite isn't a guess.
function summarize(state) {
  const alive = state.party.members.filter((c) => c.hp > 0 && !c.conditions.includes('DEAD'));
  const avgLevel = Math.round(state.party.members.reduce((sum, c) => sum + c.level, 0) / state.party.members.length);
  const where = state.map.kind === MAP_KIND.OVERWORLD ? 'the wilderness' : state.map.name;
  return { avgLevel, alive: alive.length, total: state.party.members.length, where, gold: state.party.gold };
}

export function serializeState(state) {
  return {
    version: 1,
    savedAt: Date.now(),
    seed: state.seed,
    rng: { seed: state.rng.seed, a: state.rng.a },
    mapKind: state.map.kind,
    x: state.x,
    y: state.y,
    facing: state.facing,
    currentTownId: state.currentTownId,
    currentMouthId: state.currentMouthId,
    dungeonDepth: state.dungeonDepth,
    lastTownId: state.lastTownId,
    dungeonTurnCounter: state.dungeonTurnCounter,
    restSecuredRoomRect: state.restSecuredRoomRect,
    oasisGraceSteps: state.oasisGraceSteps,
    lightTurns: state.lightTurns,
    overworld: state.overworld,
    towns: state.towns,
    dungeonMouthsState: Object.fromEntries(
      Object.entries(state.dungeonMouthsState).map(([id, m]) => [id, serializeMouthState(m)]),
    ),
    party: state.party,
    summary: summarize(state),
  };
}

// WHAT: rebuild the fields boot()/regenerateWorld() would otherwise set,
// from a saved snapshot. Returns a plain patch object — main.js's loadGame
// applies it onto Game.state and resets the handful of session-only fields
// (mode, combat, open menus, log) that a save never captures.
export function deserializeState(saved) {
  const overworld = { ...saved.overworld, map: reviveGridMap(saved.overworld.map) };
  const towns = {};
  for (const [id, town] of Object.entries(saved.towns)) towns[id] = { ...town, map: reviveGridMap(town.map) };
  const dungeonMouthsState = {};
  for (const [id, m] of Object.entries(saved.dungeonMouthsState)) dungeonMouthsState[id] = deserializeMouthState(m);

  let map;
  if (saved.mapKind === MAP_KIND.DUNGEON) map = dungeonMouthsState[saved.currentMouthId].levels[saved.dungeonDepth].map;
  else if (saved.mapKind === MAP_KIND.TOWN) map = towns[saved.currentTownId].map;
  else map = overworld.map;

  return {
    seed: saved.seed,
    rng: new RNG(saved.rng.seed, saved.rng.a),
    map,
    x: saved.x,
    y: saved.y,
    facing: saved.facing,
    overworld,
    towns,
    dungeonMouthsState,
    currentTownId: saved.currentTownId,
    currentMouthId: saved.currentMouthId,
    dungeonDepth: saved.dungeonDepth,
    lastTownId: saved.lastTownId,
    lastTown: saved.lastTownId != null && towns[saved.lastTownId] ? towns[saved.lastTownId] : null,
    dungeonTurnCounter: saved.dungeonTurnCounter,
    restSecuredRoomRect: saved.restSecuredRoomRect,
    oasisGraceSteps: saved.oasisGraceSteps,
    lightTurns: saved.lightTurns,
    party: saved.party,
  };
}

function slotKey(slot) { return `${SAVE_STORAGE_PREFIX}${slot}`; }

// WHAT: read all SAVE_SLOT_COUNT slots. WHY: the main menu's Continue list
// and the in-field save-slot picker both need "what's already in each
// slot" up front, before the player picks one.
export function listSaveSlots() {
  const out = [];
  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    let entry = null;
    try {
      const raw = localStorage.getItem(slotKey(i));
      entry = raw ? JSON.parse(raw) : null;
    } catch {
      entry = null; // corrupted slot reads as empty rather than crashing the menu
    }
    out.push(entry);
  }
  return out;
}

export function saveGameToSlot(slot, state) {
  try {
    localStorage.setItem(slotKey(slot), JSON.stringify(serializeState(state)));
    return { success: true, message: `Saved to slot ${slot + 1}.` };
  } catch {
    return { success: false, message: 'Could not save — storage is full or unavailable.' };
  }
}

export function loadGameFromSlot(slot) {
  try {
    const raw = localStorage.getItem(slotKey(slot));
    if (!raw) return null;
    return deserializeState(JSON.parse(raw));
  } catch {
    return null; // corrupted/incompatible save — caller treats this like an empty slot
  }
}

export function deleteSaveSlot(slot) {
  localStorage.removeItem(slotKey(slot));
}
