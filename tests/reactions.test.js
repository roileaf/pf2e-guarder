import test from "node:test";
import assert from "node:assert/strict";
import {
  availableReactions, clampPool, consumeReaction, currentLimit, describePool, initiativePool, maxReactionPool, restoreReactions, turnStartPool,
} from "../scripts/domain/reactions.js";

test("Ever Ready means one guardian-only reaction at initiative, not an extra one", () => {
  assert.deepEqual(initiativePool({ everReady: true }), { general: 0, guardian: 1 });
  // Reaction Time adds its extra reaction at initiative too.
  assert.deepEqual(initiativePool({ everReady: true, reactionTime: true }), { general: 0, guardian: 2 });
  assert.deepEqual(initiativePool(), { general: 1, guardian: 0 });
});

test("the most reactions a guardian can hold covers both initiative and turn starts", () => {
  assert.deepEqual(maxReactionPool({ everReady: true }), { general: 1, guardian: 1 });
  assert.deepEqual(maxReactionPool({ everReady: true, reactionTime: true }), { general: 1, guardian: 2 });
  assert.deepEqual(maxReactionPool(), { general: 1, guardian: 0 });
});

test("Reaction Time grants a guardian-only reaction each turn", () => {
  assert.deepEqual(turnStartPool({ reactionTime: true }), { general: 1, guardian: 1 });
  assert.deepEqual(turnStartPool(), { general: 1, guardian: 0 });
});

test("guardian reactions are spent before the general reaction", () => {
  const first = consumeReaction({ general: 1, guardian: 1 });
  assert.deepEqual(first, { general: 1, guardian: 0 });
  assert.deepEqual(consumeReaction(first), { general: 0, guardian: 0 });
  assert.equal(consumeReaction({ general: 0, guardian: 0 }), null);
});

test("non-guardian reactions cannot use the restricted pool", () => {
  assert.equal(consumeReaction({ general: 0, guardian: 2 }, { guardianReaction: false }), null);
  assert.equal(availableReactions({ general: 0, guardian: 2 }, { guardianReaction: false }), 0);
});

test("an untracked pool is unlimited", () => {
  assert.equal(availableReactions(null), Infinity);
  assert.equal(describePool(null), "untracked");
  assert.equal(describePool({ general: 1, guardian: 1 }), "1 reaction + 1 guardian-only");
});

test("restoring reactions never exceeds what the guardian can hold", () => {
  const max = { general: 1, guardian: 1 };
  assert.deepEqual(clampPool({ general: 1, guardian: 12 }, max), { general: 1, guardian: 1 });
  assert.deepEqual(clampPool({ general: 3, guardian: 0 }, { general: 1, guardian: 0 }), { general: 1, guardian: 0 });
  assert.deepEqual(clampPool({ general: -2, guardian: 1.7 }, { general: 1, guardian: 2 }), { general: 0, guardian: 1 });
});

test("restoring before the first turn gives back Ever Ready's guardian-only reaction, not a general one", () => {
  const limit = currentLimit({ everReady: true }, { beforeFirstTurn: true });
  assert.deepEqual(limit, { general: 0, guardian: 1 });
  assert.deepEqual(restoreReactions({ general: 0, guardian: 0 }, limit), { general: 0, guardian: 1 });
  assert.deepEqual(restoreReactions({ general: 0, guardian: 1 }, limit), { general: 0, guardian: 1 });
});

test("restoring after the first turn refills the general reaction, then Reaction Time's", () => {
  const limit = currentLimit({ everReady: true, reactionTime: true });
  assert.deepEqual(limit, { general: 1, guardian: 1 });
  assert.deepEqual(restoreReactions({ general: 0, guardian: 0 }, limit, 2), { general: 1, guardian: 1 });
  assert.deepEqual(restoreReactions({ general: 1, guardian: 1 }, limit, 3), { general: 1, guardian: 1 });
  assert.deepEqual(restoreReactions({ general: 0, guardian: 0 }, currentLimit({ everReady: true })), { general: 1, guardian: 0 });
});

test("Boundless Reprisals' reaction comes back only during an enemy's turn", () => {
  const traits = { everReady: true, boundless: true };
  assert.deepEqual(restoreReactions({ general: 1, guardian: 0, boundless: 0 }, currentLimit(traits, { enemyTurn: true })), { general: 1, guardian: 0, boundless: 1 });
  assert.deepEqual(restoreReactions({ general: 1, guardian: 0, boundless: 0 }, currentLimit(traits)), { general: 1, guardian: 0, boundless: 0 });
});
