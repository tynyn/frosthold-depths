// party.js
// WHAT: character creation, derived stats, and party-level state.
// WHY: centralizes HP/SP/AC/XP formulas so combat/services/training all
// agree on how a character's numbers are computed.

import {
  CLASSES, DEFAULT_PARTY, HP_BASE, HP_PER_ENDURANCE, HP_PER_LEVEL,
  SP_PER_STAT, SP_PER_LEVEL, AC_BASE, AC_PER_SPEED, XP_TO_LEVEL,
  STARTING_GOLD, STARTING_GEMS, STARTING_FOOD,
} from './data.js';

// WHAT: max HP for a character at their current level.
export function maxHp(character) {
  const cls = CLASSES[character.cls];
  return HP_BASE + cls.hitDie + character.stats.endurance * HP_PER_ENDURANCE + (character.level - 1) * HP_PER_LEVEL;
}

// WHAT: max SP; casters draw from Intellect (sorcerer) or Personality (cleric).
export function maxSp(character) {
  const cls = CLASSES[character.cls];
  if (!cls.spellSchool) return 0;
  const stat = cls.spellSchool === 'sorcerer' ? character.stats.intellect : character.stats.personality;
  return stat * SP_PER_STAT + (character.level - 1) * SP_PER_LEVEL;
}

// WHAT: armor class from equipped armor + Speed-derived dodge.
export function armorClass(character) {
  const armorBonus = character.equipment.armor ? character.equipment.armor.ac : 0;
  return AC_BASE + armorBonus + Math.floor(character.stats.speed * AC_PER_SPEED) + (character.combatBuff?.ac || 0);
}

export function initiative(character) { return character.stats.speed; }

// WHAT: build a fresh character record from a class + stat block.
export function createCharacter({ name, cls, stats }) {
  const c = {
    name, cls, level: 1, xp: 0,
    stats: { ...stats },
    equipment: { weapon: null, armor: null },
    conditions: [],
    knownSpells: [],
    combatBuff: null,
  };
  c.maxHp = maxHp(c); c.hp = c.maxHp;
  c.maxSp = maxSp(c); c.sp = c.maxSp;
  c.ac = armorClass(c);
  return c;
}

// WHAT: instantiate the shipped six-hero default party plus shared resources.
export function createDefaultParty() {
  return {
    members: DEFAULT_PARTY.map(createCharacter),
    gold: STARTING_GOLD,
    gems: STARTING_GEMS,
    food: STARTING_FOOD,
  };
}

export function isAlive(character) { return character.hp > 0 && !character.conditions.includes('DEAD'); }
export function isActive(character) {
  return isAlive(character) && !character.conditions.includes('UNCONSCIOUS') && !character.conditions.includes('ASLEEP');
}

// WHAT: grant XP to a character and level them up while they have enough.
// WHY: training grounds (M5) spends XP+gold, but XP itself always accrues
// from combat immediately.
export function grantXp(character, amount) {
  character.xp += amount;
}

export function canLevelUp(character) {
  return character.xp >= XP_TO_LEVEL(character.level);
}

export function levelUp(character) {
  character.level += 1;
  const newMaxHp = maxHp(character);
  character.hp += Math.max(0, newMaxHp - character.maxHp);
  character.maxHp = newMaxHp;
  const newMaxSp = maxSp(character);
  character.sp += Math.max(0, newMaxSp - character.maxSp);
  character.maxSp = newMaxSp;
  character.ac = armorClass(character);
}

export function recomputeDerived(character) {
  character.maxHp = maxHp(character);
  character.maxSp = maxSp(character);
  character.ac = armorClass(character);
  character.hp = Math.min(character.hp, character.maxHp);
  character.sp = Math.min(character.sp, character.maxSp);
}
