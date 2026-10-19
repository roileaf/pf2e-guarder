import test from "node:test";
import assert from "node:assert/strict";
import { findInterceptors } from "../scripts/foundry/intercept.js";

function actor(id, { alliance = "party", slugs = [], hp = 20, conditions = [], effects = [] } = {}) {
  return {
    id,
    uuid: `Actor.${id}`,
    name: id,
    alliance,
    items: slugs.map((slug) => ({ slug })),
    itemTypes: { effect: effects },
    attributes: { hp: { value: hp } },
    hasCondition: (slug) => conditions.includes(slug),
    isAllyOf(other) { return other.alliance === this.alliance; },
    testUserPermission: () => true,
  };
}

function sceneWith(entries) {
  const scene = { id: "scene", grid: { size: 100, distance: 5, type: 1 }, tokens: [] };
  for (const [index, entry] of entries.entries()) {
    scene.tokens.push({ id: `t${index}`, uuid: `Scene.scene.Token.t${index}`, parent: scene, actor: entry.actor, x: entry.col * 100, y: entry.row * 100, width: 1, height: 1 });
  }
  return scene;
}

function withGame(callback) {
  const previous = globalThis.game;
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: Object.assign([gm], { activeGM: gm }), combat: null, settings: { get: () => { throw new Error("unregistered"); } } };
  try { return callback(); } finally { globalThis.game = previous; }
}

const slash = (total) => ({ total, instances: [{ type: "slashing", total, materials: new Set() }] });

test("a guardian within 10 feet of a damaged ally is offered Intercept Attack", () => withGame(() => {
  const ally = actor("ally");
  const guardian = actor("guardian", { slugs: ["intercept-attack"] });
  const scene = sceneWith([{ actor: ally, col: 5, row: 5 }, { actor: guardian, col: 3, row: 5 }]);
  const candidates = findInterceptors({ ally, allyToken: scene.tokens[0], damage: slash(10), attacker: null });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].guardian, guardian);
  assert.equal(candidates[0].distance, 10);
}));

test("guardians too far away, unconscious, or hostile are skipped", () => withGame(() => {
  const ally = actor("ally");
  const far = actor("far", { slugs: ["intercept-attack"] });
  const asleep = actor("asleep", { slugs: ["intercept-attack"], conditions: ["unconscious"] });
  const foe = actor("foe", { slugs: ["intercept-attack"], alliance: "opposition" });
  const scene = sceneWith([
    { actor: ally, col: 5, row: 5 }, { actor: far, col: 2, row: 5 }, { actor: asleep, col: 6, row: 5 }, { actor: foe, col: 4, row: 5 },
  ]);
  assert.equal(findInterceptors({ ally, allyToken: scene.tokens[0], damage: slash(10) }).length, 0);
}));

test("damage from the guardian's taunted enemy extends the reach to 15 feet", () => withGame(() => {
  const ally = actor("ally");
  const guardian = actor("guardian", { slugs: ["intercept-attack"] });
  const enemy = actor("enemy", {
    alliance: "opposition",
    effects: [{ slug: "effect-taunt", system: { context: { origin: { actor: "Actor.guardian" } } } }],
  });
  const scene = sceneWith([{ actor: ally, col: 5, row: 5 }, { actor: guardian, col: 2, row: 5 }]);
  assert.equal(findInterceptors({ ally, allyToken: scene.tokens[0], damage: slash(8) }).length, 0);
  const candidates = findInterceptors({ ally, allyToken: scene.tokens[0], damage: slash(8), attacker: enemy });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceTaunted, true);
}));

test("fire damage needs Energy Interceptor", () => withGame(() => {
  const fire = { total: 6, instances: [{ type: "fire", total: 6, materials: new Set() }] };
  const ally = actor("ally");
  const plain = actor("plain", { slugs: ["intercept-attack"] });
  const energetic = actor("energetic", { slugs: ["intercept-attack", "energy-interceptor"] });
  const scene = sceneWith([{ actor: ally, col: 5, row: 5 }, { actor: plain, col: 4, row: 5 }, { actor: energetic, col: 6, row: 5 }]);
  const candidates = findInterceptors({ ally, allyToken: scene.tokens[0], damage: fire });
  assert.deepEqual(candidates.map((candidate) => candidate.guardian.id), ["energetic"]);
}));
