import test from "node:test";
import assert from "node:assert/strict";
import {
  attackFacts, clangApplies, keepUpTriggers, leftSquareInReach, reactiveShieldApplies, reactiveStrikeOnAttack,
  shieldFromArrowsApplies, toughToKillClamp,
} from "../scripts/domain/guardian-reactions.js";

const rangedArrow = attackFacts({ type: "attack-roll", options: ["item:ranged", "item:damage:type:piercing"] });
const meleeSword = attackFacts({ type: "attack-roll", options: [], itemRanged: false, damageType: "slashing" });
const rayOfFrost = attackFacts({ type: "spell-attack-roll", options: ["item:damage:type:cold"] });

test("attack facts come from roll options, with the item's own facts winning", () => {
  assert.deepEqual(rangedArrow, { strike: true, spellAttack: false, ranged: true, melee: false, physical: true });
  assert.equal(meleeSword.melee, true);
  assert.equal(meleeSword.ranged, false);
  assert.equal(rayOfFrost.ranged, true);
  assert.equal(rayOfFrost.physical, false);
});

test("Shield from Arrows: adjacent ally, physical ranged Strike, raised shield, not off-guard", () => {
  const base = { attack: rangedArrow, adjacentToTarget: true, shieldRaised: true, offGuard: false, shieldFromSpells: false, targetIsGuardian: false };
  assert.equal(shieldFromArrowsApplies(base), true);
  assert.equal(shieldFromArrowsApplies({ ...base, shieldRaised: false }), false);
  assert.equal(shieldFromArrowsApplies({ ...base, offGuard: true }), false);
  assert.equal(shieldFromArrowsApplies({ ...base, adjacentToTarget: false }), false);
  assert.equal(shieldFromArrowsApplies({ ...base, targetIsGuardian: true }), false);
  assert.equal(shieldFromArrowsApplies({ ...base, attack: meleeSword }), false);
  assert.equal(shieldFromArrowsApplies({ ...base, attack: rayOfFrost }), false);
  assert.equal(shieldFromArrowsApplies({ ...base, attack: rayOfFrost, shieldFromSpells: true }), true);
});

test("Reactive Shield: hit by a melee Strike with an unraised shield", () => {
  const base = { attack: meleeSword, targetIsGuardian: true, outcome: "success", hasShield: true, shieldRaised: false };
  assert.equal(reactiveShieldApplies(base), true);
  assert.equal(reactiveShieldApplies({ ...base, outcome: "failure" }), false);
  assert.equal(reactiveShieldApplies({ ...base, shieldRaised: true }), false);
  assert.equal(reactiveShieldApplies({ ...base, attack: rangedArrow }), false);
});

test("Clang! needs a critical miss against the guardian", () => {
  assert.equal(clangApplies({ attack: meleeSword, targetIsGuardian: true, outcome: "criticalFailure" }), true);
  assert.equal(clangApplies({ attack: meleeSword, targetIsGuardian: true, outcome: "failure" }), false);
  assert.equal(clangApplies({ attack: rayOfFrost, targetIsGuardian: true, outcome: "criticalFailure" }), true);
  assert.equal(clangApplies({ attack: meleeSword, targetIsGuardian: false, outcome: "criticalFailure" }), false);
});

test("Reactive Strike triggers on ranged attacks within reach and on leaving reach", () => {
  assert.equal(reactiveStrikeOnAttack({ attack: rangedArrow, attackerDistance: 5, reach: 5 }), true);
  assert.equal(reactiveStrikeOnAttack({ attack: rangedArrow, attackerDistance: 10, reach: 5 }), false);
  assert.equal(reactiveStrikeOnAttack({ attack: meleeSword, attackerDistance: 5, reach: 5 }), false);
  const guardian = { col: 5, row: 5, w: 1, h: 1 };
  assert.equal(leftSquareInReach({ squares: [{ col: 6, row: 5, w: 1, h: 1 }], guardian, reach: 5 }), true);
  assert.equal(leftSquareInReach({ squares: [{ col: 8, row: 5, w: 1, h: 1 }], guardian, reach: 5 }), false);
  assert.equal(leftSquareInReach({ squares: [{ col: 7, row: 5, w: 1, h: 1 }], guardian, reach: 10 }), true);
});

test("Tough to Kill clamps dying once per day", () => {
  assert.deepEqual(toughToKillClamp({ value: 3, usedDay: null, today: 10 }), { value: 2, used: true });
  assert.deepEqual(toughToKillClamp({ value: 3, usedDay: 10, today: 10 }), { value: 3, used: false });
  assert.deepEqual(toughToKillClamp({ value: 2, usedDay: null, today: 10 }), { value: 2, used: false });
});

test("Keep Up the Good Fight triggers when an enemy drops you to 0 without killing you", () => {
  assert.equal(keepUpTriggers({ hpBefore: 10, hpAfter: 0 }), true);
  assert.equal(keepUpTriggers({ hpBefore: 10, hpAfter: 0, dead: true }), false);
  assert.equal(keepUpTriggers({ hpBefore: 10, hpAfter: 0, fromEnemy: false }), false);
  assert.equal(keepUpTriggers({ hpBefore: 0, hpAfter: 0 }), false);
});
