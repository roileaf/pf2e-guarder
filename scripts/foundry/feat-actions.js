// Guardian feat actions run when the feat is posted to chat by its owner (sheet, macro, chat card).
// The player targets the enemy first; PF2e rolls every Strike and save, and Guarder applies the results.
import { MODULE_ID, SLUGS } from "../constants.js";
import {
  bloodyDenialResult, devastatingWallopResult, hourOf, isCoverShield, isHitDegree, momentumPositions, pushAwayPosition, ringTheirBellResult,
  shieldWallopResult, shoulderCheckResult, stompGroundResult, weakeningAssaultResult,
} from "../domain/feat-rules.js";
import { timedPrompt } from "../ui/prompt.js";
import { reactionCard } from "../ui/views.js";
import { pickSquare } from "../canvas/square-picker.js";
import {
  footprint, gridDistance, hasCondition, hasSlug, isEnemy, isTauntedBy, itemBySlug, notify, sceneTokenFor, tokenDistance,
  tokenDocument, wallBlocksMove,
} from "./actors.js";
import { combatantFor, reactionPool } from "./reactions.js";
import { actorReach, strikeWith } from "./followups.js";
import { activeStance } from "./hampering.js";
import { controllingUser } from "./actors.js";
import { isResponsibleGM } from "./socket.js";
import { setting } from "../settings.js";
import { tauntTokens } from "./taunt.js";
import { registerOperation, requestOperation } from "./socket.js";
import { coverRules } from "./visioner.js";
import { creatureDistance, footprintOf, overlaps } from "../domain/geometry.js";

export const CONDITION_UUIDS = Object.freeze({
  "off-guard": "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg",
  enfeebled: "Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7",
  frightened: "Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL",
  stunned: "Compendium.pf2e.conditionitems.Item.dfCMdR4wnpbYNTix",
  stupefied: "Compendium.pf2e.conditionitems.Item.e1XGnhKNSQIm5IXg",
  immobilized: "Compendium.pf2e.conditionitems.Item.eIcWbB5o3pP6OIMe",
  prone: "Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60",
});

const DURATIONS = {
  "next-turn-start": { expiry: "turn-start", value: 1 },
  "next-turn-end": { expiry: "turn-end", value: 1 },
  "turn-end": { expiry: "turn-end", value: 0 },
};
const UNTIL_TEXT = {
  "next-turn-start": "until the start of {g}'s next turn",
  "next-turn-end": "until the end of {g}'s next turn",
  "turn-end": "until the end of this turn",
};

// ---------------------------------------------------------------- primitives

function escape(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

async function confirmOverride(featName, problem) {
  return timedPrompt({
    title: featName,
    icon: "fa-solid fa-triangle-exclamation",
    body: `<p class="guarder-hint">${escape(problem)}</p>`,
    buttons: [
      { value: "go", label: "Use it anyway", icon: "fa-solid fa-check", style: "primary", result: true },
      { value: "cancel", label: "Cancel", icon: "fa-solid fa-xmark", default: true, result: false },
    ],
  });
}

/** Requirements: each { ok, text }. Unmet ones ask whether to continue. */
async function requirementsMet(featName, checks) {
  const unmet = checks.filter((check) => !check.ok).map((check) => check.text);
  if (!unmet.length) return true;
  return confirmOverride(featName, `Requirements not met: ${unmet.join("; ")}.`);
}

/**
 * Apply one planned result to an actor through the GM: a timed condition becomes an effect that
 * grants it (and removes it on expiry), an untimed one is added directly, a note becomes a reminder effect.
 */
async function applyPlan(actor, guardian, featName, plan) {
  if (!actor) return null;
  if (plan.condition && !plan.until) {
    await requestOperation("add-condition", { actorUuid: actor.uuid, slug: plan.condition, value: plan.value ?? null }, { gmRequired: true });
    return `${actor.name}: ${plan.condition}${plan.value ? ` ${plan.value}` : ""}`;
  }
  const duration = DURATIONS[plan.until] ?? DURATIONS["next-turn-start"];
  const label = plan.condition ? `${plan.condition}${plan.value ? ` ${plan.value}` : ""}` : plan.note;
  const until = (UNTIL_TEXT[plan.until] ?? "").replace("{g}", guardian.name);
  const rules = plan.condition ? [{
    key: "GrantItem", inMemoryOnly: true, uuid: CONDITION_UUIDS[plan.condition],
    ...(plan.value ? { alterations: [{ mode: "override", property: "badge-value", value: plan.value }] } : {}),
  }] : [];
  const description = `${label}${plan.condition && plan.note ? ` (${plan.note})` : ""} ${until}.`;
  await requestOperation("grant-effect", {
    actorUuid: actor.uuid,
    source: {
      name: `Effect: ${featName} (${guardian.name})`,
      type: "effect",
      img: guardian.items.find((item) => item.name === featName)?.img ?? "icons/svg/aura.svg",
      system: {
        slug: `guarder-${featName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        description: { value: `<p>${escape(description)}</p>` },
        duration: { ...duration, sustained: false, unit: "rounds" },
        // Counted from the guardian's initiative: "your next turn" is the guardian's.
        start: { value: game.time.worldTime, initiative: combatantFor(guardian)?.initiative ?? null },
        rules,
        tokenIcon: { show: true },
        traits: { rarity: "common", value: [] },
      },
      flags: { [MODULE_ID]: { featEffect: true, guardianUuid: guardian.uuid } },
    },
  }, { gmRequired: true });
  return `${actor.name}: ${description}`;
}

async function applyPlans(plans, { guardian, target, featName }) {
  const notes = [];
  for (const plan of plans) {
    const note = await applyPlan(plan.on === "guardian" ? guardian : target, guardian, featName, plan);
    if (note) notes.push(note);
  }
  return notes;
}

function classDC(guardian) {
  return Number(guardian.classDCs?.guardian?.dc?.value ?? guardian.classDC?.dc?.value ?? guardian.system?.attributes?.classDC?.value ?? 10);
}

/** The target rolls a save against the guardian's class DC on the GM's client. Returns the degree (0-3) or null. */
async function rollSave(target, guardian, { save, item, traits = [], modifiers = [], options = [] }) {
  const result = await requestOperation("roll-save", {
    actorUuid: target.uuid, save, dc: classDC(guardian), itemUuid: item?.uuid ?? null, originUuid: guardian.uuid, traits, modifiers, options,
  }, { gmRequired: true });
  return Number.isInteger(result?.degree) ? result.degree : null;
}

const DEGREE_LABEL = ["Critical failure", "Failure", "Success", "Critical success"];
const HIT_LABEL = ["Critical miss", "Miss", "Hit", "Critical hit"];

async function postCard(guardian, item, { headline, notes = [], buttons = "" }) {
  const glyph = item?.system?.actionType?.value === "free" ? "F" : String(item?.system?.actions?.value ?? 1);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: guardian }),
    content: reactionCard({ guardianName: guardian.name, guardianImg: guardian.img, pool: reactionPool(guardian), glyph, eyebrow: item?.name ?? "Guardian", headline, notes }) + buttons,
    flags: { [MODULE_ID]: { card: "feat", feat: item?.slug ?? null } },
  });
}

/** The single enemy the player targeted, or null with a warning. */
function singleTarget(ctx, featName) {
  const targets = ctx.targets.filter((token) => token.actor && isEnemy(ctx.actor, token.actor));
  if (targets.length !== 1) {
    notify("warn", `${featName}: target exactly one enemy, then use it again.`);
    return null;
  }
  return targets[0];
}

async function raiseShield(actor) {
  if (!actor.attributes?.shield?.itemId) return "no shield to raise";
  if (actor.attributes.shield.raised) return "shield already raised";
  await game.pf2e?.actions?.raiseAShield?.({ actors: [actor] });
  return "Raises a Shield";
}

function degreeOf(roll) {
  return Number.isInteger(roll?.degreeOfSuccess) ? roll.degreeOfSuccess : null;
}

function wearsHeavyArmor(actor) {
  return ["medium", "heavy"].includes(actor.wornArmor?.category);
}

function tauntedOffGuard(enemy) {
  return hasCondition(enemy, "off-guard") || (enemy.itemTypes?.effect ?? []).some((effect) => effect.slug === SLUGS.tauntOffGuardEffect);
}

function followUpButton(kind, label, guardian, extra = {}) {
  const data = Object.entries({ guardian: guardian.uuid, ...extra }).map(([key, value]) => `data-${key}="${escape(value)}"`).join(" ");
  return `<button type="button" class="guarder-card-button" data-guarder-followup="${kind}" ${data}>${escape(label)}</button>`;
}

function buttonRow(buttons) {
  return buttons.length ? `<div class="guarder-card-actions">${buttons.join("")}</div>` : "";
}

// ---------------------------------------------------------------- feats

const FEATS = {
  async "taunting-strike"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target) return;
    const degree = degreeOf(await strikeWith(ctx.actor, target));
    await tauntTokens({ guardian: ctx.actor, guardianToken: ctx.token, item: itemBySlug(ctx.actor, SLUGS.taunt, "action"), targets: [target] });
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} draws ${target.name}'s attention`, notes: [degree === null ? "Strike cancelled." : HIT_LABEL[degree], `${target.name} is taunted.`] });
  },

  async "shielding-taunt"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target) return;
    const shield = await raiseShield(ctx.actor);
    await tauntTokens({ guardian: ctx.actor, guardianToken: ctx.token, item: itemBySlug(ctx.actor, SLUGS.taunt, "action"), targets: [target] });
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} bangs on the shield`, notes: [shield, `${target.name} is taunted.`] });
  },

  async "shoulder-check"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target || !await requirementsMet(ctx.item.name, [{ ok: wearsHeavyArmor(ctx.actor), text: "wear medium or heavy armor" }])) return;
    const degree = degreeOf(await strikeWith(ctx.actor, target, { kind: "fist" }));
    if (degree === null) return;
    const notes = await applyPlans(shoulderCheckResult(degree), { guardian: ctx.actor, target: target.actor, featName: ctx.item.name });
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} checks ${target.name} with armor`, notes: [HIT_LABEL[degree], ...notes] });
  },

  async "shield-wallop"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target || !await requirementsMet(ctx.item.name, [{ ok: Boolean(ctx.actor.attributes?.shield?.itemId), text: "wield a shield" }])) return;
    const degree = degreeOf(await strikeWith(ctx.actor, target, { kind: "shield" }));
    if (degree === null) return;
    const shield = ctx.actor.items.get(ctx.actor.attributes.shield.itemId);
    const cover = isCoverShield(shield?.slug);
    const notes = [HIT_LABEL[degree], ...await applyPlans(shieldWallopResult(degree, cover), { guardian: ctx.actor, target: target.actor, featName: ctx.item.name })];
    // Devastating Shield Wallop: after the other effects, the target saves.
    if (isHitDegree(degree) && hasSlug(ctx.actor, "devastating-shield-wallop")) {
      const save = await rollSave(target.actor, ctx.actor, {
        save: "fortitude", item: itemBySlug(ctx.actor, "devastating-shield-wallop"),
        modifiers: cover ? [{ slug: "devastating-shield-wallop", label: "Devastating Shield Wallop", modifier: -2, type: "circumstance" }] : [],
      });
      if (save !== null) {
        notes.push(`Devastating Shield Wallop: ${DEGREE_LABEL[save]}`);
        notes.push(...await applyPlans(devastatingWallopResult(save), { guardian: ctx.actor, target: target.actor, featName: "Devastating Shield Wallop" }));
      }
    }
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} wallops ${target.name}`, notes });
  },

  async "weakening-assault"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target || !await requirementsMet(ctx.item.name, [{ ok: isTauntedBy(target.actor, ctx.actor), text: `${target.name} must be affected by your Taunt` }])) return;
    const first = degreeOf(await strikeWith(ctx.actor, target, { variant: 0 }));
    const second = degreeOf(await strikeWith(ctx.actor, target, { variant: 1 }));
    const degrees = [first, second].filter((degree) => degree !== null);
    const notes = await applyPlans(weakeningAssaultResult(degrees), { guardian: ctx.actor, target: target.actor, featName: ctx.item.name });
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} batters ${target.name}`, notes: [degrees.map((degree) => HIT_LABEL[degree]).join(", "), ...notes] });
  },

  async "ring-their-bell"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target) return;
    const ok = await requirementsMet(ctx.item.name, [
      { ok: wearsHeavyArmor(ctx.actor), text: "wear medium or heavy armor" },
      { ok: isTauntedBy(target.actor, ctx.actor) && tauntedOffGuard(target.actor), text: `${target.name} must be your taunted enemy, off-guard for ignoring you` },
    ]);
    if (!ok) return;
    const degree = degreeOf(await strikeWith(ctx.actor, target, { kind: "fist" }));
    if (degree === null) return;
    const notes = [HIT_LABEL[degree]];
    if (isHitDegree(degree)) {
      const save = await rollSave(target.actor, ctx.actor, { save: "fortitude", item: ctx.item, traits: ["incapacitation"] });
      if (save !== null) notes.push(`Fortitude: ${DEGREE_LABEL[save]}`, ...await applyPlans(ringTheirBellResult(save), { guardian: ctx.actor, target: target.actor, featName: ctx.item.name }));
    }
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} rings ${target.name}'s bell`, notes });
  },

  async "bloody-denial"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target) return;
    const degree = degreeOf(await strikeWith(ctx.actor, target));
    if (degree === null) return;
    const notes = [HIT_LABEL[degree]];
    if (isHitDegree(degree)) {
      const save = await rollSave(target.actor, ctx.actor, { save: "fortitude", item: ctx.item });
      if (save !== null) {
        const result = bloodyDenialResult(save, degree === 3);
        notes.push(`Fortitude: ${DEGREE_LABEL[save]}${result.degree !== save ? ` → ${DEGREE_LABEL[result.degree]} (critical hit)` : ""}`);
        notes.push(...await applyPlans(result.effects, { guardian: ctx.actor, target: target.actor, featName: ctx.item.name }));
      }
    }
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} denies ${target.name}`, notes });
  },

  async "lock-down"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target || !await requirementsMet(ctx.item.name, [{ ok: activeStance(ctx.actor) === "hampering-stance", text: "be in Hampering Stance" }])) return;
    const degree = degreeOf(await strikeWith(ctx.actor, target));
    if (degree === null) return;
    const notes = [HIT_LABEL[degree]];
    if (isHitDegree(degree)) {
      notes.push(...await applyPlans([{ on: "target", note: "can't use move actions to leave the reach of the weapon used (ends early if the guardian moves or attacks with it again)", until: "next-turn-start" }],
        { guardian: ctx.actor, target: target.actor, featName: ctx.item.name }));
    }
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} locks ${target.name} down`, notes });
  },

  async "belly-flop"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target) return;
    const ok = await requirementsMet(ctx.item.name, [
      { ok: wearsHeavyArmor(ctx.actor), text: "wear medium or heavy armor" },
      { ok: hasCondition(target.actor, "prone") && tokenDistance(ctx.token, target) <= 5, text: `${target.name} must be prone and adjacent` },
    ]);
    if (!ok) return;
    await ctx.actor.increaseCondition?.("prone");
    // Belly Flop ignores the attack penalty from being prone.
    const ModifierPF2e = game.pf2e?.Modifier;
    const modifiers = ModifierPF2e ? [new ModifierPF2e({ slug: "belly-flop", label: "Belly Flop (no prone penalty)", modifier: 2, type: "circumstance" })] : [];
    const degree = degreeOf(await strikeWith(ctx.actor, target, { kind: "fist", modifiers }));
    if (degree === null) return;
    const notes = [HIT_LABEL[degree]];
    if (isHitDegree(degree)) {
      const armorBonus = Number(ctx.actor.wornArmor?.acBonus ?? 0);
      notes.push(...await applyPlans([{ on: "target", condition: "immobilized", until: null }], { guardian: ctx.actor, target: target.actor, featName: ctx.item.name }));
      notes.push(`Escape DC: add +${armorBonus} (armor item bonus) to ${ctx.actor.name}'s Athletics. Ends if ${ctx.actor.name} Stands or moves.`);
    }
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} flops onto ${target.name}`, notes });
  },

  async "stomp-ground"(ctx) {
    const scene = ctx.token?.parent;
    if (!scene) return notify("warn", `${ctx.item.name}: ${ctx.actor.name} must be on the scene.`);
    const creatures = [...scene.tokens].filter((token) => token.actor && token.id !== ctx.token.id && !token.hidden && tokenDistance(ctx.token, token) <= 5);
    const notes = [];
    for (const token of creatures) {
      const save = await rollSave(token.actor, ctx.actor, { save: "reflex", item: ctx.item, options: ["area-effect", "damaging-effect"] });
      if (save === null) continue;
      const result = stompGroundResult(save);
      notes.push(`${token.name}: ${DEGREE_LABEL[save]}`, ...await applyPlans(result.effects, { guardian: ctx.actor, target: token.actor, featName: ctx.item.name }));
      if (result.damage) {
        await requestOperation("apply-damage", { actorUuid: token.actor.uuid, tokenUuid: token.uuid, formula: result.damage }, { gmRequired: true });
        notes.push(`${token.name} takes falling damage (${result.damage.replace(/\[.*\]/, "")}).`);
      }
    }
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} stomps the ground`, notes: creatures.length ? notes : ["No creature within 5 feet."] });
  },

  async "armored-courage"(ctx) {
    const hour = hourOf(game.time.worldTime);
    const ok = await requirementsMet(ctx.item.name, [
      { ok: wearsHeavyArmor(ctx.actor), text: "wear medium or heavy armor" },
      { ok: ctx.actor.flags?.[MODULE_ID]?.armoredCourage !== hour, text: "once per hour (already used this hour)" },
    ]);
    if (!ok) return;
    const amount = Number(ctx.actor.level) || 1;
    await ctx.actor.createEmbeddedDocuments("Item", [{
      name: "Effect: Armored Courage", type: "effect", img: ctx.item.img,
      system: {
        slug: "guarder-armored-courage",
        description: { value: `<p>${amount} temporary Hit Points for 1 minute.</p>` },
        duration: { expiry: "turn-start", sustained: false, unit: "minutes", value: 1 },
        start: { value: game.time.worldTime, initiative: combatantFor(ctx.actor)?.initiative ?? null },
        rules: [{ key: "TempHP", value: amount }],
        tokenIcon: { show: true },
        traits: { rarity: "common", value: [] },
      },
    }]);
    const frightened = hasCondition(ctx.actor, "frightened");
    if (frightened) await ctx.actor.decreaseCondition?.("frightened");
    await ctx.actor.update({ [`flags.${MODULE_ID}.armoredCourage`]: hour });
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} takes heart in the armor`, notes: [`${amount} temporary Hit Points for 1 minute.`, ...(frightened ? ["Frightened reduced by 1."] : [])] });
  },

  async "guarded-advance"(ctx) {
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} advances behind the shield`, notes: [await raiseShield(ctx.actor), "Step twice (move your token)."] });
  },

  async "shielded-attrition"(ctx) {
    const shield = await raiseShield(ctx.actor);
    const notes = await applyPlans([{ on: "guardian", note: "enemies that could react to this movement can't react to your allies' movement", until: "next-turn-start" }], { guardian: ctx.actor, target: null, featName: ctx.item.name });
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} draws the enemy's reactions`, notes: [shield, "Stride up to half your Speed (move your token); it triggers reactions as normal.", ...notes] });
  },

  async "blanket-defense"(ctx) {
    if (!await requirementsMet(ctx.item.name, [{ ok: Boolean(ctx.actor.attributes?.shield?.itemId), text: "wield a shield" }])) return;
    const shield = await raiseShield(ctx.actor);
    const notes = await applyPlans([{ on: "guardian", note: "adjacent allies who end their turn next to you get your raised shield's benefits; you can Shield Block a hit against any adjacent ally", until: "next-turn-start" }], { guardian: ctx.actor, target: null, featName: ctx.item.name });
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} becomes a bulwark`, notes: [shield, ...notes] });
  },

  async "defensive-advance"(ctx) {
    const shield = await raiseShield(ctx.actor);
    await postCard(ctx.actor, ctx.item, {
      headline: `${ctx.actor.name} dives into battle`,
      notes: [shield, "Stride (move your token), then Strike an enemy in reach."],
      buttons: buttonRow([followUpButton("strike-in-reach", "Strike an enemy in reach", ctx.actor)]),
    });
  },

  async "juggernaut-charge"(ctx) {
    if (!await requirementsMet(ctx.item.name, [{ ok: wearsHeavyArmor(ctx.actor), text: "wear medium or heavy armor" }])) return;
    await postCard(ctx.actor, ctx.item, {
      headline: `${ctx.actor.name} charges`,
      notes: ["Stride (move your token), Strike an enemy in reach, then Stride again: on a damaging hit, move that enemy the same way."],
      buttons: buttonRow([followUpButton("strike-in-reach", "Strike an enemy in reach", ctx.actor)]),
    });
  },

  async "retaliating-rescue"(ctx) {
    await postCard(ctx.actor, ctx.item, {
      headline: `${ctx.actor.name} rushes to the rescue`,
      notes: ["Stride next to an ally within an enemy's reach (move your token), push the ally 5 feet, then Strike. +2 if the push took the ally out of that enemy's reach."],
      buttons: buttonRow([
        followUpButton("push-ally", "Push an adjacent ally 5 ft", ctx.actor),
        followUpButton("strike-in-reach", "Strike", ctx.actor),
        followUpButton("strike-in-reach", "Strike (+2, ally pushed out of reach)", ctx.actor, { bonus: 2 }),
      ]),
    });
  },

  async "scattering-charge"(ctx) {
    if (!await requirementsMet(ctx.item.name, [{ ok: wearsHeavyArmor(ctx.actor), text: "wear medium or heavy armor" }])) return;
    await postCard(ctx.actor, ctx.item, {
      headline: `${ctx.actor.name} scatters the enemy line`,
      notes: ["Stride up to your Speed (move your token), then Shove up to three creatures in reach; the penalty only increases after all three."],
      buttons: buttonRow([followUpButton("shove-in-reach", "Shove creatures in reach", ctx.actor)]),
    });
  },

  async "momentum-strike"(ctx) {
    const target = singleTarget(ctx, ctx.item.name);
    if (!target) return;
    const degree = degreeOf(await strikeWith(ctx.actor, target));
    if (degree === null) return;
    const notes = [HIT_LABEL[degree]];
    if (isHitDegree(degree)) notes.push(await momentumMove(ctx.actor, ctx.token, target, degree === 3 ? 10 : 5));
    await postCard(ctx.actor, ctx.item, { headline: `${ctx.actor.name} drives ${target.name} back`, notes });
  },
};

/** Momentum Strike's move: the player picks a square within reach; walls and creatures block it. */
async function momentumMove(guardian, guardianToken, targetToken, budget) {
  const target = tokenDocument(targetToken);
  const scene = target.parent;
  const candidates = momentumPositions({
    guardian: footprint(guardianToken), target: footprint(target), reach: actorReach(guardian), budget, gridDistance: gridDistance(scene),
    blocked: (candidate) => [...scene.tokens].some((token) => token.id !== target.id && token.id !== tokenDocument(guardianToken).id && !token.hidden && overlaps(candidate, footprint(token))) || wallBlocksMove(target, candidate),
  });
  if (!candidates.length) return "No open square to move the target to.";
  const position = await pickSquare({ candidates, timeoutMs: 40_000, prompt: `Momentum Strike: click where ${target.name} goes (up to ${budget} ft, within your reach). Enter takes the brightest square; Escape leaves it.` });
  if (!position) return `${target.name} stays in place.`;
  const size = Number(scene.grid?.size ?? 100) || 100;
  await requestOperation("move-token", { tokenUuid: target.uuid, x: position.col * size, y: position.row * size }, { gmRequired: true });
  return `${target.name} is moved ${position.cost} feet. (Moving it into another creature is resolved at the table.)`;
}

/** Run a posted feat's automation. Returns true when the feat was handled. */
export async function runFeatAction(message) {
  const item = message.item;
  const handler = FEATS[item?.slug];
  if (!handler) return false;
  const actor = message.actor;
  const token = tokenDocument(message.token) ?? sceneTokenFor(actor);
  await handler({ actor, item, token, message, targets: [...(game.user.targets ?? [])].map((target) => target.document) });
  return true;
}

export const AUTOMATED_FEAT_ACTIONS = Object.keys(FEATS);

// ---------------------------------------------------------------- card buttons and GM operations

function enemiesInReach(guardian, guardianToken) {
  const scene = guardianToken?.parent;
  return [...(scene?.tokens ?? [])].filter((token) => token.actor && !token.hidden && isEnemy(guardian, token.actor)
    && tokenDistance(guardianToken, token) <= actorReach(guardian));
}

async function chooseTokens(title, tokens, max = 1) {
  // A single option needs no question; with several, the player picks (Scattering Charge may shove fewer than all).
  if (tokens.length <= 1) return tokens;
  const picked = await timedPrompt({
    title,
    icon: "fa-solid fa-crosshairs",
    body: `<p class="guarder-hint">Choose ${max === 1 ? "one" : `up to ${max}`}:</p><ul class="guarder-rows">${tokens.map((token) =>
      `<li class="guarder-row"><label class="guarder-check"><input type="checkbox" name="pick" value="${escape(token.uuid)}"> ${escape(token.name)}</label></li>`).join("")}</ul>`,
    buttons: [{ value: "ok", label: "Confirm", icon: "fa-solid fa-check", style: "primary", default: true,
      result: (element) => [...element.querySelectorAll("input[name=pick]:checked")].slice(0, max).map((input) => input.value) }],
  });
  return (picked ?? []).map((uuid) => tokens.find((token) => token.uuid === uuid)).filter(Boolean);
}

// ---------------------------------------------------------------- Shield Block follow-ups

const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];

function sizeIndex(actor) {
  return SIZES.indexOf(actor?.size ?? actor?.system?.traits?.size?.value ?? "med");
}

/** Prompt `user` with buttons through the guardian prompt window; resolves with the chosen value or null. */
async function askUser(user, guardian, { title, eyebrow, glyph = "F", facts, buttons }) {
  if (!user) return null;
  const timeout = Number(setting("interceptTimeout")) || 30;
  const result = await requestOperation("guardian-reaction-prompt", {
    requestId: foundry.utils.randomID(), guardianUuid: guardian.uuid, guardianName: guardian.name, guardianImg: guardian.img,
    pool: null, hidePool: true, timeout, title, eyebrow, glyph, facts, buttons,
  }, { authorityUserId: user.id, directed: true, timeoutMs: (timeout + 10) * 1000 }).catch(() => null);
  return result?.choice ?? null;
}

/** Aggressive Block: the triggering creature chooses to be shoved 5 feet or become off-guard (the GM answers for it). */
async function aggressiveBlock(guardian, guardianToken, attackerToken) {
  const attacker = attackerToken.actor;
  if (sizeIndex(attacker) > sizeIndex(guardian)) return;
  const scene = attackerToken.parent;
  const target = footprint(attackerToken);
  const push = pushAwayPosition({
    guardian: footprint(guardianToken), target,
    blocked: (candidate) => [...scene.tokens].some((token) => token.id !== attackerToken.id && !token.hidden && overlaps(candidate, footprint(token))) || wallBlocksMove(attackerToken, candidate),
  });
  const buttons = [{ value: "off-guard", label: "Off-guard", icon: "fa-solid fa-shield-halved", style: push ? "subtle" : "primary" }];
  if (push) buttons.unshift({ value: "shove", label: "Shoved 5 ft", icon: "fa-solid fa-arrows-left-right", style: "primary" });
  const choice = await askUser(controllingUser(attacker, "gm"), guardian, {
    title: "Aggressive Block", eyebrow: `Aggressive Block (${attackerToken.name} chooses)`,
    facts: [{ icon: "fa-solid fa-shield", text: push
      ? `${guardian.name} pushes back: ${attackerToken.name} is shoved 5 feet away, or becomes off-guard until the start of ${guardian.name}'s next turn.`
      : `${attackerToken.name} can't be shoved (blocked), so it becomes off-guard until the start of ${guardian.name}'s next turn.` }],
    buttons,
  }) ?? (push ? null : "off-guard");
  if (!choice) return;
  const notes = [];
  if (choice === "shove" && push) {
    const size = Number(scene.grid?.size ?? 100) || 100;
    await requestOperation("move-token", { tokenUuid: attackerToken.uuid, x: push.col * size, y: push.row * size }, { gmRequired: true });
    notes.push(`${attackerToken.name} is shoved 5 feet.`);
  } else {
    notes.push(...await applyPlans([{ on: "target", condition: "off-guard", until: "next-turn-start" }], { guardian, target: attacker, featName: "Aggressive Block" }));
  }
  await postCard(guardian, itemBySlug(guardian, "aggressive-block"), { headline: `${guardian.name} pushes back as it blocks`, notes });
}

/**
 * After a Shield Block (PF2e's button or Intercept Attack's toggle) against `attackerToken`:
 * Aggressive Block and Repositioning Block, when the attacker is adjacent.
 */
export async function afterShieldBlock(guardian, guardianToken, attackerToken) {
  guardianToken = tokenDocument(guardianToken) ?? sceneTokenFor(guardian);
  attackerToken = tokenDocument(attackerToken);
  if (!guardianToken || !attackerToken?.actor || tokenDistance(guardianToken, attackerToken) > 5) return;
  if (hasSlug(guardian, "aggressive-block")) await aggressiveBlock(guardian, guardianToken, attackerToken);
  if (hasSlug(guardian, "repositioning-block")) {
    await postCard(guardian, itemBySlug(guardian, "repositioning-block"), {
      headline: `${guardian.name} turns ${attackerToken.name}'s momentum`,
      notes: ["Free action: Reposition the attacker; no free hand needed. The shield's item bonus applies."],
      buttons: buttonRow([followUpButton("reposition", `Reposition ${attackerToken.name}`, guardian, { attacker: attackerToken.uuid })]),
    });
  }
}

// ---------------------------------------------------------------- Covering Stance

const COVER_SLUG = "guarder-covering-stance-cover";

/** At the end of the guardian's turn in Covering Stance, its player picks an adjacent ally to cover. */
async function coverAlly(guardian, guardianToken) {
  const allies = [...guardianToken.parent.tokens].filter((token) => token.actor && token.id !== guardianToken.id && !token.hidden
    && !isEnemy(guardian, token.actor) && token.actor.uuid !== guardian.uuid && tokenDistance(guardianToken, token) <= 5);
  if (!allies.length) return;
  const choice = await askUser(controllingUser(guardian, setting("interceptPromptTarget")), guardian, {
    title: "Covering Stance", eyebrow: "Covering Stance", glyph: "F",
    facts: [{ icon: "fa-solid fa-shield", text: `Choose an adjacent ally: lesser cover until the start of ${guardian.name}'s next turn (lost if they move away).` }],
    buttons: allies.map((token, index) => ({ value: token.uuid, label: token.name, icon: "fa-solid fa-user-shield", style: index ? "subtle" : "primary" })),
  });
  const ally = allies.find((token) => token.uuid === choice);
  if (!ally) return;
  await requestOperation("grant-effect", {
    actorUuid: ally.actor.uuid,
    source: {
      name: `Effect: Covering Stance (${guardian.name})`, type: "effect", img: itemBySlug(guardian, "covering-stance")?.img ?? "icons/svg/shield.svg",
      system: {
        slug: COVER_SLUG,
        description: { value: `<p>Lesser cover from ${escape(guardian.name)} until the start of their next turn. Lost if you move to a space not adjacent to them.</p>` },
        duration: { expiry: "turn-start", sustained: false, unit: "rounds", value: 1 },
        start: { value: game.time.worldTime, initiative: combatantFor(guardian)?.initiative ?? null },
        // With PF2E Visioner the cover goes through Visioner, so its indicators and attack messages show it.
        rules: coverRules("lesser", "covering-stance", "Covering Stance (lesser cover)"),
        tokenIcon: { show: true },
        traits: { rarity: "common", value: [] },
      },
      flags: { [MODULE_ID]: { covering: { guardianUuid: guardian.uuid, guardianTokenUuid: guardianToken.uuid } } },
    },
  }, { gmRequired: true });
}

/**
 * A covered ally that moves to a space no longer adjacent to its guardian loses the cover.
 * `destination` is where the movement ends (the token's own position isn't updated yet when it starts).
 */
async function dropCoverIfAway(tokenDocumentMoved, destination) {
  const actor = tokenDocumentMoved.actor;
  const covers = (actor?.itemTypes?.effect ?? []).filter((effect) => effect.slug === COVER_SLUG);
  if (!covers.length) return;
  const size = Number(tokenDocumentMoved.parent?.grid?.size ?? 100) || 100;
  const allyAt = footprintOf({
    x: destination?.x ?? tokenDocumentMoved.x, y: destination?.y ?? tokenDocumentMoved.y,
    width: destination?.width ?? tokenDocumentMoved.width, height: destination?.height ?? tokenDocumentMoved.height,
  }, size);
  for (const effect of covers) {
    const guardianToken = fromUuidSync(effect.flags?.[MODULE_ID]?.covering?.guardianTokenUuid);
    const distance = guardianToken ? creatureDistance(footprint(guardianToken), allyAt, gridDistance(tokenDocumentMoved.parent)) : Infinity;
    if (distance > 5) await effect.delete();
  }
}

/** Card follow-ups for movement feats; returns true when handled. */
export async function runFeatFollowUp(kind, button, guardian) {
  const guardianToken = sceneTokenFor(guardian);
  if (!guardianToken) return notify("warn", `${guardian.name} is not on the viewed scene.`), true;
  if (kind === "strike-in-reach") {
    const [target] = await chooseTokens("Strike which enemy?", enemiesInReach(guardian, guardianToken));
    if (!target) return notify("warn", "No enemy within reach."), true;
    const bonus = Number(button.dataset.bonus ?? 0);
    const ModifierPF2e = game.pf2e?.Modifier;
    const modifiers = bonus && ModifierPF2e ? [new ModifierPF2e({ slug: "retaliating-rescue", label: "Retaliating Rescue", modifier: bonus, type: "circumstance" })] : [];
    await strikeWith(guardian, target, { modifiers });
    return true;
  }
  if (kind === "shove-in-reach") {
    const targets = await chooseTokens("Shove which creatures? (up to three)", enemiesInReach(guardian, guardianToken), 3);
    const shove = game.pf2e?.actions?.get?.("shove");
    if (!shove) return notify("warn", "PF2e's Shove action is unavailable."), true;
    // One multiple attack penalty for all three: it only increases after every attempt.
    for (const target of targets) {
      target.object?.setTarget(true, { releaseOthers: true });
      await shove.use({ actors: [guardian], target: target.object, event: new MouseEvent("click"), multipleAttackPenalty: 0 });
    }
    return true;
  }
  if (kind === "reposition") {
    const target = await fromUuid(button.dataset.attacker);
    const reposition = game.pf2e?.actions?.get?.("reposition");
    if (!target?.object || !reposition) return notify("warn", "The target or PF2e's Reposition action is unavailable."), true;
    target.object.setTarget(true, { releaseOthers: true });
    await reposition.use({ actors: [guardian], target: target.object, event: new MouseEvent("click"), rollOptions: ["repositioning-block"] });
    return true;
  }
  if (kind === "push-ally") {
    const allies = [...guardianToken.parent.tokens].filter((token) => token.actor && token.id !== guardianToken.id && !isEnemy(guardian, token.actor) && tokenDistance(guardianToken, token) <= 5);
    const [ally] = await chooseTokens("Push which ally?", allies);
    if (!ally) return notify("warn", "No adjacent ally to push."), true;
    notify("info", await momentumMove(guardian, guardianToken, ally, 5));
    return true;
  }
  return false;
}

export function registerFeatActionOperations() {
  // Covering Stance: the guardian's turn just ended.
  Hooks.on("updateCombat", (combat, changed, _options, userId) => {
    if (!("turn" in changed) && !("round" in changed)) return;
    if (!isResponsibleGM(userId)) return;
    const previous = combat.combatants.get(combat.previous?.combatantId);
    const guardian = previous?.actor;
    if (!guardian || activeStance(guardian) !== "covering-stance") return;
    const guardianToken = previous.token ?? sceneTokenFor(guardian);
    if (guardianToken) void coverAlly(guardian, guardianToken).catch((error) => notify("error", `Covering Stance: ${error.message}`));
  });
  Hooks.on("moveToken", (document, movement, _operation, user) => {
    if (isResponsibleGM(user?.id)) void dropCoverIfAway(document, movement?.destination).catch((error) => console.warn(`${MODULE_ID} | Covering Stance`, error));
  });
  registerOperation("add-condition", async ({ actorUuid, slug, value }) => {
    const actor = await fromUuid(actorUuid);
    if (!actor) throw new Error("Actor not found.");
    const existing = actor.itemTypes?.condition?.find((condition) => condition.slug === slug);
    if (existing && value) await actor.updateEmbeddedDocuments("Item", [{ _id: existing.id, "system.value.value": Math.max(Number(existing.value ?? 0), value) }]);
    else if (!existing) await actor.increaseCondition(slug, value ? { value } : {});
    return true;
  });
  registerOperation("roll-save", async ({ actorUuid, save, dc, itemUuid, originUuid, traits, modifiers, options }) => {
    const actor = await fromUuid(actorUuid);
    const statistic = actor?.saves?.[save];
    if (!statistic) throw new Error("Save not found.");
    const ModifierPF2e = game.pf2e?.Modifier;
    const roll = await statistic.roll({
      dc: { value: dc },
      item: itemUuid ? await fromUuid(itemUuid) : null,
      origin: originUuid ? await fromUuid(originUuid) : null,
      traits,
      extraRollOptions: options,
      modifiers: ModifierPF2e ? (modifiers ?? []).map((modifier) => new ModifierPF2e(modifier)) : [],
      skipDialog: true,
    });
    return { degree: Number.isInteger(roll?.degreeOfSuccess) ? roll.degreeOfSuccess : null };
  });
  registerOperation("apply-damage", async ({ actorUuid, tokenUuid, formula }) => {
    const actor = await fromUuid(actorUuid);
    const DamageRoll = CONFIG.Dice.rolls.find((Roll) => Roll.name === "DamageRoll");
    if (!actor || !DamageRoll) throw new Error("Damage can't be applied.");
    const roll = await new DamageRoll(formula).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: "Falling damage" });
    await actor.applyDamage({ damage: roll, token: tokenUuid ? await fromUuid(tokenUuid) : null });
    return true;
  });
}

