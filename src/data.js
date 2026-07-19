// data.js
// WHAT: single source of truth for every tunable number/table in the game.
// WHY: spec requires no magic numbers in logic modules; everything here.

export const DIRS = ['N', 'E', 'S', 'W'];

export const DELTA = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const LEFT_OF = { N: 'W', W: 'S', S: 'E', E: 'N' };
export const RIGHT_OF = { N: 'E', E: 'S', S: 'W', W: 'N' };

export const EDGE = { OPEN: 'OPEN', WALL: 'WALL', DOOR: 'DOOR', SECRET: 'SECRET' };

export const MAP_KIND = { OVERWORLD: 'OVERWORLD', TOWN: 'TOWN', DUNGEON: 'DUNGEON' };

export const SPECIAL_TRIGGER = {
  SHOPKEEPER: 'step',
  GATE: 'step',
  TOWN_GATE: 'step',
  DUNGEON_MOUTH: 'step',
  STAIRS_UP: 'step',
  STAIRS_DOWN: 'step',
  SPINNER: 'step',
  TELEPORTER: 'step',
  DAMAGE_TRAP: 'step',
  MESSAGE: 'step',
  ENCOUNTER: 'step',
  SIGNPOST: 'step',
  SHRINE: 'step',
  CACHE: 'step',
  OASIS: 'step',
  FOUNTAIN: 'step',
  BOSS_ZONE: 'step',
  NPC: 'interact',
  CHEST: 'interact',
  DARKNESS: 'passive',
};

// ---------------------------------------------------------------------------
// PARTY / CHARACTERS
// ---------------------------------------------------------------------------

export const STATS = ['might', 'intellect', 'personality', 'endurance', 'speed', 'accuracy', 'luck'];

// WHAT: spellSchoolLevel is the character LEVEL at which a class gains
// access to its spellSchool (and starts casting/learning at all). Pure
// casters get it from level 1; hybrids (Paladin, Ranger, Artificer) get it
// delayed; Fighter/Barbarian/Monk/Rogue never gain a school (spellSchool:
// null). statMinimums: rolled-stat floors (4d6-drop-lowest, range 3-18)
// character creation checks before letting a class be chosen; a class with
// no entry for a stat has no floor on it.
export const CLASSES = {
  Fighter: {
    name: 'Fighter', hitDie: 10, spellSchool: null, combatRole: 'melee',
    statMods: { might: 3, endurance: 2, accuracy: 1, intellect: -2, personality: -2 },
    statMinimums: { might: 9 },
  },
  Barbarian: {
    name: 'Barbarian', hitDie: 12, spellSchool: null, combatRole: 'melee',
    statMods: { might: 4, endurance: 3, intellect: -3, personality: -2 },
    statMinimums: { might: 10 },
  },
  Paladin: {
    name: 'Paladin', hitDie: 9, spellSchool: 'cleric', spellSchoolLevel: 3, combatRole: 'melee',
    statMods: { might: 2, endurance: 1, personality: 1 },
    statMinimums: { might: 8, personality: 8 },
  },
  Monk: {
    name: 'Monk', hitDie: 8, spellSchool: null, combatRole: 'melee',
    statMods: { speed: 3, accuracy: 2, might: 1, personality: -2 },
    statMinimums: { speed: 9 },
  },
  Ranger: {
    name: 'Ranger', hitDie: 8, spellSchool: 'sorcerer', spellSchoolLevel: 4, combatRole: 'ranged',
    statMods: { accuracy: 3, speed: 2, might: -1 },
    statMinimums: { accuracy: 9 },
  },
  Rogue: {
    name: 'Rogue', hitDie: 8, spellSchool: null, combatRole: 'skill',
    statMods: { luck: 3, speed: 2, accuracy: 1, personality: -2 },
    statMinimums: { luck: 9 },
  },
  Artificer: {
    name: 'Artificer', hitDie: 8, spellSchool: 'sorcerer', spellSchoolLevel: 3, combatRole: 'skill',
    statMods: { intellect: 2, luck: 1, accuracy: 1, might: -1 },
    statMinimums: { intellect: 8 },
  },
  Cleric: {
    name: 'Cleric', hitDie: 7, spellSchool: 'cleric', spellSchoolLevel: 1, combatRole: 'support',
    statMods: { personality: 3, endurance: 1, might: -2 },
    statMinimums: { personality: 9 },
  },
  Druid: {
    name: 'Druid', hitDie: 7, spellSchool: 'cleric', spellSchoolLevel: 1, combatRole: 'support',
    statMods: { personality: 2, endurance: 2, might: -1, intellect: -1 },
    statMinimums: { personality: 8, endurance: 8 },
  },
  Bard: {
    name: 'Bard', hitDie: 6, spellSchool: 'cleric', spellSchoolLevel: 1, combatRole: 'support',
    statMods: { personality: 2, luck: 2, intellect: 1, might: -2, endurance: -2 },
    statMinimums: { personality: 8 },
  },
  Sorcerer: {
    name: 'Sorcerer', hitDie: 6, spellSchool: 'sorcerer', spellSchoolLevel: 1, combatRole: 'caster',
    statMods: { intellect: 3, luck: 1, endurance: -2, might: -2 },
    statMinimums: { intellect: 9 },
  },
  Wizard: {
    name: 'Wizard', hitDie: 6, spellSchool: 'sorcerer', spellSchoolLevel: 1, combatRole: 'caster',
    statMods: { intellect: 4, luck: -1, endurance: -2, might: -3 },
    statMinimums: { intellect: 10 },
  },
  Warlock: {
    name: 'Warlock', hitDie: 7, spellSchool: 'sorcerer', spellSchoolLevel: 1, combatRole: 'caster',
    statMods: { personality: 2, intellect: 1, luck: 2, endurance: -2, might: -2 },
    statMinimums: { personality: 8 },
  },
};

export const BASE_STAT = 10;

export const HP_BASE = 4;
export const HP_PER_ENDURANCE = 1;
export const HP_PER_LEVEL = 2;

export const SP_PER_STAT = 2;
export const SP_PER_LEVEL = 1;

export const AC_BASE = 10;
export const AC_PER_SPEED = 0.25; // floor(speed * this)

export const XP_TO_LEVEL = (level) => 100 * level * level;

export const TRAINING_GOLD_PER_LEVEL = 150;

export const STARTING_GOLD = 400;
export const STARTING_GEMS = 5;
export const STARTING_FOOD = 20;

// WHAT: 4d6-drop-lowest stat rolling knobs for character creation.
export const STAT_ROLL_DICE = 4;
export const STAT_ROLL_SIDES = 6;
export const STAT_ROLL_KEEP = 3;

export const MAX_ROSTER_SIZE = 6;

// WHAT: candidate names for character creation's "random name" button.
export const RANDOM_NAMES = [
  'Aldric', 'Branwen', 'Corwin', 'Delia', 'Edric', 'Freya', 'Gareth', 'Hilda',
  'Ivor', 'Junia', 'Kestrel', 'Lysander', 'Mira', 'Nolan', 'Orla', 'Percival',
  'Quenna', 'Roderick', 'Sable', 'Torvald', 'Ulrica', 'Varek', 'Wren', 'Yseult',
];

export const DEFAULT_PARTY = [
  { name: 'Harkon', cls: 'Fighter', stats: { might: 15, intellect: 6, personality: 6, endurance: 14, speed: 9, accuracy: 11, luck: 9 } },
  { name: 'Seris', cls: 'Paladin', stats: { might: 13, intellect: 8, personality: 11, endurance: 12, speed: 10, accuracy: 10, luck: 9 } },
  { name: 'Wend', cls: 'Ranger', stats: { might: 9, intellect: 9, personality: 8, endurance: 10, speed: 14, accuracy: 14, luck: 10 } },
  { name: 'Alma', cls: 'Cleric', stats: { might: 7, intellect: 9, personality: 15, endurance: 11, speed: 9, accuracy: 9, luck: 10 } },
  { name: 'Ondrei', cls: 'Sorcerer', stats: { might: 6, intellect: 15, personality: 8, endurance: 8, speed: 10, accuracy: 9, luck: 11 } },
  { name: 'Piper', cls: 'Rogue', stats: { might: 9, intellect: 9, personality: 6, endurance: 10, speed: 14, accuracy: 12, luck: 14 } },
];

export const CONDITIONS = {
  POISONED: { name: 'Poisoned', tickDamage: 2, curedBy: ['temple', 'cure_poison'] },
  DISEASED: { name: 'Diseased', statPenalty: -2, curedBy: ['temple', 'cure_disease'] },
  ASLEEP: { name: 'Asleep', skipsTurn: true, curedBy: ['temple', 'combat_hit', 'wake'] },
  AFRAID: { name: 'Afraid', attackPenalty: -3, curedBy: ['temple', 'end_of_combat'] },
  UNCONSCIOUS: { name: 'Unconscious', skipsTurn: true, curedBy: ['temple', 'heal_spell'] },
  DEAD: { name: 'Dead', skipsTurn: true, curedBy: ['temple_resurrect'] },
};

export const RESURRECT_GOLD_COST = 250;
export const RESURRECT_GEM_COST = 3;

// ---------------------------------------------------------------------------
// COMBAT
// ---------------------------------------------------------------------------

export const FRONT_RANK_SIZE = 3;
export const BLOCK_AC_BONUS = 4;
export const RUN_BASE_CHANCE = 0.5;
export const RUN_SPEED_FACTOR = 0.02;
export const BACK_RANK_MELEE_PENALTY = -6; // accuracy penalty for melee from back rank
export const XP_GOLD_VARIANCE = 0.2; // +/- 20% randomness on gold drop

export const UNARMED_DAMAGE = [1, 4]; // [min,max]

// ---------------------------------------------------------------------------
// SPELLS
// ---------------------------------------------------------------------------

// WHAT: both spell schools, levels 1-3. Every field the spec asks for:
// name, school, spellLevel, spCost, target, effect, combatOnly/
// explorationOnly (omitted on either flag means usable both places),
// description. "Light" exists once per school under a distinct id (ids
// must be globally unique — findSpell() resolves by id across schools)
// but shows the player the same spell name either way.
export const SPELLS = {
  cleric: [
    { id: 'heal', name: 'Heal', school: 'cleric', spellLevel: 1, spCost: 3, target: 'ally', effect: 'heal', power: 10, description: 'Restores hit points to one ally.' },
    { id: 'bless', name: 'Bless', school: 'cleric', spellLevel: 1, spCost: 2, target: 'party', effect: 'buff_ac', power: 2, duration: 5, combatOnly: true, description: "Improves the whole party's AC for a few rounds." },
    { id: 'cure_poison', name: 'Cure Poison', school: 'cleric', spellLevel: 2, spCost: 3, target: 'ally', effect: 'cure', cures: ['POISONED'], description: 'Cures poison in one ally.' },
    { id: 'light', name: 'Light', school: 'cleric', spellLevel: 2, spCost: 2, target: 'self', effect: 'light', duration: 50, explorationOnly: true, description: 'Brightens the passage, countering Darkness zones.' },
    { id: 'turn_undead', name: 'Turn Undead', school: 'cleric', spellLevel: 3, spCost: 5, target: 'group', effect: 'turn_undead', power: 8, combatOnly: true, description: 'Sears undead with holy power; has no effect on the living.' },
    { id: 'awaken', name: 'Awaken', school: 'cleric', spellLevel: 3, spCost: 3, target: 'ally', effect: 'cure', cures: ['ASLEEP', 'UNCONSCIOUS'], description: 'Rouses a sleeping or unconscious ally.' },
  ],
  sorcerer: [
    { id: 'magic_arrow', name: 'Magic Arrow', school: 'sorcerer', spellLevel: 1, spCost: 2, target: 'group', effect: 'damage', power: [3, 6], combatOnly: true, description: 'A bolt of raw force at one enemy group.' },
    { id: 'detect_traps', name: 'Detect Traps', school: 'sorcerer', spellLevel: 1, spCost: 2, target: 'self', effect: 'detect_traps', explorationOnly: true, description: 'Senses traps in the adjacent cells.' },
    { id: 'sleep', name: 'Sleep', school: 'sorcerer', spellLevel: 2, spCost: 3, target: 'group', effect: 'condition', condition: 'ASLEEP', combatOnly: true, description: 'Lulls an enemy group into slumber.' },
    { id: 'flame_burst', name: 'Flame Burst', school: 'sorcerer', spellLevel: 2, spCost: 5, target: 'group', effect: 'damage', power: [6, 12], combatOnly: true, description: 'A burst of fire against one enemy group.' },
    { id: 'shield', name: 'Shield', school: 'sorcerer', spellLevel: 3, spCost: 4, target: 'party', effect: 'buff_ac', power: 3, duration: 5, combatOnly: true, description: "Wraps the party in a force barrier, improving AC." },
    { id: 'arcane_light', name: 'Light', school: 'sorcerer', spellLevel: 3, spCost: 3, target: 'self', effect: 'light', duration: 40, explorationOnly: true, description: 'Brightens the passage, countering Darkness zones.' },
  ],
};

// WHAT: character level required to learn/cast a spell of a given tier.
// WHY: classic tiered-spell-progression convention — 1st-tier spells open at
// character level 1, 2nd-tier at level 3, 3rd-tier at level 5 (spellLevel*2-1)
// rather than a flat 1:1 spellLevel-to-level gate. Used by both the magic
// shop and combat/field spell-known filtering, so there is one gate formula.
export const SPELL_LEVEL_TO_CHAR_LEVEL = (spellLevel) => spellLevel * 2 - 1;

// ---------------------------------------------------------------------------
// MONSTERS
// ---------------------------------------------------------------------------

export const MONSTERS = {
  rat_swarm: { name: 'Giant Rat', hp: [3, 6], accuracy: 6, damage: [1, 3], ac: 8, speed: 12, xp: 5, gold: [0, 4], groupSize: [2, 5], tags: ['dungeon1', 'plains', 'forest'], inflicts: { condition: 'DISEASED', chance: 0.2 } },
  kobold: { name: 'Kobold', hp: [4, 9], accuracy: 8, damage: [1, 4], ac: 10, speed: 10, xp: 8, gold: [1, 6], groupSize: [2, 4], tags: ['dungeon1', 'hills'] },
  skeleton: { name: 'Skeleton', hp: [6, 12], accuracy: 9, damage: [2, 5], ac: 12, speed: 8, xp: 12, gold: [0, 3], groupSize: [1, 4], tags: ['dungeon1', 'dungeon2'], undead: true },
  goblin: { name: 'Goblin', hp: [5, 10], accuracy: 8, damage: [1, 5], ac: 11, speed: 11, xp: 10, gold: [2, 8], groupSize: [2, 5], tags: ['forest', 'hills', 'dungeon1'] },
  bandit: { name: 'Bandit', hp: [8, 16], accuracy: 10, damage: [2, 6], ac: 12, speed: 10, xp: 16, gold: [4, 14], groupSize: [1, 3], tags: ['plains', 'swamp'] },
  giant_spider: { name: 'Giant Spider', hp: [10, 18], accuracy: 11, damage: [2, 7], ac: 12, speed: 13, xp: 22, gold: [0, 5], groupSize: [1, 3], tags: ['swamp', 'forest', 'dungeon2'], inflicts: { condition: 'POISONED', chance: 0.3 } },
  orc: { name: 'Orc', hp: [12, 22], accuracy: 11, damage: [3, 8], ac: 13, speed: 9, xp: 26, gold: [5, 16], groupSize: [1, 4], tags: ['hills', 'mountain', 'dungeon2'] },
  ghoul: { name: 'Ghoul', hp: [14, 24], accuracy: 12, damage: [3, 9], ac: 14, speed: 10, xp: 32, gold: [2, 10], groupSize: [1, 3], tags: ['dungeon2', 'dungeon3', 'swamp'], inflicts: { condition: 'UNCONSCIOUS', chance: 0.2 }, undead: true },
  troll: { name: 'Troll', hp: [24, 40], accuracy: 13, damage: [5, 12], ac: 15, speed: 7, xp: 60, gold: [10, 30], groupSize: [1, 2], tags: ['mountain', 'dungeon3'] },
  sand_wraith: { name: 'Sand Wraith', hp: [18, 30], accuracy: 13, damage: [4, 10], ac: 15, speed: 12, xp: 48, gold: [5, 20], groupSize: [1, 3], tags: ['desert', 'dungeon3'], inflicts: { condition: 'AFRAID', chance: 0.25 } },
};

export const BOSS = {
  name: 'Vroktar, the Frostbound Horror',
  hp: [140, 180],
  accuracy: 16,
  damage: [10, 22],
  ac: 18,
  speed: 11,
  xp: 500,
  gold: [200, 400],
  groupSize: [1, 1],
};

// ---------------------------------------------------------------------------
// ITEMS / SHOPS
// ---------------------------------------------------------------------------

// WHAT: spBonus on a weapon feeds maxSp() (party.js) — the classic
// caster's-focus-item trope (a wand/staff channels magic) without a
// separate weapon category or spellcasting-accuracy mechanic (spells don't
// roll to hit in this engine, so there's nothing else for a "caster
// weapon" to boost).
export const WEAPONS = [
  { id: 'dagger', name: 'Dagger', cost: 15, dmg: [1, 4] },
  { id: 'handaxe', name: 'Hand Axe', cost: 20, dmg: [1, 6] },
  { id: 'shortsword', name: 'Short Sword', cost: 40, dmg: [2, 5] },
  { id: 'mace', name: 'Mace', cost: 35, dmg: [2, 6] },
  { id: 'wand', name: 'Wand', cost: 50, dmg: [1, 3], spBonus: 3 },
  { id: 'longsword', name: 'Long Sword', cost: 90, dmg: [3, 8] },
  { id: 'staff', name: 'Staff', cost: 90, dmg: [2, 5], spBonus: 5 },
  { id: 'battleaxe', name: 'Battle Axe', cost: 100, dmg: [3, 9] },
  { id: 'warhammer', name: 'War Hammer', cost: 150, dmg: [4, 10] },
  { id: 'shortbow', name: 'Short Bow', cost: 70, dmg: [2, 6], ranged: true },
  { id: 'longbow', name: 'Long Bow', cost: 110, dmg: [2, 8], ranged: true },
];

export const ARMORS = [
  { id: 'robe', name: 'Robe', cost: 10, ac: 1 },
  { id: 'leather', name: 'Leather Armor', cost: 35, ac: 3 },
  { id: 'studded', name: 'Studded Leather', cost: 60, ac: 4 },
  { id: 'chain', name: 'Chainmail', cost: 100, ac: 6 },
  { id: 'banded', name: 'Banded Mail', cost: 150, ac: 8 },
  { id: 'plate', name: 'Plate Armor', cost: 220, ac: 10 },
];

// WHAT: the offhand slot — a shield (AC bonus) or, instead, a second
// weapon for dual-wielding (see OFFHAND_DUAL_WIELD_DAMAGE_BONUS in
// combat.js) — never both; it's one slot, the player's choice.
export const SHIELDS = [
  { id: 'buckler', name: 'Buckler', cost: 25, ac: 1 },
  { id: 'kite_shield', name: 'Kite Shield', cost: 60, ac: 2 },
  { id: 'tower_shield', name: 'Tower Shield', cost: 120, ac: 4 },
];

export const OFFHAND_DUAL_WIELD_DAMAGE_BONUS = 2; // flat, added when the offhand holds a second weapon instead of a shield

export const MONK_UNARMED_DAMAGE_BONUS = 3; // flat, only when no weapon is equipped
export const MONK_UNARMORED_AC_BONUS = 2; // flat, only when no armor is equipped ("martial training")
export const DRUID_NATURAL_AC_BONUS = 1; // flat, always ("thick hide/bark-skin")
export const BARBARIAN_RAGE_HP_THRESHOLD = 0.5; // fraction of maxHp
export const BARBARIAN_RAGE_DAMAGE_BONUS = 3; // flat, only below the threshold
export const ROGUE_BACKSTAB_DAMAGE_BONUS = 3; // flat, every Rogue attack
export const WARLOCK_LIFESTEAL_FRACTION = 0.25; // fraction of damage dealt, healed to self on a hit
export const ROGUE_STEALTH_ENCOUNTER_MULTIPLIER = 0.7; // applied to encounter chance while a living Rogue is in the party
export const ROGUE_PICKPOCKET_CHANCE = 0.6;
export const ROGUE_PICKPOCKET_GOLD_FRACTION = 0.3; // fraction of the target group's remaining gold value

export const TEMPLE_COSTS = {
  healPerHp: 2,
  restoreSpPerPoint: 3,
  cureCondition: 40,
  resurrectGold: RESURRECT_GOLD_COST,
  resurrectGems: RESURRECT_GEM_COST,
};

export const TAVERN_COSTS = {
  foodCost: 5,
  restHealFraction: 0.25,
  restSpFraction: 0.25,
};

export const MAGIC_SHOP_SPELL_MARKUP = 25; // gold cost = spCost * markup

// ---------------------------------------------------------------------------
// ITEMS — General Store consumables
// ---------------------------------------------------------------------------

// WHAT: the full catalog a General Store can stock from. Each town rolls a
// random subset (GENERAL_STORE_STOCK_SIZE) at generation time — not every
// item appears in every town, and which ones do is deterministic per the
// town's own seed like everything else procedural here.
// effect vocabulary mirrors spells.js's castSpell: heal/restore_sp/cure/light.
export const ITEMS = {
  antidote: { id: 'antidote', name: 'Antidote', cost: 25, target: 'ally', effect: 'cure', cures: ['POISONED'], description: 'Cures poison in one ally.' },
  healing_potion: { id: 'healing_potion', name: 'Healing Potion', cost: 40, target: 'ally', effect: 'heal', power: 15, description: 'Restores hit points to one ally.' },
  sp_draught: { id: 'sp_draught', name: 'Restorative Draught', cost: 35, target: 'ally', effect: 'restore_sp', power: 8, description: 'Restores spell points to one ally.' },
  smelling_salts: { id: 'smelling_salts', name: 'Smelling Salts', cost: 30, target: 'ally', effect: 'cure', cures: ['ASLEEP', 'UNCONSCIOUS'], description: 'Rouses a sleeping or unconscious ally.' },
  purging_tonic: { id: 'purging_tonic', name: 'Purging Tonic', cost: 45, target: 'ally', effect: 'cure', cures: ['DISEASED'], description: 'Cures disease in one ally.' },
  torch_oil: { id: 'torch_oil', name: 'Flask of Torch Oil', cost: 20, target: 'self', effect: 'light', power: 30, description: 'Brightens the passage, countering Darkness zones.' },
};

export const GENERAL_STORE_STOCK_SIZE = [4, 6]; // how many distinct items a given town's store carries

// ---------------------------------------------------------------------------
// LOOT DROPS — bonus item/gear beyond gold, tiered to the encounter/depth
// ---------------------------------------------------------------------------

// WHAT: derive a loot tier (1-4) from a monster's xp value or a gear/item's
// cost, rather than hand-tagging every catalog entry. WHY: "relative to the
// encounter" — a weak monster's xp caps out low, so it can only ever drop
// low-tier loot; only the boss (xp far past every threshold) reaches tier
// 4, where the single priciest piece of gear (Plate Armor) lives — a weak
// monster can never drop it, only the toughest fight in the game can.
export const monsterLootTier = (xp) => {
  if (xp > 60) return 4;
  if (xp > 32) return 3;
  if (xp > 16) return 2;
  return 1;
};
export const gearLootTier = (cost) => {
  if (cost > 150) return 4;
  if (cost > 90) return 3;
  if (cost > 40) return 2;
  return 1;
};

export const COMBAT_LOOT_DROP_CHANCE = 0.2; // beyond gold, per victory
export const CHEST_LOOT_DROP_CHANCE = 0.25; // beyond gold/gems, per chest

// WHAT: gold cost to have one unidentified loot item appraised at the
// General Store. A living Rogue assesses loot for free the moment it's
// picked up instead — no store trip needed; a living Artificer (no Rogue
// present) still pays, but at ARTIFICER_IDENTIFY_DISCOUNT off.
export const IDENTIFY_COST = 1;
export const ARTIFICER_IDENTIFY_DISCOUNT = 0.5;

// WHAT: spell scrolls — each references an existing SPELLS entry by id.
// `learnable: true` means using it teaches the spell permanently instead of
// casting it; school-restricted learnable scrolls require the reader to
// already have that school (schoolFor(character) === scroll.school) unless
// `universalLearn` is set, which lets ANY class learn it regardless of
// class/spellSchool — "some simple spells any class might learn." A
// non-learnable scroll just casts its spell once, for free (no SP cost),
// and can be read by anyone — the scroll supplies the magic, not the
// reader's own training. Cost feeds the same gearLootTier() as everything
// else, and owning more than one of an id is simply more uses.
// Cast-mode scrolls are only ever usable from the field (no combat scroll
// action exists), so each one's spellId deliberately targets 'ally' with
// neither combatOnly nor explorationOnly set — the same field-eligibility
// a spell needs to appear in the party's own Cast panel. Learnable scrolls
// have no such constraint: learning just adds the spell to knownSpells, so
// the character casts it later through their own normal Cast menu
// (including combat-only spells like Bless/Sleep) exactly as if they'd
// learned it any other way.
export const SCROLLS = {
  scroll_detect_traps: { id: 'scroll_detect_traps', name: 'Scroll of Detect Traps', cost: 20, spellId: 'detect_traps', school: 'sorcerer', learnable: true, universalLearn: true },
  scroll_light: { id: 'scroll_light', name: 'Scroll of Light', cost: 20, spellId: 'light', school: 'cleric', learnable: true, universalLearn: true },
  scroll_cure_poison: { id: 'scroll_cure_poison', name: 'Scroll of Cure Poison', cost: 30, spellId: 'cure_poison', school: 'cleric', learnable: false, universalLearn: false },
  scroll_bless: { id: 'scroll_bless', name: 'Scroll of Bless', cost: 40, spellId: 'bless', school: 'cleric', learnable: true, universalLearn: false },
  scroll_heal: { id: 'scroll_heal', name: 'Scroll of Heal', cost: 45, spellId: 'heal', school: 'cleric', learnable: false, universalLearn: false },
  scroll_sleep: { id: 'scroll_sleep', name: 'Scroll of Sleep', cost: 50, spellId: 'sleep', school: 'sorcerer', learnable: true, universalLearn: false },
};

// WHAT: a loot-drop food packet — always tier 1, so it's possible from any
// encounter no matter how weak. Resolves straight into party.food, the same
// counter the Tavern already spends.
export const FOOD_PACKET_AMOUNT = 3;

// WHAT: sensible starting weapon+armor(+offhand) per class — every
// character used to begin with equipment: {weapon:null, armor:null}, i.e.
// genuinely unarmed and unarmored until a Blacksmith visit. That was never
// a design choice, just a gap; this is what a fresh character is handed at
// creation. Monk deliberately gets no weapon — see MONK_UNARMED_DAMAGE_BONUS.
export const CLASS_STARTING_GEAR = {
  Fighter: { weapon: 'longsword', armor: 'leather', offhand: 'buckler' },
  Barbarian: { weapon: 'battleaxe', armor: 'studded' },
  Paladin: { weapon: 'longsword', armor: 'leather', offhand: 'buckler' },
  Monk: { armor: 'robe' },
  Ranger: { weapon: 'shortbow', armor: 'leather' },
  Rogue: { weapon: 'shortsword', armor: 'leather' },
  Artificer: { weapon: 'wand', armor: 'leather' },
  Cleric: { weapon: 'mace', armor: 'robe' },
  Druid: { weapon: 'mace', armor: 'leather' },
  Bard: { weapon: 'shortsword', armor: 'robe' },
  Sorcerer: { weapon: 'dagger', armor: 'robe' },
  Wizard: { weapon: 'staff', armor: 'robe' },
  Warlock: { weapon: 'dagger', armor: 'robe' },
};

// ---------------------------------------------------------------------------
// PROCGEN — DUNGEON
// ---------------------------------------------------------------------------

export const DUNGEON_SIZE = 16;
export const DUNGEON_BRAID_CHANCE = 0.35;
export const DUNGEON_ROOM_COUNT = [2, 4];
export const DUNGEON_ROOM_MIN_SIZE = 2;
export const DUNGEON_ROOM_MAX_SIZE = 4;
export const DUNGEON_DOOR_CHANCE = 0.15;
export const DUNGEON_SECRET_CHANCE = 0.25; // fraction of doors that are secret
export const DUNGEON_MAX_DEPTH = 4; // deepest level holds the boss

// WHAT: classic "stock the dungeon" procedure — each carved room gets ONE
// stocking roll (monster / trap / special feature / empty) instead of
// specials being scattered by raw per-cell density. A monster room has a
// separate chance of guarding treasure; an empty room has a smaller separate
// chance of hiding treasure alone. Generic mechanic, not copied table text.
export const DUNGEON_ROOM_STOCK_MONSTER_CHANCE = 2 / 6;
export const DUNGEON_ROOM_STOCK_TRAP_CHANCE = 1 / 6;
export const DUNGEON_ROOM_STOCK_SPECIAL_CHANCE = 1 / 6;
// remaining chance (2/6 by default): room stocked empty
export const DUNGEON_ROOM_TREASURE_WITH_MONSTER_CHANCE = 0.5;
export const DUNGEON_ROOM_HIDDEN_TREASURE_CHANCE = 1 / 6;
export const DUNGEON_ROOM_SPECIAL_TYPES = ['TELEPORTER', 'SPINNER', 'FOUNTAIN', 'MESSAGE'];

// WHAT: sparse atmospheric dressing in corridors (outside stocked rooms) —
// darkness patches and flavor text only, never mechanical content. Rooms
// carry all the monsters/traps/treasure; corridors are connective tissue.
export const DUNGEON_CORRIDOR_FLAVOR_DENSITY = 0.015;
export const DUNGEON_CORRIDOR_FLAVOR_TYPES = ['DARKNESS', 'MESSAGE'];

export const DUNGEON_DAMAGE_TRAP_DMG = [3, 9];
export const DUNGEON_FOUNTAIN_SP = 5;

// WHAT: wandering-monster check — a flat chance rolled on a fixed turn
// cadence. WHY: classic convention (check every couple of turns at a flat
// 1-in-6) rather than a continuous per-step chance that scales with depth;
// depth danger instead comes from monster tags/group counts already scaling
// with dungeonDepth.
export const DUNGEON_WANDERING_CHECK_INTERVAL = 3; // turns between checks
export const DUNGEON_WANDERING_CHECK_CHANCE = 1 / 6;

export const DUNGEON_CHEST_TRAP_CHANCE = 0.4;
export const DUNGEON_CHEST_GOLD = [10, 60];
export const DUNGEON_CHEST_GEM_CHANCE = 0.3;
export const DUNGEON_DARKNESS_VIEW_DEPTH = 1;
export const SECRET_SEARCH_BASE_CHANCE = 0.5;
export const SECRET_SEARCH_ROGUE_BONUS = 0.3;

// ---------------------------------------------------------------------------
// PROCGEN — OVERWORLD
// ---------------------------------------------------------------------------

export const OVERWORLD_SIZE = 32;
export const OVERWORLD_TOWN_GATES = [2, 3];
export const OVERWORLD_DUNGEON_MOUTHS = [3, 5];
export const OVERWORLD_MIN_FEATURE_SPACING = 4;
export const OVERWORLD_NOISE_SCALE = 0.12;
export const OVERWORLD_MOISTURE_SCALE = 0.17;

export const BIOME_THRESHOLDS = {
  WATER: (e) => e < 0.30,
  MOUNTAIN: (e) => e > 0.82,
  // Remaining biomes decided by moisture once elevation is mid-range.
};

export const BIOME_DANGER = {
  PLAINS: 0.04,
  FOREST: 0.07,
  HILLS: 0.08,
  SWAMP: 0.14,
  DESERT: 0.13,
  WATER: 0,
  MOUNTAIN: 0,
};

export const BIOME_MONSTER_TAGS = {
  PLAINS: 'plains', FOREST: 'forest', HILLS: 'hills', SWAMP: 'swamp', DESERT: 'desert', MOUNTAIN: 'mountain',
};

// WHAT: per-tileset wall-detail knobs consumed by fpview.js's per-cell wall
// identity pass. WHY: "density and motif come from the map's tileset" per
// spec — this is what makes overworld/town/dungeon walls read differently
// without fpview.js ever branching on map.kind; it just reads these numbers.
//   crackChance/mossChance/accentChance: per-face probability of that detail.
//   mossColor: stain/patch fill color (with alpha) for this tileset.
//   jitter: max per-cell base-color brightness variance (fraction, e.g. 0.08 = +/-8%).
const detail = (crackChance, mossChance, accentChance, mossColor, jitter) =>
  ({ crackChance, mossChance, accentChance, mossColor, jitter });

export const BIOME_TILESET = {
  PLAINS: { sky: '#bfe3ff', floor: '#7fae4a', wall: '#5c7a36', tint: '#e8ffd0', detail: detail(0.15, 0.2, 0.05, 'rgba(80,120,40,0.25)', 0.06) },
  FOREST: { sky: '#8fbf9a', floor: '#2f5a2f', wall: '#1e3d1e', tint: '#123312', detail: detail(0.2, 0.4, 0.05, 'rgba(20,60,20,0.35)', 0.08) },
  HILLS: { sky: '#cfe0ea', floor: '#8a8256', wall: '#5f5a3a', tint: '#d8cfa0', detail: detail(0.25, 0.2, 0.04, 'rgba(90,80,50,0.25)', 0.07) },
  SWAMP: { sky: '#7c8f7a', floor: '#3c4a30', wall: '#26301c', tint: '#39422a', detail: detail(0.2, 0.5, 0.03, 'rgba(30,50,20,0.4)', 0.09) },
  DESERT: { sky: '#ffe3a3', floor: '#d9b465', wall: '#a97f3d', tint: '#fff3cf', detail: detail(0.3, 0.05, 0.04, 'rgba(120,90,40,0.2)', 0.08) },
  MOUNTAIN: { sky: '#c9d3dc', floor: '#7d7d82', wall: '#4c4c52', tint: '#e4e7ec', detail: detail(0.4, 0.15, 0.03, 'rgba(60,60,65,0.3)', 0.07) },
  WATER: { sky: '#bfe3ff', floor: '#3a6fa8', wall: '#1f3f61', tint: '#bfe3ff', detail: detail(0.05, 0.1, 0.02, 'rgba(20,40,60,0.3)', 0.05) },
};

export const DUNGEON_TILESET = { sky: '#1a1a22', floor: '#2a2418', wall: '#4a4238', door: '#7a5230', detail: detail(0.35, 0.3, 0.15, 'rgba(40,55,25,0.3)', 0.1) };
export const TOWN_TILESET = { sky: '#7fb2e0', floor: '#8a7a5a', wall: '#5a4a30', door: '#8a5a2e', detail: detail(0.1, 0.08, 0.08, 'rgba(60,70,40,0.15)', 0.05) };

export const OVERWORLD_SIGNPOST_MESSAGES = [
  'A weathered sign: "Frosthold lies to the north."',
  'A carved marker: "Beware the depths — none return unchanged."',
  'The sign reads: "Turn back, or turn to stone."',
  '"Free ale at the Frosthold tavern, ask for Piper."',
];

export const OVERWORLD_SHRINE_BUFF = { stat: 'luck', amount: 2, duration: 30 };
export const OVERWORLD_CACHE_GOLD = [15, 50];
export const OVERWORLD_OASIS_HEAL_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// TOWN
// ---------------------------------------------------------------------------

export const TOWN_SIZE = 20;

// ---------------------------------------------------------------------------
// FIRST-PERSON RENDER
// ---------------------------------------------------------------------------

export const FPVIEW_MAX_DEPTH = 4;
export const FPVIEW_DEPTH_SHADE = 0.16; // darken factor per depth unit

export const FPVIEW_TORCH_WARMTH = 0.32; // max warm-color blend at depth 0
export const FPVIEW_TORCH_FALLOFF = 1.1; // higher = warmth fades out sooner with depth
export const FPVIEW_TORCH_COLOR = [255, 176, 96]; // [r,g,b] torch-glow tint

export const FPVIEW_GRID_COLOR = 'rgba(0,0,0,0.35)'; // floor/ceiling seam-line color
export const FPVIEW_GRID_WIDTH = 1.5; // seam line stroke width, px

// ---------------------------------------------------------------------------
// AUTO-MAP
// ---------------------------------------------------------------------------

export const AUTOMAP_WALL_COLOR = '#3ad6ff'; // plain wall edge (and an undiscovered secret door)
export const AUTOMAP_DOOR_COLOR = '#ffb454'; // door edge (and a found secret door) — visually distinct from a wall
export const AUTOMAP_SPECIAL_COLOR = '#ffd23a'; // generic special-tile marker (chest/trap/fountain/etc.)
export const AUTOMAP_SHOP_COLOR = '#3aff7a'; // shopkeeper-tile marker — only ever drawn on an explored cell,
// which (since exploring a cell requires having stood on it) already means the party has visited that
// shop at least once; there's no separate "encountered" flag to track.

export const FPVIEW_STEP_DOLLY_MS = 120; // cosmetic forward/back push duration
export const FPVIEW_BUMP_SHAKE_MS = 150; // wall-bump screen-shake duration
export const FPVIEW_BUMP_SHAKE_MAGNITUDE = 6; // px, decays to 0 over the duration

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

export const DEFAULT_SEED = 1337;

// ---------------------------------------------------------------------------
// SAVE / CONTINUE
// ---------------------------------------------------------------------------

export const SAVE_SLOT_COUNT = 3; // hard cap — no more than 3 save sessions
export const SAVE_STORAGE_PREFIX = 'frosthold-depths-save-';
