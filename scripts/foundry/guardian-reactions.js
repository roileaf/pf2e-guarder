import { MODULE_ID } from "../constants.js";
import { degreeOfSuccess, frequencyAvailable, OUTCOMES } from "../domain/followups.js";
import {
  attackFacts, clangApplies, isHit, keepUpTriggers, leftSquareInReach, NOT_SO_FAST, reactiveShieldApplies,
  reactiveStrikeOnAttack, shieldFromArrowsApplies, toughToKillClamp,
} from "../domain/guardian-reactions.js";
import { setting } from "../settings.js";
import { dismissPrompts, timedPrompt } from "../ui/prompt.js";
import { reactionCard, reactionPromptBody } from "../ui/views.js";
import {
  alive, controllingUser, gridDistance, hasCondition, hasSlug, incapacitated, isAlly, isEnemy, itemBySlug, landSpeed,
  notify, sceneTokenFor, tokenDistance,
} from "./actors.js";
import { actorReach, grantQuickVengeance, strikeBack } from "./followups.js";
import { combatantFor, reactionPool, reactionsLeft, spendReactions } from "./reactions.js";
import { broadcast, isResponsibleGM, registerListener, registerOperation, requestOperation } from "./socket.js";
import { moveToward } from "./unbelievable.js";
import { sundryCountsPostedReactions, sundryCountsStrikes } from "./sundry.js";
import { setHamperingStance } from "./hampering.js";

const ATTACK_TYPES = ["attack-roll", "spell-attack-roll"];
const KEEP_UP_EFFECT = "Compendium.pf2e.feat-effects.Item.AwJBbxeoE0YhmT57";
const OFF_GUARD = "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg";

const OUTCOME_LABEL = { criticalSuccess: "Critical hit", success: "Hit", failure: "Miss", criticalFailure: "Critical miss" };

// ---------------------------------------------------------------- prompting

function eligible(guardian) {
  return guardian && alive(guardian) && !incapacitated(guardian) && reactionsLeft(guardian) > 0;
}

function guardiansOn(scene, slugs) {
  const seen = new Set();
  const found = [];
  for (const token of scene?.tokens ?? []) {
    const actor = token.actor;
    if (!actor || seen.has(actor.uuid) || actor.type !== "character") continue;
    seen.add(actor.uuid);
    if (slugs.some((slug) => hasSlug(actor, slug)) && eligible(actor)) found.push({ guardian: actor, token });
  }
  return found;
}

function promptPayload(candidate, requestId, view) {
  return {
    requestId,
    guardianUuid: candidate.guardian.uuid,
    guardianName: candidate.guardian.name,
    guardianImg: candidate.guardian.img,
    pool: reactionPool(candidate.guardian),
    timeout: Number(setting("interceptTimeout")) || 30,
    ...view,
  };
}

async function showPrompt(payload) {
  const buttons = payload.buttons.map((button, index) => ({ ...button, default: index === 0, result: { choice: button.value } }));
  buttons.push({ value: "decline", label: "Decline", icon: "fa-solid fa-xmark", result: { choice: null } });
  return timedPrompt({
    key: `${payload.requestId}:${payload.guardianUuid}`,
    title: payload.title,
    icon: payload.icon ?? "fa-solid fa-shield-halved",
    body: reactionPromptBody(payload),
    buttons,
    timeoutSeconds: payload.timeout,
  });
}

/** Prompt every candidate at once; resolves with the first { candidate, choice } that accepts. */
function askFirst(entries) {
  const requestId = foundry.utils.randomID();
  return new Promise((resolve) => {
    let remaining = entries.length;
    const finish = (value) => {
      broadcast("guardian-reaction-dismiss", { requestId });
      resolve(value);
    };
    if (!remaining) return resolve(null);
    for (const { candidate, view } of entries) {
      const payload = promptPayload(candidate, requestId, view);
      const user = controllingUser(candidate.guardian, setting("interceptPromptTarget"));
      const ask = user
        ? requestOperation("guardian-reaction-prompt", payload, { authorityUserId: user.id, directed: true, timeoutMs: (payload.timeout + 10) * 1000 })
        : Promise.resolve(null);
      ask.then((result) => {
        if (result?.choice) finish({ candidate, choice: result.choice, user });
        else if (--remaining === 0) finish(null);
      }, () => {
        if (--remaining === 0) finish(null);
      });
    }
  });
}

function resolveOn(decision, payload) {
  const user = decision.user?.active ? decision.user : game.user;
  return requestOperation("guardian-reaction-resolve", { ...payload, choice: decision.choice }, { authorityUserId: user.id, directed: true, timeoutMs: 120_000 });
}

async function postCard(guardian, view, flags = {}) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: guardian }),
    content: reactionCard({ guardianName: guardian.name, guardianImg: guardian.img, pool: reactionPool(guardian), ...view }),
    flags: { [MODULE_ID]: { card: "reaction", ...flags } },
  });
}

// ---------------------------------------------------------------- resolution (guardian's client)

async function annotateAttack(messageId, outcome, note) {
  await requestOperation("annotate-attack", { messageId, outcome, note }, { gmRequired: true });
}

async function grantOffGuardUntilMyNextTurnEnd(enemy, guardian) {
  const source = {
    name: `Effect: Clang! (${guardian.name})`,
    type: "effect",
    img: "icons/skills/melee/shield-block-bash-blue.webp",
    system: {
      description: { value: `<p>Off-guard until the end of ${foundry.utils.escapeHTML(guardian.name)}'s next turn.</p>` },
      // Counted from the guardian's initiative: lasts until the end of the guardian's next turn.
      duration: { expiry: "turn-end", sustained: false, unit: "rounds", value: 1 },
      start: { value: game.time.worldTime, initiative: combatantFor(guardian)?.initiative ?? null },
      rules: [{ key: "GrantItem", inMemoryOnly: true, uuid: OFF_GUARD }],
      tokenIcon: { show: true },
      traits: { rarity: "common", value: [] },
    },
  };
  await requestOperation("grant-effect", { actorUuid: enemy.uuid, source }, { gmRequired: true });
}

const RESOLVERS = {
  async "shield-from-arrows"(guardian, payload) {
    await spendReactions(guardian, 1);
    const degree = degreeOfSuccess(payload.total, payload.dc + 4, payload.die);
    const outcome = OUTCOMES[degree];
    const deflected = isHit(payload.outcome) && !isHit(outcome);
    // The roll already happened, so the +4 is applied by re-grading it rather than through PF2e's effect.
    await annotateAttack(payload.messageId, outcome, `Shield from Arrows: +4 AC from ${guardian.name} (${payload.total} vs ${payload.dc + 4}) — ${OUTCOME_LABEL[outcome]}.`);
    await postCard(guardian, {
      eyebrow: "Shield from Arrows",
      headline: `${guardian.name} shields ${payload.targetName}`,
      chips: [{ text: `${payload.total} vs AC ${payload.dc + 4}`, icon: "fa-solid fa-dice-d20" }, { text: OUTCOME_LABEL[outcome], class: `outcome ${outcome}` }],
      notes: deflected ? ["Deflected with the shield."] : [],
    });
    return { outcome };
  },

  async "reactive-shield"(guardian, payload) {
    await spendReactions(guardian, 1);
    await game.pf2e?.actions?.raiseAShield?.({ actors: [guardian] });
    const bonus = Number(guardian.attributes?.shield?.ac ?? 2) || 2;
    const degree = degreeOfSuccess(payload.total, payload.dc + bonus, payload.die);
    const outcome = OUTCOMES[degree];
    await annotateAttack(payload.messageId, outcome, `Reactive Shield: ${guardian.name} raises a shield (+${bonus} AC; ${payload.total} vs ${payload.dc + bonus}) — ${OUTCOME_LABEL[outcome]}.`);
    await postCard(guardian, {
      eyebrow: "Reactive Shield",
      headline: `${guardian.name} snaps the shield into place`,
      chips: [{ text: `${payload.total} vs AC ${payload.dc + bonus}`, icon: "fa-solid fa-dice-d20" }, { text: OUTCOME_LABEL[outcome], class: `outcome ${outcome}` }],
    });
    return { outcome };
  },

  async clang(guardian, payload) {
    await spendReactions(guardian, 1, { sundry: payload.choice !== "strike" || !sundryCountsStrikes() });
    const attackerToken = await fromUuid(payload.attackerTokenUuid);
    const guardianToken = await fromUuid(payload.guardianTokenUuid);
    const notes = [];
    if (payload.choice === "strike") {
      await strikeBack(guardian, attackerToken);
      notes.push(`Strikes ${attackerToken?.name ?? "the attacker"}.`);
    } else if (guardianToken && attackerToken) {
      const moved = await moveToward(guardianToken, attackerToken, landSpeed(guardian));
      notes.push(moved ? `Strides ${moved} feet toward ${attackerToken.name}.` : "No open square closer to the attacker.");
      if (tokenDistance(guardianToken, attackerToken) <= 5 && attackerToken.actor) {
        await grantOffGuardUntilMyNextTurnEnd(attackerToken.actor, guardian);
        notes.push(`${attackerToken.name} is off-guard until the end of ${guardian.name}'s next turn.`);
      }
    }
    await postCard(guardian, { eyebrow: "Clang!", headline: `The blow glances off ${guardian.name}'s armor`, notes });
    return {};
  },

  async "reactive-strike"(guardian, payload) {
    await spendReactions(guardian, 1, { sundry: !sundryCountsStrikes() });
    const attackerToken = await fromUuid(payload.attackerTokenUuid);
    const roll = await strikeBack(guardian, attackerToken);
    const outcome = OUTCOMES[roll?.degreeOfSuccess ?? -1];
    const notes = [`Trigger: ${payload.triggerText}.`];
    if (payload.manipulate && outcome === "criticalSuccess") notes.push("Critical hit: the manipulate action is disrupted.");
    await postCard(guardian, { eyebrow: "Reactive Strike", headline: `${guardian.name} punishes ${attackerToken?.name ?? "the opening"}`, notes });
    return { outcome };
  },

  async "not-so-fast"(guardian, payload) {
    await spendReactions(guardian, 1, { sundry: !sundryCountsStrikes() });
    const attackerToken = await fromUuid(payload.attackerTokenUuid);
    const roll = await strikeBack(guardian, attackerToken);
    const outcome = OUTCOMES[roll?.degreeOfSuccess ?? -1];
    await postCard(guardian, {
      eyebrow: "Not So Fast!",
      headline: `${guardian.name} lashes out at ${attackerToken?.name ?? "the mover"}`,
      notes: outcome ? [NOT_SO_FAST[outcome]] : ["Strike cancelled."],
    });
    return { outcome };
  },

  async "keep-up-the-good-fight"(guardian, payload) {
    const item = itemBySlug(guardian, "keep-up-the-good-fight");
    const woundedOf = () => Number(guardian.itemTypes?.condition?.find((condition) => condition.slug === "wounded")?.value ?? 0);
    const woundedBefore = woundedOf();
    await spendReactions(guardian, 1);
    await guardian.update({ "system.attributes.hp.value": 1 });
    // Undo only the knock-out conditions that came with this hit (some modules add them at 0 HP).
    const before = new Set(payload.conditionsBefore ?? []);
    for (const slug of ["dying", "unconscious", "prone"]) {
      if (!before.has(slug) && hasCondition(guardian, slug)) await guardian.decreaseCondition?.(slug, { forceRemove: true });
    }
    // Removing dying may already raise wounded (PF2e Workbench); never add it twice.
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (woundedOf() <= woundedBefore) await guardian.increaseCondition?.("wounded");
    const template = await fromUuid(KEEP_UP_EFFECT);
    if (template) {
      const source = template.toObject();
      delete source._id;
      await guardian.createEmbeddedDocuments("Item", [source]);
    }
    const frequency = item?.system?.frequency;
    if (frequency?.max) await item.update({ "system.frequency.value": Math.max(0, Number(frequency.value ?? frequency.max) - 1) });
    await postCard(guardian, {
      eyebrow: "Keep Up the Good Fight",
      headline: `${guardian.name} refuses to fall`,
      notes: ["Back to 1 HP, wounded +1, temporary HP equal to level for 1 round."],
    });
    return {};
  },
};

async function resolveReaction(payload) {
  const guardian = await fromUuid(payload.guardianUuid);
  const resolver = RESOLVERS[payload.kind];
  if (!guardian || !resolver) throw new Error("This guardian reaction can't be resolved here.");
  return resolver(guardian, payload);
}

// ---------------------------------------------------------------- triggers

function attackDamageType(item) {
  return item?.system?.damage?.damageType
    ?? Object.values(item?.system?.damageRolls ?? {})[0]?.damageType
    ?? null;
}

async function onAttackRoll(message) {
  const context = message.flags?.pf2e?.context;
  if (!ATTACK_TYPES.includes(context?.type) || message.author?.id !== game.user.id) return;
  const attacker = message.actor;
  const targetToken = message.target?.token;
  const target = message.target?.actor;
  if (!attacker || !targetToken?.parent || !target) return;
  const scene = targetToken.parent;
  const attackerToken = message.token ?? sceneTokenFor(attacker, scene);
  const roll = message.rolls?.[0];
  const attack = attackFacts({
    type: context.type,
    options: context.options ?? [],
    itemRanged: message.item ? Boolean(message.item.isRanged ?? message.item.system?.range) : null,
    damageType: attackDamageType(message.item),
  });
  const base = {
    messageId: message.id,
    total: roll?.total ?? 0,
    die: roll?.dice?.[0]?.total ?? null,
    dc: Number(context.dc?.value ?? target.attributes?.ac?.value ?? 10),
    attackerTokenUuid: attackerToken?.uuid ?? null,
    targetUuid: target.uuid,
    targetName: targetToken.name,
  };
  let outcome = context.outcome;
  const strip = (extra = []) => ({
    attackerName: attackerToken?.name ?? attacker.name,
    attackerImg: attackerToken?.texture?.src ?? attacker.img,
    targetName: targetToken.name,
    targetImg: targetToken.texture?.src ?? target.img,
    chips: [{ text: `${base.total} to hit`, icon: "fa-solid fa-dice-d20" }, ...extra],
  });

  // 1. Shield from Arrows: protect an adjacent ally against a ranged attack.
  // Only worth a reaction when the attack currently hits.
  const arrows = !isHit(outcome) ? [] : guardiansOn(scene, ["shield-from-arrows"]).filter(({ guardian, token }) =>
    isEnemy(guardian, attacker) && isAlly(guardian, target)
    && shieldFromArrowsApplies({
      attack,
      adjacentToTarget: tokenDistance(token, targetToken) <= 5,
      shieldRaised: Boolean(guardian.attributes?.shield?.raised),
      offGuard: hasCondition(guardian, "off-guard"),
      shieldFromSpells: hasSlug(guardian, "shield-from-spells"),
      targetIsGuardian: guardian.uuid === target.uuid,
    }));
  if (arrows.length) {
    const decision = await askFirst(arrows.map((candidate) => ({ candidate, view: {
      title: "Shield from Arrows", eyebrow: "Shield from Arrows", ...strip(),
      facts: [{ icon: "fa-solid fa-shield", text: `${targetToken.name} gains +4 AC against this attack (AC ${base.dc} → ${base.dc + 4}).` }],
      buttons: [{ value: "go", label: "Shield them", icon: "fa-solid fa-shield", style: "primary" }],
    } })));
    if (decision) outcome = (await resolveOn(decision, { ...base, kind: "shield-from-arrows", guardianUuid: decision.candidate.guardian.uuid, outcome }))?.outcome ?? outcome;
  }

  // 2. Reactive Shield: the guardian is hit by a melee Strike.
  const shielders = guardiansOn(scene, ["reactive-shield"]).filter(({ guardian }) => reactiveShieldApplies({
    attack, targetIsGuardian: guardian.uuid === target.uuid, outcome,
    hasShield: Boolean(guardian.attributes?.shield?.itemId), shieldRaised: Boolean(guardian.attributes?.shield?.raised),
  }));
  if (shielders.length) {
    const bonus = Number(shielders[0].guardian.attributes?.shield?.ac ?? 2) || 2;
    const decision = await askFirst(shielders.map((candidate) => ({ candidate, view: {
      title: "Reactive Shield", eyebrow: "Reactive Shield", ...strip([{ text: OUTCOME_LABEL[outcome] }]),
      facts: [{ icon: "fa-solid fa-shield", text: `Raise a Shield: AC ${base.dc} → ${base.dc + bonus} against this Strike (${base.total} to hit).` }],
      buttons: [{ value: "go", label: "Raise shield", icon: "fa-solid fa-shield", style: "primary" }],
    } })));
    if (decision) outcome = (await resolveOn(decision, { ...base, kind: "reactive-shield", guardianUuid: decision.candidate.guardian.uuid, outcome }))?.outcome ?? outcome;
  }

  // 3. Clang!: the attack critically missed the guardian.
  const clangers = guardiansOn(scene, ["clang"]).filter(({ guardian }) => clangApplies({ attack, targetIsGuardian: guardian.uuid === target.uuid, outcome }));
  if (clangers.length && attackerToken) {
    const decision = await askFirst(clangers.map((candidate) => ({ candidate, view: {
      title: "Clang!", eyebrow: "Clang!", ...strip([{ text: "Critical miss" }]),
      facts: [{ icon: "fa-solid fa-hand-fist", text: "Strike the attacker, or Stride toward it; ending adjacent makes it off-guard until the end of your next turn." }],
      buttons: [
        { value: "strike", label: "Strike", icon: "fa-solid fa-hand-fist", style: "primary" },
        { value: "stride", label: "Stride toward", icon: "fa-solid fa-person-running" },
      ],
    } })));
    if (decision) await resolveOn(decision, { ...base, kind: "clang", guardianUuid: decision.candidate.guardian.uuid, guardianTokenUuid: decision.candidate.token.uuid });
  }

  // 4. Reactive Strike: a ranged attack made within the guardian's reach.
  if (attackerToken) {
    const strikers = guardiansOn(scene, ["reactive-strike"]).filter(({ guardian, token }) =>
      guardian.uuid !== attacker.uuid && isEnemy(guardian, attacker)
      && reactiveStrikeOnAttack({ attack, attackerDistance: tokenDistance(token, attackerToken), reach: actorReach(guardian) }));
    await offerReactiveStrike(strikers, attackerToken, "made a ranged attack within reach");
  }
}

async function offerReactiveStrike(strikers, attackerToken, triggerText, { manipulate = false, notSoFast = [] } = {}) {
  const entries = new Map();
  for (const candidate of strikers) entries.set(candidate.guardian.uuid, { candidate, buttons: [{ value: "reactive-strike", label: "Reactive Strike", icon: "fa-solid fa-khanda", style: "primary" }] });
  for (const candidate of notSoFast) {
    const entry = entries.get(candidate.guardian.uuid) ?? { candidate, buttons: [] };
    entry.buttons.push({ value: "not-so-fast", label: "Not So Fast!", icon: "fa-solid fa-hand", style: entry.buttons.length ? "subtle" : "primary" });
    entries.set(candidate.guardian.uuid, entry);
  }
  if (!entries.size) return;
  const decision = await askFirst([...entries.values()].map(({ candidate, buttons }) => ({ candidate, view: {
    title: "Reaction", eyebrow: buttons.map((button) => button.label).join(" / "),
    attackerName: attackerToken.name, attackerImg: attackerToken.texture?.src, targetName: candidate.guardian.name, targetImg: candidate.guardian.img,
    chips: [{ text: triggerText }],
    facts: [{ icon: "fa-solid fa-khanda", text: `${attackerToken.name} ${triggerText}.` }],
    buttons,
  } })));
  if (!decision) return;
  await resolveOn(decision, {
    kind: decision.choice, guardianUuid: decision.candidate.guardian.uuid,
    attackerTokenUuid: attackerToken.uuid, triggerText: `${attackerToken.name} ${triggerText}`, manipulate,
  });
}

/** Manipulate actions (spells, Interact, item actions) used within a guardian's reach. */
async function onActionMessage(message) {
  // Spell cards carry context type "spell-cast"; other context types are rolls, not the action itself.
  const contextType = message.flags?.pf2e?.context?.type;
  if (message.author?.id !== game.user.id || (contextType && contextType !== "spell-cast")) return;
  const item = message.item;
  const traits = item?.system?.traits?.value ?? [];
  if (!item || !traits.includes("manipulate")) return;
  const actor = message.actor;
  const actorToken = message.token ?? sceneTokenFor(actor);
  if (!actor || !actorToken?.parent) return;
  const strikers = guardiansOn(actorToken.parent, ["reactive-strike"]).filter(({ guardian, token }) =>
    isEnemy(guardian, actor) && tokenDistance(token, actorToken) <= actorReach(guardian));
  await offerReactiveStrike(strikers, actorToken, `used a manipulate action (${item.name}) within reach`, { manipulate: true });
}

function footprintAt(document, point) {
  const size = Number(document.parent?.grid?.size ?? 100) || 100;
  return {
    col: Math.round(Number(point.x ?? document.x) / size),
    row: Math.round(Number(point.y ?? document.y) / size),
    w: Math.max(1, Math.round(Number(point.width ?? document.width) || 1)),
    h: Math.max(1, Math.round(Number(point.height ?? document.height) || 1)),
  };
}

function inHamperingStance(actor) {
  return (actor.itemTypes?.effect ?? []).some((effect) => effect.slug?.includes("hampering-stance"));
}

/** Reactive Strike / Not So Fast!: a creature leaves a square within a guardian's reach while moving. */
async function onTokenMove(document, movement, _operation, user) {
  if (!isResponsibleGM(user?.id)) return;
  const waypoints = movement?.passed?.waypoints ?? [];
  if (!waypoints.length || waypoints.at(-1)?.action === "displace" || waypoints.some((point) => point.action === "displace")) return;
  const mover = document.actor;
  if (!mover || !document.parent) return;
  const left = [movement.origin, ...waypoints.slice(0, -1)].filter(Boolean).map((point) => footprintAt(document, point));
  const grid = gridDistance(document.parent);
  const inReach = ({ guardian, token }) => guardian.uuid !== mover.uuid && isEnemy(guardian, mover)
    && leftSquareInReach({ squares: left, guardian: footprintAt(token, token), reach: actorReach(guardian), gridDistance: grid });
  const strikers = guardiansOn(document.parent, ["reactive-strike"]).filter(inReach);
  const notSoFast = guardiansOn(document.parent, ["not-so-fast"]).filter((candidate) => inHamperingStance(candidate.guardian) && inReach(candidate));
  await offerReactiveStrike(strikers, document, "left a square within reach", { notSoFast });
}

/** Called by the damage wrapper after damage lands: Keep Up the Good Fight and native Shield Block. */
export async function afterDamage(actor, options, hpBefore, conditionsBefore = []) {
  const guardian = actor?.isToken ? actor : game.actors?.get(actor?.id) ?? actor;
  if (!guardian || guardian.type !== "character") return;
  const hpAfter = guardian.hitPoints?.value ?? guardian.system?.attributes?.hp?.value;
  const attacker = options.item?.actor ?? null;
  // PF2e's own Shield Block (damage card button) spends a reaction and triggers Quick Vengeance.
  if (options.shieldBlockRequest && !options[`${MODULE_ID}.intercepted`] && guardian.attributes?.shield?.raised && hasSlug(guardian, "shield-block")) {
    await spendReactions(guardian, 1);
    if (hasSlug(guardian, "quick-vengeance")) await grantQuickVengeance(guardian, attacker?.name, combatantFor(guardian));
  }
  const item = itemBySlug(guardian, "keep-up-the-good-fight");
  // The guardian is at 0 HP here by definition, and modules such as PF2e Workbench may already have
  // applied dying/unconscious for it: only conditions from other sources block the reaction.
  const blocking = ["paralyzed", "stunned", "petrified"].some((slug) => hasCondition(guardian, slug));
  if (!item || !frequencyAvailable(item.system?.frequency) || blocking || reactionsLeft(guardian) <= 0) return;
  // PF2e reports a character at 0 HP without dying as "dead" for a moment; only maxed-out dying is death here.
  const dying = guardian.attributes?.dying;
  const dead = Boolean(dying && Number(dying.max) > 0 && Number(dying.value) >= Number(dying.max));
  if (!keepUpTriggers({ hpBefore, hpAfter, dead, fromEnemy: !attacker || isEnemy(guardian, attacker) })) return;
  const token = sceneTokenFor(guardian);
  const decision = await askFirst([{ candidate: { guardian, token }, view: {
    title: "Keep Up the Good Fight", eyebrow: "Keep Up the Good Fight",
    facts: [{ icon: "fa-solid fa-heart-pulse", text: `Instead of being knocked out: 1 HP, wounded +1, and ${guardian.level} temporary HP for 1 round.` }],
    buttons: [{ value: "go", label: "Keep fighting", icon: "fa-solid fa-heart-pulse", style: "primary" }],
  } }]);
  if (decision) await resolveOn(decision, { kind: "keep-up-the-good-fight", guardianUuid: guardian.uuid, conditionsBefore });
}

// ---------------------------------------------------------------- Tough to Kill

function today() {
  return Math.floor(Number(game.time?.worldTime ?? 0) / 86_400);
}

function clampDying(item, value) {
  const actor = item.parent;
  if (item.slug !== "dying" || !actor || !hasSlug(actor, "tough-to-kill")) return null;
  const result = toughToKillClamp({ value, usedDay: actor.flags?.[MODULE_ID]?.toughToKill, today: today() });
  return result.used ? result : null;
}

function markToughToKill(actor) {
  void actor.update({ [`flags.${MODULE_ID}.toughToKill`]: today() }).then(() => ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: reactionCard({ guardianName: actor.name, guardianImg: actor.img, glyph: null, eyebrow: "Tough to Kill", headline: `${actor.name} stays at dying 2`, notes: ["First time today reaching dying 3 or more."], pool: reactionPool(actor) }),
    flags: { [MODULE_ID]: { card: "reaction" } },
  }));
}

// ---------------------------------------------------------------- registration

export function registerGuardianReactions() {
  registerOperation("guardian-reaction-prompt", (payload) => showPrompt(payload));
  registerOperation("guardian-reaction-resolve", (payload) => resolveReaction(payload));
  registerListener("guardian-reaction-dismiss", ({ requestId }) => dismissPrompts(`${requestId}:`));
  registerOperation("annotate-attack", async ({ messageId, outcome, note }) => {
    const message = game.messages.get(messageId);
    if (!message) throw new Error("The attack message is gone.");
    const flavor = `${message.flavor ?? ""}<p class="guarder-retarget-note"><i class="fa-solid fa-shield"></i> ${foundry.utils.escapeHTML(note)}</p>`;
    await message.update({ flavor, "flags.pf2e.context.outcome": outcome, [`flags.${MODULE_ID}.outcomeChanged`]: true });
    return true;
  });
  registerOperation("grant-effect", async ({ actorUuid, source }) => {
    const actor = await fromUuid(actorUuid);
    if (!actor) throw new Error("Actor not found.");
    await actor.createEmbeddedDocuments("Item", [source]);
    return true;
  });

  Hooks.on("createChatMessage", (message) => {
    if (!setting("interceptEnabled")) return;
    void (async () => {
      await onAttackRoll(message);
      await onActionMessage(message);
      await onStanceOrReactionPosted(message);
    })().catch((error) => notify("error", `Guardian reaction: ${error.message}`));
  });
  Hooks.on("moveToken", (document, movement, operation, user) => {
    if (!setting("interceptEnabled")) return;
    void onTokenMove(document, movement, operation, user).catch((error) => notify("error", `Guardian reaction: ${error.message}`));
  });

  Hooks.on("preCreateItem", (item, data) => {
    const clamp = clampDying(item, Number(data.system?.value?.value ?? 1));
    if (!clamp) return;
    item.updateSource({ "system.value.value": clamp.value });
    markToughToKill(item.parent);
  });
  Hooks.on("preUpdateItem", (item, changes) => {
    const value = foundry.utils.getProperty(changes, "system.value.value");
    if (value === undefined) return;
    const clamp = clampDying(item, Number(value));
    if (!clamp) return;
    foundry.utils.setProperty(changes, "system.value.value", clamp.value);
    markToughToKill(item.parent);
  });
}

/**
 * Native reactions posted to chat (e.g. a reaction feat from the sheet) spend a tracked reaction;
 * Hampering Stance posted from the sheet starts the stance Not So Fast! needs.
 */
async function onStanceOrReactionPosted(message) {
  if (message.author?.id !== game.user.id || message.flags?.[MODULE_ID]) return;
  const item = message.item;
  const actor = message.actor;
  if (!item || !actor || actor.type !== "character" || message.flags?.pf2e?.context?.type) return;
  if (item.slug === "hampering-stance") {
    if (!inHamperingStance(actor)) await setHamperingStance(actor, true);
    return;
  }
  // Sundry's own tracker already marks reaction items posted to chat.
  if (item.system?.actionType?.value === "reaction" && reactionPool(actor)) await spendReactions(actor, 1, { sundry: !sundryCountsPostedReactions() });
}
