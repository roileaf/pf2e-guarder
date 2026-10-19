import { MODULE_ID } from "./constants.js";

const SETTINGS = {
  interceptEnabled: { type: Boolean, default: true },
  interceptPromptTarget: {
    type: String,
    default: "owner",
    choices: { owner: "PF2E_GUARDER.Settings.PromptOwner", gm: "PF2E_GUARDER.Settings.PromptGM" },
  },
  interceptTimeout: { type: Number, default: 30, range: { min: 5, max: 120, step: 5 } },
  interceptScope: {
    type: String,
    default: "trigger",
    choices: { trigger: "PF2E_GUARDER.Settings.ScopeTrigger", all: "PF2E_GUARDER.Settings.ScopeAll" },
  },
  interceptAutoMove: { type: Boolean, default: true },
  tauntEnabled: { type: Boolean, default: true },
  tauntOffGuard: { type: Boolean, default: true },
  trackReactions: { type: Boolean, default: true },
};

export function registerSettings() {
  for (const [key, config] of Object.entries(SETTINGS)) {
    game.settings.register(MODULE_ID, key, {
      name: `PF2E_GUARDER.Settings.${key}.Name`,
      hint: `PF2E_GUARDER.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      ...config,
    });
  }
}

export function setting(key) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return SETTINGS[key]?.default;
  }
}
