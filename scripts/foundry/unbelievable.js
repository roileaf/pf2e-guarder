import { MODULE_ID } from "../constants.js";
import { chooseTowardPosition, overlaps } from "../domain/geometry.js";
import { degreeOfSuccess, OUTCOMES } from "../domain/followups.js";
import { setting } from "../settings.js";
import { dismissPrompts, timedPrompt } from "../ui/prompt.js";
import { unbelievableCard, unbelievablePromptBody } from "../ui/views.js";
import {
  alive, controllingUser, footprint, gridDistance, hasSlug, incapacitated, isAlly, landSpeed, notify, sceneTokenFor, tokenDistance,
  wallBlocksMove,
} from "./actors.js";
import { actorReach } from "./followups.js";
import { reactionPool, reactionsLeft, spendReactions } from "./reactions.js";
import { broadcast, registerListener, registerOperation, requestOperation } from "./socket.js";

const SLUG = "unbelievable-interception";
const ATTACK_TYPES = ["attack-roll", "spell-attack-roll"];

function mythicPoints(actor) {
  return Number(actor?.system?.resources?.mythicPoints?.value ?? 0);
}

/** How far the triggering attack reaches: melee reach, or a ranged weapon's maximum range. */
function attackReach(attacker, item) {
  if (item?.isRanged || item?.system?.range?.increment) {
    const increment = Number(item.range?.increment ?? item.system?.range?.increment ?? 0);
    const max = Number(item.range?.max ?? item.system?.range?.max ?? increment * 6);
    return max > 0 ? max : Infinity;
  }
  const reach = Number(attacker?.getReach?.({ action: "attack", weapon: item }) ?? 5);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

function candidatesFor({ ally, allyToken, attacker, attackerToken, item }) {
  const scene = allyToken.parent;
  const reach = attackReach(attacker, item);
  const seen = new Set();
  const candidates = [];
  for (const token of scene.tokens) {
    const guardian = token.actor;
    if (!guardian || seen.has(guardian.uuid) || !hasSlug(guardian, SLUG)) continue;
    seen.add(guardian.uuid);
    if (guardian.uuid === ally.uuid || !isAlly(guardian, ally) || !alive(guardian) || incapacitated(guardian)) continue;
    if (mythicPoints(guardian) <= 0 || reactionsLeft(guardian) <= 0) continue;
    // Stride twice toward the enemy, then it must be inside the attack's reach or range.
    const distance = tokenDistance(token, attackerToken);
    const budget = landSpeed(guardian) * 2;
    if (distance - budget > reach) continue;
    candidates.push({ guardian, token, distance, budget, reach, user: controllingUser(guardian, setting("interceptPromptTarget")) });
  }
  return candidates;
}

async function promptUnbelievable(payload) {
  return timedPrompt({
    key: `${payload.requestId}:${payload.guardianUuid}`,
    title: "Unbelievable Interception",
    icon: "fa-solid fa-bolt",
    body: unbelievablePromptBody(payload),
    buttons: [
      { value: "go", label: "Intercept", icon: "fa-solid fa-bolt", style: "primary", default: true, result: { accept: true } },
      { value: "no", label: "Decline", icon: "fa-solid fa-xmark", result: { accept: false } },
    ],
    timeoutSeconds: payload.timeout,
  });
}

function firstYes(prompts) {
  return new Promise((resolve) => {
    let remaining = prompts.length;
    if (!remaining) resolve(null);
    for (const { promise, index } of prompts) {
      promise.then((result) => {
        if (result?.accept) resolve(index);
        else if (--remaining === 0) resolve(null);
      }, () => {
        if (--remaining === 0) resolve(null);
      });
    }
  });
}

export async function moveToward(guardianToken, attackerToken, budget) {
  const scene = guardianToken.parent;
  const size = Number(scene.grid?.size ?? 100) || 100;
  const others = [...scene.tokens].filter((token) => token.id !== guardianToken.id && !token.hidden).map(footprint);
  const position = chooseTowardPosition({
    mover: footprint(guardianToken),
    target: footprint(attackerToken),
    budget,
    gridDistance: gridDistance(scene),
    blocked: (candidate) => others.some((other) => overlaps(candidate, other)) || wallBlocksMove(guardianToken, candidate),
  });
  if (!position) return 0;
  await guardianToken.update({ x: position.col * size, y: position.row * size });
  await guardianToken.object?.movementAnimationPromise;
  return position.cost;
}

async function resolveUnbelievable(payload) {
  const guardianToken = await fromUuid(payload.guardianTokenUuid);
  const attackerToken = await fromUuid(payload.attackerTokenUuid);
  const guardian = guardianToken?.actor;
  if (!guardian || !attackerToken) throw new Error("The guardian or the attacker is no longer on the scene.");
  const notes = [];
  const moved = await moveToward(guardianToken, attackerToken, payload.budget);
  if (moved) notes.push(`Strides ${moved} feet toward ${attackerToken.name}`);
  await spendReactions(guardian, 1);
  await guardian.update({ "system.resources.mythicPoints.value": Math.max(0, mythicPoints(guardian) - 1) });

  const inReach = tokenDistance(guardianToken, attackerToken) <= payload.reach;
  let degree = null;
  if (inReach) {
    degree = degreeOfSuccess(payload.total, Number(guardian.attributes?.ac?.value ?? 10), payload.die);
    await requestOperation("retarget-attack", {
      messageId: payload.messageId,
      target: { actor: guardian.uuid, token: guardianToken.uuid },
      outcome: OUTCOMES[degree],
      note: `Unbelievable Interception: ${guardian.name} is the target instead (AC ${guardian.attributes?.ac?.value ?? "?"}).`,
    }, { gmRequired: true });
  } else {
    notes.push("did not reach the attack's reach or range; the original target is still attacked");
  }
  const counter = inReach && degree < 2 && tokenDistance(guardianToken, attackerToken) <= actorReach(guardian);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: guardian, token: guardianToken }),
    content: unbelievableCard({
      guardianUuid: guardian.uuid,
      guardianName: guardian.name,
      guardianImg: guardian.img,
      allyName: payload.allyName,
      attackerName: attackerToken.name,
      attackerTokenUuid: attackerToken.uuid,
      total: payload.total,
      ac: guardian.attributes?.ac?.value ?? null,
      outcome: degree === null ? null : OUTCOMES[degree],
      notes,
      counter,
      pool: reactionPool(guardian),
    }),
    flags: { [MODULE_ID]: { card: "unbelievable" } },
  });
  return true;
}

async function onAttackRoll(message) {
  const context = message.flags?.pf2e?.context;
  if (!ATTACK_TYPES.includes(context?.type) || message.author?.id !== game.user.id) return;
  const ally = message.target?.actor;
  const allyToken = message.target?.token;
  const attacker = message.actor;
  if (!ally || !allyToken?.parent || !attacker) return;
  const attackerToken = message.token ?? sceneTokenFor(attacker, allyToken.parent);
  if (!attackerToken) return;
  const candidates = candidatesFor({ ally, allyToken, attacker, attackerToken, item: message.item });
  if (!candidates.length) return;

  const roll = message.rolls?.[0];
  const requestId = foundry.utils.randomID();
  const timeout = Number(setting("interceptTimeout")) || 30;
  const prompts = candidates.map((candidate, index) => ({
    index,
    promise: candidate.user ? requestOperation("unbelievable-prompt", {
      requestId,
      guardianUuid: candidate.guardian.uuid,
      guardianName: candidate.guardian.name,
      guardianImg: candidate.guardian.img,
      allyName: ally.name,
      allyImg: allyToken.texture?.src ?? ally.img,
      attackerName: attackerToken.name,
      attackerImg: attackerToken.texture?.src ?? attacker.img,
      total: roll?.total ?? null,
      distance: candidate.distance,
      mythicPoints: mythicPoints(candidate.guardian),
      pool: reactionPool(candidate.guardian),
      timeout,
    }, { authorityUserId: candidate.user.id, directed: true, timeoutMs: (timeout + 10) * 1000 }) : Promise.resolve(null),
  }));
  const winner = await firstYes(prompts);
  broadcast("unbelievable-dismiss", { requestId });
  if (winner === null) return;
  const candidate = candidates[winner];
  await requestOperation("unbelievable-resolve", {
    messageId: message.id,
    guardianTokenUuid: candidate.token.uuid,
    attackerTokenUuid: attackerToken.uuid,
    allyName: ally.name,
    budget: candidate.budget,
    reach: candidate.reach,
    total: roll?.total ?? 0,
    die: roll?.dice?.[0]?.total ?? null,
  }, { authorityUserId: candidate.user?.active ? candidate.user.id : game.user.id, directed: true, timeoutMs: 60_000 });
}

export function registerUnbelievableInterception() {
  registerOperation("unbelievable-prompt", (payload) => promptUnbelievable(payload));
  registerOperation("unbelievable-resolve", (payload) => resolveUnbelievable(payload));
  registerListener("unbelievable-dismiss", ({ requestId }) => dismissPrompts(`${requestId}:`));
  registerOperation("retarget-attack", async ({ messageId, target, outcome, note }) => {
    const message = game.messages.get(messageId);
    if (!message) throw new Error("The attack message is gone.");
    // PF2e bakes the original target into the flavor; mark it superseded and name the new target.
    const flavor = `${message.flavor ?? ""}<p class="guarder-retarget-note"><i class="fa-solid fa-bolt"></i> ${foundry.utils.escapeHTML(note)}</p>`;
    await message.update({
      flavor,
      "flags.pf2e.context.target": target,
      "flags.pf2e.context.outcome": outcome,
      [`flags.${MODULE_ID}.retargeted`]: true,
    });
    // The damage roll uses the roller's targets: point the attack's author at the guardian.
    broadcast("unbelievable-target", { tokenUuid: target.token }, { userIds: [message.author?.id].filter(Boolean) });
    return true;
  });
  registerListener("unbelievable-target", ({ tokenUuid }) => fromUuidSync(tokenUuid)?.object?.setTarget(true, { releaseOthers: true }));
  Hooks.on("createChatMessage", (message) => {
    if (!setting("interceptEnabled")) return;
    void onAttackRoll(message).catch((error) => notify("error", `Unbelievable Interception: ${error.message}`));
  });
}
