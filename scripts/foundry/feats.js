// High-level Guardian feats: Tough Cookie, Shield Salvation and Opening Stance.
// (Boundless Reprisals lives with reaction tracking; Paragon's Guard with the stances.)
import { MODULE_ID } from "../constants.js";
import { toughCookieAmount, toughCookieAllowed } from "../domain/feats.js";
import { setting } from "../settings.js";
import { timedPrompt } from "../ui/prompt.js";
import { reactionCard } from "../ui/views.js";
import { controllingUser, hasSlug, notify } from "./actors.js";
import { activeStance, setStance, STANCES } from "./hampering.js";
import { reactionPool } from "./reactions.js";
import { isResponsibleGM, requestOperation } from "./socket.js";

const TOUGH_COOKIE_EFFECT = "guarder-tough-cookie";

/** Days since the world began; "once per day" and "until your next daily preparations" use it. */
function today() {
  return Math.floor(Number(game.time?.worldTime ?? 0) / 86_400);
}

async function postCard(actor, view) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: reactionCard({ guardianName: actor.name, guardianImg: actor.img, pool: reactionPool(actor), ...view }),
    flags: { [MODULE_ID]: { card: "reaction" } },
  });
}

// ---------------------------------------------------------------- Tough Cookie

async function confirm(title, text, label) {
  return timedPrompt({
    title,
    icon: "fa-solid fa-heart-pulse",
    body: `<p class="guarder-hint">${foundry.utils.escapeHTML(text)}</p>`,
    buttons: [
      { value: "apply", label, icon: "fa-solid fa-check", style: "primary", result: true },
      { value: "cancel", label: "Cancel", icon: "fa-solid fa-xmark", default: true, result: false },
    ],
  });
}

/**
 * Tough Cookie, posted from the sheet: temporary HP equal to half maximum HP for 1 minute. The
 * requirement (half HP or less) and once-per-day limit are checked, with an override prompt.
 * PF2e's TempHP rule element grants the HP and takes it away when the effect ends.
 */
export async function toughCookie(actor) {
  const hp = actor.hitPoints ?? actor.system?.attributes?.hp;
  const check = toughCookieAllowed({ hp: hp.value, max: hp.max, usedDay: actor.flags?.[MODULE_ID]?.toughCookie, today: today() });
  if (!check.ok && !await confirm("Tough Cookie", `${actor.name}: ${check.reason}. Apply Tough Cookie anyway?`, "Apply anyway")) return false;
  const amount = toughCookieAmount(hp.max);
  const feat = actor.items.find((item) => item.slug === "tough-cookie");
  const existing = (actor.itemTypes?.effect ?? []).filter((effect) => effect.slug === TOUGH_COOKIE_EFFECT);
  if (existing.length) await actor.deleteEmbeddedDocuments("Item", existing.map((effect) => effect.id));
  await actor.createEmbeddedDocuments("Item", [{
    name: "Effect: Tough Cookie",
    type: "effect",
    img: feat?.img ?? "icons/svg/regen.svg",
    system: {
      slug: TOUGH_COOKIE_EFFECT,
      description: { value: `<p>${amount} temporary Hit Points for 1 minute.</p>` },
      duration: { expiry: "turn-start", sustained: false, unit: "minutes", value: 1 },
      start: { value: game.time.worldTime, initiative: game.combat?.combatant?.initiative ?? null },
      rules: [{ key: "TempHP", value: amount }],
      tokenIcon: { show: true },
      traits: { rarity: "common", value: [] },
    },
  }]);
  await actor.update({ [`flags.${MODULE_ID}.toughCookie`]: today() });
  await postCard(actor, {
    glyph: "2", eyebrow: "Tough Cookie", headline: `${actor.name} isn't easily brought down`,
    notes: [`${amount} temporary Hit Points for 1 minute.`],
  });
  return true;
}

// ---------------------------------------------------------------- Shield Salvation

// Actors whose damage is being applied with a Shield Block right now (set by the damage wrapper).
const blocking = new Set();

/** Run `apply` with the actor marked as Shield Blocking, so Shield Salvation can recognize the damage. */
export async function duringShieldBlock(actor, apply) {
  const key = actor?.uuid;
  if (!key) return apply();
  blocking.add(key);
  try {
    return await apply();
  } finally {
    blocking.delete(key);
  }
}

/** Shield Salvation: the shield Shield Block would destroy stays at 1 HP, once per shield per day. */
function salvage(item, changes) {
  if (item.type !== "shield") return;
  const value = foundry.utils.getProperty(changes, "system.hp.value");
  if (value === undefined || Number(value) > 0) return;
  const actor = item.parent;
  if (!actor || !blocking.has(actor.uuid) || !hasSlug(actor, "shield-salvation")) return;
  if (item.flags?.[MODULE_ID]?.shieldSalvation === today()) return;
  foundry.utils.setProperty(changes, "system.hp.value", 1);
  foundry.utils.setProperty(changes, `flags.${MODULE_ID}.shieldSalvation`, today());
  void postCard(actor, {
    glyph: null, eyebrow: "Shield Salvation", headline: `${item.name} holds together`,
    notes: ["The shield stays intact at 1 Hit Point. It can't be saved this way again until your next daily preparations."],
  });
}

// ---------------------------------------------------------------- Opening Stance

/** Stances the guardian can drop into: module stances, plus any other stance action or feat it has. */
function stanceOptions(actor) {
  const options = new Map();
  for (const item of actor.items) {
    const traits = item.system?.traits?.value ?? [];
    if (!["feat", "action"].includes(item.type) || !traits.includes("stance") || options.has(item.slug)) continue;
    options.set(item.slug, { slug: item.slug, name: item.name, item });
  }
  return [...options.values()];
}

async function enterStance(actor, option) {
  if (STANCES[option.slug]) await setStance(actor, option.slug, true);
  else await option.item.toMessage(undefined, { create: true });
}

/** Opening Stance: on rolling initiative, offer a free stance. */
async function offerOpeningStance(combatant) {
  const actor = combatant.actor;
  const options = stanceOptions(actor).filter((option) => activeStance(actor) !== option.slug);
  if (!options.length) return;
  await combatant.update({ [`flags.${MODULE_ID}.openingStance`]: combatant.parent?.id ?? true });
  const user = controllingUser(actor, setting("interceptPromptTarget"));
  if (!user) return;
  const result = await requestOperation("guardian-reaction-prompt", {
    requestId: foundry.utils.randomID(),
    guardianUuid: actor.uuid,
    guardianName: actor.name,
    guardianImg: actor.img,
    pool: null,
    timeout: Number(setting("interceptTimeout")) || 30,
    title: "Opening Stance",
    eyebrow: "Opening Stance",
    glyph: "F",
    hidePool: true,
    facts: [{ icon: "fa-solid fa-person-rays", text: "You rolled initiative: drop into a stance as a free action." }],
    buttons: options.map((option, index) => ({ value: option.slug, label: option.name, icon: "fa-solid fa-shield-halved", style: index ? "subtle" : "primary" })),
  }, { authorityUserId: user.id, directed: true, timeoutMs: ((Number(setting("interceptTimeout")) || 30) + 10) * 1000 }).catch(() => null);
  const option = options.find((entry) => entry.slug === result?.choice);
  if (option) await enterStance(actor, option);
}

export function registerHighLevelFeats() {
  Hooks.on("preUpdateItem", (item, changes) => salvage(item, changes));
  Hooks.on("updateCombatant", (combatant, changed, _options, userId) => {
    if (!("initiative" in changed) || changed.initiative === null || !isResponsibleGM(userId)) return;
    const actor = combatant.actor;
    if (!actor || !hasSlug(actor, "opening-stance")) return;
    if (combatant.flags?.[MODULE_ID]?.openingStance === (combatant.parent?.id ?? true)) return;
    void offerOpeningStance(combatant).catch((error) => notify("error", `Opening Stance: ${error.message}`));
  });
}
