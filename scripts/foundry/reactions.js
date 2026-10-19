import { FLAG_SCOPE, SLUGS } from "../constants.js";
import { availableReactions, consumeReaction, describePool, initiativePool, turnStartPool } from "../domain/reactions.js";
import { setting } from "../settings.js";
import { hasSlug, isGuardian } from "./actors.js";
import { isResponsibleGM, registerOperation, requestOperation } from "./socket.js";

const FLAG_KEY = "reactions";

function guardianTraits(actor) {
  return {
    everReady: hasSlug(actor, SLUGS.everReady),
    reactionTime: hasSlug(actor, SLUGS.reactionTime),
  };
}

function combatantIn(combat, actor) {
  const byActor = combat.getCombatantsByActor?.(actor);
  if (byActor?.length) return byActor[0];
  return combat.combatants?.find?.((combatant) => combatant.actor?.uuid === actor.uuid || combatant.actorId === actor.id) ?? null;
}

/** The actor's combatant in the viewed combat, else in any started combat (the viewed one may differ). */
export function combatantFor(actor, combat = game.combat) {
  if (!actor) return null;
  const viewed = combat ? combatantIn(combat, actor) : null;
  if (viewed) return viewed;
  for (const other of game.combats ?? []) {
    if (other === combat || !other.started) continue;
    const found = combatantIn(other, actor);
    if (found) return found;
  }
  return null;
}

/** Current reaction pool, or null when this actor's reactions are not tracked. */
export function reactionPool(actor) {
  if (!setting("trackReactions")) return null;
  const combatant = combatantFor(actor);
  if (!combatant?.parent?.started) return null;
  return combatant.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? initiativePool(guardianTraits(actor));
}

export function reactionsLeft(actor) {
  return availableReactions(reactionPool(actor));
}

export function reactionSummary(actor) {
  return describePool(reactionPool(actor));
}

function storePool(combatant, pool) {
  return combatant.update({ [`flags.${FLAG_SCOPE}.${FLAG_KEY}`]: pool });
}

async function writePool(combatant, pool) {
  if (combatant.isOwner) return storePool(combatant, pool);
  return requestOperation("set-reactions", { combatUuid: combatant.parent.uuid, combatantId: combatant.id, pool }, { gmRequired: true });
}

/**
 * Spend `count` guardian reactions in one write (a relayed write may not be visible locally
 * before a second read). Returns how many were actually available to spend.
 */
export async function spendReactions(actor, count = 1) {
  const combatant = combatantFor(actor);
  let pool = reactionPool(actor);
  if (!combatant || !pool) return count;
  let spent = 0;
  for (; spent < count; spent++) {
    const next = consumeReaction(pool);
    if (!next) break;
    pool = next;
  }
  if (spent) await writePool(combatant, pool);
  return spent;
}

export async function setReactions(actor, pool) {
  const combatant = combatantFor(actor);
  if (!combatant) throw new Error(`${actor?.name ?? "Actor"} is not in the current combat.`);
  await writePool(combatant, { general: Math.max(0, pool.general ?? 0), guardian: Math.max(0, pool.guardian ?? 0) });
}

async function resetCombatant(combatant, kind) {
  const actor = combatant?.actor;
  if (!actor || !isGuardian(actor)) return;
  const traits = guardianTraits(actor);
  const pool = kind === "initiative" ? initiativePool(traits) : turnStartPool(traits);
  await storePool(combatant, pool);
}

export function registerReactionTracking() {
  registerOperation("set-reactions", async ({ combatUuid, combatantId, pool }) => {
    const combat = await fromUuid(combatUuid);
    const combatant = combat?.combatants?.get(combatantId);
    if (!combatant) throw new Error("Combatant not found.");
    await storePool(combatant, pool);
    return true;
  });

  // A combatant without a stored pool uses its initiative pool (Ever Ready), so only turn starts need writes.
  Hooks.on("updateCombat", async (combat, changed, _options, userId) => {
    if (!isResponsibleGM(userId) || !setting("trackReactions")) return;
    if (!("turn" in changed) && !("round" in changed)) return;
    if (combat.combatant) await resetCombatant(combat.combatant, "turn");
  });
}
