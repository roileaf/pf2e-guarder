import test from "node:test";
import assert from "node:assert/strict";
import {
  bloodyDenialResult, devastatingWallopResult, isCoverShield, momentumPositions, pushAwayPosition, ringTheirBellResult,
  shieldWallopResult, shiftDegree, shoulderCheckResult, stompGroundResult, weakeningAssaultResult,
} from "../scripts/domain/feat-rules.js";

const at = (col, row, w = 1, h = 1) => ({ col, row, w, h });

test("degrees shift within critical failure and critical success", () => {
  assert.equal(shiftDegree(2, -1), 1);
  assert.equal(shiftDegree(0, -1), 0);
  assert.equal(shiftDegree(3, 1), 3);
});

test("Shoulder Check: off-guard by degree, or the guardian on a critical failure", () => {
  assert.deepEqual(shoulderCheckResult(3).map((e) => [e.on, e.condition, e.until]), [["target", "off-guard", "next-turn-end"]]);
  assert.deepEqual(shoulderCheckResult(2).map((e) => e.until), ["turn-end"]);
  assert.deepEqual(shoulderCheckResult(1), []);
  assert.deepEqual(shoulderCheckResult(0).map((e) => e.on), ["guardian"]);
});

test("Shield Wallop: stupefied 1/2, one higher with a tower or fortress shield", () => {
  assert.equal(shieldWallopResult(2)[0].value, 1);
  assert.equal(shieldWallopResult(3)[0].value, 2);
  assert.equal(shieldWallopResult(3, true)[0].value, 3);
  assert.deepEqual(shieldWallopResult(1), []);
  assert.ok(isCoverShield("tower-shield") && isCoverShield("fortress-shield") && !isCoverShield("steel-shield"));
});

test("Devastating Shield Wallop: off-guard, prone, or prone and stunned 1", () => {
  assert.deepEqual(devastatingWallopResult(3), []);
  assert.equal(devastatingWallopResult(2)[0].condition, "off-guard");
  assert.deepEqual(devastatingWallopResult(1).map((e) => e.condition), ["prone"]);
  assert.deepEqual(devastatingWallopResult(0).map((e) => [e.condition, e.value ?? null]), [["prone", null], ["stunned", 1]]);
});

test("Weakening Assault: enfeebled 1 for one hit, 3 for two", () => {
  assert.deepEqual(weakeningAssaultResult([1, 1]), []);
  assert.equal(weakeningAssaultResult([2, 0])[0].value, 1);
  assert.equal(weakeningAssaultResult([3, 2])[0].value, 3);
});

test("Ring Their Bell: stunned 1/2/3 by the save", () => {
  assert.deepEqual(ringTheirBellResult(3), []);
  assert.deepEqual([2, 1, 0].map((d) => ringTheirBellResult(d)[0].value), [1, 2, 3]);
});

test("Bloody Denial: a critical hit worsens the save by one degree", () => {
  assert.equal(bloodyDenialResult(2).degree, 2);
  assert.equal(bloodyDenialResult(2, true).degree, 1);
  assert.deepEqual(bloodyDenialResult(0).effects.map((e) => e.condition ?? "note"), ["note", "stunned"]);
  assert.deepEqual(bloodyDenialResult(3).effects, []);
});

test("Stomp Ground: off-guard, prone, prone with falling damage", () => {
  assert.equal(stompGroundResult(2).effects[0].condition, "off-guard");
  assert.equal(stompGroundResult(1).damage, null);
  assert.equal(stompGroundResult(0).damage, "1d6[bludgeoning]");
});

test("Aggressive Block pushes the target one square straight away, unless blocked", () => {
  assert.deepEqual(pushAwayPosition({ guardian: at(4, 6), target: at(5, 6) }), { ...at(6, 6), cost: 5 });
  assert.deepEqual(pushAwayPosition({ guardian: at(4, 6), target: at(5, 7) }), { ...at(6, 8), cost: 5 });
  assert.equal(pushAwayPosition({ guardian: at(4, 6), target: at(5, 6), blocked: () => true }), null);
});

test("Momentum Strike keeps the target within reach and out of the guardian's space", () => {
  const options = momentumPositions({ guardian: at(4, 6), target: at(5, 6), reach: 5, budget: 5 });
  assert.ok(options.length > 0);
  assert.ok(options.every((o) => !(o.col === 4 && o.row === 6)));
  assert.ok(options.every((o) => Math.max(Math.abs(o.col - 4), Math.abs(o.row - 6)) === 1));
  assert.ok(momentumPositions({ guardian: at(4, 6), target: at(5, 6), reach: 10, budget: 10 }).some((o) => o.col === 6));
});
