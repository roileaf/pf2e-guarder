import { MODULE_ID, SLUGS } from "../constants.js";
import { featureStatuses } from "../domain/features.js";
import { BASE_INTERCEPT_RANGE } from "../domain/intercept.js";
import { tauntLimits } from "../domain/taunt.js";
import { activeStance, setStance, STANCES } from "../foundry/hampering.js";
import {
  hasCondition, hasSlug, isAlly, isGuardianCharacter, itemBySlug, notify, sameActor, sceneTokenFor, tauntEffects, tauntOrigin, tokenDistance,
} from "../foundry/actors.js";
import { currentLimitFor, maxPool, reactionPool, setReactions } from "../foundry/reactions.js";
import { sundryReactionRestored, sundryReactionUsed } from "../foundry/sundry.js";
import { registerOperation, requestOperation } from "../foundry/socket.js";

import { guardianPanelBody } from "./panel-view.js";

const BODYGUARD_EFFECT = "Compendium.pf2e.feat-effects.Item.6QFg5v5iW4I3rcAm";
const REFRESH_DELAY = 80;
const panels = new Map();

export function hasGuardianFeatures(actor) {
  return isGuardianCharacter(actor);
}

const INTERCEPT_FEATURES = [
  ["energy-interceptor", "Energy Interceptor", "Acid, cold, electricity, fire and sonic damage also trigger Intercept Attack"],
  ["get-behind-me", "Get Behind Me!", "Move the ally up to 10 feet away from the attacker"],
  ["disarming-intercept", "Disarming Intercept", "Disarm an adjacent attacker's melee weapon after intercepting"],
  ["armored-counterattack", "Armored Counterattack", "Strike an adjacent attacker after intercepting; Taunt on hit"],
  ["quick-vengeance", "Quick Vengeance", "Quickened next turn after Intercept Attack or Shield Block"],
  ["unbelievable-interception", "Unbelievable Interception", "Mythic: become the target of an attack on an ally"],
];

function bodyguardCharge(guardian) {
  for (const actor of game.actors ?? []) {
    const effect = actor.itemTypes?.effect?.find((entry) => entry.slug === "effect-bodyguard" && sameActor(entry.system?.context?.origin?.actor, guardian));
    if (effect) return actor.uuid;
  }
  return null;
}

function viewModel(actor) {
  const scene = globalThis.canvas?.scene;
  const token = sceneTokenFor(actor, scene);
  const armor = actor.wornArmor;
  const heavyEnough = armor && ["medium", "heavy"].includes(armor.category);
  const resistance = actor.attributes?.resistances?.find?.((entry) => entry.type === "physical")?.value ?? 0;
  const shieldData = actor.attributes?.shield;
  const shield = shieldData?.itemId ? {
    name: shieldData.name, hp: shieldData.hp?.value ?? 0, max: shieldData.hp?.max ?? 0,
    hardness: shieldData.hardness ?? 0, raised: Boolean(shieldData.raised), broken: Boolean(shieldData.broken),
  } : null;

  const taunted = [];
  for (const enemyToken of scene?.tokens ?? []) {
    const effects = tauntEffects(enemyToken.actor).filter((effect) => sameActor(tauntOrigin(effect), actor));
    if (!effects.length) continue;
    taunted.push({
      name: enemyToken.name,
      img: enemyToken.texture?.src ?? enemyToken.actor?.img,
      distance: token ? tokenDistance(token, enemyToken) : NaN,
      offGuard: hasCondition(enemyToken.actor, "off-guard"),
      effects: effects.map((effect) => effect.uuid),
    });
  }

  const allies = (scene?.tokens ?? []).filter((other) => other.actor && other.actor.uuid !== actor.uuid && isAlly(actor, other.actor))
    .map((other) => ({ name: other.name, img: other.texture?.src ?? other.actor.img, distance: token ? tokenDistance(token, other) : Infinity }))
    .sort((a, b) => a.distance - b.distance)
    .map((ally) => ({ ...ally, inRange: ally.distance <= BASE_INTERCEPT_RANGE }));

  const action = itemBySlug(actor, SLUGS.interceptAttack, "action");
  const frequency = action?.system?.frequency;
  const interceptFeatures = INTERCEPT_FEATURES.filter(([slug]) => hasSlug(actor, slug))
    .map(([slug, label, detail]) => ({
      label: slug === "unbelievable-interception" ? `${label} (${actor.system?.resources?.mythicPoints?.value ?? 0} MP)` : label,
      detail,
      active: true,
    }));
  if (frequency?.max) interceptFeatures.unshift({ label: `Guardian's Intercept ${frequency.value ?? frequency.max}/${frequency.max}`, detail: "Once per 10 minutes", active: (frequency.value ?? frequency.max) > 0 });

  const bodyguard = hasSlug(actor, "bodyguard") ? {
    current: bodyguardCharge(actor),
    options: [...(game.actors ?? [])].filter((other) => other.type === "character" && other.uuid !== actor.uuid && isAlly(actor, other))
      .map((other) => ({ uuid: other.uuid, name: other.name })).sort((a, b) => a.name.localeCompare(b.name)),
  } : null;

  return {
    name: actor.name,
    img: actor.img,
    level: actor.level,
    className: actor.class?.name ?? "Guardian archetype",
    isOwner: actor.isOwner,
    isGM: game.user.isGM,
    armor: heavyEnough ? { name: armor.name, resistance } : null,
    shield,
    pool: reactionPool(actor),
    // Slots that exist right now: before the first turn only Ever Ready's, so no dimmed slot that can't be used.
    poolMax: currentLimitFor(actor) ?? maxPool(actor),
    taunted,
    hasTaunt: Boolean(itemBySlug(actor, SLUGS.taunt, "action")),
    tauntLimits: tauntLimits({ groupTaunt: hasSlug(actor, SLUGS.groupTaunt), longDistance: hasSlug(actor, SLUGS.longDistanceTaunt) }),
    bodyguard,
    allies,
    stances: Object.entries(STANCES).filter(([slug]) => hasSlug(actor, slug)).map(([slug, stance]) => ({
      slug,
      name: stance.name,
      active: activeStance(actor) === slug,
      activeText: stance.activeText,
      inactiveText: "Not in stance",
    })),
    interceptFeatures,
    features: featureStatuses(actor.items),
  };
}

export class GuardianPanel extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["pf2e-guarder", "pf2e-guarder-panel"],
    tag: "section",
    window: { title: "Guardian", icon: "fa-solid fa-shield-halved", resizable: true },
    position: { width: 520, height: 680 },
    actions: {
      tauntTargets: GuardianPanel.#tauntTargets,
      endTaunt: GuardianPanel.#endTaunt,
      raiseShield: GuardianPanel.#raiseShield,
      toggleReaction: GuardianPanel.#toggleReaction,
      toggleStance: GuardianPanel.#toggleStance,
    },
  };

  constructor(actor, options = {}) {
    super({ ...options, id: `${MODULE_ID}-panel-${actor.id}` });
    this.actor = actor;
    this.refreshTimer = null;
  }

  get title() {
    return `${this.actor.name} — Guardian`;
  }

  async _renderHTML() {
    return guardianPanelBody(viewModel(this.actor));
  }

  _replaceHTML(result, content) {
    const scroll = content.querySelector(".guarder-panel")?.scrollTop ?? 0;
    content.innerHTML = result;
    const panel = content.querySelector(".guarder-panel");
    if (panel) panel.scrollTop = scroll;
    content.querySelector("select[name=charge]")?.addEventListener("change", (event) => void this.#setCharge(event.target.value));
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      if (this.rendered) void this.render();
    }, REFRESH_DELAY);
  }

  _onClose(options) {
    super._onClose(options);
    clearTimeout(this.refreshTimer);
    panels.delete(this.actor.uuid);
  }

  static async #tauntTargets() {
    const targets = [...(game.user.targets ?? [])];
    if (!targets.length) return notify("warn", "Target the enemies to Taunt first.");
    const item = itemBySlug(this.actor, SLUGS.taunt, "action");
    await item?.toMessage?.(undefined, { create: true }).catch(() => null);
  }

  static async #endTaunt(_event, target) {
    const remove = (target.dataset.effects ?? "").split(",").filter(Boolean);
    await requestOperation("taunt-apply", { guardianUuid: this.actor.uuid, guardianTokenUuid: null, itemUuid: null, apply: [], remove }, { gmRequired: true });
  }

  static async #toggleStance(_event, target) {
    const slug = target.dataset.slug;
    await setStance(this.actor, slug, activeStance(this.actor) !== slug).catch((error) => notify("error", error.message));
  }

  static async #raiseShield() {
    await game.pf2e?.actions?.raiseAShield?.({ actors: [this.actor] });
  }

  /** A reaction glyph: a lit one is spent, a dimmed one restored. */
  static async #toggleReaction(_event, target) {
    const pool = reactionPool(this.actor);
    const kind = ["guardian", "boundless"].includes(target.dataset.kind) ? target.dataset.kind : "general";
    if (!pool) return;
    const delta = target.dataset.spent === "true" ? 1 : -1;
    await setReactions(this.actor, { ...pool, [kind]: Math.max(0, (pool[kind] ?? 0) + delta) });
    await (delta < 0 ? sundryReactionUsed(this.actor) : sundryReactionRestored(this.actor)).catch(() => null);
  }

  async #setCharge(allyUuid) {
    try {
      await requestOperation("bodyguard-charge", { guardianUuid: this.actor.uuid, allyUuid: allyUuid || null }, { gmRequired: true });
    } catch (error) {
      notify("error", error.message);
    }
  }
}

export function openGuardianPanel(actor) {
  const existing = panels.get(actor.uuid);
  if (existing) return existing.render({ force: true });
  const panel = new GuardianPanel(actor);
  panels.set(actor.uuid, panel);
  return panel.render({ force: true });
}

function refreshAll() {
  for (const panel of panels.values()) panel.scheduleRefresh();
}

async function setBodyguardCharge({ guardianUuid, allyUuid }) {
  const guardian = await fromUuid(guardianUuid);
  if (!guardian) throw new Error("Guardian not found.");
  for (const actor of game.actors) {
    const stale = actor.itemTypes?.effect?.filter((effect) => effect.slug === "effect-bodyguard" && sameActor(effect.system?.context?.origin?.actor, guardian)) ?? [];
    if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale.map((effect) => effect.id));
  }
  if (!allyUuid) return true;
  const ally = await fromUuid(allyUuid);
  const template = await fromUuid(BODYGUARD_EFFECT);
  if (!ally || !template) throw new Error("Bodyguard: the ally or PF2e's Effect: Bodyguard is unavailable.");
  const feat = itemBySlug(guardian, "bodyguard");
  const source = foundry.utils.mergeObject(template.toObject(), {
    system: {
      context: {
        origin: { actor: guardian.uuid, token: null, item: feat?.uuid ?? null, spellcasting: null, rollOptions: feat?.getOriginData?.().rollOptions ?? [] },
        target: { actor: ally.uuid, token: null },
        roll: null,
      },
    },
  });
  delete source._id;
  await ally.createEmbeddedDocuments("Item", [source]);
  return true;
}

/** Sheet header button, token HUD button and live refresh. Registered at load. */
export function registerGuardianPanel() {
  const control = (actor) => ({
    action: `${MODULE_ID}-panel`,
    icon: "fa-solid fa-shield-halved",
    label: "Guardian",
    onClick: () => openGuardianPanel(actor),
  });
  Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
    const actor = sheet.document;
    if (actor?.isOwner && hasGuardianFeatures(actor)) controls.unshift(control(actor));
  });
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    const actor = sheet.actor;
    if (!actor?.isOwner || !hasGuardianFeatures(actor)) return;
    buttons.unshift({ class: `${MODULE_ID}-panel`, icon: "fa-solid fa-shield-halved", label: "Guardian", onclick: () => openGuardianPanel(actor) });
  });
  Hooks.on("renderTokenHUD", (hud, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const column = root?.querySelector(".col.right");
    const actor = hud.object?.actor ?? hud.actor;
    if (!column || !actor?.isOwner || !hasGuardianFeatures(actor)) return;
    column.querySelector(`[data-action="${MODULE_ID}-panel"]`)?.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-icon";
    button.dataset.action = `${MODULE_ID}-panel`;
    button.dataset.tooltip = "Guardian";
    button.innerHTML = `<i class="fa-solid fa-shield-halved" inert></i>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openGuardianPanel(actor);
    });
    column.append(button);
  });
  for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem", "updateToken", "createToken", "deleteToken",
    "updateCombat", "updateCombatant", "targetToken", "canvasReady"]) Hooks.on(hook, refreshAll);
}

export function registerGuardianPanelOperations() {
  registerOperation("bodyguard-charge", (payload) => setBodyguardCharge(payload));
}
