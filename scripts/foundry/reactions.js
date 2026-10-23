import { FLAG_SCOPE, SLUGS } from "../constants.js";
import {
  availableReactions, clampPool, consumeReaction, currentLimit, describePool, initiativePool, maxReactionPool, restoreReactions, turnStartPool,
  withBoundless,
} from "../domain/reactions.js";
import { setting } from "../settings.js";
import { hasSlug, isEnemy, isGuardian } from "./actors.js";
import { isResponsibleGM, registerOperation, requestOperation } from "./socket.js";
import { sundryReactionRestored, sundryReactionUsed } from "./sundry.js";

const FLAG_KEY = "reactions";

function guardianTraits(actor) {
  return {
    everReady: hasSlug(actor, SLUGS.everReady),
    reactionTime: hasSlug(actor, SLUGS.reactionTime),
    boundless: hasSlug(actor, SLUGS.boundlessReprisals),
  };
}

/** Boundless Reprisals: is it an enemy's turn in this guardian's combat right now? */
function enemyTurn(actor, combat) {
  const current = combat?.combatant?.actor;
  return Boolean(current && isEnemy(actor, current));
}

function basePool(actor, kind, combat) {
  const traits = guardianTraits(actor);
  const pool = kind === "initiative" ? initiativePool(traits) : turnStartPool(traits);
  return traits.boundless ? withBoundless(pool, enemyTurn(actor, combat)) : pool;
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
  return combatant.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? basePool(actor, "initiative", combatant.parent);
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
export async function spendReactions(actor, count = 1, { sundry = true } = {}) {
  const combatant = combatantFor(actor);
  // Sundry marks the used reaction on the combatant's actor; skipped when Sundry would count it itself.
  if (sundry && combatant?.parent?.started && combatant.actor) {
    void sundryReactionUsed(combatant.actor, count).catch((error) => console.warn("pf2e-guarder | Sundry", error));
  }
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

/** The most reactions this guardian can hold at once. */
export function maxPool(actor) {
  const traits = guardianTraits(actor);
  const max = maxReactionPool(traits);
  return traits.boundless ? { ...max, boundless: 1 } : max;
}

/** Before the guardian's first turn of the combat (only Ever Ready's reaction exists then). */
function beforeFirstTurn(combatant) {
  const combat = combatant?.parent;
  if (!combat?.started) return false;
  if ((combat.round ?? 0) > 1) return false;
  const index = combat.turns.findIndex((entry) => entry.id === combatant.id);
  return index > (combat.turn ?? 0);
}

/**
 * The reactions the guardian can hold right now (see currentLimit): before its first turn only Ever Ready's
 * guardian-only one, after it the normal reaction plus Reaction Time's. Null when reactions aren't tracked.
 */
export function currentLimitFor(actor) {
  const combatant = combatantFor(actor);
  if (!reactionPool(actor) || !combatant) return null;
  return currentLimit(guardianTraits(actor), { beforeFirstTurn: beforeFirstTurn(combatant), enemyTurn: enemyTurn(actor, combatant.parent) });
}

/**
 * Give back `count` spent reactions (a reaction undone at the table), never past what the guardian can
 * hold right now. Returns how many came back.
 */
export async function restoreReactionsFor(actor, count = 1) {
  const combatant = combatantFor(actor);
  const pool = reactionPool(actor);
  if (!combatant || !pool || count <= 0) return 0;
  const next = restoreReactions(pool, currentLimitFor(actor), count);
  const restored = availableReactions(next) - availableReactions(pool);
  if (restored > 0) await writePool(combatant, next);
  return restored;
}

/**
 * Spend one tracked reaction by hand (tracker badge click, PF2e Combater): Boundless Reprisals, then
 * guardian-only, then general, and mark it in Sundry. Returns true when one was spent.
 */
export async function spendOneReaction(actor) {
  const pool = reactionPool(actor);
  if (!pool || !consumeReaction(pool)) return false;
  return (await spendReactions(actor, 1)) === 1;
}

/** Give back one reaction by hand (tracker badge right-click, PF2e Combater) and remove one Sundry mark. */
export async function restoreOneReaction(actor) {
  const restored = await restoreReactionsFor(actor, 1);
  if (restored) await sundryReactionRestored(actor).catch(() => null);
  return restored > 0;
}

export async function setReactions(actor, pool) {
  const combatant = combatantFor(actor);
  if (!combatant) throw new Error(`${actor?.name ?? "Actor"} is not in the current combat.`);
  // Restoring can never give more than the guardian can hold (1 reaction, plus Reaction Time's guardian-only one).
  await writePool(combatant, clampPool(pool, maxPool(actor)));
}

async function resetCombatant(combatant, kind) {
  const actor = combatant?.actor;
  if (!actor || !isGuardian(actor)) return;
  await storePool(combatant, basePool(actor, kind, combatant.parent));
}

/** Boundless Reprisals: grant the extra reaction when an enemy's turn starts, drop it when any turn ends. */
async function refreshBoundless(combat) {
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || combatant.id === combat.combatant?.id || !isGuardian(actor) || !hasSlug(actor, SLUGS.boundlessReprisals)) continue;
    const pool = combatant.flags?.[FLAG_SCOPE]?.[FLAG_KEY] ?? basePool(actor, "initiative", combat);
    const next = withBoundless(pool, enemyTurn(actor, combat));
    if (next.boundless !== pool.boundless) await storePool(combatant, next);
  }
}

export function registerReactionTracking() {
  registerOperation("set-reactions", async ({ combatUuid, combatantId, pool }) => {
    const combat = await fromUuid(combatUuid);
    const combatant = combat?.combatants?.get(combatantId);
    if (!combatant) throw new Error("Combatant not found.");
    await storePool(combatant, pool);
    return true;
  });

  // A combatant without a stored pool uses its initiative pool (Ever Ready's reaction), so only turn starts need writes.
  Hooks.on("updateCombat", async (combat, changed, _options, userId) => {
    if (!isResponsibleGM(userId) || !setting("trackReactions")) return;
    if (!("turn" in changed) && !("round" in changed)) return;
    if (combat.combatant) await resetCombatant(combat.combatant, "turn");
    await refreshBoundless(combat);
  });
}
