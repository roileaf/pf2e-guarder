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

// Sundry marks Guarder removes itself (a reaction restored from the panel or tracker) must not restore again.
const ownChanges = new Set();

/** Undo one Sundry reaction mark (a reaction restored from the Guardian panel). */
export async function sundryReactionRestored(actor) {
  if (!sundryActive()) return;
  const effect = usedEffect(actor);
  if (!effect) return;
  const value = Number(effect.system?.badge?.value ?? 1);
  ownChanges.add(effect.uuid);
  try {
    if (value > 1) await actor.updateEmbeddedDocuments("Item", [{ _id: effect.id, "system.badge.value": value - 1 }]);
    else await effect.delete();
  } finally {
    ownChanges.delete(effect.uuid);
  }
}

function isUsedEffect(item) {
  return item?.type === "effect" && item.slug === USED_SLUG && Boolean(item.parent);
}

/**
 * Removing Sundry's Reaction Used effect, or counting its badge down, gives the guardian its reactions
 * back. Sundry's own clean-ups are left alone: the effect expiring at the actor's turn start (Guarder
 * refreshes reactions then) and the combat ending.
 */
export function registerSundryRestore({ isGuardian, combatantFor, restoreReactionsFor }) {
  const badges = new Map();
  const ownTurn = (actor) => {
    const combat = combatantFor(actor)?.parent;
    return Boolean(combat?.started && combat.combatant?.actor?.id === actor.id);
  };
  const restore = (actor, count) => {
    if (count > 0 && sundryActive() && isGuardian(actor) && !ownTurn(actor) && combatantFor(actor)?.parent?.started) {
      void restoreReactionsFor(actor, count).catch((error) => console.warn("pf2e-guarder | Sundry restore", error));
    }
  };
  Hooks.on("preUpdateItem", (item, changes, _options, userId) => {
    if (userId === game.user.id && isUsedEffect(item) && foundry.utils.hasProperty(changes, "system.badge.value")) {
      badges.set(item.uuid, Number(item.system?.badge?.value ?? 1));
    }
  });
  Hooks.on("updateItem", (item, _changes, _options, userId) => {
    if (userId !== game.user.id || !badges.has(item.uuid)) return;
    const before = badges.get(item.uuid);
    badges.delete(item.uuid);
    if (ownChanges.has(item.uuid)) return;
    restore(item.parent, before - Number(item.system?.badge?.value ?? 0));
  });
  Hooks.on("deleteItem", (item, _options, userId) => {
    if (userId !== game.user.id || !isUsedEffect(item) || ownChanges.has(item.uuid)) return;
    // PF2e removes the effect once it has expired (at the actor's own turn start); not a reaction given back.
    if (item.isExpired || item.system?.expired) return;
    restore(item.parent, Number(item.system?.badge?.value ?? 1));
  });
}
