import test from "node:test";
import assert from "node:assert/strict";
import { toughCookieAllowed, toughCookieAmount } from "../scripts/domain/feats.js";
import { availableReactions, clampPool, consumeReaction, describePool, withBoundless } from "../scripts/domain/reactions.js";

test("Tough Cookie grants half maximum HP, rounded down", () => {
  assert.equal(toughCookieAmount(58), 29);
  assert.equal(toughCookieAmount(57), 28);
  assert.equal(toughCookieAmount(undefined), 0);
});

test("Tough Cookie needs half HP or less and is once per day", () => {
  assert.deepEqual(toughCookieAllowed({ hp: 29, max: 58, today: 3 }), { ok: true, reason: null });
  assert.equal(toughCookieAllowed({ hp: 30, max: 58, today: 3 }).ok, false);
  assert.match(toughCookieAllowed({ hp: 10, max: 58, usedDay: 3, today: 3 }).reason, /already used today/);
  assert.equal(toughCookieAllowed({ hp: 10, max: 58, usedDay: 2, today: 3 }).ok, true);
});

test("Boundless Reprisals adds a reaction only during enemy turns", () => {
  assert.deepEqual(withBoundless({ general: 1, guardian: 0 }, true), { general: 1, guardian: 0, boundless: 1 });
  assert.deepEqual(withBoundless({ general: 1, guardian: 0, boundless: 1 }, false), { general: 1, guardian: 0, boundless: 0 });
});

test("the Boundless reaction is spent first and only for guardian reactions", () => {
  const pool = { general: 1, guardian: 1, boundless: 1 };
  assert.equal(availableReactions(pool), 3);
  assert.equal(availableReactions(pool, { guardianReaction: false }), 1);
  assert.deepEqual(consumeReaction(pool), { general: 1, guardian: 1, boundless: 0 });
  assert.deepEqual(consumeReaction(pool, { guardianReaction: false }), { general: 0, guardian: 1, boundless: 1 });
  assert.match(describePool(pool), /Boundless Reprisals/);
});

test("the Boundless slot is clamped like the others and absent without the feat", () => {
  assert.deepEqual(clampPool({ general: 1, guardian: 0, boundless: 4 }, { general: 1, guardian: 0, boundless: 1 }), { general: 1, guardian: 0, boundless: 1 });
  assert.deepEqual(clampPool({ general: 1, guardian: 0, boundless: 1 }, { general: 1, guardian: 0 }), { general: 1, guardian: 0 });
});
