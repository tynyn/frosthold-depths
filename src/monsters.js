// monsters.js
// WHAT: monster group spawning + encounter table selection.
// WHY: keeps combat.js/dungeon.js/overworld.js from hand-rolling monster
// stat blocks — everything comes from data.js MONSTERS/BOSS tables.

import { MONSTERS, BOSS } from './data.js';

// WHAT: all monster ids whose `tags` include the given tag (biome or dungeon depth key).
export function monstersForTag(tag) {
  return Object.entries(MONSTERS).filter(([, m]) => m.tags.includes(tag)).map(([id]) => id);
}

// WHAT: spawn one monster GROUP (1..N identical monsters) using `rng` for
// full reproducibility under a seed.
export function spawnGroup(monsterId, rng, isBoss = false) {
  const def = isBoss ? BOSS : MONSTERS[monsterId];
  const [gLo, gHi] = def.groupSize;
  const count = rng.int(gLo, gHi);
  const members = [];
  for (let i = 0; i < count; i++) {
    const hp = rng.int(def.hp[0], def.hp[1]);
    members.push({
      hp, maxHp: hp, accuracy: def.accuracy, damage: def.damage, ac: def.ac, speed: def.speed,
      inflicts: def.inflicts || null, condition: null,
    });
  }
  return {
    id: isBoss ? 'boss' : monsterId,
    name: def.name,
    isBoss,
    undead: !!def.undead,
    members,
    xpEach: def.xp,
    goldRange: def.gold,
  };
}

// WHAT: pick a random monster id appropriate for `tag` (biome or dungeon depth key).
export function randomMonsterForTag(tag, rng) {
  const candidates = monstersForTag(tag);
  if (candidates.length === 0) return null;
  return rng.choice(candidates);
}

export function groupAliveCount(group) { return group.members.filter((m) => m.hp > 0).length; }
export function groupIsDefeated(group) { return groupAliveCount(group) === 0; }
