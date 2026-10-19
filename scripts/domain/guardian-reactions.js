// Trigger rules for guardian reactions. Pure functions over plain facts.
import { creatureDistance } from "./geometry.js";

const PHYSICAL = ["bludgeoning", "piercing", "slashing", "bleed"];

/**
 * Facts about an attack roll, from PF2e's check context roll options, with the attacking item's
 * own facts (`itemRanged`, `damageType`) taking precedence when known.
 */
export function attackFacts({ type, options = [], itemRanged = null, damageType = null }) {
  const set = new Set(options);
  const damageTypes = options.filter((option) => option.startsWith("item:damage:type:")).map((option) => option.slice(17));
  if (damageType) damageTypes.push(damageType);
  const ranged = itemRanged ?? (set.has("item:ranged") || type === "spell-attack-roll" && !set.has("item:melee"));
  return {
    strike: type === "attack-roll",
    spellAttack: type === "spell-attack-roll",
    ranged,
    melee: itemRanged === null ? set.has("item:melee") : !itemRanged,
    physical: set.has("item:damage:category:physical") || damageTypes.some((entry) => PHYSICAL.includes(entry)),
  };
}

export const isHit = (outcome) => outcome === "success" || outcome === "criticalSuccess";

/** Shield from Arrows: an adjacent ally is the target of a physical ranged Strike (any ranged attack with Shield from Spells). */
export function shieldFromArrowsApplies({ attack, adjacentToTarget, shieldRaised, offGuard, shieldFromSpells, targetIsGuardian }) {
  if (targetIsGuardian || !adjacentToTarget || !shieldRaised || offGuard || !attack.ranged) return false;
  return shieldFromSpells ? attack.strike || attack.spellAttack : attack.strike && attack.physical;
}

/** Reactive Shield: an enemy hits you with a melee Strike while you wield a shield that isn't raised. */
export function reactiveShieldApplies({ attack, targetIsGuardian, outcome, hasShield, shieldRaised }) {
  return targetIsGuardian && attack.strike && attack.melee && isHit(outcome) && hasShield && !shieldRaised;
}

/** Clang!: an enemy critically misses a Strike or spell attack roll against your AC. */
export function clangApplies({ attack, targetIsGuardian, outcome }) {
  return targetIsGuardian && (attack.strike || attack.spellAttack) && outcome === "criticalFailure";
}

/** Reactive Strike on a ranged attack made by a creature within your reach. */
export function reactiveStrikeOnAttack({ attack, attackerDistance, reach }) {
  return attack.ranged && attackerDistance <= reach;
}

/**
 * Did a moving creature leave a square within `reach` of the guardian?
 * `squares` is the creature's footprint at each point it left (origin and intermediate waypoints).
 */
export function leftSquareInReach({ squares, guardian, reach, gridDistance = 5 }) {
  return squares.some((square) => creatureDistance(square, guardian, gridDistance) <= reach);
}

/** Tough to Kill: the first time each day you'd reach dying 3 or more, you stay at dying 2. */
export function toughToKillClamp({ value, usedDay, today }) {
  if (!(value >= 3) || usedDay === today) return { value, used: false };
  return { value: 2, used: true };
}

/** Keep Up the Good Fight: an enemy reduces you to 0 HP without killing you. */
export function keepUpTriggers({ hpBefore, hpAfter, dead = false, fromEnemy = true }) {
  return hpBefore > 0 && hpAfter === 0 && !dead && fromEnemy;
}

/** Not So Fast! results applied to the moving creature by the Strike's degree of success. */
export const NOT_SO_FAST = Object.freeze({
  criticalSuccess: "Its movement is disrupted.",
  success: "It takes a –10-foot circumstance penalty to its Speed for the rest of the movement.",
  failure: "It takes a –5-foot circumstance penalty to its Speed for the rest of the movement.",
  criticalFailure: "It is unaffected.",
});
