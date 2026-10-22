import { MODULE_ID, SLUGS, SYSTEM_UUIDS } from "../constants.js";
import { damageFormula, interceptableTypes, partitionInstances } from "../domain/damage.js";
import { interceptEligibility, interceptMovementBudget, shieldBlockApplies, shieldBlockOption } from "../domain/intercept.js";
import { frequencyAvailable, interceptFollowUps } from "../domain/followups.js";
import { setting } from "../settings.js";
import { dismissPrompts, openPrompt, timedPrompt } from "../ui/prompt.js";
import { interceptCard, interceptPromptBody, overrideBoardBody, overrideRowStatus } from "../ui/views.js";
import {
  alive, controllingUser, hasSlug, immobilized, incapacitated, isAlly, isGuardian, isTauntedBy, itemBySlug,
  landSpeed, notify, sceneTokenFor, tokenDistance, tokenDocument,
} from "./actors.js";
import { attackFacts, getBehindMe, grantQuickVengeance } from "./followups.js";
import { afterDamage } from "./guardian-reactions.js";
import { duringShieldBlock } from "./feats.js";
import { afterShieldBlock } from "./feat-actions.js";
import { moveAdjacent, pickAdjacent } from "./movement.js";
import { combatantFor, reactionPool, reactionsLeft, spendReactions } from "./reactions.js";
import { broadcast, registerListener, registerOperation, requestOperation } from "./socket.js";

const WRAPPED = Symbol.for(`${MODULE_ID}.applyDamage`);
// Damage the guardian takes through Intercept Attack carries this marker so it is never intercepted again.
export const INTERCEPTED = `${MODULE_ID}.intercepted`;

function damageParts(instances = []) {
  return instances.filter((instance) => instance.persistent || instance.total > 0).map((instance) => ({
    type: instance.type,
    total: instance.total,
    persistent: Boolean(instance.persistent),
    formula: instance.persistent ? instance.head?.expression ?? null : null,
    icon: instance.iconClass ? `fa-solid ${instance.iconClass}` : null,
    label: game.i18n?.localize?.(CONFIG.PF2E?.damageTypes?.[instance.type] ?? instance.type) ?? instance.type,
  }));
}

function canShieldBlock(guardian) {
  const shield = guardian?.attributes?.shield;
  return Boolean(shield?.raised && !shield.broken && !shield.destroyed && hasSlug(guardian, SLUGS.shieldBlock));
}

/** Guardians on the ally's scene that could intercept this damage right now. */
export function findInterceptors({ ally, allyToken, damage, attacker }) {
  const scene = allyToken?.parent;
  if (!scene) return [];
  const seen = new Set();
  const candidates = [];
  for (const token of scene.tokens) {
    const guardian = token.actor;
    if (!guardian || !isGuardian(guardian) || seen.has(guardian.uuid)) continue;
    seen.add(guardian.uuid);
    if (guardian.uuid === ally.uuid || token.id === allyToken.id) continue;
    // Guardian's Intercept (archetype) grants Intercept Attack once per 10 minutes.
    if (!frequencyAvailable(itemBySlug(guardian, SLUGS.interceptAttack, "action")?.system?.frequency)) continue;
    const triggerTypes = interceptableTypes({ energyInterceptor: hasSlug(guardian, SLUGS.energyInterceptor) });
    const partition = partitionInstances(damage.instances, triggerTypes, setting("interceptScope"));
    if (!partition.triggered) continue;
    const sourceTaunted = Boolean(attacker && isTauntedBy(attacker, guardian));
    const distance = tokenDistance(token, allyToken);
    const verdict = interceptEligibility({
      isAlly: isAlly(guardian, ally),
      hasIntercept: true,
      incapacitated: incapacitated(guardian),
      alive: alive(guardian),
      distance,
      sourceTaunted,
      reactionsLeft: reactionsLeft(guardian),
    });
    if (!verdict.eligible) continue;
    candidates.push({ guardian, token, partition, sourceTaunted, distance, user: controllingUser(guardian, setting("interceptPromptTarget")) });
  }
  return candidates;
}

function promptButtons(payload) {
  const moveLabel = payload.movement === "adjacent" ? "Intercept" : payload.movement === "stride" ? "Intercept & Move" : "Intercept & Step";
  const checked = (element, name) => Boolean(element?.querySelector?.(`input[name=${name}]`)?.checked);
  const accept = (autoMove) => (element) => ({
    intercept: true, autoMove, shieldBlock: checked(element, "shieldBlock"), getBehindMe: checked(element, "getBehindMe"),
  });
  const buttons = [{ value: "auto", label: moveLabel, icon: "fa-solid fa-shield-halved", style: "primary", default: true, result: accept(true) }];
  if (payload.movement !== "adjacent") {
    buttons.push({ value: "manual", label: "Choose square", icon: "fa-solid fa-hand-pointer", result: accept(false) });
  }
  buttons.push({ value: "decline", label: "Decline", icon: "fa-solid fa-xmark", result: { intercept: false } });
  return buttons;
}

async function promptGuardian(payload) {
  return timedPrompt({
    key: `${payload.requestId}:${payload.guardianUuid}`,
    title: "Intercept Attack",
    body: interceptPromptBody(payload),
    buttons: promptButtons(payload),
    timeoutSeconds: payload.timeout,
  });
}

function overrideKey(requestId) {
  return `${requestId}:gm`;
}

function gmOverride(requestId, plan, parts) {
  const buttons = plan.candidates.map((_candidate, index) => ({
    value: `force-${index}`, hidden: true, result: { intercept: true, autoMove: true, shieldBlock: false, forced: true, index },
  }));
  buttons.push({ value: "skip", label: "Apply to ally", icon: "fa-solid fa-forward", style: "danger", result: { halt: true } });
  return timedPrompt({
    key: overrideKey(requestId),
    title: "Intercept Attack — GM",
    icon: "fa-solid fa-hourglass-half",
    body: overrideBoardBody({
      allyName: plan.ally.name,
      allyImg: plan.allyToken.texture?.src ?? plan.ally.img,
      parts,
      candidates: plan.candidates.map((candidate) => ({
        name: candidate.guardian.name,
        img: candidate.guardian.img,
        userName: candidate.user?.name ?? "nobody online",
        distance: candidate.distance,
      })),
    }),
    buttons,
  });
}

function markRow(requestId, index, status) {
  overrideRowStatus(openPrompt(overrideKey(requestId))?.element, index, status);
}

function firstAcceptance(requestId, prompts, override) {
  return new Promise((resolve) => {
    let remaining = prompts.length;
    if (!remaining) resolve(null);
    for (const { promise, index } of prompts) {
      promise.then((result) => {
        markRow(requestId, index, result?.intercept ? "accepted" : result ? "declined" : "timeout");
        if (result?.intercept) resolve({ ...result, index });
        else if (--remaining === 0) resolve(null);
      }, (error) => {
        console.warn(`${MODULE_ID} | intercept prompt failed`, error);
        markRow(requestId, index, "timeout");
        if (--remaining === 0) resolve(null);
      });
    }
    override?.then((result) => {
      if (result?.halt) resolve(null);
      else if (result?.intercept) resolve(result);
    });
  });
}

function askCandidate(candidate, payload) {
  if (!candidate.user) return Promise.resolve(null);
  return requestOperation("intercept-prompt", payload, {
    authorityUserId: candidate.user.id,
    directed: true,
    timeoutMs: (payload.timeout + 10) * 1000,
  });
}

async function buildRoll(template, instances) {
  const formula = damageFormula(instances);
  if (!formula) return null;
  const DamageRoll = template.constructor;
  return new DamageRoll(formula, template.options ? { ...template.options } : {}).evaluate();
}

function movementFor(candidate) {
  if (candidate.distance <= 5) return "adjacent";
  return candidate.sourceTaunted && candidate.distance > 10 ? "stride" : "step";
}

/** Ask eligible guardians, then redirect the damage. Returns null when nobody intercepts. */
async function runIntercept(ally, options, plan) {
  const requestId = foundry.utils.randomID();
  const timeout = Number(setting("interceptTimeout")) || 30;
  const allyImg = plan.allyToken.texture?.src ?? ally.img;
  const prompts = plan.candidates.map((candidate, index) => ({
    index,
    promise: askCandidate(candidate, {
      requestId,
      guardianUuid: candidate.guardian.uuid,
      guardianName: candidate.guardian.name,
      guardianImg: candidate.guardian.img,
      allyName: ally.name,
      allyImg,
      attackerName: plan.attacker?.name ?? null,
      attackerImg: plan.attacker?.img ?? null,
      parts: damageParts(candidate.partition.intercepted),
      keeps: damageParts(candidate.partition.remainder),
      distance: candidate.distance,
      movement: movementFor(candidate),
      pool: reactionPool(candidate.guardian),
      shieldBlock: shieldBlockOption({ shieldReady: canShieldBlock(candidate.guardian), reactionsLeft: reactionsLeft(candidate.guardian) }),
      getBehindMe: hasSlug(candidate.guardian, "get-behind-me"),
      timeout,
    }),
  }));
  const remote = plan.candidates.some((candidate) => candidate.user && candidate.user.id !== game.user.id);
  const parts = damageParts(options.damage.instances);
  const override = game.user.isGM && remote ? gmOverride(requestId, plan, parts) : null;
  const decision = await firstAcceptance(requestId, prompts, override);
  broadcast("intercept-dismiss", { requestId });
  if (!decision) return null;

  const candidate = plan.candidates[decision.index];
  const { intercepted, remainder } = candidate.partition;
  const guardianRoll = remainder.length ? await buildRoll(options.damage, intercepted) : options.damage;
  const remainderRoll = remainder.length ? await buildRoll(options.damage, remainder) : null;
  const rollOptions = [...(options.rollOptions ?? [])].filter((option) => !/^(?:self|target)(?::|$)/.test(option));
  const resolver = candidate.user?.active ? candidate.user : game.user;
  try {
    await requestOperation("intercept-resolve", {
      guardianUuid: candidate.guardian.uuid,
      guardianTokenUuid: candidate.token.uuid,
      allyTokenUuid: plan.allyToken.uuid,
      allyName: ally.name,
      allyImg,
      damage: guardianRoll.toJSON(),
      parts: damageParts(intercepted),
      itemUuid: options.item?.uuid ?? null,
      outcome: options.outcome ?? null,
      rollOptions,
      sourceTaunted: candidate.sourceTaunted,
      autoMove: decision.autoMove !== false && setting("interceptAutoMove"),
      shieldBlock: Boolean(decision.shieldBlock),
      forced: Boolean(decision.forced),
      // A GM-forced interception keeps the feat's default (move the ally) since nobody was asked.
      getBehindMe: decision.forced ? true : Boolean(decision.getBehindMe),
      attackerTokenUuid: plan.attackerToken?.uuid ?? null,
      attackerName: plan.attacker?.name ?? null,
      ...attackFacts(options.item),
    }, { authorityUserId: resolver.id, directed: true, timeoutMs: 60_000 });
  } catch (error) {
    notify("error", `Intercept Attack failed: ${error.message} ${ally.name} takes the damage instead.`);
    return null;
  }
  return { remainder: remainderRoll };
}

async function planIntercept(actor, options) {
  if (!setting("interceptEnabled") || options?.[INTERCEPTED] || options?.final) return null;
  const damage = options?.damage;
  if (!damage || typeof damage === "number" || !Array.isArray(damage.instances)) return null;
  if (!(Number(damage.total) > 0)) return null;
  const allyToken = tokenDocument(options.token) ?? sceneTokenFor(actor);
  if (!allyToken?.parent) return null;
  const attacker = options.item?.actor ?? null;
  const candidates = findInterceptors({ ally: actor, allyToken, damage, attacker });
  if (!candidates.length) return null;
  const attackerToken = attacker ? sceneTokenFor(attacker, allyToken.parent) : null;
  return { candidates, ally: actor, allyToken, attacker, attackerToken };
}

async function resolveIntercept(payload) {
  const tokenDoc = await fromUuid(payload.guardianTokenUuid);
  const guardian = tokenDoc?.actor ?? await fromUuid(payload.guardianUuid);
  if (!guardian) throw new Error("The intercepting guardian is unavailable.");
  const allyToken = await fromUuid(payload.allyTokenUuid);
  const attackerToken = payload.attackerTokenUuid ? await fromUuid(payload.attackerTokenUuid) : null;
  const notes = [];

  if (allyToken && tokenDoc) {
    if (tokenDistance(tokenDoc, allyToken) > 5 && immobilized(guardian)) {
      notes.push("cannot move while immobilized");
    } else {
      const budget = interceptMovementBudget({ sourceTaunted: payload.sourceTaunted, speed: landSpeed(guardian) });
      // "I'll move" (or auto-move turned off): the player picks the square, limited to the same budget.
      const movement = payload.autoMove
        ? await moveAdjacent(tokenDoc, allyToken, { budget, attackerToken })
        : await pickAdjacent(tokenDoc, allyToken, { budget, attackerToken, label: payload.sourceTaunted && budget > 5 ? "Stride" : "Step" });
      if (movement.moved) notes.push(`${payload.sourceTaunted && movement.cost > 5 ? "Strides" : "Steps"} ${movement.cost} feet`);
      else if (movement.reason === "no-space") notes.push("no open square adjacent to the ally; move manually");
      else if (movement.reason === "unsupported-grid") notes.push("move manually (gridless or hex scene)");
      else if (movement.reason === "stayed") notes.push("stays in place");
    }
  }

  const wanted = payload.shieldBlock ? 2 : 1;
  const spent = await spendReactions(guardian, wanted);
  // Shield Block costs its own reaction; without it, only the interception happens.
  const shieldBlock = shieldBlockApplies({ requested: payload.shieldBlock, spent, forced: payload.forced });
  if (spent < wanted) {
    if (payload.forced) notes.push("GM override beyond tracked reactions");
    else notes.push(spent === 0 ? "no reaction was left" : "no reaction left for Shield Block");
  }

  await spendFrequency(guardian);
  const feats = new Set(guardian.items.map((entry) => entry.slug));
  const followUps = interceptFollowUps({
    feats,
    meleeWeaponAttack: payload.meleeWeaponAttack,
    meleeStrike: payload.meleeStrike,
    adjacentToAttacker: Boolean(tokenDoc && attackerToken && tokenDistance(tokenDoc, attackerToken) <= 5),
  });
  const moveAlly = followUps.getBehindMe && payload.getBehindMe && allyToken;
  if (moveAlly) notes.push(`Get Behind Me!: ${payload.allyName} can be moved up to 10 feet`);
  if (followUps.quickVengeance) notes.push(await grantQuickVengeance(guardian, payload.attackerName, combatantFor(guardian)));

  // Roll.fromData resolves the serialized class (PF2e's DamageRoll) through CONFIG.Dice.rolls.
  const roll = Roll.fromData(payload.damage);
  const item = payload.itemUuid ? await fromUuid(payload.itemUuid).catch(() => null) : null;
  const rollOptions = new Set([...payload.rollOptions, ...(guardian.getSelfRollOptions?.() ?? []), "intercept-attack"]);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: guardian, token: tokenDoc }),
    content: interceptCard({
      actionUuid: SYSTEM_UUIDS.interceptAttack,
      guardianName: guardian.name,
      guardianImg: guardian.img,
      allyName: payload.allyName,
      allyImg: payload.allyImg,
      parts: payload.parts,
      forced: payload.forced,
      notes,
      pool: reactionPool(guardian),
      followUps: [
        followUps.disarmingIntercept && { kind: "disarm", label: "Disarming Intercept", glyph: "F" },
        followUps.armoredCounterattack && { kind: "counterattack", label: "Armored Counterattack", glyph: "F" },
      ].filter(Boolean),
      guardianUuid: guardian.uuid,
      attackerTokenUuid: attackerToken?.uuid ?? null,
    }),
    flags: { [MODULE_ID]: { card: "intercept", intercept: { guardianUuid: guardian.uuid } } },
  });

  await guardian.applyDamage({
    damage: roll,
    token: tokenDoc,
    item,
    rollOptions,
    shieldBlockRequest: shieldBlock,
    outcome: payload.outcome,
    [INTERCEPTED]: true,
  });
  if (shieldBlock && attackerToken) {
    void afterShieldBlock(guardian, tokenDoc, attackerToken).catch((error) => notify("error", `Shield Block follow-up: ${error.message}`));
  }
  // The square picker waits on the player, so it runs after the damage is settled and the
  // requesting client has its answer; a slow choice can never double-apply the damage.
  if (moveAlly) {
    void getBehindMe({ guardianToken: tokenDoc, allyToken, attackerToken })
      .then((note) => note && notify("info", note))
      .catch((error) => notify("error", `Get Behind Me! failed: ${error.message}`));
  }
  return true;
}

/** Guardian's Intercept: spend one use of a limited-frequency Intercept Attack. */
async function spendFrequency(guardian) {
  const action = itemBySlug(guardian, SLUGS.interceptAttack, "action");
  const frequency = action?.system?.frequency;
  if (!frequency || !Number.isFinite(Number(frequency.max))) return;
  await action.update({ "system.frequency.value": Math.max(0, Number(frequency.value ?? frequency.max) - 1) });
}

function applyDamageOwner() {
  let prototype = CONFIG.PF2E.Actor.documentClasses.character.prototype;
  while (prototype && !Object.prototype.hasOwnProperty.call(prototype, "applyDamage")) prototype = Object.getPrototypeOf(prototype);
  return prototype;
}

export function registerInterceptAttack() {
  registerOperation("intercept-prompt", (payload) => promptGuardian(payload));
  registerOperation("intercept-resolve", (payload) => resolveIntercept(payload));
  registerListener("intercept-dismiss", ({ requestId }) => dismissPrompts(`${requestId}:`));

  const prototype = applyDamageOwner();
  if (!prototype || prototype[WRAPPED]) return;
  const applyDamage = prototype.applyDamage;
  prototype.applyDamage = async function (options = {}, ...args) {
    const hpBefore = this.hitPoints?.value ?? null;
    const conditionsBefore = (this.itemTypes?.condition ?? []).map((condition) => condition.slug);
    const apply = async (applied) => {
      // Shield Salvation needs to know that a shield takes damage from a Shield Block.
      const result = applied?.shieldBlockRequest
        ? await duringShieldBlock(this, () => applyDamage.call(this, applied, ...args))
        : await applyDamage.call(this, applied, ...args);
      // Keep Up the Good Fight and native Shield Block react to the damage that actually landed.
      void afterDamage(this, applied, hpBefore, conditionsBefore).catch((error) => console.error(`${MODULE_ID} | after damage`, error));
      return result;
    };
    let plan = null;
    try {
      plan = await planIntercept(this, options);
    } catch (error) {
      console.error(`${MODULE_ID} | could not check Intercept Attack`, error);
    }
    if (!plan) return apply(options);
    const outcome = await runIntercept(this, options, plan);
    if (!outcome) return apply(options);
    if (outcome.remainder) return apply({ ...options, damage: outcome.remainder });
    return this;
  };
  prototype[WRAPPED] = true;
}
