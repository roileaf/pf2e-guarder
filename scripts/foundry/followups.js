import { MODULE_ID } from "../constants.js";
import { getBehindCandidates, overlaps } from "../domain/geometry.js";
import { pickSquare } from "../canvas/square-picker.js";
import { mythicProficiencyBonus } from "../domain/followups.js";
import { footprint, gridDistance, notify, tokenDocument, wallBlocksMove } from "./actors.js";
import { tauntTokens } from "./taunt.js";
import { registerOperation, requestOperation } from "./socket.js";

const QUICKENED_UUID = "Compendium.pf2e.conditionitems.Item.nlCjDvLMf2EkV2dl";

export function actorReach(actor) {
  const reach = Number(actor?.getReach?.({ action: "attack" }) ?? actor?.attributes?.reach?.base ?? 5);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

/** Attack facts the follow-up feats care about. */
export function attackFacts(item) {
  const isWeaponLike = item?.isOfType?.("weapon", "melee") ?? ["weapon", "melee"].includes(item?.type);
  const melee = Boolean(isWeaponLike && (item.isMelee ?? item.system?.range == null));
  const unarmed = item?.system?.traits?.value?.includes?.("unarmed") || item?.category === "unarmed";
  return { meleeStrike: melee, meleeWeaponAttack: melee && !unarmed };
}

function squareBlocked(scene, ignore, candidate) {
  return [...scene.tokens].some((token) => !ignore.includes(token.id) && !token.hidden && overlaps(candidate, footprint(token)));
}

/** An occupied square, or one the moving token can't reach without passing through a wall. */
function moveBlocked(mover, ignore, candidate) {
  return squareBlocked(mover.parent, ignore, candidate) || wallBlocksMove(mover, candidate);
}

/** Get Behind Me!: pick and request the ally's new square. Returns a chat note. */
export async function getBehindMe({ guardianToken, allyToken, attackerToken }) {
  const guardian = tokenDocument(guardianToken);
  const ally = tokenDocument(allyToken);
  const scene = ally?.parent;
  if (!guardian || !ally || !scene) return null;
  const candidates = getBehindCandidates({
    ally: footprint(ally),
    guardian: footprint(guardian),
    attacker: attackerToken ? footprint(tokenDocument(attackerToken)) : null,
    reach: actorReach(guardian.actor),
    budget: 10,
    gridDistance: gridDistance(scene),
    blocked: (candidate) => moveBlocked(ally, [ally.id, guardian.id], candidate),
  });
  if (!candidates.length) return "Get Behind Me!: no open square farther from the attacker";
  // The guardian's player chooses among the legal squares when they can see the scene.
  const position = globalThis.canvas?.scene?.id === scene.id
    ? await pickSquare({
      candidates,
      prompt: `Get Behind Me!: click where ${ally.name} goes (up to 10 ft, within your reach, away from the attacker). Enter takes the brightest square; Escape leaves them in place.`,
    })
    : candidates[0];
  if (!position) return `Get Behind Me!: ${ally.name} stays in place`;
  const size = Number(scene.grid?.size ?? 100) || 100;
  await requestOperation("move-token", { tokenUuid: ally.uuid, x: position.col * size, y: position.row * size }, { gmRequired: true });
  return `Get Behind Me! moves ${ally.name} ${position.cost} feet`;
}

/** Quick Vengeance: quickened on the guardian's next turn, only to Stride toward or Strike the attacker. */
export async function grantQuickVengeance(guardian, attackerName, combatant) {
  const note = `Use the extra action only to Stride closer to ${attackerName ?? "the triggering enemy"} or to Strike it.`;
  await guardian.createEmbeddedDocuments("Item", [{
    name: "Effect: Quick Vengeance",
    type: "effect",
    img: "icons/skills/movement/arrow-upward-yellow.webp",
    system: {
      description: { value: `<p>${foundry.utils.escapeHTML(note)}</p>` },
      // Until the end of the guardian's next turn, counted from the guardian's own initiative.
      duration: { expiry: "turn-end", sustained: false, unit: "rounds", value: 1 },
      start: { value: game.time.worldTime, initiative: combatant?.initiative ?? null },
      rules: [
        { key: "GrantItem", inMemoryOnly: true, uuid: QUICKENED_UUID },
        { key: "Note", selector: "all", text: note, title: "Quick Vengeance" },
      ],
      slug: "effect-quick-vengeance",
      tokenIcon: { show: true },
      traits: { rarity: "common", value: [] },
    },
    flags: { [MODULE_ID]: { quickVengeance: true } },
  }]);
  return "Quick Vengeance: quickened next turn";
}

function proficiencyOf(strike) {
  return (strike?.modifiers ?? []).find((modifier) => modifier.type === "proficiency" && modifier.enabled)?.modifier ?? 0;
}

// Card buttons of feats whose movement the player does by hand (see feat-actions.js).
const FEAT_FOLLOW_UPS = ["strike-in-reach", "shove-in-reach", "push-ally", "reposition"];

const FIST_SLUGS = ["spiked-gauntlet", "gauntlet", "fist"];

function isShieldStrike(action) {
  const item = action.item;
  return item?.type === "shield" || item?.system?.group === "shield" || ["shield-bash", "shield-boss", "shield-spikes"].includes(item?.slug ?? action.slug);
}

/**
 * The guardian's Strike of a kind: "melee" (first ready melee Strike), "fist" (a gauntlet if wielded,
 * else the fist; usable without a free hand) or "shield" (shield bash, boss or spikes).
 */
export function findStrike(actor, kind = "melee") {
  const strikes = (actor?.system?.actions ?? []).filter((action) => action.type === "strike");
  const ready = strikes.filter((action) => action.ready !== false);
  if (kind === "fist") {
    for (const slug of FIST_SLUGS) {
      const found = strikes.find((action) => (action.item?.slug ?? action.slug) === slug && (slug === "fist" || action.ready !== false));
      if (found) return found;
    }
    return strikes.find((action) => action.slug === "basic-unarmed" || action.item?.system?.category === "unarmed") ?? null;
  }
  if (kind === "shield") return ready.find(isShieldStrike) ?? strikes.find(isShieldStrike) ?? null;
  return ready.find((action) => (action.item?.isMelee ?? true) && !isShieldStrike(action))
    ?? ready.find((action) => action.item?.isMelee ?? true) ?? null;
}

function meleeStrike(actor) {
  return findStrike(actor, "melee");
}

async function withTarget(token, run) {
  const previous = [...game.user.targets].map((target) => target.document?.uuid);
  token.object?.setTarget(true, { releaseOthers: true });
  try {
    return await run();
  } finally {
    if (previous.length) for (const [index, uuid] of previous.entries()) fromUuidSync(uuid)?.object?.setTarget(true, { releaseOthers: index === 0 });
  }
}

/**
 * Strike a token with one of the guardian's Strikes. `kind` picks the Strike (see findStrike), `variant`
 * the multiple attack penalty step (0 first attack), `modifiers` extra PF2e modifiers.
 * Returns the attack roll (with degreeOfSuccess) or null when the roll was cancelled.
 */
export async function strikeWith(guardian, targetToken, { kind = "melee", variant = 0, modifiers = [] } = {}) {
  const strike = findStrike(guardian, kind);
  if (!strike) throw new Error(`${guardian.name} has no ${kind === "fist" ? "fist or gauntlet" : kind} Strike.`);
  const roller = strike.variants?.[variant] ?? strike;
  return withTarget(tokenDocument(targetToken), () => roller.roll({ event: new MouseEvent("click"), modifiers }));
}

/** Strike the attacker with the guardian's first ready melee Strike. `mythic` uses mythic proficiency. */
export async function strikeBack(guardian, attackerToken, { mythic = false } = {}) {
  const strike = meleeStrike(guardian);
  if (!strike) throw new Error(`${guardian.name} has no ready melee Strike.`);
  const modifiers = [];
  if (mythic) {
    const ModifierPF2e = game.pf2e?.Modifier;
    const bonus = mythicProficiencyBonus({
      level: guardian.level,
      currentProficiency: proficiencyOf(strike),
      pwol: game.pf2e?.settings?.variants?.pwol?.enabled,
    });
    if (ModifierPF2e && bonus) modifiers.push(new ModifierPF2e({ slug: "mythic-proficiency", label: "Mythic", modifier: bonus }));
  }
  return withTarget(attackerToken, () => strike.roll({ event: new MouseEvent("click"), modifiers }));
}

async function disarm(guardian, attackerToken) {
  const action = game.pf2e?.actions?.get?.("disarm");
  if (!action) throw new Error("PF2e's Disarm action is unavailable.");
  return withTarget(attackerToken, () => action.use({
    actors: [guardian],
    target: attackerToken.object,
    rollOptions: ["disarming-intercept"],
    event: new MouseEvent("click"),
  }));
}

async function onFollowUp(button) {
  const { guarderFollowup: kind, guardian: guardianUuid, attacker: attackerUuid } = button.dataset;
  const guardian = fromUuidSync(guardianUuid);
  if (FEAT_FOLLOW_UPS.includes(kind)) {
    if (!guardian?.isOwner) return notify("warn", "Only the guardian's owner can use this.");
    const { runFeatFollowUp } = await import("./feat-actions.js");
    return void await runFeatFollowUp(kind, button, guardian).catch((error) => notify("error", error.message));
  }
  const attackerToken = await fromUuid(attackerUuid);
  if (!guardian?.isOwner) return notify("warn", "Only the guardian's owner can use this.");
  if (!attackerToken?.object) return notify("warn", "The attacker is not on the viewed scene.");
  button.disabled = true;
  try {
    if (kind === "disarm") await disarm(guardian, attackerToken);
    else {
      const roll = await strikeBack(guardian, attackerToken, { mythic: kind === "mythic-strike" });
      // Armored Counterattack: a hit Taunts the target.
      if (kind === "counterattack" && (roll?.degreeOfSuccess ?? 0) >= 2) {
        const guardianToken = guardian.token ?? guardian.getActiveTokens?.(true, true)?.[0];
        const item = guardian.items.find((entry) => entry.slug === "taunt" && entry.type === "action");
        await tauntTokens({ guardian, guardianToken, item, targets: [attackerToken] });
      }
    }
  } catch (error) {
    notify("error", error.message);
    button.disabled = false;
  }
}

/** Follow-up buttons on Guarder chat cards; registered at load so existing cards get them. */
export function registerFollowUpButtons() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    // Attack cards retargeted by Unbelievable Interception.
    if (message.flags?.[MODULE_ID]?.retargeted) html.classList.add("guarder-retargeted");
    // Attack cards re-graded by Shield from Arrows or Reactive Shield.
    if (message.flags?.[MODULE_ID]?.outcomeChanged) html.classList.add("guarder-outcome-changed");
    for (const button of html.querySelectorAll("[data-guarder-followup]")) {
      const guardian = fromUuidSync(button.dataset.guardian);
      if (!guardian?.isOwner) {
        button.remove();
        continue;
      }
      button.addEventListener("click", () => void onFollowUp(button));
    }
  });
}

export function registerFollowUpOperations() {
  registerOperation("move-token", async ({ tokenUuid, x, y }) => {
    const token = await fromUuid(tokenUuid);
    if (!token) throw new Error("Token not found.");
    // Forced movement: Get Behind Me! movement doesn't trigger reactions.
    await token.update({ x, y });
    return true;
  });
}
