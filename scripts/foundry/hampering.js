import { MODULE_ID } from "../constants.js";
import { isEnemy, notify, sceneTokenFor } from "./actors.js";
import { isResponsibleGM } from "./socket.js";

// Hampering Stance: squares within 5 feet of the guardian are difficult terrain for the guardian's enemies.
// A Region attached to the guardian's token follows it; a behavior subtype limits the terrain to enemies.

export const HAMPERING_EFFECT = "guarder-hampering-stance";
export const BEHAVIOR_TYPE = `${MODULE_ID}.hamperingTerrain`;
const REGION_FLAG = "hamperingStance";
const RANGE = 5;

/** Registered at init: PF2e's difficult-terrain behavior, applied only to enemies of the attached token. */
export function registerHamperingTerrainBehavior() {
  const Base = CONFIG.RegionBehavior?.dataModels?.modifyMovementCost;
  if (!Base) return;
  class HamperingTerrainBehaviorType extends Base {
    _getTerrainEffects(token, segment, options) {
      const guardian = this.region?.attachment?.token;
      if (!guardian || token === guardian || token?.id === guardian.id) return [];
      if (!guardian.actor || !token?.actor || !isEnemy(guardian.actor, token.actor)) return [];
      return super._getTerrainEffects(token, segment, options);
    }
  }
  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = HamperingTerrainBehaviorType;
  CONFIG.RegionBehavior.typeIcons ??= {};
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-shield-halved";
  CONFIG.RegionBehavior.typeLabels ??= {};
  CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = "PF2E_GUARDER.HamperingTerrain";
}

function attachedRegions(token) {
  return [...(token?.parent?.regions ?? [])].filter((region) =>
    region.flags?.[MODULE_ID]?.[REGION_FLAG] && (region.attachment?.token?.id ?? region._source.attachment?.token) === token.id);
}

const TOOLBELT_TERRAIN = "pf2e-toolbelt.difficult-terrain";

/**
 * The terrain behavior for the region. pf2e-toolbelt's difficult terrain already supports
 * "enemies of the origin actor"; otherwise Guarder's own subtype (needs the world reloaded once
 * after installing so Foundry registers the type).
 */
function terrainBehavior(token) {
  // Stride (walk) on the ground; crawl and climb derive from it. Flying creatures are unaffected.
  const difficulties = { walk: 2 };
  const registered = (type) => game.documentTypes?.RegionBehavior?.includes(type) && CONFIG.RegionBehavior.dataModels[type];
  if (registered(TOOLBELT_TERRAIN)) {
    return { name: "Hampering Stance", type: TOOLBELT_TERRAIN, system: { affects: { alliance: "enemies", types: [] }, difficulties, origin: { actor: token.actor?.uuid ?? null } } };
  }
  if (registered(BEHAVIOR_TYPE)) return { name: "Hampering Stance", type: BEHAVIOR_TYPE, system: { difficulties } };
  return null;
}

async function createRegion(token) {
  if (!token || attachedRegions(token).length) return;
  const behavior = terrainBehavior(token);
  if (!behavior) {
    notify("warn", "Hampering Stance: no region behavior available for difficult terrain. Reload the world after enabling PF2e Guarder.");
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

async function deleteRegions(actor) {
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens) {
      if (token.actor?.id !== actor.id) continue;
      const ids = attachedRegions(token).map((region) => region.id);
      if (ids.length) await scene.deleteEmbeddedDocuments("Region", ids);
    }
  }
}

function isStanceEffect(item) {
  return item?.type === "effect" && item.slug === HAMPERING_EFFECT;
}

/** The stance effect drives the region: created with it, deleted with it (GM side, behaviors are GM-only). */
export function registerHamperingStance() {
  Hooks.on("createItem", (item, _options, userId) => {
    if (!isStanceEffect(item) || !isResponsibleGM(userId) || !item.parent) return;
    const token = sceneTokenFor(item.parent) ?? item.parent.getActiveTokens?.(true, true)?.[0];
    if (!token) return;
    void createRegion(token).catch((error) => notify("error", `Hampering Stance: ${error.message}`));
  });
  Hooks.on("deleteItem", (item, _options, userId) => {
    if (!isStanceEffect(item) || !isResponsibleGM(userId) || !item.parent) return;
    void deleteRegions(item.parent).catch((error) => notify("error", `Hampering Stance: ${error.message}`));
  });
}
