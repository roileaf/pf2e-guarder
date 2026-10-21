import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { coverRules, visionerCoverMinimum } from "../scripts/foundry/visioner.js";

function withVisioner(module, { autoCover = true } = {}) {
  globalThis.game = {
    modules: new Map(module ? [["pf2e-visioner", module]] : []),
    settings: { get: (scope, key) => (scope === "pf2e-visioner" && key === "autoCover" ? autoCover : undefined) },
  };
}

afterEach(() => {
  delete globalThis.game;
});

test("without Visioner, cover is a circumstance AC bonus", () => {
  withVisioner(null);
  assert.equal(visionerCoverMinimum(), false);
  assert.deepEqual(coverRules("lesser", "covering-stance", "Covering Stance"), [
    { key: "FlatModifier", selector: "ac", type: "circumstance", value: 1, label: "Covering Stance" },
  ]);
});

test("an older Visioner without the minimum mode keeps Guarder's bonus", () => {
  withVisioner({ active: true, api: { coverAdjustmentModes: ["step", "bonus"] } });
  assert.equal(visionerCoverMinimum(), false);
  assert.equal(coverRules("lesser", "covering-stance", "x")[0].key, "FlatModifier");
});

test("an inactive Visioner is ignored", () => {
  withVisioner({ active: false, api: { coverAdjustmentModes: ["minimum"] } });
  assert.equal(visionerCoverMinimum(), false);
});

test("with Visioner's minimum mode, cover goes through Visioner's rule element", () => {
  withVisioner({ active: true, api: { coverAdjustmentModes: () => ["step", "bonus", "minimum"] } });
  assert.equal(visionerCoverMinimum(), true);
  const [rule] = coverRules("lesser", "covering-stance", "x");
  assert.equal(rule.key, "PF2eVisionerEffect");
  assert.deepEqual(rule.operations[0], { type: "adjustCover", mode: "minimum", state: "lesser", direction: "from", observers: "all", scope: "while-active", source: "covering-stance" });
});

test("with Visioner's auto-cover off, Guarder keeps its own bonus so the cover isn't lost", () => {
  withVisioner({ active: true, api: { coverAdjustmentModes: ["step", "bonus", "minimum"] } }, { autoCover: false });
  assert.equal(visionerCoverMinimum(), false);
  assert.equal(coverRules("lesser", "covering-stance", "x")[0].key, "FlatModifier");
});
