// Results of Guardian feat actions by degree of success. Pure functions over plain facts.
// Degrees: 0 critical failure, 1 failure, 2 success, 3 critical success (PF2e's order).
import { creatureDistance, moveCost, overlaps } from "./geometry.js";

export const HIT = 2;
export const CRITICAL_HIT = 3;

export const isHitDegree = (degree) => Number(degree) >= HIT;

/** Move a degree of success `steps` worse (negative) or better, within 0..3. */
export function shiftDegree(degree, steps) {
  return Math.min(3, Math.max(0, Number(degree) + steps));
}

/** A shield that gives a higher bonus when you Take Cover behind it (tower or fortress shields). */
export function isCoverShield(slug = "") {
  return /tower-shield|fortress-shield/.test(String(slug));
}

/**
 * Effect plans: { condition, value?, until, on: "target" | "guardian" } where `until` is
 * "next-turn-start" / "next-turn-end" (the guardian's next turn) or "turn-end" (this turn).
 */

/** Shoulder Check's extra results. */
export function shoulderCheckResult(degree) {
  if (degree === CRITICAL_HIT) return [{ on: "target", condition: "off-guard", until: "next-turn-end", note: "off-guard against your melee attacks" }];
  if (degree === HIT) return [{ on: "target", condition: "off-guard", until: "turn-end", note: "off-guard against your next melee attack this turn" }];
  if (degree === 0) return [{ on: "guardian", condition: "off-guard", until: "next-turn-end", note: "off-guard against the target's melee attacks" }];
  return [];
}

/** Shield Wallop: stupefied 1 (2 on a critical hit), one higher with a cover shield, until your next turn. */
export function shieldWallopResult(degree, coverShield = false) {
  if (!isHitDegree(degree)) return [];
  const value = (degree === CRITICAL_HIT ? 2 : 1) + (coverShield ? 1 : 0);
  return [{ on: "target", condition: "stupefied", value, until: "next-turn-start" }];
}

/** Devastating Shield Wallop's Fortitude save (degree of the target's save). */
export function devastatingWallopResult(saveDegree) {
  if (saveDegree === 2) return [{ on: "target", condition: "off-guard", until: "turn-end", note: "off-guard to you" }];
  if (saveDegree === 1) return [{ on: "target", condition: "prone", until: null }];
  if (saveDegree === 0) return [{ on: "target", condition: "prone", until: null }, { on: "target", condition: "stunned", value: 1, until: null }];
  return [];
}

/** Weakening Assault: enfeebled 1 if either Strike hits, enfeebled 3 if both do. */
export function weakeningAssaultResult(degrees) {
  const hits = degrees.filter(isHitDegree).length;
  if (!hits) return [];
  return [{ on: "target", condition: "enfeebled", value: hits >= 2 ? 3 : 1, until: "next-turn-start" }];
}

/** Ring Their Bell's incapacitation Fortitude save. */
export function ringTheirBellResult(saveDegree) {
  const stunned = { 2: 1, 1: 2, 0: 3 }[saveDegree];
  return stunned ? [{ on: "target", condition: "stunned", value: stunned, until: null }] : [];
}

/** Bloody Denial: a critical hit makes the save one degree worse. */
export function bloodyDenialResult(saveDegree, criticalHit = false) {
  const degree = criticalHit ? shiftDegree(saveDegree, -1) : saveDegree;
  if (degree === 2) return { degree, effects: [{ on: "target", note: "can't use reactions against an ally you choose", until: "next-turn-start" }] };
  const noReactions = { on: "target", note: "can't use reactions", until: "next-turn-start" };
  if (degree === 1) return { degree, effects: [noReactions] };
  if (degree === 0) return { degree, effects: [noReactions, { on: "target", condition: "stunned", value: 1, until: null }] };
  return { degree, effects: [] };
}

/** Stomp Ground's Reflex save for each creature in the emanation. */
export function stompGroundResult(saveDegree) {
  if (saveDegree === 2) return { effects: [{ on: "target", condition: "off-guard", until: "turn-end" }], damage: null };
  if (saveDegree === 1) return { effects: [{ on: "target", condition: "prone", until: null }], damage: null };
  if (saveDegree === 0) return { effects: [{ on: "target", condition: "prone", until: null }], damage: "1d6[bludgeoning]" };
  return { effects: [], damage: null };
}

/** Armored Courage: once per hour. */
export function hourOf(worldTime) {
  return Math.floor(Number(worldTime ?? 0) / 3600);
}

/**
 * Aggressive Block's Shove: the square 5 feet directly away from the guardian (one grid step),
 * or null when there is none (the target then becomes off-guard instead).
 */
export function pushAwayPosition({ guardian, target, blocked = () => false }) {
  const step = (from, size, to, toSize) => {
    const a = from + size / 2;
    const b = to + toSize / 2;
    return Math.sign(b - a);
  };
  const dc = step(guardian.col, guardian.w, target.col, target.w);
  const dr = step(guardian.row, guardian.h, target.row, target.h);
  if (!dc && !dr) return null;
  const candidate = { ...target, col: target.col + dc, row: target.row + dr };
  return blocked(candidate) ? null : { ...candidate, cost: moveCost(dc, dr) };
}

/**
 * Momentum Strike: squares the target can be moved to, up to `budget` feet, staying within the
 * guardian's reach and outside the guardian's space; farthest from the guardian first.
 */
export function momentumPositions({ guardian, target, reach = 5, budget = 5, gridDistance = 5, blocked = () => false }) {
  const steps = Math.floor(budget / gridDistance);
  const options = [];
  for (let dc = -steps; dc <= steps; dc++) {
    for (let dr = -steps; dr <= steps; dr++) {
      if (!dc && !dr) continue;
      const cost = moveCost(dc, dr, gridDistance);
      const candidate = { ...target, col: target.col + dc, row: target.row + dr, cost };
      if (cost > budget || overlaps(candidate, guardian) || blocked(candidate)) continue;
      if (creatureDistance(candidate, guardian, gridDistance) > reach) continue;
      options.push(candidate);
    }
  }
  return options.sort((a, b) => creatureDistance(b, guardian, gridDistance) - creatureDistance(a, guardian, gridDistance) || a.cost - b.cost);
}
