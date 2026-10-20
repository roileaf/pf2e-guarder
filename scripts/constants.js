export const MODULE_ID = "pf2e-guarder";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const FLAG_SCOPE = MODULE_ID;

export const SLUGS = Object.freeze({
  interceptAttack: "intercept-attack",
  taunt: "taunt",
  tauntEffect: "effect-taunt",
  everReady: "guardians-techniques",
  reactionTime: "reaction-time",
  energyInterceptor: "energy-interceptor",
  groupTaunt: "group-taunt",
  longDistanceTaunt: "long-distance-taunt",
  shieldBlock: "shield-block",
  tauntOffGuardEffect: "effect-taunted-off-guard",
  boundlessReprisals: "boundless-reprisals",
});

export const SYSTEM_UUIDS = Object.freeze({
  tauntEffect: "Compendium.pf2e.feat-effects.Item.FlyWq9znOHvpISNW",
  offGuard: "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg",
  interceptAttack: "Compendium.pf2e.actionspf2e.Item.vhO1f7oTD2s3Ncg9",
});

// Conditions that stop a creature from using reactions at all.
export const INCAPACITATING_CONDITIONS = Object.freeze(["unconscious", "paralyzed", "stunned", "petrified", "dying"]);
// Conditions that stop a creature from Stepping or Striding into place.
export const IMMOBILIZING_CONDITIONS = Object.freeze(["immobilized", "grabbed", "restrained"]);
