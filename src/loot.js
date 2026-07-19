// loot.js
// WHAT: bonus item/gear/scroll/food drops beyond gold/gems — tiered so a
// weak encounter or shallow chest can never hand out top-tier gear, plus
// the identify pipeline (unidentified -> resolved) that gates whether a
// drop is usable right away.
// WHY: single place that knows the drop pool, the identify cost, and where
// a resolved drop ends up (party.items/party.scrolls for consumables,
// party.unclaimedGear for weapons/armor pending a free Blacksmith equip,
// party.food directly for a food packet) — combat.js and dungeon.js just
// ask "roll a drop for this tier," main.js just asks "identify index N" /
// "equip index N onto this character" / "use scroll N on this character."

import { WEAPONS, ARMORS, ITEMS, SCROLLS, gearLootTier, IDENTIFY_COST, ARTIFICER_IDENTIFY_DISCOUNT, FOOD_PACKET_AMOUNT } from './data.js';
import { recomputeDerived, schoolFor, isAlive } from './party.js';
import { findSpell, castSpell } from './spells.js';

function poolForTier(maxTier) {
  const pool = [];
  for (const w of WEAPONS) if (gearLootTier(w.cost) <= maxTier) pool.push({ kind: 'weapon', id: w.id });
  for (const a of ARMORS) if (gearLootTier(a.cost) <= maxTier) pool.push({ kind: 'armor', id: a.id });
  for (const it of Object.values(ITEMS)) if (gearLootTier(it.cost) <= maxTier) pool.push({ kind: 'item', id: it.id });
  for (const sc of Object.values(SCROLLS)) if (gearLootTier(sc.cost) <= maxTier) pool.push({ kind: 'scroll', id: sc.id });
  pool.push({ kind: 'food', amount: FOOD_PACKET_AMOUNT }); // always tier 1 — possible from any encounter
  return pool;
}

// WHAT: pick one random drop of tier <= maxTier, or null if the pool is
// somehow empty (it never is — a food packet is always in the pool).
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
  if (drop.kind === 'food') return 'a food packet';
  const catalog = catalogFor(drop.kind);
  if (catalog) return catalog.find((x) => x.id === drop.id)?.name || drop.id;
  if (drop.kind === 'scroll') return SCROLLS[drop.id]?.name || drop.id;
  return ITEMS[drop.id]?.name || drop.id;
}

// WHAT: fold a resolved (known) drop into its final place. A food packet
// resolves straight into party.food regardless of identification — you
// don't need an appraisal to recognize food.
function resolveLoot(party, drop) {
  if (drop.kind === 'food') party.food += drop.amount;
  else if (drop.kind === 'item') party.items[drop.id] = (party.items[drop.id] || 0) + 1;
  else if (drop.kind === 'scroll') party.scrolls[drop.id] = (party.scrolls[drop.id] || 0) + 1;
  else party.unclaimedGear.push(drop);
}

// WHAT: hand a drop to the party. hasAssessor (a living Rogue) resolves it
// immediately, for free; otherwise it waits in unidentifiedLoot until paid
// identification at the General Store. Food never needs identifying.
export function grantLoot(party, drop, hasAssessor) {
  if (hasAssessor || drop.kind === 'food') resolveLoot(party, drop);
  else party.unidentifiedLoot.push(drop);
}

// WHAT: identify cost is halved for a party with a living Artificer (their
// tinkerer's eye for gear) — only relevant when no living Rogue is present,
// since a Rogue already bypasses identification entirely at pickup time.
export function identifyCostFor(party) {
  const hasArtificer = party.members.some((m) => m.cls === 'Artificer' && isAlive(m));
  return hasArtificer ? Math.floor(IDENTIFY_COST * ARTIFICER_IDENTIFY_DISCOUNT) : IDENTIFY_COST;
}

export function identifyLoot(party, index) {
  const drop = party.unidentifiedLoot[index];
  if (!drop) return { success: false, message: 'No such item.' };
  const cost = identifyCostFor(party);
  if (party.gold < cost) return { success: false, message: `Identifying an item costs ${cost} gold.` };
  party.gold -= cost;
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
  recomputeDerived(character);
  return { success: true, message: `${character.name} equips ${item.name}.` };
}

export function ownedScrolls(party) {
  return Object.entries(party.scrolls || {})
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ scroll: SCROLLS[id], count }))
    .filter((entry) => entry.scroll);
}

// WHAT: use one scroll — either it teaches its spell permanently (learnable)
// or it casts the spell once for free (no SP cost), consuming one copy
// either way. `ctx` = { party, targetCharacter, log, rng, state } forwarded
// to castSpell for cast-mode scrolls.
export function useScroll(scrollId, character, ctx) {
  const scroll = SCROLLS[scrollId];
  if (!scroll) return { success: false, message: 'No such scroll.' };
  if (!ctx.party.scrolls[scrollId]) return { success: false, message: 'No such scroll left.' };
  const spell = findSpell(scroll.spellId);
  if (scroll.learnable) {
    if (!scroll.universalLearn && schoolFor(character) !== scroll.school) {
      return { success: false, message: `${character.name} cannot learn ${spell.name} from this scroll.` };
    }
    if (character.knownSpells.includes(spell.id)) return { success: false, message: `${character.name} already knows ${spell.name}.` };
    character.knownSpells.push(spell.id);
    ctx.party.scrolls[scrollId] -= 1;
    return { success: true, message: `${character.name} learns ${spell.name} from the scroll!` };
  }
  ctx.party.scrolls[scrollId] -= 1;
  castSpell(spell, { ...ctx, caster: character, free: true });
  return { success: true, message: null }; // castSpell already logs its own line
}
