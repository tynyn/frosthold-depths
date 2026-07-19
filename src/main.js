// main.js
// WHAT: boot, mode state machine, rAF render loop, input router, map swap.
// WHY: the single orchestrator tying every shared-engine module together;
// no module here re-implements movement or rendering — it only calls the
// one shared gridmap/fpview primitives.

import {
  DIRS, DELTA, OPPOSITE, EDGE, MAP_KIND, SPECIAL_TRIGGER, DEFAULT_SEED,
  DUNGEON_MAX_DEPTH, DUNGEON_WANDERING_CHECK_INTERVAL, DUNGEON_WANDERING_CHECK_CHANCE,
  DUNGEON_DARKNESS_VIEW_DEPTH, FPVIEW_MAX_DEPTH, WEAPONS, ARMORS, SPELLS,
  BIOME_TILESET, DUNGEON_TILESET, TOWN_TILESET, BIOME_MONSTER_TAGS, TAVERN_COSTS,
  SECRET_SEARCH_BASE_CHANCE, SECRET_SEARCH_ROBBER_BONUS,
  FPVIEW_STEP_DOLLY_MS, FPVIEW_BUMP_SHAKE_MS, FPVIEW_BUMP_SHAKE_MAGNITUDE,
  MAGIC_SHOP_SPELL_MARKUP, CLASSES, STATS, RANDOM_NAMES, MAX_ROSTER_SIZE, FRONT_RANK_SIZE,
  SPELL_LEVEL_TO_CHAR_LEVEL,
} from './data.js';
import { RNG, hashString } from './rng.js';
import { GridMap, turnLeft, turnRight, tryStepForward, tryStepBackward, tryMove } from './gridmap.js';
import { renderFPView } from './fpview.js';
import { renderAutoMap, markExplored } from './automap.js';
import { MessageLog } from './log.js';
import {
  createDefaultParty, isAlive, isActive, recomputeDerived, canLevelUp, schoolFor,
  createCharacter, rollAllStats, statShortfalls, createPartyFromRoster,
} from './party.js';
import { spawnGroup, randomMonsterForTag, groupIsDefeated } from './monsters.js';
import { spellsForSchool, findSpell, castSpell, canCast } from './spells.js';
import {
  startCombat, currentActor, advance, performAttack, performBlock, performRun, performCast, performMonsterTurn,
} from './combat.js';
import {
  templeHeal, templeRestoreSp, templeCureCondition, templeResurrect, templeFullService, templeHealCost, templeRestoreSpCost,
  trainCharacter, trainingCost, buyWeapon, buyArmor, learnSpell, buyFood, restAtTavern, RUMORS,
} from './services.js';
import { generateDungeonLevel, verifyLevelConnectivity, verifyBossUnavoidable } from './dungeon.js';
import { generateTown } from './town.js';
import { generateOverworld, encounterChanceForCell } from './overworld.js';

const TOWN_NAMES = ['Frosthold', 'Ashvale', 'Millbrook', 'Cairnwatch'];

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const mapCanvas = document.getElementById('automap');
const mapCtx = mapCanvas.getContext('2d');
const hudEl = document.getElementById('hud');
const rosterEl = document.getElementById('roster');
const logEl = document.getElementById('log');
const combatPanel = document.getElementById('combat-panel');
const shopPanel = document.getElementById('shop-panel');
const castPanel = document.getElementById('cast-panel');
const overlayEl = document.getElementById('overlay');
const touchControlsEl = document.getElementById('touch-controls');
const menuPanel = document.getElementById('menu-panel');
const menuDynamic = document.getElementById('menu-dynamic');
const chargenPanel = document.getElementById('chargen-panel');
const chargenDynamic = document.getElementById('chargen-dynamic');
const chargenNameInput = document.getElementById('chargen-name-input');
const partyReviewPanel = document.getElementById('party-review-panel');
const partyReviewDynamic = document.getElementById('party-review-dynamic');

const CHARGEN_CLASS_ORDER = ['Knight', 'Paladin', 'Archer', 'Cleric', 'Sorcerer', 'Robber'];

// WHAT: hide every screen/panel except `keep`. WHY: MENU/CHARGEN/PARTY_REVIEW
// share the same grid area as combat/shop/cast/overlay — exactly one is ever
// visible, so each render* function calls this before showing its own.
function hideAllPanelsExcept(keep) {
  for (const el of [combatPanel, shopPanel, castPanel, overlayEl, menuPanel, chargenPanel, partyReviewPanel, mapCanvas]) {
    if (el !== keep) el.classList.add('hidden');
  }
}

function clearCanvasForScreen(title) {
  ctx.fillStyle = '#05050a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#6ee7ff';
  ctx.font = '20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(title, canvas.width / 2, canvas.height / 2);
}

// WHAT: replace an element's innerHTML only when the markup actually
// changed. WHY: render() runs every animation frame, but combat/shop/cast
// panels now hold real <button> elements — rewriting them unconditionally
// at 60fps destroys and recreates every button that often, which a mouse
// click usually outruns but a touch tap (a slower, multi-event gesture)
// can land mid-swap and silently miss. Panels only need to change when
// their content does.
const _lastHtml = new WeakMap();
function setHtmlIfChanged(el, html) {
  if (_lastHtml.get(el) === html) return;
  _lastHtml.set(el, html);
  el.innerHTML = html;
}

const Game = { state: null };
window.Game = Game;

// WHAT: render choice buttons. Each pair is [key, label] or [key, label,
// reasonIfDisabled]. WHY (dead-option guard): a genuinely disabled action
// gets a real HTML `disabled` button — it cannot be clicked or tapped at
// all, so "shown but does nothing" is structurally impossible, not just
// discouraged by convention. The reason string becomes both the label
// suffix and the hover/long-press tooltip.
function choiceButtons(pairs) {
  return pairs.map(([key, label, reason]) => {
    if (!reason) return `<button type="button" class="choice-btn" data-key="${key}">${label}</button>`;
    return `<button type="button" class="choice-btn" disabled title="${reason}">${label} (${reason})</button>`;
  }).join('');
}

function tagForDepth(depth) { return `dungeon${Math.min(depth, 3)}`; }
function numGroupsForDepth(depth, rng) {
  if (depth <= 1) return 1;
  return rng.int(1, Math.min(4, 1 + Math.floor(depth / 2)));
}

function boot() {
  const seed = DEFAULT_SEED;
  const rng = new RNG(seed);
  const log = new MessageLog();

  const overworldRng = rng.fork(3);
  const overworld = generateOverworld(overworldRng.fork(1), 'Wilderness');

  const state = {
    mode: 'MENU',
    seed, rng, overworldRng,
    chargenRng: rng.fork(999), // separate stream: stat rolls/random names never disturb world gen
    party: null,
    chargen: null,
    log,
    map: overworld.map,
    x: overworld.start.x, y: overworld.start.y, facing: overworld.map.entry.facing,
    overworld,
    towns: {},
    dungeonMouthsState: {},
    currentTownId: null,
    currentMouthId: null,
    dungeonDepth: null,
    dungeonTurnCounter: 0,
    restSecuredRoomRect: null,
    oasisGraceSteps: 0,
    showAutoMap: false,
    combat: null,
    combatUI: null,
    shop: null,
    lightTurns: 0,
    lastTown: null,
    lastTownId: null,
    reducedMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    dollyAnim: null,
    dollyQueue: [],
    bumpShake: null,
  };
  Game.state = state;

  markExplored(state.map, state.x, state.y);

  window.addEventListener('keydown', onKeyDown);
  document.body.addEventListener('click', onTouchButton);
  requestAnimationFrame(loop);
}

// WHAT: hand a finished party (premade or player-built) to the game and drop
// into FIELD. WHY: one party model, one entry point — Quick Start and
// Create Party's confirm step both funnel through here, nothing downstream
// of this point knows or cares which path built the party.
function beginAdventure(party) {
  const s = Game.state;
  s.party = party;
  s.chargen = null;
  s.mode = 'FIELD';
  s.log.push('You stand in the wilderness. The Frosthold Depths lie somewhere below.');
  s.log.push('Arrows/WASD move+turn, Space/Enter interact, M automap.');
}

// ---------------------------------------------------------------------------
// TILESET / KIND HELPERS
// ---------------------------------------------------------------------------

// WHAT: an opaque per-map identity number folding the world seed into the
// map's name. WHY: fpview's per-cell wall detail is keyed by (mapSeed, cellX,
// cellY, edgeDir) — this keeps two different maps that happen to share a
// coordinate (e.g. every dungeon level has a cell (3,4)) from ever drawing
// identical wall texture, and reproduces identically under the same seed.
function mapSeedFor(map) {
  return hashString(`${Game.state.seed}:${map.name}`);
}

function tilesetFor(map, x, y) {
  if (map.kind === MAP_KIND.DUNGEON) return DUNGEON_TILESET;
  if (map.kind === MAP_KIND.TOWN) return TOWN_TILESET;
  const biome = map.cellAt(x, y).terrain;
  return BIOME_TILESET[biome] || BIOME_TILESET.PLAINS;
}

function formatCoord(map, x, y) {
  if (map.kind === MAP_KIND.OVERWORLD) return `${x},${y}`;
  return `${String.fromCharCode(65 + (x % 26))}-${y + 1}`;
}

// ---------------------------------------------------------------------------
// MOVEMENT — the shared step()/rotate() the spec requires
// ---------------------------------------------------------------------------

function rotate(dir) {
  const s = Game.state;
  if (s.mode !== 'FIELD') return;
  s.facing = dir === 'L' ? turnLeft(s.facing) : turnRight(s.facing);
  // free turn: NO advanceTurn() call — re-render only.
}

// WHAT: queue a cosmetic forward/back "dolly" push — never called for
// strafe, which cuts instantly as before. WHY: this is purely visual; game
// state and turn timing are already committed by the time this runs. A
// tween already in progress is never stacked on — the new one queues and
// plays after, so rapid input never compounds into a runaway offset.
function queueDolly(sign) {
  const s = Game.state;
  if (s.reducedMotion) return;
  if (s.dollyAnim) s.dollyQueue.push(sign);
  else s.dollyAnim = { sign, startTime: performance.now() };
}

// WHAT: trigger the short screen-shake + already-existing log line for a
// bump. WHY: "no silent no-op" — a blocked step must always be visibly and
// audibly (via the log) obvious, never just... nothing happening.
function triggerBumpShake() {
  const s = Game.state;
  if (s.reducedMotion) return;
  s.bumpShake = { startTime: performance.now() };
}

function step(kind) {
  const s = Game.state;
  if (s.mode !== 'FIELD') return;
  let result;
  if (kind === 'F') result = tryStepForward(s.map, s.x, s.y, s.facing);
  else if (kind === 'B') result = tryStepBackward(s.map, s.x, s.y, s.facing);
  else result = tryMove(s.map, s.x, s.y, kind); // strafe: absolute dir L/R of facing

  if (!result.moved) { s.log.push('A wall blocks your way.'); triggerBumpShake(); return; }
  s.x = result.x; s.y = result.y;
  markExplored(s.map, s.x, s.y);
  if (kind === 'F' || kind === 'B') queueDolly(kind === 'F' ? 1 : -1);
  advanceTurn();
}

function strafe(side) {
  const s = Game.state;
  if (s.mode !== 'FIELD') return;
  const dir = side === 'L' ? turnLeft(s.facing) : turnRight(s.facing);
  step(dir);
}

// WHAT: the SOLE place a turn advances — random encounters + on-enter
// specials fire here, never from rotate().
function advanceTurn() {
  const s = Game.state;
  if (s.lightTurns > 0) s.lightTurns -= 1;
  const cell = s.map.cellAt(s.x, s.y);
  if (cell.special && SPECIAL_TRIGGER[cell.special.type] === 'step') {
    dispatchSpecial(cell.special);
    if (s.mode !== 'FIELD') return; // special changed mode (combat/shop/transition)
  }
  if (s.map.kind === MAP_KIND.DUNGEON) {
    if (s.restSecuredRoomRect) {
      // Secured-room rest suppresses the normal wandering check entirely
      // while the party is still inside; the moment they step out, exactly
      // one check fires (not the accrued turn cadence), then the secure
      // state ends — matching "check for encounter upon leaving room."
      if (inRoomRect(s.x, s.y, s.restSecuredRoomRect)) {
        // still inside: no check at all
      } else {
        if (s.rng.chance(DUNGEON_WANDERING_CHECK_CHANCE)) startEncounterFlow();
        s.restSecuredRoomRect = null;
      }
    } else {
      // Classic wandering-monster check: a flat chance rolled on a fixed turn
      // cadence, not a continuous per-step probability — depth danger comes
      // from monster tags/group counts (tagForDepth/numGroupsForDepth) instead.
      s.dungeonTurnCounter += 1;
      if (s.dungeonTurnCounter >= DUNGEON_WANDERING_CHECK_INTERVAL) {
        s.dungeonTurnCounter = 0;
        if (s.rng.chance(DUNGEON_WANDERING_CHECK_CHANCE)) startEncounterFlow();
      }
    }
  } else if (s.map.kind === MAP_KIND.OVERWORLD) {
    if (s.oasisGraceSteps > 0) {
      // A brief no-roll grace period after resting at an oasis.
      s.oasisGraceSteps -= 1;
    } else {
      const rate = encounterChanceForCell(s.map, s.x, s.y);
      if (rate > 0 && s.rng.chance(rate)) startEncounterFlow();
    }
  }
}

// ---------------------------------------------------------------------------
// REST — a field action distinct from Tavern rest, with location-dependent
// safety: the wilds and a secured dungeon room aren't a paid inn room, so
// resting there carries risk (or, at a fountain/oasis, doesn't).
// ---------------------------------------------------------------------------

function inRoomRect(x, y, r) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

function currentDungeonLevel() {
  const s = Game.state;
  if (s.map.kind !== MAP_KIND.DUNGEON || s.currentMouthId == null) return null;
  return s.dungeonMouthsState[s.currentMouthId]?.levels[s.dungeonDepth] || null;
}

// WHAT: a room can be rested in only if every edge connecting one of its
// cells to a cell outside the room is NOT a plain open passage — a door
// (closed by default in this engine — nothing ever props one open),
// secret door, or wall all count as "sealed" — and no trap inside it is
// still unsprung. WHY: this is what "the party must secure the room; door
// closed and no untriggered traps" means in terms of the map's edge data.
function roomIsSecure(map, room) {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const cell = map.cellAt(x, y);
      if (cell.special?.type === 'DAMAGE_TRAP' && !cell.special.payload.triggered) return false;
      for (const dir of DIRS) {
        const { dx, dy } = DELTA[dir];
        const nx = x + dx, ny = y + dy;
        if (inRoomRect(nx, ny, room)) continue; // interior edge, not a boundary
        if (map.getEdge(x, y, dir) === EDGE.OPEN) return false; // undoored connection to the outside
      }
    }
  }
  return true;
}

function restInField() {
  const s = Game.state;
  if (s.mode !== 'FIELD') return;
  const cell = s.map.cellAt(s.x, s.y);

  if (s.map.kind === MAP_KIND.DUNGEON) {
    if (cell.special?.type === 'FOUNTAIN') {
      // A fountain is inherently safe — no roll, and resting there costs no
      // turn at all (a free action, like turning in place).
      s.log.push(restAtTavern(s.party).message);
      s.log.push("The fountain's calm wards off danger — resting here is free.");
      return;
    }
    const level = currentDungeonLevel();
    const room = level?.rooms.find((r) => inRoomRect(s.x, s.y, r));
    if (!room) { s.log.push('There is no room to secure here — you can only rest behind a sealed door.'); return; }
    if (!roomIsSecure(s.map, room)) { s.log.push('This room is not secure — an open passage or a live trap remains.'); return; }
    const result = restAtTavern(s.party);
    s.log.push(result.message);
    if (result.success) {
      s.restSecuredRoomRect = room;
      s.log.push('The party rests behind the sealed door.');
    }
    return;
  }

  if (s.map.kind === MAP_KIND.OVERWORLD) {
    if (cell.special?.type === 'OASIS') {
      s.log.push(restAtTavern(s.party).message);
      s.oasisGraceSteps = 2;
      s.log.push('The oasis shelters the party — no danger stirs as they rest.');
      return;
    }
    const chance = encounterChanceForCell(s.map, s.x, s.y);
    if (chance > 0 && s.rng.chance(chance)) {
      s.log.push('You are ambushed while trying to rest!');
      startEncounterFlow();
      return;
    }
    const result = restAtTavern(s.party);
    s.log.push(result.message);
    if (!result.success) return;
    if (chance > 0 && s.rng.chance(chance)) {
      s.log.push('Something disturbs the party as they wake!');
      startEncounterFlow();
    }
    return;
  }

  s.log.push('There is nowhere to rest here — try the tavern in town.');
}

// ---------------------------------------------------------------------------
// SPECIAL SQUARE DISPATCH
// ---------------------------------------------------------------------------

function dispatchSpecial(special) {
  const s = Game.state;
  switch (special.type) {
    case 'STAIRS_UP': {
      if (s.dungeonDepth === 1) {
        const mouth = s.overworld.dungeonMouths[s.currentMouthId];
        s.map = s.overworld.map; s.x = mouth.x; s.y = mouth.y; s.facing = 'S';
        s.currentMouthId = null; s.dungeonDepth = null;
        s.log.push('You climb out onto the overworld.');
      } else {
        const mouthState = s.dungeonMouthsState[s.currentMouthId];
        const level = mouthState.levels[s.dungeonDepth - 1];
        s.dungeonDepth -= 1;
        s.map = level.map; s.x = level.stairsDown ? level.stairsDown.x : 0; s.y = level.stairsDown ? level.stairsDown.y : 0;
        s.facing = 'N';
        s.log.push(`You climb up to ${s.map.name}.`);
      }
      markExplored(s.map, s.x, s.y);
      break;
    }
    case 'STAIRS_DOWN': {
      const nextDepth = special.payload.nextDepth;
      const mouthState = s.dungeonMouthsState[s.currentMouthId];
      if (!mouthState.levels[nextDepth]) {
        mouthState.levels[nextDepth] = generateDungeonLevel(nextDepth, mouthState.rngRoot.fork(nextDepth), mouthState.maxDepth);
      }
      const level = mouthState.levels[nextDepth];
      s.dungeonDepth = nextDepth;
      s.map = level.map; s.x = level.entry.x; s.y = level.entry.y; s.facing = level.entry.facing;
      markExplored(s.map, s.x, s.y);
      s.log.push(`You descend to ${s.map.name}.`);
      break;
    }
    case 'TOWN_GATE': {
      const townId = special.payload.townId;
      if (!s.towns[townId]) {
        s.towns[townId] = generateTown(s.overworldRng.fork(100 + townId), TOWN_NAMES[townId % TOWN_NAMES.length]);
      }
      const town = s.towns[townId];
      s.currentTownId = townId;
      s.lastTown = town; s.lastTownId = townId;
      s.map = town.map; s.x = town.map.entry.x; s.y = town.map.entry.y; s.facing = town.map.entry.facing;
      markExplored(s.map, s.x, s.y);
      s.log.push(`You enter ${s.map.name}.`);
      break;
    }
    case 'DUNGEON_MOUTH': {
      const mouthId = special.payload.mouthId;
      if (!s.dungeonMouthsState[mouthId]) {
        const rngRoot = s.overworldRng.fork(200 + mouthId);
        const maxDepth = mouthId === 0 ? DUNGEON_MAX_DEPTH : Math.min(2, DUNGEON_MAX_DEPTH - 1);
        s.dungeonMouthsState[mouthId] = { levels: { 1: generateDungeonLevel(1, rngRoot.fork(1), maxDepth) }, rngRoot, maxDepth };
      }
      s.currentMouthId = mouthId;
      const level1 = s.dungeonMouthsState[mouthId].levels[1];
      s.dungeonDepth = 1;
      s.map = level1.map; s.x = level1.entry.x; s.y = level1.entry.y; s.facing = level1.entry.facing;
      markExplored(s.map, s.x, s.y);
      s.log.push(`You descend into ${s.map.name}.`);
      break;
    }
    case 'GATE': {
      const gateCoord = s.overworld.townGates[s.currentTownId];
      s.map = s.overworld.map; s.x = gateCoord.x; s.y = gateCoord.y; s.facing = 'S';
      s.currentTownId = null;
      markExplored(s.map, s.x, s.y);
      s.log.push('You step back out onto the overworld.');
      break;
    }
    case 'SHRINE': {
      if (!special.payload.used) {
        special.payload.used = true;
        for (const c of s.party.members) if (isAlive(c)) { c.stats[special.payload.stat] += special.payload.amount; recomputeDerived(c); }
        s.log.push(`A shrine blesses the party's ${special.payload.stat}!`);
      } else {
        s.log.push('The shrine is spent.');
      }
      break;
    }
    case 'CACHE': {
      if (!special.payload.used) {
        special.payload.used = true;
        s.party.gold += special.payload.gold;
        s.log.push(`You find a cache of ${special.payload.gold} gold.`);
      } else {
        s.log.push('This cache is empty.');
      }
      break;
    }
    case 'OASIS': {
      if (!special.payload.used) {
        special.payload.used = true;
        for (const c of s.party.members) if (isAlive(c)) c.hp = Math.min(c.maxHp, c.hp + Math.ceil(c.maxHp * special.payload.fraction));
        s.log.push("The oasis restores the party's health.");
      } else {
        s.log.push('The oasis is dry.');
      }
      break;
    }
    case 'SHOPKEEPER': {
      openShop(special.payload.service);
      break;
    }
    case 'NPC': {
      s.log.push(special.payload.text);
      break;
    }
    case 'MESSAGE': {
      s.log.push(special.payload.text);
      break;
    }
    case 'SPINNER': {
      s.facing = s.rng.choice(DIRS);
      s.log.push('The floor spins beneath you!');
      break;
    }
    case 'TELEPORTER': {
      s.x = special.payload.x; s.y = special.payload.y;
      markExplored(s.map, s.x, s.y);
      s.log.push('You are wrenched through space!');
      break;
    }
    case 'DAMAGE_TRAP': {
      special.payload.triggered = true; // rest-security check: a sprung trap is no longer "untriggered"
      const alive = s.party.members.filter(isActive);
      if (alive.length) {
        const target = s.rng.choice(alive);
        const dmg = s.rng.int(special.payload.dmg[0], special.payload.dmg[1]);
        target.hp = Math.max(0, target.hp - dmg);
        s.log.push(`A trap springs! ${target.name} takes ${dmg} damage.`);
        if (target.hp === 0) target.conditions.push('DEAD');
      }
      break;
    }
    case 'FOUNTAIN': {
      if (!special.payload.used) {
        special.payload.used = true;
        for (const c of s.party.members) if (isAlive(c)) c.sp = Math.min(c.maxSp, c.sp + special.payload.sp);
        s.log.push('The fountain restores your party\'s spell points.');
      } else {
        s.log.push('The fountain is dry.');
      }
      break;
    }
    case 'ENCOUNTER': {
      startEncounterFlow();
      break;
    }
    case 'BOSS_ZONE': {
      const level = s.dungeonMouthsState[s.currentMouthId].levels[s.dungeonDepth];
      if (!level.bossDefeated) startBossFight(level);
      break;
    }
    default: break;
  }
}

function interact() {
  const s = Game.state;
  if (s.mode !== 'FIELD') return;
  const cell = s.map.cellAt(s.x, s.y);
  if (cell.special && SPECIAL_TRIGGER[cell.special.type] === 'interact') {
    if (cell.special.type === 'CHEST') openChest(cell.special);
    else if (cell.special.type === 'NPC') s.log.push(cell.special.payload.text);
    return;
  }
  searchForSecret();
}

// WHAT: attempt to find a secret door in the wall directly ahead.
// WHY: secret doors "look like walls" until searched out — Robbers are
// better at sensing them, per spec.
function searchForSecret() {
  const s = Game.state;
  if (s.map.getEdge(s.x, s.y, s.facing) !== EDGE.SECRET) { s.log.push('You find nothing unusual.'); return; }
  const cell = s.map.cellAt(s.x, s.y);
  if (cell.secretFound[s.facing]) { s.log.push('You already found the hidden door here.'); return; }
  const hasRobber = s.party.members.some((m) => m.cls === 'Robber' && isAlive(m));
  const chance = SECRET_SEARCH_BASE_CHANCE + (hasRobber ? SECRET_SEARCH_ROBBER_BONUS : 0);
  if (s.rng.chance(chance)) {
    cell.secretFound[s.facing] = true;
    const { dx, dy } = DELTA[s.facing];
    const neighbor = s.map.cellAt(s.x + dx, s.y + dy);
    if (neighbor) neighbor.secretFound[OPPOSITE[s.facing]] = true;
    s.log.push('You discover a hidden door!');
  } else {
    s.log.push('You search but find nothing.');
  }
}

function openChest(special) {
  const s = Game.state;
  const p = special.payload;
  if (p.opened) { s.log.push('The chest is empty.'); return; }
  if (p.trapped) {
    const target = s.rng.choice(s.party.members.filter(isActive));
    if (target) {
      const dmg = s.rng.int(2, 8);
      target.hp = Math.max(0, target.hp - dmg);
      s.log.push(`The chest was trapped! ${target.name} takes ${dmg} damage.`);
    }
  }
  s.party.gold += p.gold;
  s.party.gems += p.gems;
  p.opened = true;
  s.log.push(`You find ${p.gold} gold${p.gems ? ` and ${p.gems} gem(s)` : ''} in the chest.`);
}

// ---------------------------------------------------------------------------
// COMBAT FLOW
// ---------------------------------------------------------------------------

function startEncounterFlow(groupsOverride, opts = {}) {
  const s = Game.state;
  let groups = groupsOverride;
  if (!groups) {
    let tag, numGroups;
    if (s.map.kind === MAP_KIND.DUNGEON) {
      tag = tagForDepth(s.dungeonDepth);
      numGroups = numGroupsForDepth(s.dungeonDepth, s.rng);
    } else {
      tag = BIOME_MONSTER_TAGS[s.map.cellAt(s.x, s.y).terrain] || 'plains';
      numGroups = 1;
    }
    groups = Array.from({ length: numGroups }, () => spawnGroup(randomMonsterForTag(tag, s.rng), s.rng));
  }
  s.combat = startCombat(s.party, groups, s.rng, s.log, opts);
  s.mode = 'COMBAT';
  s.combatUI = { phase: 'ACTION', actorIdx: null, spell: null };
  runUntilPartyTurnOrEnd();
  finalizeCombatIfEnded();
}

function startBossFight(level) {
  const group = spawnGroup(null, Game.state.rng, true);
  startEncounterFlow([group], { bossFight: true });
  Game.state._bossLevel = level;
}

function runUntilPartyTurnOrEnd() {
  const s = Game.state;
  while (s.combat.active) {
    const actor = currentActor(s.combat);
    if (!actor) break;
    if (actor.kind === 'group') {
      performMonsterTurn(s.combat, s.party, actor.idx);
      advance(s.combat, s.party);
    } else {
      s.combatUI.phase = 'ACTION';
      s.combatUI.actorIdx = actor.idx;
      break;
    }
  }
}

function finalizeCombatIfEnded() {
  const s = Game.state;
  if (!s.combat || s.combat.active) return;
  if (s.combat.result !== 'defeat') {
    // AFRAID is cured at the end of any combat that isn't a TPK.
    for (const m of s.party.members) m.conditions = m.conditions.filter((c) => c !== 'AFRAID');
  }
  if (s.combat.result === 'victory') {
    if (s.combat.bossFight && s._bossLevel) {
      s._bossLevel.bossDefeated = true;
      for (const k of s._bossLevel.bossZone) {
        const [x, y] = k.split(',').map(Number);
        s._bossLevel.map.cellAt(x, y).special = null;
      }
      s.mode = 'VICTORY';
      s.combat = null;
      return;
    }
    s.mode = 'FIELD';
    s.combat = null;
  } else if (s.combat.result === 'defeat') {
    s.mode = 'DEAD';
  } else if (s.combat.result === 'fled') {
    s.mode = 'FIELD';
    s.combat = null;
  }
}

function restartFromTown() {
  const s = Game.state;
  for (const c of s.party.members) {
    c.conditions = [];
    c.hp = c.maxHp;
    c.sp = c.maxSp;
  }
  s.combat = null;
  s.currentMouthId = null;
  s.dungeonDepth = null;
  if (s.lastTown) {
    s.currentTownId = s.lastTownId;
    s.map = s.lastTown.map;
    s.x = s.lastTown.map.entry.x; s.y = s.lastTown.map.entry.y; s.facing = s.lastTown.map.entry.facing;
    s.log.push('The party awakens back in town, alive but shaken.');
  } else {
    s.currentTownId = null;
    s.map = s.overworld.map;
    s.x = s.overworld.start.x; s.y = s.overworld.start.y; s.facing = s.overworld.map.entry.facing;
    s.log.push('The party awakens in the wilderness, alive but shaken.');
  }
  markExplored(s.map, s.x, s.y);
  s.mode = 'FIELD';
}

function handleCombatKey(key) {
  const s = Game.state;
  const ui = s.combatUI;
  const combat = s.combat;
  if (ui.phase === 'ACTION') {
    if (key === '1') { ui.phase = 'TARGET_GROUP'; ui.pendingAction = 'attack'; }
    else if (key === '2') {
      const actor = s.party.members[ui.actorIdx];
      const spells = combatEligibleSpells(actor);
      if (!spells.length) return; // dead-option guard: the button is disabled in this state, not clickable
      ui.spellChoices = spells;
      ui.phase = 'SPELL_SELECT';
    } else if (key === '3') {
      performBlock(combat, s.party, ui.actorIdx);
      endActorTurn();
    } else if (key === '4') {
      performRun(combat, s.party);
      finalizeCombatIfEnded();
      if (s.mode === 'COMBAT') endActorTurn();
    }
    return;
  }
  if (ui.phase === 'TARGET_GROUP') {
    const idx = parseInt(key, 10) - 1;
    if (idx >= 0 && idx < combat.groups.length && !groupIsDefeated(combat.groups[idx])) {
      performAttack(combat, s.party, ui.actorIdx, idx);
      endActorTurn();
    }
    return;
  }
  if (ui.phase === 'SPELL_SELECT') {
    const idx = parseInt(key, 10) - 1;
    const spell = ui.spellChoices[idx];
    if (!spell) return;
    const actor = s.party.members[ui.actorIdx];
    if (!canCast(actor, spell)) { s.log.push(`${actor.name} lacks the SP for ${spell.name}.`); return; }
    ui.spell = spell;
    if (spell.target === 'group') ui.phase = 'SPELL_TARGET_GROUP';
    else if (spell.target === 'ally') ui.phase = 'SPELL_TARGET_ALLY';
    else {
      performCast(combat, s.party, ui.actorIdx, spell);
      endActorTurn();
    }
    return;
  }
  if (ui.phase === 'SPELL_TARGET_GROUP') {
    const idx = parseInt(key, 10) - 1;
    if (idx >= 0 && idx < combat.groups.length && !groupIsDefeated(combat.groups[idx])) {
      performCast(combat, s.party, ui.actorIdx, ui.spell, idx);
      endActorTurn();
    }
    return;
  }
  if (ui.phase === 'SPELL_TARGET_ALLY') {
    const idx = parseInt(key, 10) - 1;
    if (idx >= 0 && idx < s.party.members.length) {
      performCast(combat, s.party, ui.actorIdx, ui.spell, null, idx);
      endActorTurn();
    }
    return;
  }
}

function endActorTurn() {
  const s = Game.state;
  advance(s.combat, s.party);
  finalizeCombatIfEnded();
  if (s.mode === 'COMBAT') {
    runUntilPartyTurnOrEnd();
    finalizeCombatIfEnded();
  }
}

// ---------------------------------------------------------------------------
// SHOP FLOW
// ---------------------------------------------------------------------------

function openShop(serviceType) {
  const s = Game.state;
  s.mode = 'SHOP';
  s.shop = { type: serviceType, charIdx: 0 };
  s.log.push(`You approach the ${serviceType.replace('_', ' ').toLowerCase()}.`);
}

function shopCharacter() { return Game.state.party.members[Game.state.shop.charIdx]; }

function cycleShopChar(delta) {
  const s = Game.state;
  s.shop.charIdx = (s.shop.charIdx + delta + s.party.members.length) % s.party.members.length;
}

function handleShopKey(key) {
  const s = Game.state;
  const shop = s.shop;
  if (key === 'Escape' || key === 'Backspace') { s.mode = 'FIELD'; s.shop = null; return; }
  if (key === ',') { cycleShopChar(-1); return; }
  if (key === '.') { cycleShopChar(1); return; }
  const c = shopCharacter();
  const say = (r) => s.log.push(r.message);
  if (shop.type === 'TEMPLE') {
    if (key === '1') { say(templeHeal(s.party, c)); say(templeRestoreSp(s.party, c)); for (const cond of [...c.conditions]) if (cond !== 'DEAD') say(templeCureCondition(s.party, c, cond)); }
    if (key === '2') { if (c.conditions.includes('DEAD')) say(templeResurrect(s.party, c)); }
    if (key === '3') { for (const msg of templeFullService(s.party)) s.log.push(msg); }
  } else if (shop.type === 'BLACKSMITH') {
    const n = parseInt(key, 10);
    if (n >= 1 && n <= WEAPONS.length) say(buyWeapon(s.party, c, WEAPONS[n - 1].id));
    else if (n > WEAPONS.length && n <= WEAPONS.length + ARMORS.length) say(buyArmor(s.party, c, ARMORS[n - WEAPONS.length - 1].id));
  } else if (shop.type === 'MAGIC_SHOP') {
    const school = schoolFor(c);
    if (school) {
      const n = parseInt(key, 10);
      const list = spellsForSchool(school);
      if (n >= 1 && n <= list.length) say(learnSpell(s.party, c, list[n - 1].id));
    }
  } else if (shop.type === 'TRAINING_GROUNDS') {
    if (key === '1') say(trainCharacter(s.party, c));
  } else if (shop.type === 'TAVERN') {
    if (key === '1') say(buyFood(s.party, 5));
    if (key === '2') say(restAtTavern(s.party));
    if (key === '3') s.log.push(s.rng.choice(RUMORS));
  }
}

// ---------------------------------------------------------------------------
// CHARACTER CREATION — MENU / CHARGEN / PARTY_REVIEW
// WHY: "one party model, no parallel path" — Quick Start and a finished
// Create Party roster both end up calling beginAdventure(party) with a party
// built by createDefaultParty()/createPartyFromRoster(), never anything else.
// ---------------------------------------------------------------------------

function freshDraft() {
  return { stats: rollAllStats(Game.state.chargenRng), cls: null };
}

function handleMenuKey(key) {
  if (key === '1' || key === 'quick-start') beginAdventure(createDefaultParty());
  else if (key === '2' || key === 'create-party') startChargen();
}

function startChargen() {
  const s = Game.state;
  s.chargen = { roster: [], draft: freshDraft() };
  s.mode = 'CHARGEN';
  chargenNameInput.value = '';
}

function addDraftToRoster() {
  const s = Game.state;
  const cg = s.chargen;
  if (!cg.draft.cls || cg.roster.length >= MAX_ROSTER_SIZE) return;
  const name = chargenNameInput.value.trim() || `Recruit ${cg.roster.length + 1}`;
  cg.roster.push({ name, cls: cg.draft.cls, stats: cg.draft.stats });
  cg.draft = freshDraft();
  chargenNameInput.value = '';
  if (cg.roster.length >= MAX_ROSTER_SIZE) s.mode = 'PARTY_REVIEW';
}

function handleChargenKey(key) {
  const s = Game.state;
  const cg = s.chargen;
  if (key === 'cancel-chargen' || key === 'Escape') { s.chargen = null; s.mode = 'MENU'; return; }
  if (key === 'r' || key === 'R') {
    cg.draft.stats = rollAllStats(s.chargenRng);
    if (cg.draft.cls && statShortfalls(cg.draft.cls, cg.draft.stats).length) cg.draft.cls = null;
    return;
  }
  if (key === 'random-name') { chargenNameInput.value = s.chargenRng.choice(RANDOM_NAMES); return; }
  if (/^[1-6]$/.test(key)) {
    const cls = CHARGEN_CLASS_ORDER[parseInt(key, 10) - 1];
    if (!statShortfalls(cls, cg.draft.stats).length) cg.draft.cls = cls;
    return;
  }
  if (key === 'add-to-roster') { addDraftToRoster(); return; }
  if (key === 'finish-roster') { if (cg.roster.length >= 1) s.mode = 'PARTY_REVIEW'; return; }
}

function handlePartyReviewKey(key) {
  const s = Game.state;
  const cg = s.chargen;
  const m = key.match(/^(remove|up|down)-(\d+)$/);
  if (m) {
    const idx = parseInt(m[2], 10);
    if (m[1] === 'remove') cg.roster.splice(idx, 1);
    else if (m[1] === 'up' && idx > 0) [cg.roster[idx - 1], cg.roster[idx]] = [cg.roster[idx], cg.roster[idx - 1]];
    else if (m[1] === 'down' && idx < cg.roster.length - 1) [cg.roster[idx], cg.roster[idx + 1]] = [cg.roster[idx + 1], cg.roster[idx]];
    return;
  }
  if (key === 'add-more') {
    if (cg.roster.length < MAX_ROSTER_SIZE) { cg.draft = freshDraft(); s.mode = 'CHARGEN'; chargenNameInput.value = ''; }
    return;
  }
  if (key === 'confirm-party') { if (cg.roster.length >= 1) beginAdventure(createPartyFromRoster(cg.roster)); return; }
}

// ---------------------------------------------------------------------------
// INPUT ROUTER
// ---------------------------------------------------------------------------

// WHAT: the one input router, driven by a key STRING rather than a
// KeyboardEvent. WHY: this lets a tap on an on-screen button feed the exact
// same dispatch a keypress does — touch is a second input SOURCE, never a
// second set of rules. onKeyDown and the touch-button click handler are the
// only two callers.
function handleKey(key) {
  const s = Game.state;
  if (s.mode === 'MENU') { handleMenuKey(key); return; }
  if (s.mode === 'CHARGEN') { handleChargenKey(key); return; }
  if (s.mode === 'PARTY_REVIEW') { handlePartyReviewKey(key); return; }
  if (s.mode === 'DEAD') { if (key === 'Enter' || key === ' ') restartFromTown(); return; }
  if (s.mode === 'VICTORY') { if (key === 'Enter' || key === ' ') { s.mode = 'FIELD'; } return; }
  if (s.mode === 'COMBAT') { handleCombatKey(key); return; }
  if (s.mode === 'SHOP') { handleShopKey(key); return; }
  if (s.mode === 'CAST') { handleFieldCastKey(key); return; }

  switch (key) {
    case 'ArrowUp': case 'w': case 'W': step('F'); break;
    case 'ArrowDown': case 's': case 'S': step('B'); break;
    case 'ArrowLeft': case 'a': case 'A': rotate('L'); break;
    case 'ArrowRight': case 'd': case 'D': rotate('R'); break;
    case 'q': case 'Q': strafe('L'); break;
    case 'e': case 'E': strafe('R'); break;
    case ' ': case 'Enter': interact(); break;
    case 'm': case 'M': s.showAutoMap = !s.showAutoMap; break;
    case 'c': case 'C': openFieldCast(); break;
    case 'r': case 'R': restInField(); break;
    default: break;
  }
}

// WHAT: ignore game-key shortcuts while a text input has focus. WHY: the
// chargen name field shares letters (r, c, 1-6...) with movement/action
// shortcuts — without this guard, typing a name would also reroll stats,
// pick a class, or cast a spell.
function onKeyDown(e) {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  handleKey(e.key);
}

// WHAT: one delegated click/tap listener for the whole document. WHY: every
// on-screen control (D-pad, combat/shop/cast choice buttons, the D-pad's
// action row, the death/victory continue button) is just a button carrying
// data-key — this is the only place touch input enters the game.
function onTouchButton(e) {
  const btn = e.target.closest('[data-key]');
  if (!btn) return;
  handleKey(btn.dataset.key);
}

// ---------------------------------------------------------------------------
// FIELD CASTING — spells usable outside combat (Light, Heal, cures, etc).
// WHY: group-target combat spells (damage/sleep) make no sense here, so the
// eligible list is filtered to self/ally/party-target spells only.
// ---------------------------------------------------------------------------

function fieldEligibleSpells(character) {
  return character.knownSpells.map(findSpell).filter((sp) => sp && !sp.combatOnly && sp.target !== 'group');
}

function combatEligibleSpells(character) {
  return character.knownSpells.map(findSpell).filter((sp) => sp && !sp.explorationOnly);
}

function openFieldCast() {
  const s = Game.state;
  if (s.mode !== 'FIELD') return;
  const casters = s.party.members.filter((m) => isAlive(m) && fieldEligibleSpells(m).length > 0);
  if (!casters.length) { s.log.push('No one has a spell worth casting here.'); return; }
  const idx = s.party.members.indexOf(casters[0]);
  s.mode = 'CAST';
  s.fieldCast = { casterIdx: idx, phase: 'SPELL', spell: null };
}

function fieldCastCaster() { return Game.state.party.members[Game.state.fieldCast.casterIdx]; }

function cycleFieldCaster(delta) {
  const s = Game.state;
  const n = s.party.members.length;
  let idx = s.fieldCast.casterIdx;
  for (let i = 0; i < n; i++) {
    idx = (idx + delta + n) % n;
    if (isAlive(s.party.members[idx]) && fieldEligibleSpells(s.party.members[idx]).length > 0) break;
  }
  s.fieldCast.casterIdx = idx;
}

function handleFieldCastKey(key) {
  const s = Game.state;
  const fc = s.fieldCast;
  if (key === 'Escape' || key === 'Backspace') { s.mode = 'FIELD'; s.fieldCast = null; return; }
  if (fc.phase === 'SPELL') {
    if (key === ',') { cycleFieldCaster(-1); return; }
    if (key === '.') { cycleFieldCaster(1); return; }
    const list = fieldEligibleSpells(fieldCastCaster());
    const spell = list[parseInt(key, 10) - 1];
    if (!spell) return;
    const caster = fieldCastCaster();
    if (!canCast(caster, spell)) { s.log.push(`${caster.name} lacks the SP for ${spell.name}.`); return; }
    fc.spell = spell;
    if (spell.target === 'ally') { fc.phase = 'TARGET'; return; }
    castSpell(spell, { caster, party: s.party, log: s.log, rng: s.rng, state: s });
    s.mode = 'FIELD'; s.fieldCast = null;
    return;
  }
  if (fc.phase === 'TARGET') {
    const idx = parseInt(key, 10) - 1;
    if (idx >= 0 && idx < s.party.members.length) {
      castSpell(fc.spell, { caster: fieldCastCaster(), party: s.party, log: s.log, rng: s.rng, state: s, targetCharacter: s.party.members[idx] });
      s.mode = 'FIELD'; s.fieldCast = null;
    }
  }
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

function renderRoster() {
  const s = Game.state;
  const html = s.party.members.map((c, i) => {
    const dead = c.conditions.includes('DEAD');
    const cond = c.conditions.filter((x) => x !== 'DEAD').join(',');
    return `<div class="hero${dead ? ' dead' : ''}${s.mode === 'COMBAT' && s.combatUI.actorIdx === i ? ' active' : ''}">
      <b>${i + 1}. ${c.name}</b> Lv${c.level} ${c.cls}<br/>
      HP ${c.hp}/${c.maxHp}  SP ${c.sp}/${c.maxSp}  AC ${c.ac}${cond ? `<br/><i>${cond}</i>` : ''}
    </div>`;
  }).join('') + `<div class="resources">Gold: ${s.party.gold}  Gems: ${s.party.gems}  Food: ${s.party.food}</div>`;
  setHtmlIfChanged(rosterEl, html);
}

// WHAT: advance and read the current step-dolly camera offset. WHY: called
// once per frame from renderField only — it owns the tween/queue-advance
// side effect, so it must never be called more than once per frame.
function currentDollyOffset() {
  const s = Game.state;
  if (!s.dollyAnim) return 0;
  const elapsed = performance.now() - s.dollyAnim.startTime;
  const t = Math.min(1, elapsed / FPVIEW_STEP_DOLLY_MS);
  const offset = (1 - t) * s.dollyAnim.sign;
  if (t >= 1) {
    s.dollyAnim = s.dollyQueue.length ? { sign: s.dollyQueue.shift(), startTime: performance.now() } : null;
  }
  return offset;
}

// WHAT: advance and read the current bump-shake screen offset (decaying
// jitter, not random per frame — a smooth sine keeps it from looking noisy).
function currentShakeOffset() {
  const s = Game.state;
  if (!s.bumpShake) return { dx: 0, dy: 0 };
  const elapsed = performance.now() - s.bumpShake.startTime;
  const t = Math.min(1, elapsed / FPVIEW_BUMP_SHAKE_MS);
  if (t >= 1) { s.bumpShake = null; return { dx: 0, dy: 0 }; }
  const mag = FPVIEW_BUMP_SHAKE_MAGNITUDE * (1 - t);
  return { dx: Math.sin(elapsed * 0.08) * mag, dy: Math.cos(elapsed * 0.11) * mag * 0.6 };
}

function renderField() {
  const s = Game.state;
  const tileset = tilesetFor(s.map, s.x, s.y);
  const cell = s.map.cellAt(s.x, s.y);
  const dark = cell && cell.dark && s.lightTurns <= 0;
  const depth = dark ? DUNGEON_DARKNESS_VIEW_DEPTH : FPVIEW_MAX_DEPTH;
  const dollyOffset = currentDollyOffset();
  const shake = currentShakeOffset();
  ctx.save();
  ctx.translate(shake.dx, shake.dy);
  renderFPView(ctx, canvas.width, canvas.height, s.map, s.x, s.y, s.facing, tileset, depth, mapSeedFor(s.map), dollyOffset);
  ctx.restore();
  hudEl.textContent = `${s.map.name}  ${formatCoord(s.map, s.x, s.y)}  facing ${s.facing}${dark ? '  [DARKNESS]' : ''}`;
  if (s.showAutoMap && !dark) {
    mapCanvas.classList.remove('hidden');
    renderAutoMap(mapCtx, mapCanvas.width, mapCanvas.height, s.map, s.x, s.y, s.facing);
  } else {
    mapCanvas.classList.add('hidden');
  }
  combatPanel.classList.add('hidden');
  shopPanel.classList.add('hidden');
  castPanel.classList.add('hidden');
  overlayEl.classList.add('hidden');
  menuPanel.classList.add('hidden');
  chargenPanel.classList.add('hidden');
  partyReviewPanel.classList.add('hidden');
}

function renderCombat() {
  const s = Game.state;
  const combat = s.combat;
  ctx.fillStyle = '#120a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffdca8';
  ctx.font = '20px monospace';
  ctx.textAlign = 'center';
  combat.groups.forEach((g, i) => {
    const alive = g.members.filter((m) => m.hp > 0).length;
    const y = 60 + i * 60;
    ctx.fillStyle = alive ? '#ff5a5a' : '#444';
    ctx.fillRect(canvas.width / 2 - 100, y - 25, 200, 40);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${g.name} x${alive}${g.isBoss ? ' [BOSS]' : ''}`, canvas.width / 2, y);
  });
  hudEl.textContent = `Combat — Round ${combat.round}`;
  mapCanvas.classList.add('hidden');
  shopPanel.classList.add('hidden');
  castPanel.classList.add('hidden');
  overlayEl.classList.add('hidden');
  menuPanel.classList.add('hidden');
  chargenPanel.classList.add('hidden');
  partyReviewPanel.classList.add('hidden');
  combatPanel.classList.remove('hidden');

  const ui = s.combatUI;
  let html = '';
  if (ui.phase === 'ACTION') {
    const actor = s.party.members[ui.actorIdx];
    const castable = combatEligibleSpells(actor);
    let castReason = null;
    if (!castable.length) castReason = 'no spells known';
    else if (!castable.some((sp) => canCast(actor, sp))) castReason = 'not enough SP';
    html = `<b>${actor.name}'s turn</b><br/>` +
      choiceButtons([['1', 'Attack'], ['2', 'Cast', castReason], ['3', 'Block'], ['4', 'Run']]);
  } else if (ui.phase === 'TARGET_GROUP' || ui.phase === 'SPELL_TARGET_GROUP') {
    html = 'Target group:<br/>' + choiceButtons(combat.groups.map((g, i) => [String(i + 1), g.name]));
  } else if (ui.phase === 'SPELL_SELECT') {
    html = 'Cast:<br/>' + choiceButtons(ui.spellChoices.map((sp, i) => [String(i + 1), `${sp.name} (${sp.spCost}sp)`]));
  } else if (ui.phase === 'SPELL_TARGET_ALLY') {
    html = 'Target ally:<br/>' + choiceButtons(s.party.members.map((m, i) => [String(i + 1), m.name]));
  }
  setHtmlIfChanged(combatPanel, html);
}

function renderShop() {
  const s = Game.state;
  const c = shopCharacter();
  let html = `<b>${s.shop.type.replace('_', ' ')}</b> — selected: ${c.name} ` +
    choiceButtons([[',', '‹'], ['.', '›']]) + '<br/>';
  if (s.shop.type === 'TEMPLE') {
    html += choiceButtons([
      ['1', `Heal & cure ${c.name} (${templeHealCost(c) + templeRestoreSpCost(c)}g)`],
      ['2', 'Resurrect if dead'],
      ['3', 'Full party heal/cure'],
    ]);
  } else if (s.shop.type === 'BLACKSMITH') {
    html += choiceButtons(WEAPONS.map((w, i) => [String(i + 1), `${w.name} ${w.cost}g`])) + '<br/>' +
      choiceButtons(ARMORS.map((a, i) => [String(i + 1 + WEAPONS.length), `${a.name} ${a.cost}g`]));
  } else if (s.shop.type === 'MAGIC_SHOP') {
    const school = schoolFor(c);
    if (!school) {
      html += `${c.name} cannot learn spells.`;
    } else {
      html += choiceButtons(spellsForSchool(school).map((sp, i) => {
        const label = `${sp.name} (L${sp.spellLevel}, ${sp.spCost * MAGIC_SHOP_SPELL_MARKUP}g)`;
        const reqLevel = SPELL_LEVEL_TO_CHAR_LEVEL(sp.spellLevel);
        if (c.knownSpells.includes(sp.id)) return [String(i + 1), label, 'known'];
        if (c.level < reqLevel) return [String(i + 1), label, `needs level ${reqLevel}`];
        if (s.party.gold < sp.spCost * MAGIC_SHOP_SPELL_MARKUP) return [String(i + 1), label, 'not enough gold'];
        return [String(i + 1), label];
      }));
    }
  } else if (s.shop.type === 'TRAINING_GROUNDS') {
    html += choiceButtons([['1', `Train ${c.name} to level ${c.level + 1} (${trainingCost(c)}g, needs ${canLevelUp(c) ? 'enough' : 'more'} XP)`]]);
  } else if (s.shop.type === 'TAVERN') {
    html += choiceButtons([
      ['1', `Buy 5 food (${5 * TAVERN_COSTS.foodCost}g)`],
      ['2', 'Rest (uses 1 food)'],
      ['3', 'Hear a rumor'],
    ]);
  }
  html += '<br/>' + choiceButtons([['Escape', 'Leave']]);
  setHtmlIfChanged(shopPanel, html);
  shopPanel.classList.remove('hidden');
  combatPanel.classList.add('hidden');
  castPanel.classList.add('hidden');
  mapCanvas.classList.add('hidden');
  overlayEl.classList.add('hidden');
  menuPanel.classList.add('hidden');
  chargenPanel.classList.add('hidden');
  partyReviewPanel.classList.add('hidden');
  hudEl.textContent = `${s.map.name} — shop`;
}

function renderFieldCast() {
  const s = Game.state;
  const fc = s.fieldCast;
  const caster = fieldCastCaster();
  let html = `<b>Cast</b> — caster: ${caster.name} ` + choiceButtons([[',', '‹'], ['.', '›']]) + '<br/>';
  if (fc.phase === 'SPELL') {
    const list = fieldEligibleSpells(caster);
    html += choiceButtons(list.map((sp, i) => [String(i + 1), `${sp.name} (${sp.spCost}sp)`]));
  } else if (fc.phase === 'TARGET') {
    html += `Casting ${fc.spell.name} on:<br/>` + choiceButtons(s.party.members.map((m, i) => [String(i + 1), m.name]));
  }
  html += '<br/>' + choiceButtons([['Escape', 'Cancel']]);
  setHtmlIfChanged(castPanel, html);
  castPanel.classList.remove('hidden');
  combatPanel.classList.add('hidden');
  shopPanel.classList.add('hidden');
  mapCanvas.classList.add('hidden');
  overlayEl.classList.add('hidden');
  menuPanel.classList.add('hidden');
  chargenPanel.classList.add('hidden');
  partyReviewPanel.classList.add('hidden');
  hudEl.textContent = `${s.map.name} — casting`;
}

function renderOverlay(text) {
  setHtmlIfChanged(overlayEl, `${text}<br/><br/>` + choiceButtons([['Enter', 'Continue']]));
  overlayEl.classList.remove('hidden');
  combatPanel.classList.add('hidden');
  shopPanel.classList.add('hidden');
  castPanel.classList.add('hidden');
  mapCanvas.classList.add('hidden');
  menuPanel.classList.add('hidden');
  chargenPanel.classList.add('hidden');
  partyReviewPanel.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// MENU / CHARGEN / PARTY_REVIEW RENDER
// ---------------------------------------------------------------------------

function renderMenu() {
  clearCanvasForScreen('THE FROSTHOLD DEPTHS');
  hudEl.textContent = 'Choose how to begin';
  const html = choiceButtons([
    ['1', 'Quick Start — premade party of six'],
    ['2', 'Create Party — roll your own heroes'],
  ]);
  setHtmlIfChanged(menuDynamic, html);
  hideAllPanelsExcept(menuPanel);
  menuPanel.classList.remove('hidden');
}

function renderChargen() {
  const s = Game.state;
  const cg = s.chargen;

  clearCanvasForScreen('CREATE PARTY');
  hudEl.textContent = `Recruiting character ${cg.roster.length + 1} of ${MAX_ROSTER_SIZE}`;

  const statsHtml = STATS.map((stat) => `${stat[0].toUpperCase()}${stat.slice(1)} <b>${cg.draft.stats[stat]}</b>`).join(' &nbsp; ');
  const total = STATS.reduce((sum, stat) => sum + cg.draft.stats[stat], 0);

  const classButtons = CHARGEN_CLASS_ORDER.map((cls, i) => {
    const info = CLASSES[cls];
    const short = statShortfalls(cls, cg.draft.stats);
    const schoolText = info.spellSchool ? ` — ${info.spellSchool} spells${info.spellSchoolLevel > 1 ? ` at Lv${info.spellSchoolLevel}` : ''}` : '';
    const label = `${cls} (${info.combatRole}, d${info.hitDie} HP${schoolText})${cg.draft.cls === cls ? ' [chosen]' : ''}`;
    return short.length ? [String(i + 1), label, `needs ${short.join(', ')}`] : [String(i + 1), label, null];
  });

  let previewHtml = '';
  if (cg.draft.cls) {
    const preview = createCharacter({ name: 'Preview', cls: cg.draft.cls, stats: cg.draft.stats });
    previewHtml = `<br/>Preview — HP ${preview.maxHp}  SP ${preview.maxSp}  AC ${preview.ac}`;
  }

  const rosterHtml = cg.roster.length
    ? `<br/>Roster so far: ${cg.roster.map((r) => `${r.name} (${r.cls})`).join(', ')}`
    : '<br/>Roster so far: (empty)';

  const html = `Rolled stats: ${statsHtml} &nbsp; Total <b>${total}</b><br/>` +
    choiceButtons([['r', 'Reroll Stats']]) + '<br/>' +
    classButtons.map((btn) => choiceButtons([btn])).join('') +
    previewHtml + rosterHtml + '<br/><br/>' +
    choiceButtons([
      ['add-to-roster', 'Add to Party', cg.draft.cls ? null : 'choose a class first'],
      ['finish-roster', 'Done Recruiting', cg.roster.length >= 1 ? null : 'add at least one character'],
      ['cancel-chargen', 'Cancel'],
    ]);
  setHtmlIfChanged(chargenDynamic, html);
  hideAllPanelsExcept(chargenPanel);
  chargenPanel.classList.remove('hidden');
}

function renderPartyReview() {
  const s = Game.state;
  const cg = s.chargen;

  clearCanvasForScreen('REVIEW PARTY');
  hudEl.textContent = `${cg.roster.length} of ${MAX_ROSTER_SIZE} recruited — first 3 stand in the front rank`;

  const rows = cg.roster.map((r, i) => {
    const preview = createCharacter({ name: r.name, cls: r.cls, stats: r.stats });
    const rank = i < FRONT_RANK_SIZE ? 'front' : 'back';
    return `<div>${i + 1}. ${r.name} — ${r.cls} (${rank} rank) HP ${preview.maxHp} SP ${preview.maxSp} AC ${preview.ac} ` +
      choiceButtons([
        [`up-${i}`, '▲ Up', i > 0 ? null : 'already first'],
        [`down-${i}`, '▼ Down', i < cg.roster.length - 1 ? null : 'already last'],
        [`remove-${i}`, 'Remove', null],
      ]) + `</div>`;
  }).join('');

  const html = rows + '<br/>' +
    choiceButtons([
      ['add-more', 'Recruit Another', cg.roster.length < MAX_ROSTER_SIZE ? null : 'roster is full'],
      ['confirm-party', 'Confirm & Begin', cg.roster.length >= 1 ? null : 'need at least one character'],
    ]);
  setHtmlIfChanged(partyReviewDynamic, html);
  hideAllPanelsExcept(partyReviewPanel);
  partyReviewPanel.classList.remove('hidden');
}

function render() {
  const s = Game.state;
  if (s.mode === 'MENU') renderMenu();
  else if (s.mode === 'CHARGEN') renderChargen();
  else if (s.mode === 'PARTY_REVIEW') renderPartyReview();
  else if (s.mode === 'FIELD') renderField();
  else if (s.mode === 'COMBAT') renderCombat();
  else if (s.mode === 'SHOP') renderShop();
  else if (s.mode === 'CAST') renderFieldCast();
  else if (s.mode === 'DEAD') renderOverlay('The party has fallen. Press Enter to awaken in town.');
  else if (s.mode === 'VICTORY') renderOverlay('Victory! The depths are conquered. Press Enter to continue.');
  touchControlsEl.classList.toggle('hidden', s.mode !== 'FIELD');
  if (s.party) {
    renderRoster();
    logEl.textContent = s.log.recent(8).join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  } else {
    setHtmlIfChanged(rosterEl, '');
    logEl.textContent = '';
  }
}

function loop() {
  render();
  requestAnimationFrame(loop);
}

boot();

// expose for the connectivity test / debugging in a browser console
Game.debug = {
  verifyLevelConnectivity, verifyBossUnavoidable, generateDungeonLevel,
  setPos(x, y, facing) { Game.state.x = x; Game.state.y = y; if (facing) Game.state.facing = facing; },
  advanceTurn, dispatchSpecial, startEncounterFlow, finalizeCombatIfEnded,
  quickStart() { beginAdventure(createDefaultParty()); },
};
