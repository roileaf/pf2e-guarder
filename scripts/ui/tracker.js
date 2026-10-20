import { FLAG_SCOPE } from "../constants.js";
import { clampPool, describePool } from "../domain/reactions.js";
import { setting } from "../settings.js";
import { isGuardian, notify } from "../foundry/actors.js";
import { maxPool, reactionPool, setReactions } from "../foundry/reactions.js";
import { sundryReactionRestored, sundryReactionUsed } from "../foundry/sundry.js";
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
  const change = (delta) => async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const current = reactionPool(combatant.actor);
    const max = maxPool(combatant.actor);
    let next = { ...current };
    if (delta < 0) {
      if (next.guardian > 0) next.guardian--;
      else if (next.general > 0) next.general--;
    } else if (next.general < max.general) next.general++;
    else next.guardian++;
    next = clampPool(next, max);
    const changed = next.general !== current.general || next.guardian !== current.guardian;
    if (!changed) return;
    await setReactions(combatant.actor, next).catch((error) => notify("error", error.message));
    await (delta < 0 ? sundryReactionUsed(combatant.actor) : sundryReactionRestored(combatant.actor)).catch(() => null);
  };
  // PF2e HUD rows act on click and right-click themselves; the badge keeps its own clicks.
  element.addEventListener("click", change(-1));
  element.addEventListener("contextmenu", change(1));
  for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick"]) element.addEventListener(type, (event) => event.stopPropagation());
  return element;
}

/** Add a reaction badge to each guardian row of a tracker; `slot(row)` is where it goes. */
function decorate(html, combat, slot) {
  if (!setting("trackReactions") || !combat?.started) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
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
