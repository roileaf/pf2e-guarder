// A reaction pool: `general` reactions work for anything, `guardian` reactions
// only for reactions from guardian feats or class features (Ever Ready, Reaction Time).
// `boundless` (Boundless Reprisals) is a guardian-only reaction that exists only during an enemy's turn;
// it is present on the pool only for guardians with the feat.

export function initiativePool({ everReady = false, reactionTime = false } = {}) {
  return {
    general: 1,
    guardian: (everReady ? 1 : 0) + (everReady && reactionTime ? 1 : 0),
  };
}

/** Keep a pool within 0 and the most the guardian can hold at once (its initiative pool). */
export function clampPool(pool, max) {
  const limit = (value, top) => Math.min(Math.max(0, Math.floor(Number(value) || 0)), top);
  const clamped = { general: limit(pool?.general, max.general), guardian: limit(pool?.guardian, max.guardian) };
  if (max.boundless !== undefined) clamped.boundless = limit(pool?.boundless, max.boundless);
  return clamped;
}

export function turnStartPool({ reactionTime = false } = {}) {
  return { general: 1, guardian: reactionTime ? 1 : 0 };
}

/** Boundless Reprisals: the extra reaction is there for exactly the turns of the guardian's enemies. */
export function withBoundless(pool, enemyTurn) {
  return { ...pool, boundless: enemyTurn ? 1 : 0 };
}

export function availableReactions(pool, { guardianReaction = true } = {}) {
  if (!pool) return Infinity;
  const restricted = guardianReaction ? Math.max(0, pool.guardian ?? 0) + Math.max(0, pool.boundless ?? 0) : 0;
  return Math.max(0, pool.general ?? 0) + restricted;
}

/**
 * Spend one reaction. Guardian reactions use the one that expires soonest first: Boundless Reprisals
 * (this turn only), then guardian-only, then the general reaction. Returns null when none are left.
 */
export function consumeReaction(pool, { guardianReaction = true } = {}) {
  if (!pool) return null;
  if (guardianReaction && (pool.boundless ?? 0) > 0) return { ...pool, boundless: pool.boundless - 1 };
  if (guardianReaction && (pool.guardian ?? 0) > 0) return { ...pool, guardian: pool.guardian - 1 };
  if ((pool.general ?? 0) > 0) return { ...pool, general: pool.general - 1 };
  return null;
}

export function describePool(pool) {
  if (!pool) return "untracked";
  const parts = [`${pool.general ?? 0} reaction${pool.general === 1 ? "" : "s"}`];
  if (pool.guardian) parts.push(`${pool.guardian} guardian-only`);
  if (pool.boundless) parts.push("1 Boundless Reprisals (this turn)");
  return parts.join(" + ");
}
