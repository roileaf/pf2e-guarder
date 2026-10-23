import { FLAG_SCOPE } from "../constants.js";
import { describePool } from "../domain/reactions.js";
import { setting } from "../settings.js";
import { isGuardian, notify } from "../foundry/actors.js";
import { reactionPool, restoreOneReaction, spendOneReaction } from "../foundry/reactions.js";
import { reactionPips } from "./views.js";

// PF2e HUD (pf2e-hud) replaces the combat tracker with its own ApplicationV2 using the same row markup.
const HUD_TRACKER_ID = "pf2e-hud-tracker";

function badge(combatant) {
  const pool = reactionPool(combatant.actor);
  if (!pool) return null;
  const element = document.createElement("span");
  element.className = "pf2e-guarder-reactions";
  const left = (pool.general ?? 0) + (pool.guardian ?? 0);
  element.classList.toggle("spent", left === 0);
  element.innerHTML = reactionPips(pool);
  element.dataset.tooltip = `Reactions: ${describePool(pool)}${game.user.isGM ? "<br>Click: spend one · Right-click: restore one" : ""}`;
  if (!game.user.isGM) return element;
  // Restores stay within what the guardian can hold right now (before its first turn: Ever Ready's reaction only).
  const change = (delta) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    void (delta > 0 ? restoreOneReaction(combatant.actor) : spendOneReaction(combatant.actor)).catch((error) => notify("error", error.message));
  };
  // PF2e HUD rows act on click and right-click themselves; the badge keeps its own clicks.
  element.addEventListener("click", change(-1));
  element.addEventListener("contextmenu", change(1));
  for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick"]) element.addEventListener(type, (event) => event.stopPropagation());
  return element;
}

/**
 * PF2e Combater draws action and reaction glyphs in the trackers for this user (its per-user "Show actions
 * in the combat tracker" setting), reading Guarder's pool; then Guarder's own badge would be a duplicate.
 */
export function combaterDrawsTrackerActions() {
  if (game.modules?.get?.("pf2e-combater")?.active !== true) return false;
  try {
    return game.settings.get("pf2e-combater", "combatTrackerActions") === true;
  } catch {
    // Older Combater versions don't have the setting.
    return false;
  }
}

/** Add a reaction badge to each guardian row of a tracker; `slot(row)` is where it goes. */
function decorate(html, combat, slot) {
  if (!setting("trackReactions") || !combat?.started) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (combaterDrawsTrackerActions()) {
    for (const element of root?.querySelectorAll?.(".pf2e-guarder-reactions") ?? []) element.remove();
    return;
  }
  for (const row of root?.querySelectorAll?.("[data-combatant-id]") ?? []) {
    const combatant = combat.combatants.get(row.dataset.combatantId);
    if (!combatant?.actor || !isGuardian(combatant.actor)) continue;
    if (!game.user.isGM && !combatant.isOwner) continue;
    const element = badge(combatant);
    if (!element) continue;
    row.querySelector(".pf2e-guarder-reactions")?.remove();
    slot(row).append(element);
  }
}

export function registerReactionBadges() {
  Hooks.on("renderCombatTracker", (_app, html) => decorate(html, game.combat, (row) => row.querySelector(".token-name") ?? row));
  Hooks.on("renderApplicationV2", (app, html) => {
    if (app.id !== HUD_TRACKER_ID) return;
    // The name line clips overflow, so the badge joins the icon row under it.
    decorate(html, app.viewed ?? game.combat, (row) => row.querySelector(".details .controls:not(.alt)") ?? row.querySelector(".details") ?? row);
  });
  Hooks.on("updateCombatant", (combatant, changed) => {
    if (!foundry.utils.hasProperty(changed, `flags.${FLAG_SCOPE}`)) return;
    ui.combat?.render();
    foundry.applications.instances.get(HUD_TRACKER_ID)?.render();
  });
}
