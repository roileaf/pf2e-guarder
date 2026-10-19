import { FLAG_SCOPE } from "../constants.js";
import { describePool } from "../domain/reactions.js";
import { setting } from "../settings.js";
import { isGuardian, notify } from "../foundry/actors.js";
import { reactionPool, setReactions } from "../foundry/reactions.js";
import { reactionPips } from "./views.js";

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
    const next = { ...current };
    if (delta < 0) {
      if (next.guardian > 0) next.guardian--;
      else if (next.general > 0) next.general--;
    } else if (next.general < 1) next.general++;
    else next.guardian++;
    await setReactions(combatant.actor, next).catch((error) => notify("error", error.message));
  };
  element.addEventListener("click", change(-1));
  element.addEventListener("contextmenu", change(1));
  return element;
}

export function registerReactionBadges() {
  Hooks.on("renderCombatTracker", (_app, html) => {
    if (!setting("trackReactions") || !game.combat?.started) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    for (const row of root?.querySelectorAll?.("[data-combatant-id]") ?? []) {
      const combatant = game.combat.combatants.get(row.dataset.combatantId);
      if (!combatant?.actor || !isGuardian(combatant.actor)) continue;
      if (!game.user.isGM && !combatant.isOwner) continue;
      const element = badge(combatant);
      if (!element) continue;
      (row.querySelector(".token-name") ?? row).append(element);
    }
  });
  Hooks.on("updateCombatant", (combatant, changed) => {
    if (foundry.utils.hasProperty(changed, `flags.${FLAG_SCOPE}`)) ui.combat?.render();
  });
}
