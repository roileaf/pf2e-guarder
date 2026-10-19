import test from "node:test";
import assert from "node:assert/strict";
import { availableReactions, consumeReaction, describePool, initiativePool, turnStartPool } from "../scripts/domain/reactions.js";

test("Ever Ready grants a guardian-only reaction on initiative", () => {
  assert.deepEqual(initiativePool({ everReady: true }), { general: 1, guardian: 1 });
  assert.deepEqual(initiativePool({ everReady: true, reactionTime: true }), { general: 1, guardian: 2 });
  assert.deepEqual(initiativePool(), { general: 1, guardian: 0 });
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
