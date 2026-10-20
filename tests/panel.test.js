import test from "node:test";
import assert from "node:assert/strict";
import { featureStatuses } from "../scripts/domain/features.js";
import { guardianPanelBody, reactionSlots } from "../scripts/ui/panel-view.js";

test("feature statuses sort automated, native, then manual, and skip non-guardian items", () => {
  const rows = featureStatuses([
    { slug: "stomp-ground", name: "Stomp Ground", traits: new Set(["guardian"]) },
    { slug: "guardians-armor", name: "Guardian's Armor", traits: new Set(["guardian"]) },
    { slug: "intercept-attack", name: "Intercept Attack", traits: new Set(["guardian"]) },
    { slug: "power-attack", name: "Power Attack", traits: new Set(["fighter"]) },
    { slug: "bodyguard", name: "Bodyguard", system: { traits: { value: ["guardian"] } } },
  ]);
  assert.deepEqual(rows.map((row) => row.status), ["automated", "automated", "native", "manual"]);
  assert.ok(!rows.some((row) => row.slug === "power-attack"));
});

const view = {
  name: "Ava", img: "a.webp", level: 8, className: "Guardian", isOwner: true, isGM: true,
  armor: { name: "Full Plate", resistance: 5 },
  shield: { name: "Steel Shield", hp: 20, max: 20, hardness: 5, raised: false, broken: false },
  pool: { general: 1, guardian: 1 },
  taunted: [{ name: "Ogre", img: "o.webp", distance: 10, offGuard: true, effects: ["Actor.o.Item.t"] }],
  hasTaunt: true,
  tauntLimits: { range: 30, maxTaunted: 1 },
  bodyguard: { current: "Actor.b", options: [{ uuid: "Actor.b", name: "Bo" }] },
  allies: [{ name: "Bo", img: "b.webp", distance: 10, inRange: true }],
  interceptFeatures: [{ label: "Get Behind Me!", detail: "x", active: true }],
  features: [{ slug: "intercept-attack", name: "Intercept Attack", status: "automated", detail: "x" }],
};

test("reaction glyphs are clickable slots: lit ones spend, dimmed ones restore", () => {
  const html = reactionSlots({ pool: { general: 0, guardian: 1 }, poolMax: { general: 1, guardian: 2 }, isGM: true });
  assert.equal((html.match(/data-action="toggleReaction"/g) ?? []).length, 3);
  assert.match(html, /data-kind="general" data-spent="true"/);
  assert.equal((html.match(/data-kind="guardian" data-spent="false"/g) ?? []).length, 1);
  assert.equal((html.match(/data-kind="guardian" data-spent="true"/g) ?? []).length, 1);
  const player = reactionSlots({ pool: { general: 1, guardian: 0 }, poolMax: { general: 1, guardian: 0 }, isGM: false });
  assert.doesNotMatch(player, /toggleReaction/);
});

test("the panel shows taunts, bodyguard charge, allies and controls", () => {
  const html = guardianPanelBody(view);
  assert.match(html, /data-action="raiseShield"/);
  assert.match(html, /data-action="toggleReaction"/);
  assert.match(html, /data-action="endTaunt" data-effects="Actor\.o\.Item\.t"/);
  assert.match(html, /value="Actor\.b" selected/);
  assert.match(html, /in reach of Intercept/);
  assert.match(html, /Automated/);
});

test("players see no GM reaction controls and no Raise a Shield on a raised shield", () => {
  const html = guardianPanelBody({ ...view, isGM: false, shield: { ...view.shield, raised: true } });
  assert.doesNotMatch(html, /toggleReaction/);
  assert.doesNotMatch(html, /raiseShield/);
});
