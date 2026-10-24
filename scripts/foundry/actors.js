import { IMMOBILIZING_CONDITIONS, INCAPACITATING_CONDITIONS, SLUGS } from "../constants.js";
import { creatureDistance, footprintOf } from "../domain/geometry.js";
import { footprintCenter, wallBlocksPath } from "../domain/walls.js";
import { activeGM } from "./socket.js";

export function notify(level, message) {
  ui.notifications?.[level]?.(message);
}

export function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

export function hasSlug(actor, slug) {
  return actor?.items?.some?.((item) => item.slug === slug) === true;
}

export function itemBySlug(actor, slug, type = null) {
  return actor?.items?.find?.((item) => item.slug === slug && (!type || item.type === type)) ?? null;
}

export function isGuardian(actor) {
  return hasSlug(actor, SLUGS.interceptAttack);
}

/**
 * A guardian character: the Guardian class, Intercept Attack, or the Guardian Dedication. Guarder offers
 * reactions and runs feats only for them; a fighter's Reactive Strike or Shield Block stays at the table.
 */
export function isGuardianCharacter(actor) {
  if (!actor || actor.type !== "character") return false;
  return actor.class?.slug === "guardian" || isGuardian(actor) || hasSlug(actor, "guardian-dedication");
}

/** The real actor behind a PF2e contextual clone or a token actor. */
export function sourceActor(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor;
  return game.actors?.get(actor.id) ?? actor;
}

export function sameActor(uuid, actor) {
  if (!uuid || !actor) return false;
  return uuid === actor.uuid || uuid.endsWith(`Actor.${actor.id}`);
}

export function isAlly(actor, other) {
  if (!actor || !other || actor.uuid === other.uuid) return false;
  if (typeof actor.isAllyOf === "function") return actor.isAllyOf(other);
  return actor.alliance != null && actor.alliance === other.alliance;
}

export function isEnemy(actor, other) {
  if (!actor || !other || actor.uuid === other.uuid) return false;
  if (typeof actor.isEnemyOf === "function") return actor.isEnemyOf(other);
  return actor.alliance != null && other.alliance != null && actor.alliance !== other.alliance;
}

export function hasCondition(actor, slug) {
  if (typeof actor?.hasCondition === "function") return actor.hasCondition(slug);
  return actor?.itemTypes?.condition?.some?.((condition) => condition.slug === slug) === true;
}

export function incapacitated(actor) {
  return INCAPACITATING_CONDITIONS.some((slug) => hasCondition(actor, slug));
}

export function immobilized(actor) {
  return IMMOBILIZING_CONDITIONS.some((slug) => hasCondition(actor, slug));
}

export function alive(actor) {
  const hp = actor?.attributes?.hp ?? actor?.system?.attributes?.hp;
  return !hp || Number(hp.value) > 0;
}

export function landSpeed(actor) {
  const speed = actor?.attributes?.speed ?? actor?.system?.attributes?.speed;
  return Number(speed?.total ?? speed?.value ?? 25) || 25;
}

/** The user who answers prompts for this actor: an active player owner, else the active GM. */
export function controllingUser(actor, mode = "owner") {
  // A GM applying the damage answers GM prompts on their own client.
  const gm = game.user?.isGM ? game.user : activeGM();
  if (mode === "gm") return gm;
  const users = [...(game.users ?? [])].filter((user) => user.active && !user.isGM);
  const owners = users.filter((user) => actor?.testUserPermission?.(user, "OWNER"));
  return owners.find((user) => user.character?.id === actor?.id) ?? owners[0] ?? gm;
}

export function tokenDocument(token) {
  return token?.document ?? token ?? null;
}

export function sceneTokenFor(actor, scene = globalThis.canvas?.scene) {
  if (actor?.token && actor.token.parent?.id === scene?.id) return actor.token;
  return scene?.tokens?.find?.((token) => token.actorId === actor?.id && (actor.isToken ? token.id === actor.token?.id : token.actorLink))
    ?? actor?.getActiveTokens?.(true, true)?.find((token) => token.parent?.id === scene?.id)
    ?? null;
}

export function gridDistance(scene = globalThis.canvas?.scene) {
  return Number(scene?.grid?.distance ?? globalThis.canvas?.dimensions?.distance ?? 5) || 5;
}

export function footprint(token) {
  const doc = tokenDocument(token);
  const size = Number(doc?.parent?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
  return footprintOf(doc, size);
}

export function tokenDistance(a, b) {
  const first = tokenDocument(a);
  const second = tokenDocument(b);
  if (!first || !second || first.parent?.id !== second.parent?.id) return Infinity;
  const placeable = first.object;
  if (typeof placeable?.distanceTo === "function" && second.object) {
    const measured = Number(placeable.distanceTo(second.object));
    if (Number.isFinite(measured)) return measured;
  }
  return creatureDistance(footprint(first), footprint(second), gridDistance(first.parent));
}

export function tauntEffects(actor) {
  return (actor?.itemTypes?.effect ?? actor?.items?.filter?.((item) => item.type === "effect") ?? [])
    .filter((effect) => effect.slug === SLUGS.tauntEffect);
}

export function tauntOrigin(effect) {
  return effect?.system?.context?.origin?.actor ?? null;
}

export function isTauntedBy(enemy, guardian) {
  return tauntEffects(enemy).some((effect) => sameActor(tauntOrigin(effect), guardian));
}

/**
 * Whether moving `token` straight to the footprint `candidate` would pass through a movement wall
 * (closed doors included) on the token's scene. Uses the scene's wall documents, so it also works on a
 * client that is not viewing that scene.
 */
export function wallBlocksMove(token, candidate) {
  const doc = tokenDocument(token);
  const scene = doc?.parent;
  if (!scene?.walls?.size) return false;
  const size = Number(scene.grid?.size ?? 100) || 100;
  const walls = [...scene.walls].map((wall) => ({ c: wall.c, move: wall.move, door: wall.door, ds: wall.ds }));
  return wallBlocksPath(walls, footprintCenter(footprint(doc), size), footprintCenter(candidate, size));
}
