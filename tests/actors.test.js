import test from "node:test";
import assert from "node:assert/strict";
import { guardianEffectContext, isDead, isGuardianCharacter } from "../scripts/foundry/actors.js";

const character = ({ classSlug = "fighter", slugs = [], type = "character" } = {}) => ({
  type,
  class: { slug: classSlug },
  items: slugs.map((slug) => ({ slug })),
});

test("only guardians get Guarder's reactions: the class, Intercept Attack, or the dedication", () => {
  assert.equal(isGuardianCharacter(character({ classSlug: "guardian" })), true);
  assert.equal(isGuardianCharacter(character({ slugs: ["intercept-attack"] })), true);
  assert.equal(isGuardianCharacter(character({ slugs: ["guardian-dedication"] })), true);
});

test("a fighter with Reactive Strike, Reactive Shield and Shield Block isn't a guardian", () => {
  assert.equal(isGuardianCharacter(character({ slugs: ["reactive-strike", "reactive-shield", "shield-block"] })), false);
  assert.equal(isGuardianCharacter(character({ type: "npc", slugs: ["intercept-attack"] })), false);
  assert.equal(isGuardianCharacter(null), false);
});

test("isDead follows PF2e's actor.isDead", () => {
  assert.equal(isDead({ isDead: true }), true);
  assert.equal(isDead({ isDead: false }), false);
  assert.equal(isDead(null), false);
});

test("Guardian effect context names the guardian as origin, so durations count from the guardian's turn", () => {
  const context = guardianEffectContext({ uuid: "Actor.guardian" }, { uuid: "Actor.enemy" }, { uuid: "Item.feat" });
  assert.equal(context.origin.actor, "Actor.guardian");
  assert.equal(context.origin.item, "Item.feat");
  assert.deepEqual(context.target, { actor: "Actor.enemy", token: null });
  assert.equal(context.roll, null);
});
