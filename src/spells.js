// spells.js
// WHAT: cleric + sorcerer spell lists and their effects.
// WHY: combat.js and the field (Heal outside combat, Light in dungeons) both
// need a single place that knows what a spell id does.

import { SPELLS, CONDITIONS } from './data.js';
import { recomputeDerived } from './party.js';

export function spellsForSchool(school) { return SPELLS[school] || []; }

export function knownSpellsFor(character) {
  return character.knownSpells.map((id) => findSpell(id)).filter(Boolean);
}

export function findSpell(id) {
  for (const school of Object.values(SPELLS)) {
    const found = school.find((s) => s.id === id);
    if (found) return found;
  }
  return null;
}

export function canCast(character, spell) {
  return character.sp >= spell.spCost;
}

// WHAT: apply a spell's effect. `ctx` = { caster, targetCharacter, targetGroup,
// party, log } — callers only supply what's relevant to that spell's target type.
export function castSpell(spell, ctx) {
  ctx.caster.sp -= spell.spCost;
  switch (spell.effect) {
    case 'heal': {
      const target = ctx.targetCharacter || ctx.caster;
      target.hp = Math.min(target.maxHp, target.hp + spell.power);
      target.conditions = target.conditions.filter((c) => c !== 'UNCONSCIOUS');
      ctx.log?.push(`${ctx.caster.name} casts ${spell.name} on ${target.name} (+${spell.power} HP).`);
      break;
    }
    case 'cure': {
      const target = ctx.targetCharacter || ctx.caster;
      target.conditions = target.conditions.filter((c) => !spell.cures.includes(c));
      ctx.log?.push(`${ctx.caster.name} casts ${spell.name} on ${target.name}.`);
      break;
    }
    case 'buff_ac': {
      for (const m of ctx.party.members) {
        m.combatBuff = { ac: spell.power, turnsLeft: spell.duration };
        recomputeDerived(m);
      }
      ctx.log?.push(`${ctx.caster.name} casts ${spell.name} — the party's AC improves.`);
      break;
    }
    case 'light': {
      if (ctx.state) {
        ctx.state.lightTurns = (ctx.state.lightTurns || 0) + spell.duration;
        ctx.log?.push(`${ctx.caster.name} casts Light. The passage brightens.`);
      } else {
        ctx.log?.push(`${ctx.caster.name} casts Light, but it fizzles here.`);
      }
      break;
    }
    case 'damage': {
      const [lo, hi] = spell.power;
      const dmg = ctx.rng ? ctx.rng.int(lo, hi) : lo + Math.floor(Math.random() * (hi - lo + 1));
      let killed = 0;
      let remaining = dmg;
      for (const mon of ctx.targetGroup.members) {
        if (mon.hp <= 0) continue;
        mon.hp -= remaining;
        if (mon.hp <= 0) killed++;
        break; // sparks/firebolt/lightning hit one monster in the group per spec's group-target model
      }
      ctx.log?.push(`${ctx.caster.name} casts ${spell.name} at the ${ctx.targetGroup.name} for ${dmg} damage.`);
      break;
    }
    case 'condition': {
      for (const mon of ctx.targetGroup.members) {
        if (mon.hp > 0) mon.condition = spell.condition;
      }
      ctx.log?.push(`${ctx.caster.name} casts ${spell.name} on the ${ctx.targetGroup.name}.`);
      break;
    }
    default: break;
  }
}
