import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { combaterDrawsTrackerActions } from "../scripts/ui/tracker.js";

function withCombater({ active = true, setting } = {}) {
  globalThis.game = {
    modules: new Map(active === null ? [] : [["pf2e-combater", { active }]]),
    settings: {
      get(scope, key) {
        if (setting === "missing") throw new Error(`${scope}.${key} is not a registered game setting`);
        return scope === "pf2e-combater" && key === "combatTrackerActions" ? setting : undefined;
      },
    },
  };
}

afterEach(() => {
  delete globalThis.game;
});

test("Guarder draws its badge unless PF2e Combater draws the tracker glyphs for this user", () => {
  withCombater({ active: null });
  assert.equal(combaterDrawsTrackerActions(), false);
  withCombater({ active: false, setting: true });
  assert.equal(combaterDrawsTrackerActions(), false);
  withCombater({ active: true, setting: false });
  assert.equal(combaterDrawsTrackerActions(), false);
  withCombater({ active: true, setting: true });
  assert.equal(combaterDrawsTrackerActions(), true);
});

test("an older PF2e Combater without the setting keeps Guarder's badge", () => {
  withCombater({ active: true, setting: "missing" });
  assert.equal(combaterDrawsTrackerActions(), false);
});
