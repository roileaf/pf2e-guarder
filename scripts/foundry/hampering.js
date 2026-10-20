import { MODULE_ID } from "../constants.js";
import { notify } from "./actors.js";
import { isResponsibleGM } from "./socket.js";

// Hampering Stance: squares within 5 feet of the guardian are difficult terrain for the guardian's enemies.
// A Region attached to the guardian's token follows it, using pf2e-toolbelt's difficult terrain limited to
// enemies when available, otherwise PF2e's native Difficult Terrain behavior.

export const HAMPERING_EFFECT = "guarder-hampering-stance";
export const PARAGON_EFFECT = "guarder-paragons-guard";

// PF2e's own Raise a Shield effect rule: the stance keeps the shield raised while it lasts.
const RAISED_SHIELD_RULE = {
  key: "ActiveEffectLike", mode: "override", path: "system.attributes.shield.raised", value: true,
  predicate: ["self:shield:equipped", { nor: ["self:shield:broken", "self:shield:destroyed"] }],
};

/** Guardian stances the module runs: feat slug -> stance effect. Only one stance at a time. */
export const STANCES = Object.freeze({
  "hampering-stance": {
    effect: HAMPERING_EFFECT,
    name: "Hampering Stance",
    description: "Squares within 5 feet are difficult terrain for your enemies. Enables Not So Fast!",
    activeText: "Enemies within 5 ft treat the area as difficult terrain; Not So Fast! enabled",
    rules: [],
  },
  "paragons-guard": {
    effect: PARAGON_EFFECT,
    name: "Paragon's Guard",
    description: "Your shield is constantly raised, as if you had used Raise a Shield.",
    activeText: "Shield constantly raised",
    rules: [RAISED_SHIELD_RULE],
  },
});
const STANCE_EFFECTS = new Set(Object.values(STANCES).map((stance) => stance.effect));
const EFFECT_STANCE = Object.fromEntries(Object.entries(STANCES).map(([slug, stance]) => [stance.effect, slug]));
const REGION_FLAG = "hamperingStance";
const RANGE = 5;

function attachedRegions(token) {
  return [...(token?.parent?.regions ?? [])].filter((region) =>
    region.flags?.[MODULE_ID]?.[REGION_FLAG] && (region.attachment?.token?.id ?? region._source.attachment?.token) === token.id);
}

const TOOLBELT_TERRAIN = "pf2e-toolbelt.difficult-terrain";

/**
 * The terrain behavior for the region: pf2e-toolbelt's difficult terrain, which can affect only the
 * guardian's enemies, or else PF2e's native Difficult Terrain (it has no alliance filter, so it slows
 * everyone in the area, the guardian included).
 */
function terrainBehavior(token) {
  // Stride (walk) on the ground; crawl and climb derive from it. Flying creatures are unaffected.
  const difficulties = { walk: 2 };
  const registered = (type) => game.documentTypes?.RegionBehavior?.includes(type) && CONFIG.RegionBehavior.dataModels[type];
  if (registered(TOOLBELT_TERRAIN)) {
    return { name: "Hampering Stance", type: TOOLBELT_TERRAIN, system: { affects: { alliance: "enemies", types: [] }, difficulties, origin: { actor: token.actor?.uuid ?? null } } };
  }
  if (registered("modifyMovementCost")) return { name: "Hampering Stance", type: "modifyMovementCost", system: { difficulties } };
  return null;
}

async function createRegion(token) {
  if (!token || attachedRegions(token).length) return;
  const behavior = terrainBehavior(token);
  if (!behavior) {
    notify("warn", "Hampering Stance: no difficult terrain region behavior is available.");
    return;
  }
  const RegionDocument = CONFIG.Region.documentClass;
  const data = {
    name: `Hampering Stance (${token.name})`,
    color: "#d9782d",
    hidden: token.hidden,
    visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2,
    highlightMode: "coverage",
    behaviors: [behavior],
    flags: { [MODULE_ID]: { [REGION_FLAG]: true } },
  };
  if (typeof RegionDocument?.createTokenEmanation === "function") {
    await RegionDocument.createTokenEmanation(token, RANGE, data, { gridBased: true });
    return;
  }
  const { x, y, width, height, shape, elevation, depth, level } = token._source;
  const { distance, distancePixels } = token.parent.dimensions;
  await token.parent.createEmbeddedDocuments("Region", [{
    ...data,
    shapes: [{ type: "emanation", base: { type: "token", x, y, width, height, shape, hole: false }, radius: RANGE * distancePixels, gridBased: true }],
    elevation: { bottom: elevation - RANGE, top: elevation + (depth ?? 1) * distance + RANGE },
    levels: level === undefined ? [] : [level],
    attachment: { token: token.id },
  }]);
}

function inStance(actor) {
  return (actor?.itemTypes?.effect ?? actor?.items?.filter?.((item) => item.type === "effect") ?? []).some(isStanceEffect);
}

function tokensOf(actor) {
  return [...(game.scenes ?? [])].flatMap((scene) => [...scene.tokens].filter((token) =>
    actor.isToken ? token.id === actor.token?.id : token.actorLink && token.actorId === actor.id));
}

let syncing = Promise.resolve();

/**
 * Make every token of `actor` match its stance: an attached area while in Hampering Stance, none otherwise.
 * Serialized so overlapping triggers never create duplicate regions.
 */
export function syncHamperingRegions(actor) {
  syncing = syncing.then(async () => {
    const active = inStance(actor);
    for (const token of tokensOf(actor)) {
      const regions = attachedRegions(token);
      if (active && !regions.length) await createRegion(token);
      if (!active && regions.length) await token.parent.deleteEmbeddedDocuments("Region", regions.map((region) => region.id));
    }
  }).catch((error) => notify("error", `Hampering Stance: ${error.message}`));
  return syncing;
}

/** The module stance (feat slug) the actor is in, or null. */
export function activeStance(actor) {
  const effect = (actor?.itemTypes?.effect ?? []).find((item) => STANCE_EFFECTS.has(item.slug));
  return effect ? EFFECT_STANCE[effect.slug] : null;
}

/**
 * Enter or leave a module stance (its owner may call this). Entering one ends any other module
 * stance, since a creature can be in only one stance at a time.
 */
export async function setStance(actor, slug, on) {
  const stance = STANCES[slug];
  if (!stance) return;
  const effects = (actor.itemTypes?.effect ?? []).filter((item) => STANCE_EFFECTS.has(item.slug));
  const current = effects.filter((item) => item.slug === stance.effect);
  const others = on ? effects.filter((item) => item.slug !== stance.effect) : current;
  if (others.length) await actor.deleteEmbeddedDocuments("Item", others.map((effect) => effect.id));
  if (!on || current.length) return;
  const feat = actor.items.find((item) => item.slug === slug);
  await actor.createEmbeddedDocuments("Item", [stanceEffectSource(feat, slug)]);
}

/** Turn Hampering Stance on or off for an actor (its owner may call this). */
export function setHamperingStance(actor, on) {
  return setStance(actor, "hampering-stance", on);
}

export function stanceEffectSource(feat, slug = "hampering-stance") {
  const stance = STANCES[slug];
  return {
    name: `Stance: ${stance.name}`,
    type: "effect",
    img: feat?.img ?? "icons/svg/aura.svg",
    system: {
      slug: stance.effect,
      description: { value: `<p>${stance.description}</p>` },
      duration: { expiry: null, sustained: false, unit: "encounter", value: -1 },
      rules: stance.rules.map((rule) => foundry.utils.deepClone(rule)),
      tokenIcon: { show: true },
      traits: { rarity: "common", value: ["stance"] },
    },
  };
}

function isPrimaryGM() {
  return game.users?.activeGM?.id === game.user.id;
}

function isStanceEffect(item) {
  return item?.type === "effect" && item.slug === HAMPERING_EFFECT;
}

function isStanceCard(message) {
  return Boolean(STANCES[message?.item?.slug] && message.actor);
}

/** Enter/End button on module stance chat cards, reflecting the actor's current stance. */
function decorateStanceCard(message, html) {
  if (!isStanceCard(message) || !message.actor.isOwner) return;
  const slug = message.item.slug;
  const { name } = STANCES[slug];
  html.querySelector("[data-guarder-action=stance]")?.remove();
  const active = activeStance(message.actor) === slug;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `guarder-card-button ${active ? "" : "primary"}`;
  button.dataset.guarderAction = "stance";
  button.dataset.stance = slug;
  button.innerHTML = active
    ? `<i class="fa-solid fa-xmark"></i> End ${name}`
    : `<i class="fa-solid fa-shield-halved"></i> Enter ${name}`;
  button.addEventListener("click", () => void setStance(message.actor, slug, activeStance(message.actor) !== slug)
    .catch((error) => notify("error", error.message)));
  (html.querySelector(".card-content") ?? html.querySelector(".message-content"))?.append(button);
}

/** Re-render an actor's stance cards so their buttons show the current state. */
function refreshStanceCards(actor) {
  for (const message of (game.messages?.contents ?? []).slice(-50)) {
    if (isStanceCard(message) && message.actor?.id === actor?.id) void ui.chat?.updateMessage?.(message);
  }
}

/** Registered at load so cards rendered with the chat log get their button. */
export function registerHamperingChat() {
  Hooks.on("renderChatMessageHTML", decorateStanceCard);
  const refresh = (item) => {
    if (STANCE_EFFECTS.has(item?.slug) && item.type === "effect" && item.parent) refreshStanceCards(item.parent);
  };
  Hooks.on("createItem", refresh);
  Hooks.on("deleteItem", refresh);
}

/** The stance effect drives the areas; a GM keeps them in sync (region behaviors are GM-only). */
export function registerHamperingStance() {
  const onEffect = (item, _options, userId) => {
    if (!isStanceEffect(item) || !item.parent || !isResponsibleGM(userId)) return;
    void syncHamperingRegions(item.parent);
  };
  Hooks.on("createItem", onEffect);
  Hooks.on("deleteItem", onEffect);
  // A token placed later (another scene, re-dragged) gets its area too.
  Hooks.on("createToken", (token, _options, userId) => {
    if (token.actor && isResponsibleGM(userId) && inStance(token.actor)) void syncHamperingRegions(token.actor);
  });
  // Repair anything missed while no up-to-date GM was connected.
  if (isPrimaryGM()) {
    for (const actor of game.actors ?? []) if (inStance(actor) || tokensOf(actor).some((token) => attachedRegions(token).length)) void syncHamperingRegions(actor);
  }
}
