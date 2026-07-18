// combat.js
// WHAT: group/rank turn-based combat resolution — the centerpiece system.
// WHY: encapsulates initiative, attack/cast/block/run resolution, and
// victory/defeat so main.js only drives UI and calls into this module.

import {
  FRONT_RANK_SIZE, BLOCK_AC_BONUS, RUN_BASE_CHANCE, RUN_SPEED_FACTOR,
  BACK_RANK_MELEE_PENALTY, UNARMED_DAMAGE, XP_GOLD_VARIANCE, CONDITIONS,
} from './data.js';
import { isAlive, isActive, armorClass, recomputeDerived, grantXp } from './party.js';
import { groupIsDefeated } from './monsters.js';
import { castSpell } from './spells.js';

function rollHit(accuracy, ac, rng) {
  const chance = Math.min(0.95, Math.max(0.05, 0.5 + (accuracy - ac) * 0.05));
  return rng.chance(chance);
}

function avgSpeed(group) {
  const alive = group.members.filter((m) => m.hp > 0);
  if (!alive.length) return 0;
  return alive.reduce((s, m) => s + m.speed, 0) / alive.length;
}

function pickAliveMonster(group, rng) {
  const alive = group.members.filter((m) => m.hp > 0);
  if (!alive.length) return null;
  return rng.choice(alive);
}

function pickPartyTarget(party, rng) {
  const front = party.members.slice(0, FRONT_RANK_SIZE).filter(isActive);
  const back = party.members.slice(FRONT_RANK_SIZE).filter(isActive);
  const pool = front.length ? front : back;
  if (!pool.length) return null;
  return rng.choice(pool);
}

function buildOrder(combat, party) {
  const entries = [];
  party.members.forEach((m, idx) => { if (isActive(m)) entries.push({ kind: 'party', idx, speed: m.stats.speed }); });
  combat.groups.forEach((g, idx) => { if (!groupIsDefeated(g)) entries.push({ kind: 'group', idx, speed: avgSpeed(g) }); });
  const shuffled = combat.rng.shuffle(entries);
  shuffled.sort((a, b) => b.speed - a.speed);
  combat.order = shuffled;
  combat.pointer = 0;
}

export function startCombat(party, groups, rng, log, opts = {}) {
  const combat = {
    active: true,
    bossFight: !!opts.bossFight,
    groups,
    rng,
    log,
    order: [],
    pointer: 0,
    round: 1,
    result: null, // null | 'victory' | 'defeat' | 'fled'
  };
  buildOrder(combat, party);
  log.push(opts.bossFight
    ? `${groups[0].name} blocks your path. There is no escape from ${groups[0].name}.`
    : `A group of ${groups.map((g) => g.name).join(', ')} attacks!`);
  return combat;
}

export function currentActor(combat) {
  if (combat.pointer >= combat.order.length) return null;
  return combat.order[combat.pointer];
}

function checkEnd(combat, party) {
  if (combat.groups.every(groupIsDefeated)) {
    combat.result = 'victory';
    combat.active = false;
    awardVictory(combat, party);
  } else if (!party.members.some(isAlive)) {
    combat.result = 'defeat';
    combat.active = false;
  }
}

function awardVictory(combat, party) {
  let totalXp = 0, totalGold = 0;
  for (const g of combat.groups) {
    totalXp += g.xpEach * g.members.length;
    for (let i = 0; i < g.members.length; i++) {
      totalGold += combat.rng.int(g.goldRange[0], g.goldRange[1]);
    }
  }
  totalGold = Math.round(totalGold * (1 + (combat.rng.next() * 2 - 1) * XP_GOLD_VARIANCE));
  const survivors = party.members.filter(isAlive);
  const xpEach = Math.floor(totalXp / Math.max(1, survivors.length));
  survivors.forEach((m) => grantXp(m, xpEach));
  party.gold += totalGold;
  combat.log.push(`Victory! The party gains ${totalXp} XP and ${totalGold} gold.`);
}

// WHAT: advance to the next living actor in the initiative order; starts a
// new round (and ticks per-round effects) when the order is exhausted.
export function advance(combat, party) {
  if (!combat.active) return;
  combat.pointer += 1;
  // skip actors that died/fell unconscious/asleep since order was built
  while (combat.pointer < combat.order.length) {
    const e = combat.order[combat.pointer];
    const alive = e.kind === 'party' ? isActive(party.members[e.idx]) : !groupIsDefeated(combat.groups[e.idx]);
    if (alive) break;
    combat.pointer += 1;
  }
  checkEnd(combat, party);
  if (!combat.active) return;
  if (combat.pointer >= combat.order.length) {
    endRound(combat, party);
    buildOrder(combat, party);
    combat.round += 1;
  }
}

function endRound(combat, party) {
  for (const m of party.members) {
    m.blocking = false;
    if (m.combatBuff) {
      m.combatBuff.turnsLeft -= 1;
      if (m.combatBuff.turnsLeft <= 0) m.combatBuff = null;
      recomputeDerived(m);
    }
    if (isAlive(m) && m.conditions.includes('POISONED')) {
      m.hp = Math.max(0, m.hp - CONDITIONS.POISONED.tickDamage);
      combat.log.push(`${m.name} suffers from poison.`);
      if (m.hp === 0) m.conditions.push('DEAD');
    }
  }
}

// WHAT: party member performs Attack — melee vs. front group, ranged/spell
// ignore rank; back-rank melee is penalized per spec. AFRAID/DISEASED
// conditions sap accuracy/damage; hitting a sleeping monster wakes it.
export function performAttack(combat, party, actorIdx, targetGroupIdx) {
  const actor = party.members[actorIdx];
  const group = combat.groups[targetGroupIdx];
  if (!group || groupIsDefeated(group)) { combat.log.push(`${actor.name} has no target.`); return; }
  const isBack = actorIdx >= FRONT_RANK_SIZE;
  const ranged = !!(actor.equipment.weapon && actor.equipment.weapon.ranged);
  let acc = actor.stats.accuracy;
  if (isBack && !ranged) acc += BACK_RANK_MELEE_PENALTY;
  if (actor.conditions.includes('AFRAID')) acc += CONDITIONS.AFRAID.attackPenalty;
  const might = actor.stats.might + (actor.conditions.includes('DISEASED') ? CONDITIONS.DISEASED.statPenalty : 0);
  const weaponDmg = actor.equipment.weapon ? actor.equipment.weapon.dmg : UNARMED_DAMAGE;
  const target = pickAliveMonster(group, combat.rng);
  if (rollHit(acc, target.ac, combat.rng)) {
    const dmg = Math.max(1, combat.rng.int(weaponDmg[0], weaponDmg[1]) + Math.floor(might / 5));
    target.hp -= dmg;
    if (target.condition === 'ASLEEP') target.condition = null;
    combat.log.push(`${actor.name} hits the ${group.name} for ${dmg}.`);
    if (target.hp <= 0) combat.log.push(`A ${group.name} falls!`);
  } else {
    combat.log.push(`${actor.name} misses the ${group.name}.`);
  }
}

export function performBlock(combat, party, actorIdx) {
  const actor = party.members[actorIdx];
  actor.blocking = true;
  recomputeDerived(actor);
  actor.ac += BLOCK_AC_BONUS;
  combat.log.push(`${actor.name} braces to block.`);
}

export function performRun(combat, party) {
  if (combat.bossFight) {
    combat.log.push(`There is no escape from ${combat.groups[0].name}.`);
    return false;
  }
  const partySpeed = party.members.filter(isActive).reduce((s, m) => s + m.stats.speed, 0) / Math.max(1, party.members.filter(isActive).length);
  const monsterSpeed = combat.groups.reduce((s, g) => s + avgSpeed(g), 0) / Math.max(1, combat.groups.length);
  const chance = Math.min(0.95, Math.max(0.05, RUN_BASE_CHANCE + (partySpeed - monsterSpeed) * RUN_SPEED_FACTOR));
  if (combat.rng.chance(chance)) {
    combat.log.push('The party flees from combat!');
    combat.active = false;
    combat.result = 'fled';
    return true;
  }
  combat.log.push('The party fails to flee!');
  return false;
}

export function performCast(combat, party, actorIdx, spell, targetGroupIdx, targetCharacterIdx) {
  const actor = party.members[actorIdx];
  const ctx = {
    caster: actor,
    party,
    log: combat.log,
    rng: combat.rng,
    targetGroup: targetGroupIdx != null ? combat.groups[targetGroupIdx] : null,
    targetCharacter: targetCharacterIdx != null ? party.members[targetCharacterIdx] : null,
  };
  castSpell(spell, ctx);
}

// WHAT: monster group's turn — every living, awake member attacks a party
// target; a monster's special attack can inflict a condition on hit.
export function performMonsterTurn(combat, party, groupIdx) {
  const group = combat.groups[groupIdx];
  for (const mon of group.members) {
    if (mon.hp <= 0) continue;
    if (mon.condition === 'ASLEEP') { combat.log.push(`The ${group.name} slumbers.`); continue; }
    const target = pickPartyTarget(party, combat.rng);
    if (!target) return;
    if (rollHit(mon.accuracy, target.ac, combat.rng)) {
      const dmg = combat.rng.int(mon.damage[0], mon.damage[1]);
      target.hp = Math.max(0, target.hp - dmg);
      if (target.conditions.includes('ASLEEP')) target.conditions = target.conditions.filter((c) => c !== 'ASLEEP');
      combat.log.push(`The ${group.name} hits ${target.name} for ${dmg}.`);
      if (target.hp === 0) {
        target.conditions.push('DEAD');
        combat.log.push(`${target.name} falls!`);
      } else if (mon.inflicts && !target.conditions.includes(mon.inflicts.condition) && combat.rng.chance(mon.inflicts.chance)) {
        target.conditions.push(mon.inflicts.condition);
        combat.log.push(`${target.name} is afflicted with ${CONDITIONS[mon.inflicts.condition].name.toLowerCase()}!`);
      }
    } else {
      combat.log.push(`The ${group.name} misses ${target.name}.`);
    }
  }
}
