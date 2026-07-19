// services.js
// WHAT: shop/temple/training transaction logic invoked when the party steps
// onto a town shopkeeper tile. WHY: keeps all gold/gem/XP bookkeeping in one
// place instead of scattered across town.js tile handlers.

import {
  TEMPLE_COSTS, TAVERN_COSTS, WEAPONS, ARMORS, TRAINING_GOLD_PER_LEVEL,
  MAGIC_SHOP_SPELL_MARKUP, XP_TO_LEVEL, SPELLS, SPELL_LEVEL_TO_CHAR_LEVEL,
} from './data.js';
import { recomputeDerived, canLevelUp, levelUp, isAlive, schoolFor } from './party.js';

// ---------------------------------------------------------------------------
// TEMPLE
// ---------------------------------------------------------------------------

export function templeHealCost(character) {
  return (character.maxHp - character.hp) * TEMPLE_COSTS.healPerHp;
}

export function templeHeal(party, character) {
  const cost = templeHealCost(character);
  if (cost === 0) return { success: true, message: `${character.name} is already at full health.` };
  if (party.gold < cost) return { success: false, message: `Healing ${character.name} costs ${cost} gold — you can't afford it.` };
  party.gold -= cost;
  character.hp = character.maxHp;
  return { success: true, message: `${character.name} is healed for ${cost} gold.` };
}

export function templeRestoreSpCost(character) {
  return (character.maxSp - character.sp) * TEMPLE_COSTS.restoreSpPerPoint;
}

export function templeRestoreSp(party, character) {
  const cost = templeRestoreSpCost(character);
  if (cost === 0) return { success: true, message: `${character.name} already has full spell points.` };
  if (party.gold < cost) return { success: false, message: `Restoring SP costs ${cost} gold — you can't afford it.` };
  party.gold -= cost;
  character.sp = character.maxSp;
  return { success: true, message: `${character.name}'s spell points are restored for ${cost} gold.` };
}

export function templeCureCondition(party, character, condition) {
  if (!character.conditions.includes(condition)) return { success: true, message: `${character.name} is not afflicted.` };
  const cost = TEMPLE_COSTS.cureCondition;
  if (party.gold < cost) return { success: false, message: `Curing ${condition} costs ${cost} gold — you can't afford it.` };
  party.gold -= cost;
  character.conditions = character.conditions.filter((c) => c !== condition);
  return { success: true, message: `${character.name} is cured of ${condition} for ${cost} gold.` };
}

export function templeResurrect(party, character) {
  if (!character.conditions.includes('DEAD')) return { success: true, message: `${character.name} is not dead.` };
  if (party.gold < TEMPLE_COSTS.resurrectGold || party.gems < TEMPLE_COSTS.resurrectGems) {
    return { success: false, message: `Resurrection costs ${TEMPLE_COSTS.resurrectGold} gold and ${TEMPLE_COSTS.resurrectGems} gems.` };
  }
  party.gold -= TEMPLE_COSTS.resurrectGold;
  party.gems -= TEMPLE_COSTS.resurrectGems;
  character.conditions = character.conditions.filter((c) => c !== 'DEAD');
  character.hp = 1;
  return { success: true, message: `${character.name} is restored to life!` };
}

// WHAT: heal/restore/cure/resurrect the whole party in one visit.
export function templeFullService(party) {
  const messages = [];
  for (const c of party.members) {
    if (c.conditions.includes('DEAD')) messages.push(templeResurrect(party, c).message);
    if (isAlive(c)) {
      messages.push(templeHeal(party, c).message);
      messages.push(templeRestoreSp(party, c).message);
      for (const cond of [...c.conditions]) {
        if (cond !== 'DEAD') messages.push(templeCureCondition(party, c, cond).message);
      }
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// TRAINING GROUNDS
// ---------------------------------------------------------------------------

export function trainingCost(character) { return character.level * TRAINING_GOLD_PER_LEVEL; }

export function trainCharacter(party, character) {
  if (!canLevelUp(character)) {
    return { success: false, message: `${character.name} needs ${XP_TO_LEVEL(character.level) - character.xp} more XP to train.` };
  }
  const cost = trainingCost(character);
  if (party.gold < cost) return { success: false, message: `Training ${character.name} costs ${cost} gold — you can't afford it.` };
  party.gold -= cost;
  levelUp(character);
  return { success: true, message: `${character.name} trains to level ${character.level}!` };
}

// ---------------------------------------------------------------------------
// BLACKSMITH
// ---------------------------------------------------------------------------

export function buyWeapon(party, character, weaponId) {
  const item = WEAPONS.find((w) => w.id === weaponId);
  if (!item) return { success: false, message: 'No such weapon.' };
  if (party.gold < item.cost) return { success: false, message: `${item.name} costs ${item.cost} gold.` };
  party.gold -= item.cost;
  character.equipment.weapon = item;
  return { success: true, message: `${character.name} equips a ${item.name}.` };
}

export function buyArmor(party, character, armorId) {
  const item = ARMORS.find((a) => a.id === armorId);
  if (!item) return { success: false, message: 'No such armor.' };
  if (party.gold < item.cost) return { success: false, message: `${item.name} costs ${item.cost} gold.` };
  party.gold -= item.cost;
  character.equipment.armor = item;
  recomputeDerived(character);
  return { success: true, message: `${character.name} dons ${item.name}.` };
}

// ---------------------------------------------------------------------------
// MAGIC SHOP
// ---------------------------------------------------------------------------

export function learnSpell(party, character, spellId) {
  const school = schoolFor(character);
  if (!school) return { success: false, message: `${character.name} cannot cast spells.` };
  const spell = SPELLS[school].find((s) => s.id === spellId);
  if (!spell) return { success: false, message: 'No such spell.' };
  if (character.knownSpells.includes(spellId)) return { success: false, message: `${character.name} already knows ${spell.name}.` };
  const reqLevel = SPELL_LEVEL_TO_CHAR_LEVEL(spell.spellLevel);
  if (character.level < reqLevel) return { success: false, message: `${character.name} must be level ${reqLevel} to learn ${spell.name}.` };
  const cost = spell.spCost * MAGIC_SHOP_SPELL_MARKUP;
  if (party.gold < cost) return { success: false, message: `${spell.name} costs ${cost} gold.` };
  party.gold -= cost;
  character.knownSpells.push(spellId);
  return { success: true, message: `${character.name} learns ${spell.name}.` };
}

// ---------------------------------------------------------------------------
// TAVERN
// ---------------------------------------------------------------------------

export function buyFood(party, amount) {
  const cost = amount * TAVERN_COSTS.foodCost;
  if (party.gold < cost) return { success: false, message: `${amount} food costs ${cost} gold.` };
  party.gold -= cost;
  party.food += amount;
  return { success: true, message: `The party buys ${amount} food for ${cost} gold.` };
}

export function restAtTavern(party) {
  if (party.food < 1) return { success: false, message: 'The party has no food left to rest.' };
  party.food -= 1;
  for (const c of party.members) {
    if (!isAlive(c)) continue;
    c.hp = Math.min(c.maxHp, c.hp + Math.ceil(c.maxHp * TAVERN_COSTS.restHealFraction));
    c.sp = Math.min(c.maxSp, c.sp + Math.ceil(c.maxSp * TAVERN_COSTS.restSpFraction));
  }
  return { success: true, message: 'The party rests and recovers.' };
}

export const RUMORS = [
  'They say the deepest halls of Frosthold hide something that was never meant to wake.',
  'A drunk mutters: "Spinners... they turn you right around, they do."',
  'The barkeep leans in: "Secret doors look just like walls. Search close."',
];
