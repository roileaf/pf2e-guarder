import test from "node:test";
import assert from "node:assert/strict";
import { isGuardianCharacter } from "../scripts/foundry/actors.js";

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
