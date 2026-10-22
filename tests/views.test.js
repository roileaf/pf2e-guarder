import test from "node:test";
import assert from "node:assert/strict";
import { damageChips, escapeHtml, interceptCard, interceptPromptBody, overrideBoardBody, reactionPips } from "../scripts/ui/views.js";

const view = {
  guardianName: "Ava", guardianImg: "a.webp", allyName: "Bo <script>", allyImg: "b.webp",
  attackerName: "Ogre", attackerImg: "o.webp", distance: 10, movement: "step",
  parts: [{ type: "slashing", total: 12, label: "Slashing" }], keeps: [], pool: { general: 1, guardian: 1 }, canShieldBlock: true,
};

test("names are escaped in every view", () => {
  assert.equal(escapeHtml("<b>&\"'"), "&lt;b&gt;&amp;&quot;&#39;");
  assert.ok(!interceptPromptBody(view).includes("<script>"));
  assert.ok(interceptPromptBody(view).includes("Bo &lt;script&gt;"));
});

test("the prompt shows damage, movement, and the Shield Block toggle", () => {
  const html = interceptPromptBody(view);
  assert.match(html, /guarder-chip damage slashing/);
  assert.match(html, /Step into place/);
  assert.match(html, /name="shieldBlock"/);
  assert.doesNotMatch(interceptPromptBody({ ...view, canShieldBlock: false }), /shieldBlock/);
  assert.match(interceptPromptBody({ ...view, movement: "stride" }), /Stride allowed/);
});

test("with one reaction left the Shield Block toggle is disabled and says why", () => {
  const html = interceptPromptBody({ ...view, shieldBlock: { show: true, available: false, reason: "needs a second reaction (Ever Ready or Reaction Time)" } });
  assert.match(html, /name="shieldBlock" disabled/);
  assert.match(html, /needs a second reaction/);
  assert.doesNotMatch(interceptPromptBody({ ...view, shieldBlock: { show: true, available: true, reason: null } }), /disabled/);
  assert.doesNotMatch(interceptPromptBody({ ...view, shieldBlock: { show: false, available: false, reason: null } }), /shieldBlock/);
});

test("reaction pips distinguish guardian-only reactions and untracked pools", () => {
  assert.equal((reactionPips({ general: 1, guardian: 2 }).match(/action-glyph guardian/g) ?? []).length, 2);
  assert.match(reactionPips({ general: 0, guardian: 0 }), /action-glyph spent/);
  assert.match(reactionPips(null), /untracked/);
});

test("persistent damage chips show the formula", () => {
  assert.match(damageChips([{ type: "bleed", persistent: true, formula: "1d6", label: "Bleed" }]), /1d6[\s\S]*persistent/);
});

test("the GM board has a Force button per guardian and the chat card links the action", () => {
  const board = overrideBoardBody({ allyName: "Bo", parts: [], candidates: [{ name: "Ava", userName: "Roi", distance: 5 }, { name: "Cy", userName: "GM", distance: 10 }] });
  assert.equal((board.match(/data-value="force-/g) ?? []).length, 2);
  const card = interceptCard({ ...view, actionUuid: "Compendium.x", notes: ["Steps 5 feet"] });
  assert.match(card, /@UUID\[Compendium\.x\]\{Intercept Attack\}/);
  assert.match(card, /Steps 5 feet/);
});
