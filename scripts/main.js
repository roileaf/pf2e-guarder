import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { registerSocket } from "./foundry/socket.js";
import { registerInterceptAttack } from "./foundry/intercept.js";
import { registerFollowUpButtons, registerFollowUpOperations } from "./foundry/followups.js";
import { registerUnbelievableInterception } from "./foundry/unbelievable.js";
import { registerGuardianReactions } from "./foundry/guardian-reactions.js";
import { registerHamperingStance, registerHamperingTerrainBehavior } from "./foundry/hampering.js";
import { reactionPool, registerReactionTracking, setReactions } from "./foundry/reactions.js";
import { applyTauntFromMessage, applyTauntOffGuard, registerTaunt, registerTauntChatButtons } from "./foundry/taunt.js";
import { openGuardianPanel, registerGuardianPanel, registerGuardianPanelOperations } from "./ui/panel.js";
import { registerReactionBadges } from "./ui/tracker.js";

Hooks.once("init", () => {
  registerSettings();
  registerHamperingTerrainBehavior();
});
// Render hooks must exist before the chat log, sheets and combat tracker first render.
registerTauntChatButtons();
registerFollowUpButtons();
registerReactionBadges();
registerGuardianPanel();

Hooks.once("ready", () => {
  registerSocket();
  registerReactionTracking();
  registerInterceptAttack();
  registerFollowUpOperations();
  registerUnbelievableInterception();
  registerGuardianReactions();
  registerHamperingStance();
  registerTaunt();
  registerGuardianPanelOperations();

  const module = game.modules.get(MODULE_ID);
  module.api = Object.freeze({
    open: (actor) => openGuardianPanel(actor),
    reactions: (actor) => reactionPool(actor),
    setReactions: (actor, pool) => setReactions(actor, pool),
    applyTaunt: (message) => applyTauntFromMessage(message),
    applyTauntOffGuard: (enemy, guardian) => applyTauntOffGuard(enemy, guardian),
  });
  console.info(`${MODULE_ID} | Ready`);
});
