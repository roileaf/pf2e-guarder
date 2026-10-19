export function tauntLimits({ groupTaunt = false, longDistance = false } = {}) {
  return {
    maxTargets: groupTaunt ? 3 : 1,
    maxTaunted: groupTaunt ? 3 : 1,
    range: longDistance ? 120 : 30,
  };
}

/**
 * Work out which taunt effects to remove and which targets to taunt.
 * `existing` are the ids of enemies this guardian currently taunts.
 * `keep` (optional) is the player's choice of existing enemies to keep taunted.
 * Re-taunting an enemy refreshes it: its old effect is removed and a new one applied.
 */
export function planTaunt({ existing = [], targets = [], limits, keep = null }) {
  if (!targets.length) return { ok: false, error: "Target at least one enemy to Taunt." };
  if (targets.length > limits.maxTargets) {
    return { ok: false, error: `You can Taunt at most ${limits.maxTargets} ${limits.maxTargets === 1 ? "enemy" : "enemies"}.` };
  }
  const targetSet = new Set(targets);
  const others = existing.filter((id) => !targetSet.has(id));
  const capacity = limits.maxTaunted - targets.length;
  if (keep === null) {
    if (capacity <= 0 || others.length === 0) {
      return { ok: true, apply: [...targets], remove: [...existing], keep: [], needsChoice: false };
    }
    if (others.length > capacity) {
      return { ok: true, apply: [...targets], remove: null, keep: null, needsChoice: true, choices: others, capacity };
    }
    return { ok: true, apply: [...targets], remove: existing.filter((id) => targetSet.has(id)), keep: others, needsChoice: false };
  }
  const kept = others.filter((id) => keep.includes(id));
  if (kept.length > capacity) return { ok: false, error: `Keep at most ${capacity} other taunted ${capacity === 1 ? "enemy" : "enemies"}.` };
  return { ok: true, apply: [...targets], remove: existing.filter((id) => !kept.includes(id)), keep: kept, needsChoice: false };
}

/** Taunt makes the enemy off-guard when its hostile action includes an ally of the guardian but not the guardian. */
export function tauntTriggersOffGuard({ guardianId, affectedIds = [], isAllyOfGuardian = () => false }) {
  if (!affectedIds.length || affectedIds.includes(guardianId)) return false;
  return affectedIds.some((id) => isAllyOfGuardian(id));
}
