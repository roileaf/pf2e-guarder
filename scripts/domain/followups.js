// Rules for what may follow an Intercept Attack. Pure functions: callers pass plain facts.

/** Which free actions/benefits apply after intercepting this attack. */
export function interceptFollowUps({
  feats = new Set(),
  meleeWeaponAttack = false,
  meleeStrike = false,
  adjacentToAttacker = false,
}) {
  return {
    disarmingIntercept: feats.has("disarming-intercept") && meleeWeaponAttack && adjacentToAttacker,
    armoredCounterattack: feats.has("armored-counterattack") && meleeStrike && adjacentToAttacker,
    quickVengeance: feats.has("quick-vengeance"),
    getBehindMe: feats.has("get-behind-me"),
  };
}

/** Limited-use Intercept Attack (Guardian's Intercept archetype: once per 10 minutes). */
export function frequencyAvailable(frequency) {
  if (!frequency || !Number.isFinite(Number(frequency.max))) return true;
  return Number(frequency.value ?? frequency.max) > 0;
}

/** PF2e degree of success: 0 crit failure … 3 crit success, with natural 20/1 adjustments. */
export function degreeOfSuccess(total, dc, die = null) {
  let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (die === 20) degree = Math.min(3, degree + 1);
  else if (die === 1) degree = Math.max(0, degree - 1);
  return degree;
}

export const OUTCOMES = Object.freeze(["criticalFailure", "failure", "success", "criticalSuccess"]);

/** Mythic proficiency replaces the proficiency modifier with 10 + level (no level with Proficiency Without Level). */
export function mythicProficiencyBonus({ level = 0, currentProficiency = 0, pwol = false }) {
  return 10 + (pwol ? 0 : level) - currentProficiency;
}
