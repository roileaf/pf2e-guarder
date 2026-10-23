import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { registerSocket } from "./foundry/socket.js";
import { registerInterceptAttack } from "./foundry/intercept.js";
import { registerFollowUpButtons, registerFollowUpOperations } from "./foundry/followups.js";
import { registerUnbelievableInterception } from "./foundry/unbelievable.js";
import { registerGuardianReactions } from "./foundry/guardian-reactions.js";
import { registerHamperingChat, registerHamperingStance } from "./foundry/hampering.js";
import {
  combatantFor, currentLimitFor, reactionPool, registerReactionTracking, restoreOneReaction, restoreReactionsFor, setReactions,
  spendOneReaction,
} from "./foundry/reactions.js";
import { registerSundryRestore } from "./foundry/sundry.js";
import { isGuardian } from "./foundry/actors.js";
import { applyTauntFromMessage, applyTauntOffGuard, registerTaunt, registerTauntChatButtons } from "./foundry/taunt.js";
import { openGuardianPanel, registerGuardianPanel, registerGuardianPanelOperations } from "./ui/panel.js";
import { registerReactionBadges } from "./ui/tracker.js";
import { registerHighLevelFeats } from "./foundry/feats.js";
import { registerFeatActionOperations } from "./foundry/feat-actions.js";

Hooks.once("init", registerSettings);
// Render hooks must exist before the chat log, sheets and combat tracker first render.
registerTauntChatButtons();
registerFollowUpButtons();
registerHamperingChat();
registerReactionBadges();
registerGuardianPanel();

Hooks.once("ready", () => {
  registerSocket();
  registerReactionTracking();
  registerSundryRestore({ isGuardian, combatantFor, restoreReactionsFor });
  registerInterceptAttack();
  registerFollowUpOperations();
  registerUnbelievableInterception();
  registerGuardianReactions();
  registerHamperingStance();
  registerTaunt();
  registerGuardianPanelOperations();
  registerHighLevelFeats();
  registerFeatActionOperations();

  const module = game.modules.get(MODULE_ID);
  module.api = Object.freeze({
    open: (actor) => openGuardianPanel(actor),
    // Guarder tracks guardians' reactions (Intercept Attack); other creatures get null so other modules keep their own.
    isGuardian: (actor) => isGuardian(actor),
    reactions: (actor) => (isGuardian(actor) ? reactionPool(actor) : null),
    setReactions: (actor, pool) => setReactions(actor, pool),
    // One reaction by hand, as the tracker badge does it (with Sundry and the current limit); used by PF2e Combater.
    spendReaction: async (actor) => isGuardian(actor) && spendOneReaction(actor),
    restoreReaction: async (actor) => isGuardian(actor) && restoreOneReaction(actor),
    // The slots that exist right now ({ general, guardian, boundless? }), for drawing reaction glyphs.
    reactionLimit: (actor) => (isGuardian(actor) ? currentLimitFor(actor) : null),
    applyTaunt: (message) => applyTauntFromMessage(message),
    applyTauntOffGuard: (enemy, guardian) => applyTauntOffGuard(enemy, guardian),
  });
  console.info(`${MODULE_ID} | Ready`);
});
