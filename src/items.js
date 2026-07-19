// items.js
// WHAT: General Store consumables — what an item does when used.
// WHY: parallels spells.js (same effect vocabulary: heal/restore_sp/cure/
// light) but items have no caster/SP cost — they just consume one count
// from the party's shared item pool.

import { ITEMS } from './data.js';

export function findItem(id) { return ITEMS[id] || null; }

export function ownedItems(party) {
  return Object.entries(party.items || {})
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ item: findItem(id), count }))
    .filter((entry) => entry.item);
}

// WHAT: apply an item's effect. `ctx` = { party, targetCharacter, log, state }
// — callers only supply what's relevant to that item's effect.
export function useItem(itemId, ctx) {
  const item = findItem(itemId);
  if (!item) return;
  if (!ctx.party.items[itemId]) { ctx.log?.push(`No ${item.name} left.`); return; }
  ctx.party.items[itemId] -= 1;
  const target = ctx.targetCharacter;
  switch (item.effect) {
    case 'heal': {
      target.hp = Math.min(target.maxHp, target.hp + item.power);
      target.conditions = target.conditions.filter((c) => c !== 'UNCONSCIOUS');
      ctx.log?.push(`${target.name} drinks a ${item.name} (+${item.power} HP).`);
      break;
    }
    case 'restore_sp': {
      target.sp = Math.min(target.maxSp, target.sp + item.power);
      ctx.log?.push(`${target.name} drinks a ${item.name} (+${item.power} SP).`);
      break;
    }
    case 'cure': {
      target.conditions = target.conditions.filter((c) => !item.cures.includes(c));
      ctx.log?.push(`${target.name} uses a ${item.name}.`);
      break;
    }
    case 'light': {
      if (ctx.state) {
        ctx.state.lightTurns = (ctx.state.lightTurns || 0) + item.power;
        ctx.log?.push(`The ${item.name} brightens the passage.`);
      } else {
        ctx.log?.push(`The ${item.name} fizzles here.`);
      }
      break;
    }
    default: break;
  }
}
