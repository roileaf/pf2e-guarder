// Rules for high-level Guardian feats. Pure functions over plain facts.

/** Tough Cookie: temporary Hit Points equal to half your maximum Hit Points. */
export function toughCookieAmount(maxHp) {
  return Math.floor(Math.max(0, Number(maxHp) || 0) / 2);
}

/** Tough Cookie's requirement (half HP or less) and once-per-day frequency. */
export function toughCookieAllowed({ hp, max, usedDay = null, today }) {
  if (usedDay === today) return { ok: false, reason: "Tough Cookie was already used today" };
  if (Number(hp) > Number(max) / 2) return { ok: false, reason: "Hit Points are above half of maximum" };
  return { ok: true, reason: null };
}
