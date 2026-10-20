import { MODULE_ID } from "../constants.js";
import { notify } from "./actors.js";
import { isResponsibleGM } from "./socket.js";

// Hampering Stance: squares within 5 feet of the guardian are difficult terrain for the guardian's enemies.
// A Region attached to the guardian's token follows it, using pf2e-toolbelt's difficult terrain limited to
// enemies when available, otherwise PF2e's native Difficult Terrain behavior.

export const HAMPERING_EFFECT = "guarder-hampering-stance";
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

/** Turn Hampering Stance on or off for an actor (its owner may call this). */
export async function setHamperingStance(actor, on) {
  const existing = (actor.itemTypes?.effect ?? []).filter(isStanceEffect);
  if (!on) {
    if (existing.length) await actor.deleteEmbeddedDocuments("Item", existing.map((effect) => effect.id));
    return;
  }
  if (existing.length) return;
  const feat = actor.items.find((item) => item.slug === "hampering-stance");
  await actor.createEmbeddedDocuments("Item", [stanceEffectSource(feat)]);
}

export function stanceEffectSource(feat) {
  return {
    name: "Stance: Hampering Stance",
    type: "effect",
    img: feat?.img ?? "icons/svg/aura.svg",
    system: {
      slug: HAMPERING_EFFECT,
      description: { value: "<p>Squares within 5 feet are difficult terrain for your enemies. Enables Not So Fast!</p>" },
      duration: { expiry: null, sustained: false, unit: "encounter", value: -1 },
      rules: [],
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
  return message?.item?.slug === "hampering-stance" && Boolean(message.actor);
}

/** Enter/End button on Hampering Stance chat cards, reflecting the actor's current stance. */
function decorateStanceCard(message, html) {
  if (!isStanceCard(message) || !message.actor.isOwner) return;
  html.querySelector("[data-guarder-action=hampering-stance]")?.remove();
  const active = inStance(message.actor);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `guarder-card-button ${active ? "" : "primary"}`;
  button.dataset.guarderAction = "hampering-stance";
  button.innerHTML = active
    ? `<i class="fa-solid fa-xmark"></i> End Hampering Stance`
    : `<i class="fa-solid fa-shield-halved"></i> Enter Hampering Stance`;
  button.addEventListener("click", () => void setHamperingStance(message.actor, !inStance(message.actor))
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
    if (isStanceEffect(item) && item.parent) refreshStanceCards(item.parent);
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
