// A reaction pool: `general` reactions work for anything, `guardian` reactions
// only for reactions from guardian feats or class features (Ever Ready, Reaction Time).
// Ever Ready doesn't add a reaction: it guarantees the guardian has one when rolling initiative,
// usable only for guardian reactions. Only Reaction Time adds a second one.
// `boundless` (Boundless Reprisals) is a guardian-only reaction that exists only during an enemy's turn;
// it is present on the pool only for guardians with the feat.

export function initiativePool({ everReady = false, reactionTime = false } = {}) {
  // Without Ever Ready the guardian has its normal reaction (the GM decides about reactions before the first turn).
  if (!everReady) return { general: 1, guardian: 0 };
  // Ever Ready's reaction, plus Reaction Time's extra one when rolling initiative; both guardian-only.
  return { general: 0, guardian: 1 + (reactionTime ? 1 : 0) };
}

/** The most reactions a guardian can hold at once, at initiative or at a turn start. */
export function maxReactionPool(traits = {}) {
  const atInitiative = initiativePool(traits);
  const atTurn = turnStartPool(traits);
  return {
    general: Math.max(atInitiative.general, atTurn.general),
    guardian: Math.max(atInitiative.guardian, atTurn.guardian),
  };
}

/** Keep a pool within 0 and the most the guardian can hold at once (see maxReactionPool). */
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
