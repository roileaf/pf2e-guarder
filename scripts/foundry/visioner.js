// Optional integration with PF2E Visioner (per-observer cover). Everything degrades to Guarder's own
// effects when Visioner is absent or too old to support "at least this cover" adjustments.

const VISIONER_ID = "pf2e-visioner";

/** Visioner is active, its adjustCover operation supports `mode: "minimum"`, and its auto-cover is on. */
export function visionerCoverMinimum() {
  const module = game.modules?.get?.(VISIONER_ID);
  if (module?.active !== true) return false;
  const modes = module.api?.coverAdjustmentModes;
  const list = typeof modes === "function" ? modes.call(module.api) : modes;
  if (!Array.isArray(list) || !list.includes("minimum")) return false;
  // Visioner applies cover adjustments only through its auto-cover; without it the cover would be lost.
  try {
    return game.settings.get(VISIONER_ID, "autoCover") === true;
  } catch {
    return false;
  }
}

/**
 * Rule elements giving the effect's bearer at least `state` cover against every observer: Visioner's
 * own rule when it supports it (Visioner shows and applies the cover, and drops it with the effect),
 * else a circumstance AC bonus of the same size.
 */
export function coverRules(state, source, label) {
  if (visionerCoverMinimum()) {
    return [{
      key: "PF2eVisionerEffect",
      priority: 120,
      operations: [{ type: "adjustCover", mode: "minimum", state, direction: "from", observers: "all", scope: "while-active", source }],
    }];
  }
  const bonus = { lesser: 1, standard: 2, greater: 4 }[state] ?? 0;
  return bonus ? [{ key: "FlatModifier", selector: "ac", type: "circumstance", value: bonus, label }] : [];
}
