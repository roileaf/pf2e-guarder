import test from "node:test";
import assert from "node:assert/strict";
import { degreeOfSuccess, frequencyAvailable, interceptFollowUps, mythicProficiencyBonus } from "../scripts/domain/followups.js";
import { chooseGetBehindPosition, chooseTowardPosition, creatureDistance } from "../scripts/domain/geometry.js";

const at = (col, row, w = 1, h = 1) => ({ col, row, w, h });

test("Disarming Intercept needs a melee weapon attack from an adjacent attacker", () => {
  const feats = new Set(["disarming-intercept", "armored-counterattack"]);
  const near = interceptFollowUps({ feats, meleeWeaponAttack: true, meleeStrike: true, adjacentToAttacker: true });
  assert.equal(near.disarmingIntercept, true);
  assert.equal(near.armoredCounterattack, true);
  const unarmed = interceptFollowUps({ feats, meleeWeaponAttack: false, meleeStrike: true, adjacentToAttacker: true });
  assert.equal(unarmed.disarmingIntercept, false);
  assert.equal(unarmed.armoredCounterattack, true);
  assert.equal(interceptFollowUps({ feats, meleeWeaponAttack: true, meleeStrike: true, adjacentToAttacker: false }).armoredCounterattack, false);
  assert.equal(interceptFollowUps({ feats: new Set() , meleeWeaponAttack: true, meleeStrike: true, adjacentToAttacker: true }).disarmingIntercept, false);
});

test("Quick Vengeance and Get Behind Me! follow the feats", () => {
  const result = interceptFollowUps({ feats: new Set(["quick-vengeance", "get-behind-me"]) });
  assert.equal(result.quickVengeance, true);
  assert.equal(result.getBehindMe, true);
});

test("Guardian's Intercept limits Intercept Attack by frequency", () => {
  assert.equal(frequencyAvailable(null), true);
  assert.equal(frequencyAvailable({ max: 1, value: 1, per: "PT10M" }), true);
  assert.equal(frequencyAvailable({ max: 1, value: 0, per: "PT10M" }), false);
});

test("degree of success follows PF2e with natural 20 and 1", () => {
  assert.equal(degreeOfSuccess(30, 20), 3);
  assert.equal(degreeOfSuccess(20, 20), 2);
  assert.equal(degreeOfSuccess(15, 20), 1);
  assert.equal(degreeOfSuccess(10, 20), 0);
  assert.equal(degreeOfSuccess(15, 20, 20), 2);
  assert.equal(degreeOfSuccess(25, 20, 1), 1);
});

test("mythic proficiency replaces proficiency with 10 + level", () => {
  assert.equal(mythicProficiencyBonus({ level: 8, currentProficiency: 12 }), 6);
  assert.equal(mythicProficiencyBonus({ level: 8, currentProficiency: 4, pwol: true }), 6);
});

test("Get Behind Me! moves the ally away from the attacker but within the guardian's reach", () => {
  const guardian = at(4, 5);
  const ally = at(5, 5);
  const attacker = at(6, 5);
  const position = chooseGetBehindPosition({ ally, guardian, attacker, reach: 5, budget: 10 });
  assert.ok(position);
  assert.ok(creatureDistance(position, guardian) <= 5);
  assert.ok(creatureDistance(position, attacker) > creatureDistance(ally, attacker));
  assert.ok(position.cost <= 10);
});

test("Get Behind Me! returns null when no square is farther away", () => {
  const blocked = () => true;
  assert.equal(chooseGetBehindPosition({ ally: at(5, 5), guardian: at(4, 5), attacker: at(6, 5), blocked }), null);
});

test("Unbelievable Interception strides toward the attacker", () => {
  const position = chooseTowardPosition({ mover: at(0, 0), target: at(10, 0), budget: 50 });
  assert.equal(creatureDistance(position, at(10, 0)), 5);
  assert.ok(position.cost <= 50);
});
