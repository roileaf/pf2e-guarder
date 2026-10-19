// A reaction pool: `general` reactions work for anything, `guardian` reactions
// only for reactions from guardian feats or class features (Ever Ready, Reaction Time).

export function initiativePool({ everReady = false, reactionTime = false } = {}) {
  return {
    general: 1,
    guardian: (everReady ? 1 : 0) + (everReady && reactionTime ? 1 : 0),
  };
}

export function turnStartPool({ reactionTime = false } = {}) {
  return { general: 1, guardian: reactionTime ? 1 : 0 };
}

export function availableReactions(pool, { guardianReaction = true } = {}) {
  if (!pool) return Infinity;
  return Math.max(0, pool.general ?? 0) + (guardianReaction ? Math.max(0, pool.guardian ?? 0) : 0);
}

/** Spend one reaction, preferring the restricted guardian pool. Returns null when none are left. */
export function consumeReaction(pool, { guardianReaction = true } = {}) {
  if (!pool) return null;
  if (guardianReaction && (pool.guardian ?? 0) > 0) return { ...pool, guardian: pool.guardian - 1 };
  if ((pool.general ?? 0) > 0) return { ...pool, general: pool.general - 1 };
  return null;
}

export function describePool(pool) {
  if (!pool) return "untracked";
  const parts = [`${pool.general ?? 0} reaction${pool.general === 1 ? "" : "s"}`];
  if (pool.guardian) parts.push(`${pool.guardian} guardian-only`);
  return parts.join(" + ");
}
