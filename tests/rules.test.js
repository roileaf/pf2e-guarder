import test from "node:test";
import assert from "node:assert/strict";
import { interceptEligibility, interceptMovementBudget, interceptRange } from "../scripts/domain/intercept.js";
import { planTaunt, tauntLimits, tauntTriggersOffGuard } from "../scripts/domain/taunt.js";

const eligibleBase = { isAlly: true, hasIntercept: true, distance: 10, reactionsLeft: 1 };

test("Intercept Attack reaches 10 feet, or 15 against the guardian's taunted enemy", () => {
  assert.equal(interceptRange(), 10);
  assert.equal(interceptRange({ sourceTaunted: true }), 15);
  assert.equal(interceptEligibility(eligibleBase).eligible, true);
  assert.equal(interceptEligibility({ ...eligibleBase, distance: 15 }).eligible, false);
  assert.equal(interceptEligibility({ ...eligibleBase, distance: 15, sourceTaunted: true }).eligible, true);
});

test("ineligible guardians report why", () => {
  assert.match(interceptEligibility({ ...eligibleBase, reactionsLeft: 0 }).reason, /reaction/);
  assert.match(interceptEligibility({ ...eligibleBase, incapacitated: true }).reason, /reactions/);
  assert.match(interceptEligibility({ ...eligibleBase, isAlly: false }).reason, /ally/);
  assert.match(interceptEligibility({ ...eligibleBase, alive: false }).reason, /0 HP/);
});

test("movement is a Step unless the taunted-enemy extension allows a Stride", () => {
  assert.equal(interceptMovementBudget({ speed: 25 }), 5);
  assert.equal(interceptMovementBudget({ sourceTaunted: true, speed: 25 }), 25);
});

test("Taunt limits follow Group Taunt and Long-Distance Taunt", () => {
  assert.deepEqual(tauntLimits(), { maxTargets: 1, maxTaunted: 1, range: 30 });
  assert.deepEqual(tauntLimits({ groupTaunt: true, longDistance: true }), { maxTargets: 3, maxTaunted: 3, range: 120 });
});

test("a new taunt ends the previous one", () => {
  const plan = planTaunt({ existing: ["old"], targets: ["new"], limits: tauntLimits() });
  assert.deepEqual(plan.apply, ["new"]);
  assert.deepEqual(plan.remove, ["old"]);
});

test("too many targets are refused", () => {
  assert.equal(planTaunt({ targets: ["a", "b"], limits: tauntLimits() }).ok, false);
  assert.equal(planTaunt({ targets: [], limits: tauntLimits() }).ok, false);
});

test("Group Taunt keeps existing enemies while there is room and refreshes re-taunted ones", () => {
  const plan = planTaunt({ existing: ["a", "b"], targets: ["b"], limits: tauntLimits({ groupTaunt: true }) });
  assert.deepEqual(plan.remove, ["b"]);
  assert.deepEqual(plan.keep, ["a"]);
});

test("Group Taunt asks which enemies to keep when over the limit", () => {
  const limits = tauntLimits({ groupTaunt: true });
  const plan = planTaunt({ existing: ["a", "b", "c"], targets: ["d", "e"], limits });
  assert.equal(plan.needsChoice, true);
  assert.equal(plan.capacity, 1);
  const chosen = planTaunt({ existing: ["a", "b", "c"], targets: ["d", "e"], limits, keep: ["b"] });
  assert.deepEqual(chosen.remove, ["a", "c"]);
  assert.equal(planTaunt({ existing: ["a", "b", "c"], targets: ["d", "e"], limits, keep: ["a", "b"] }).ok, false);
});

test("Taunt off-guard needs an ally affected and the guardian left out", () => {
  const isAllyOfGuardian = (id) => id === "ally";
  assert.equal(tauntTriggersOffGuard({ guardianId: "g", affectedIds: ["ally"], isAllyOfGuardian }), true);
  assert.equal(tauntTriggersOffGuard({ guardianId: "g", affectedIds: ["ally", "g"], isAllyOfGuardian }), false);
  assert.equal(tauntTriggersOffGuard({ guardianId: "g", affectedIds: ["foe"], isAllyOfGuardian }), false);
});
