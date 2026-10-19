// Optional integration with pf2e-toolbelt (game.toolbelt). Everything degrades to null when it is absent.

const TOOLBELT_ID = "pf2e-toolbelt";

export function toolbeltActive() {
  return game.modules?.get?.(TOOLBELT_ID)?.active === true && Boolean(game.toolbelt?.api);
}

/** Target Helper's targets on a spell/action/area/damage message, or null when unknown. */
export function messageTargets(message) {
  if (!toolbeltActive()) return null;
  try {
    const targets = game.toolbelt.api.targetHelper?.getMessageTargets?.(message);
    return Array.isArray(targets) ? targets : null;
  } catch {
    return null;
  }
}

/** Whether a chat message update changed Target Helper's targets. */
export function targetsChanged(changes) {
  return foundry.utils.hasProperty(changes ?? {}, `flags.${TOOLBELT_ID}.targetHelper.targets`);
}
