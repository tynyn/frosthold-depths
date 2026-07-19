// loot.js
// WHAT: bonus item/gear drops beyond gold/gems — tiered so a weak encounter
// or shallow chest can never hand out top-tier gear, plus the identify
// pipeline (unidentified -> resolved) that gates whether a drop is usable
// right away.
// WHY: single place that knows the drop pool, the identify cost, and where
// a resolved drop ends up (party.items for consumables, party.unclaimedGear
// for weapons/armor pending a free Blacksmith equip) — combat.js and
// dungeon.js just ask "roll a drop for this tier," main.js just asks
// "identify index N" / "equip index N onto this character."

import { WEAPONS, ARMORS, ITEMS, gearLootTier, IDENTIFY_COST } from './data.js';
import { recomputeDerived } from './party.js';

function poolForTier(maxTier) {
  const pool = [];
  for (const w of WEAPONS) if (gearLootTier(w.cost) <= maxTier) pool.push({ kind: 'weapon', id: w.id });
  for (const a of ARMORS) if (gearLootTier(a.cost) <= maxTier) pool.push({ kind: 'armor', id: a.id });
  for (const it of Object.values(ITEMS)) if (gearLootTier(it.cost) <= maxTier) pool.push({ kind: 'item', id: it.id });
  return pool;
}

// WHAT: pick one random drop of tier <= maxTier, or null if the pool is
// somehow empty (it never is, since tier-1 gear/items always exist).
export function rollLootDrop(rng, maxTier) {
  const pool = poolForTier(maxTier);
  if (!pool.length) return null;
  return rng.choice(pool);
}

function catalogFor(kind) {
  if (kind === 'weapon') return WEAPONS;
  if (kind === 'armor') return ARMORS;
  return null;
}

export function lootName(drop) {
  const catalog = catalogFor(drop.kind);
  if (catalog) return catalog.find((x) => x.id === drop.id)?.name || drop.id;
  return ITEMS[drop.id]?.name || drop.id;
}

// WHAT: fold a resolved (known) drop into its final place — a consumable
// joins the shared item pool, gear waits in unclaimedGear for a free equip.
function resolveLoot(party, drop) {
  if (drop.kind === 'item') party.items[drop.id] = (party.items[drop.id] || 0) + 1;
  else party.unclaimedGear.push(drop);
}

// WHAT: hand a drop to the party. hasAssessor (a living Robber) resolves it
// immediately, for free; otherwise it waits in unidentifiedLoot until paid
// identification at the General Store.
export function grantLoot(party, drop, hasAssessor) {
  if (hasAssessor) resolveLoot(party, drop);
  else party.unidentifiedLoot.push(drop);
}

export function identifyLoot(party, index) {
  const drop = party.unidentifiedLoot[index];
  if (!drop) return { success: false, message: 'No such item.' };
  if (party.gold < IDENTIFY_COST) return { success: false, message: `Identifying an item costs ${IDENTIFY_COST} gold.` };
  party.gold -= IDENTIFY_COST;
  party.unidentifiedLoot.splice(index, 1);
  resolveLoot(party, drop);
  return { success: true, message: `Identified: ${lootName(drop)}.` };
}

export function equipLoot(party, index, character) {
  const drop = party.unclaimedGear[index];
  if (!drop) return { success: false, message: 'No such item.' };
  const catalog = catalogFor(drop.kind);
  const item = catalog.find((x) => x.id === drop.id);
  character.equipment[drop.kind] = item;
  party.unclaimedGear.splice(index, 1);
  if (drop.kind === 'armor') recomputeDerived(character);
  return { success: true, message: `${character.name} equips ${item.name}.` };
}
