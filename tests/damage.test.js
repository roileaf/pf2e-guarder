import test from "node:test";
import assert from "node:assert/strict";
import { damageFormula, instancesTotal, interceptableTypes, partitionInstances } from "../scripts/domain/damage.js";

const slashing = { type: "slashing", total: 12, materials: new Set() };
const fire = { type: "fire", total: 5, materials: new Set() };
const silverPiercing = { type: "piercing", total: 7, materials: new Set(["silver"]) };
const persistentBleed = { type: "bleed", total: 0, persistent: true, head: { expression: "1d6" }, materials: new Set() };

test("Intercept Attack triggers on physical damage only by default", () => {
  assert.deepEqual(interceptableTypes(), ["bludgeoning", "piercing", "slashing", "bleed"]);
  const result = partitionInstances([fire], interceptableTypes());
  assert.equal(result.triggered, false);
  assert.deepEqual(result.remainder, [fire]);
});

test("Energy Interceptor adds its five energy types", () => {
  const types = interceptableTypes({ energyInterceptor: true });
  for (const type of ["acid", "cold", "electricity", "fire", "sonic"]) assert.ok(types.includes(type));
  assert.ok(!types.includes("force"));
  assert.equal(partitionInstances([fire], types).triggered, true);
});

test("trigger scope sends only triggering types to the guardian", () => {
  const result = partitionInstances([slashing, fire], interceptableTypes());
  assert.deepEqual(result.intercepted, [slashing]);
  assert.deepEqual(result.remainder, [fire]);
});

test("all scope sends the whole roll to the guardian", () => {
  const result = partitionInstances([slashing, fire], interceptableTypes(), "all");
  assert.deepEqual(result.intercepted, [slashing, fire]);
  assert.deepEqual(result.remainder, []);
});

test("persistent bleed alone does not trigger an interception", () => {
  assert.equal(partitionInstances([persistentBleed], interceptableTypes()).triggered, false);
});

test("formula keeps types, materials, and persistent expressions for the guardian's IWR", () => {
  assert.equal(damageFormula([slashing]), "12[slashing]");
  assert.equal(damageFormula([silverPiercing, persistentBleed]), "{7[piercing,silver],(1d6)[persistent,bleed]}");
  assert.equal(damageFormula([]), null);
  assert.equal(instancesTotal([slashing, fire, persistentBleed]), 17);
});
