// main.js
// WHAT: boot, mode state machine, rAF render loop, input router, map swap.
// WHY: the single orchestrator tying every shared-engine module together;
// no module here re-implements movement or rendering — it only calls the
// one shared gridmap/fpview primitives.

import {
  DIRS, DELTA, OPPOSITE, EDGE, MAP_KIND, SPECIAL_TRIGGER, DEFAULT_SEED,
  DUNGEON_MAX_DEPTH, DUNGEON_ENCOUNTER_RATE, DUNGEON_ENCOUNTER_RATE_DEPTH_SCALE,
  DUNGEON_DARKNESS_VIEW_DEPTH, FPVIEW_MAX_DEPTH, WEAPONS, ARMORS, SPELLS,
  BIOME_TILESET, BIOME_MONSTER_TAGS, TAVERN_COSTS,
  SECRET_SEARCH_BASE_CHANCE, SECRET_SEARCH_ROBBER_BONUS,
} from './data.js';
import { RNG } from './rng.js';
import { GridMap, turnLeft, turnRight, tryStepForward, tryStepBackward, tryMove } from './gridmap.js';
import { renderFPView } from './fpview.js';
import { renderAutoMap, markExplored } from './automap.js';
import { MessageLog } from './log.js';
import { createDefaultParty, isAlive, isActive, recomputeDerived, canLevelUp } from './party.js';
import { spawnGroup, randomMonsterForTag, groupIsDefeated } from './monsters.js';
import { spellsForSchool, findSpell, castSpell } from './spells.js';
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

const DUNGEON_TILESET = { sky: '#1a1a22', floor: '#2a2418', wall: '#4a4238', door: '#7a5230' };
const TOWN_TILESET = { sky: '#7fb2e0', floor: '#8a7a5a', wall: '#5a4a30', door: '#8a5a2e' };
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

// WHAT: render a row of tappable choice buttons, each carrying the exact key
// string handleKey() would receive from a keydown. WHY: this is the single
// bridge between the panel text and touch input — a tap and the matching
// keypress run through the identical dispatch, so there is only one set of
// action rules to keep correct, not two.
function choiceButtons(pairs) {
  return pairs.map(([key, label]) => `<button type="button" class="choice-btn" data-key="${key}">${label}</button>`).join('');
}

function tagForDepth(depth) { return `dungeon${Math.min(depth, 3)}`; }
function numGroupsForDepth(depth, rng) {
  if (depth <= 1) return 1;
  return rng.int(1, Math.min(4, 1 + Math.floor(depth / 2)));
}

function boot() {
  const seed = DEFAULT_SEED;
  const rng = new RNG(seed);
  const party = createDefaultParty();
  const log = new MessageLog();

  const overworldRng = rng.fork(3);
  const overworld = generateOverworld(overworldRng.fork(1), 'Wilderness');

  const state = {
    mode: 'FIELD',
    seed, rng, overworldRng,
    party, log,
    map: overworld.map,
    x: overworld.start.x, y: overworld.start.y, facing: overworld.map.entry.facing,
    overworld,
    towns: {},
    dungeonMouthsState: {},
    currentTownId: null,
    currentMouthId: null,
    dungeonDepth: null,
    showAutoMap: false,
    combat: null,
    combatUI: null,
    shop: null,
    lightTurns: 0,
    lastTown: null,
    lastTownId: null,
  };
  Game.state = state;

  markExplored(state.map, state.x, state.y);
  log.push('You stand in the wilderness. The Frosthold Depths lie somewhere below.');
  log.push('Arrows/WASD move+turn, Space/Enter interact, M automap.');

  window.addEventListener('keydown', onKeyDown);
  document.body.addEventListener('click', onTouchButton);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// TILESET / KIND HELPERS
// ---------------------------------------------------------------------------

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

function step(kind) {
  const s = Game.state;
  if (s.mode !== 'FIELD') return;
  let result;
  if (kind === 'F') result = tryStepForward(s.map, s.x, s.y, s.facing);
  else if (kind === 'B') result = tryStepBackward(s.map, s.x, s.y, s.facing);
  else result = tryMove(s.map, s.x, s.y, kind); // strafe: absolute dir L/R of facing

  if (!result.moved) { s.log.push('A wall blocks your way.'); return; }
  s.x = result.x; s.y = result.y;
  markExplored(s.map, s.x, s.y);
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
    const rate = DUNGEON_ENCOUNTER_RATE + s.dungeonDepth * DUNGEON_ENCOUNTER_RATE_DEPTH_SCALE;
    if (s.rng.chance(rate)) startEncounterFlow();
  } else if (s.map.kind === MAP_KIND.OVERWORLD) {
    const rate = encounterChanceForCell(s.map, s.x, s.y);
    if (rate > 0 && s.rng.chance(rate)) startEncounterFlow();
  }
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
      const spells = actor.knownSpells.map(findSpell).filter(Boolean);
      if (!spells.length) { s.log.push(`${actor.name} knows no spells.`); return; }
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
    if (actor.sp < spell.spCost) { s.log.push(`${actor.name} lacks the SP for ${spell.name}.`); return; }
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
    const school = c.cls === 'Sorcerer' ? 'sorcerer' : (c.cls === 'Cleric' || c.cls === 'Paladin') ? 'cleric' : null;
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
// INPUT ROUTER
// ---------------------------------------------------------------------------

// WHAT: the one input router, driven by a key STRING rather than a
// KeyboardEvent. WHY: this lets a tap on an on-screen button feed the exact
// same dispatch a keypress does — touch is a second input SOURCE, never a
// second set of rules. onKeyDown and the touch-button click handler are the
// only two callers.
function handleKey(key) {
  const s = Game.state;
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
    default: break;
  }
}

function onKeyDown(e) { handleKey(e.key); }

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
  return character.knownSpells.map(findSpell).filter((sp) => sp && sp.target !== 'group');
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
    if (caster.sp < spell.spCost) { s.log.push(`${caster.name} lacks the SP for ${spell.name}.`); return; }
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

function renderField() {
  const s = Game.state;
  const tileset = tilesetFor(s.map, s.x, s.y);
  const cell = s.map.cellAt(s.x, s.y);
  const dark = cell && cell.dark && s.lightTurns <= 0;
  const depth = dark ? DUNGEON_DARKNESS_VIEW_DEPTH : FPVIEW_MAX_DEPTH;
  renderFPView(ctx, canvas.width, canvas.height, s.map, s.x, s.y, s.facing, tileset, depth);
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
  combatPanel.classList.remove('hidden');

  const ui = s.combatUI;
  let html = '';
  if (ui.phase === 'ACTION') {
    html = `<b>${s.party.members[ui.actorIdx].name}'s turn</b><br/>` +
      choiceButtons([['1', 'Attack'], ['2', 'Cast'], ['3', 'Block'], ['4', 'Run']]);
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
    const school = c.cls === 'Sorcerer' ? 'sorcerer' : (c.cls === 'Cleric' || c.cls === 'Paladin') ? 'cleric' : null;
    html += school ? choiceButtons(spellsForSchool(school).map((sp, i) => [String(i + 1), `${sp.name} (${sp.spCost * 25}g)`])) : `${c.name} cannot learn spells.`;
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
  hudEl.textContent = `${s.map.name} — casting`;
}

function renderOverlay(text) {
  setHtmlIfChanged(overlayEl, `${text}<br/><br/>` + choiceButtons([['Enter', 'Continue']]));
  overlayEl.classList.remove('hidden');
  combatPanel.classList.add('hidden');
  shopPanel.classList.add('hidden');
  castPanel.classList.add('hidden');
  mapCanvas.classList.add('hidden');
}

function render() {
  const s = Game.state;
  if (s.mode === 'FIELD') renderField();
  else if (s.mode === 'COMBAT') renderCombat();
  else if (s.mode === 'SHOP') renderShop();
  else if (s.mode === 'CAST') renderFieldCast();
  else if (s.mode === 'DEAD') renderOverlay('The party has fallen. Press Enter to awaken in town.');
  else if (s.mode === 'VICTORY') renderOverlay('Victory! The depths are conquered. Press Enter to continue.');
  touchControlsEl.classList.toggle('hidden', s.mode !== 'FIELD');
  renderRoster();
  logEl.textContent = s.log.recent(8).join('\n');
  logEl.scrollTop = logEl.scrollHeight;
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
};
