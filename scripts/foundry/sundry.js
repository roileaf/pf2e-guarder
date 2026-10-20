// Optional integration with Sundry's reaction tracker (window.sundry.api.reactionUsed), which marks a
// spent reaction with an "Effect: Reaction Used" counter. Everything is a no-op when Sundry is absent.

const SUNDRY_ID = "sundry";
const USED_SLUG = "effect-reaction-used";

export function sundryActive() {
  return game.modules?.get?.(SUNDRY_ID)?.active === true && typeof globalThis.sundry?.api?.reactionUsed === "function";
}

function sundrySetting(key, fallback) {
  try {
    return game.settings.get(SUNDRY_ID, key);
  } catch {
    return fallback;
  }
}

/** Sundry's own tracker already counts reaction items posted to chat. */
export function sundryCountsPostedReactions() {
  return sundryActive() && sundrySetting("track.reaction-usage", "off") !== "off";
}

/** Sundry's own tracker already counts off-turn attack rolls as Reactive Strikes. */
export function sundryCountsStrikes() {
  return sundryCountsPostedReactions() && sundrySetting("track.reaction-usage.reactive-strike", false) === true;
}

function usedEffect(actor) {
  return (actor?.itemTypes?.effect ?? []).find((effect) => effect.slug === USED_SLUG) ?? null;
}

/** Tell Sundry the actor spent `count` reactions. */
export async function sundryReactionUsed(actor, count = 1) {
  if (!sundryActive() || !actor || count <= 0) return;
  const before = usedEffect(actor);
  globalThis.sundry.api.reactionUsed([actor]);
  if (count === 1) return;
  // Sundry creates or bumps one counter per call without awaiting; set the final count once it exists.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const effect = usedEffect(actor);
    if (effect && (effect !== before || (effect.system?.badge?.value ?? 0) > (before?.system?.badge?.value ?? 0))) {
      const target = (before?.system?.badge?.value ?? 0) + count;
      await actor.updateEmbeddedDocuments("Item", [{ _id: effect.id, "system.badge.value": target }]);
      return;
    }
  }
}

/** Undo one Sundry reaction mark (a reaction restored from the Guardian panel). */
export async function sundryReactionRestored(actor) {
  if (!sundryActive()) return;
  const effect = usedEffect(actor);
  if (!effect) return;
  const value = Number(effect.system?.badge?.value ?? 1);
  if (value > 1) await actor.updateEmbeddedDocuments("Item", [{ _id: effect.id, "system.badge.value": value - 1 }]);
  else await effect.delete();
}
