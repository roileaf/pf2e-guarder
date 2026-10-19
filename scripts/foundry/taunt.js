import { FLAG_SCOPE, MODULE_ID, SLUGS, SYSTEM_UUIDS } from "../constants.js";
import { planTaunt, tauntLimits, tauntTriggersOffGuard } from "../domain/taunt.js";
import { setting } from "../settings.js";
import { timedPrompt } from "../ui/prompt.js";
import { tauntKeepBody, tauntRangeBody, tauntSpellCard } from "../ui/views.js";
import {
  escapeHtml, hasSlug, isAlly, isEnemy, notify, sameActor, sceneTokenFor, tauntEffects, tauntOrigin, tokenDistance, tokenDocument,
} from "./actors.js";
import { combatantFor } from "./reactions.js";
import { isResponsibleGM, registerOperation, requestOperation } from "./socket.js";

const ATTACK_TYPES = ["attack-roll", "spell-attack-roll"];

function isTauntMessage(message) {
  const item = message?.item;
  return item?.type === "action" && item.slug === SLUGS.taunt && Boolean(message.actor);
}

function effectStart(actor) {
  const combatant = combatantFor(actor);
  return {
    value: game.time.worldTime,
    initiative: combatant?.initiative ?? game.combat?.combatant?.initiative ?? null,
  };
}

/** Enemies on this scene currently taunted by `guardian`, keyed by token uuid. */
function currentlyTaunted(guardian, scene) {
  const taunted = new Map();
  for (const token of scene?.tokens ?? []) {
    const effects = tauntEffects(token.actor).filter((effect) => sameActor(tauntOrigin(effect), guardian));
    if (effects.length) taunted.set(token.uuid, { token, effects });
  }
  return taunted;
}

function enemyView(token, guardianToken) {
  return {
    value: token.uuid,
    name: token.name,
    img: token.texture?.src ?? token.actor?.img,
    distance: guardianToken ? tokenDistance(guardianToken, token) : NaN,
  };
}

async function confirmOutOfRange(outOfRange, range, guardian, guardianToken) {
  return timedPrompt({
    title: "Taunt",
    icon: "fa-solid fa-bullhorn",
    body: tauntRangeBody({
      guardianName: guardian.name,
      guardianImg: guardian.img,
      range,
      enemies: outOfRange.map(({ token }) => enemyView(token, guardianToken)),
    }),
    buttons: [
      { value: "include", label: "Taunt anyway", icon: "fa-solid fa-bullhorn", style: "primary", result: true },
      { value: "skip", label: "Skip them", icon: "fa-solid fa-xmark", default: true, result: false },
    ],
  });
}

// Distance tells apart enemies whose token names are hidden or identical.
async function chooseKept(taunted, choices, capacity, guardian, guardianToken) {
  return timedPrompt({
    title: "Group Taunt",
    icon: "fa-solid fa-users",
    body: tauntKeepBody({
      guardianName: guardian.name,
      guardianImg: guardian.img,
      capacity,
      enemies: choices.map((uuid) => taunted.get(uuid)?.token).filter(Boolean).map((token) => enemyView(token, guardianToken)),
    }),
    // Lock further boxes once the limit is reached.
    onRender: (element) => {
      const boxes = [...element.querySelectorAll("input[name=keep]")];
      const sync = () => {
        const full = boxes.filter((box) => box.checked).length >= capacity;
        for (const box of boxes) box.disabled = full && !box.checked;
      };
      for (const box of boxes) box.addEventListener("change", sync);
    },
    buttons: [{
      value: "keep", label: "Taunt", icon: "fa-solid fa-bullhorn", style: "primary", default: true,
      result: (element) => [...element.querySelectorAll("input[name=keep]:checked")].map((input) => input.value),
    }],
  });
}

/** Apply the Taunt effect from a Taunt action message to the user's targeted enemies. */
export async function applyTauntFromMessage(message) {
  const guardian = message.actor;
  const guardianToken = message.token ?? sceneTokenFor(guardian);
  const targets = [...(game.user.targets ?? [])];
  if (!targets.length) {
    notify("warn", "Taunt: target the enemy you Taunt, then use the chat card's Apply Taunt button.");
    return false;
  }
  return tauntTokens({ guardian, guardianToken, item: message.item, targets });
}

/**
 * Taunt the given tokens: range check (with override), Group Taunt limits and keep choice,
 * then apply PF2e's Effect: Taunt through the GM.
 */
export async function tauntTokens({ guardian, guardianToken, item, targets: requested }) {
  guardianToken = tokenDocument(guardianToken);
  const scene = guardianToken?.parent ?? globalThis.canvas?.scene;
  const limits = tauntLimits({
    groupTaunt: hasSlug(guardian, SLUGS.groupTaunt),
    longDistance: hasSlug(guardian, SLUGS.longDistanceTaunt),
  });
  let targets = requested.map(tokenDocument)
    .filter((token) => token?.parent?.id === scene?.id && isEnemy(guardian, token.actor));
  if (!targets.length) {
    notify("warn", "Taunt: no enemy among the targets.");
    return false;
  }
  if (guardianToken) {
    const outOfRange = targets.map((token) => ({ token, distance: tokenDistance(guardianToken, token) }))
      .filter(({ distance }) => distance > limits.range);
    if (outOfRange.length && !await confirmOutOfRange(outOfRange, limits.range, guardian, guardianToken)) {
      targets = targets.filter((token) => !outOfRange.some((entry) => entry.token.id === token.id));
    }
  }
  if (!targets.length) return false;

  const taunted = currentlyTaunted(guardian, scene);
  let plan = planTaunt({ existing: [...taunted.keys()], targets: targets.map((token) => token.uuid), limits });
  if (plan.ok && plan.needsChoice) {
    const keep = await chooseKept(taunted, plan.choices, plan.capacity, guardian, guardianToken);
    if (keep === null) return false;
    plan = planTaunt({ existing: [...taunted.keys()], targets: targets.map((token) => token.uuid), limits, keep });
  }
  if (!plan.ok) {
    notify("warn", `Taunt: ${plan.error}`);
    return false;
  }
  const remove = plan.remove.flatMap((uuid) => taunted.get(uuid)?.effects.map((effect) => effect.uuid) ?? []);
  await requestOperation("taunt-apply", {
    guardianUuid: guardian.uuid,
    guardianTokenUuid: guardianToken?.uuid ?? null,
    itemUuid: item?.uuid ?? null,
    apply: plan.apply,
    remove,
  }, { gmRequired: true });
  const names = targets.map((token) => token.name).join(", ");
  notify("info", `${guardian.name} taunts ${names}.`);
  return true;
}

/** Enemies this guardian currently taunts on the scene (for the Guardian panel). */
export function tauntedTokens(guardian, scene = globalThis.canvas?.scene) {
  return [...currentlyTaunted(guardian, scene).values()].map((entry) => entry.token);
}

async function applyTaunt({ guardianUuid, guardianTokenUuid, itemUuid, apply, remove }) {
  const guardianToken = guardianTokenUuid ? await fromUuid(guardianTokenUuid) : null;
  const guardian = guardianToken?.actor ?? await fromUuid(guardianUuid);
  const item = itemUuid ? await fromUuid(itemUuid) : null;
  const template = await fromUuid(SYSTEM_UUIDS.tauntEffect);
  if (!guardian || !template) throw new Error("Taunt: the guardian or PF2e's Effect: Taunt is unavailable.");
  for (const uuid of remove) await (await fromUuid(uuid))?.delete();
  for (const tokenUuid of apply) {
    const token = await fromUuid(tokenUuid);
    const actor = token?.actor;
    if (!actor) continue;
    const source = foundry.utils.mergeObject(template.toObject(), {
      system: {
        context: {
          origin: {
            actor: guardian.uuid,
            token: guardianToken?.uuid ?? null,
            item: item?.uuid ?? null,
            spellcasting: null,
            rollOptions: item?.getOriginData?.().rollOptions ?? [],
          },
          target: { actor: actor.uuid, token: token.uuid },
          roll: null,
        },
        // The guardian's initiative: the taunt lasts until the start of the guardian's next turn.
        start: effectStart(guardian),
      },
      flags: { [FLAG_SCOPE]: { taunt: { guardianUuid: guardian.uuid } } },
    });
    delete source._id;
    await actor.createEmbeddedDocuments("Item", [source]);
  }
  return true;
}

function hasTauntOffGuard(enemy, guardian) {
  return (enemy.itemTypes?.effect ?? []).some((effect) => sameActor(effect.flags?.[FLAG_SCOPE]?.offGuard?.guardianUuid, guardian));
}

export async function applyTauntOffGuard(enemy, guardian) {
  if (hasTauntOffGuard(enemy, guardian)) return false;
  await enemy.createEmbeddedDocuments("Item", [{
    name: `Effect: Taunted by ${guardian.name} (Off-Guard)`,
    type: "effect",
    img: "icons/skills/social/intimidation-impressing.webp",
    system: {
      badge: null,
      context: { origin: { actor: guardian.uuid, token: null, item: null, spellcasting: null, rollOptions: [] }, target: null, roll: null },
      description: { value: `<p>Took a hostile action against ${escapeHtml(guardian.name)}'s allies while taunted. Off-guard until the start of its next turn.</p>` },
      // The enemy's own initiative: off-guard lasts until the start of its next turn.
      duration: { expiry: "turn-start", sustained: false, unit: "rounds", value: 1 },
      start: effectStart(enemy),
      rules: [{ key: "GrantItem", inMemoryOnly: true, uuid: SYSTEM_UUIDS.offGuard }],
      slug: SLUGS.tauntOffGuardEffect,
      tokenIcon: { show: true },
      traits: { rarity: "common", value: [] },
      unidentified: false,
    },
    flags: { [FLAG_SCOPE]: { offGuard: { guardianUuid: guardian.uuid } } },
  }]);
  return true;
}

function tauntingGuardians(enemy) {
  return tauntEffects(enemy)
    .map((effect) => fromUuidSync(tauntOrigin(effect)))
    .filter((guardian) => guardian?.documentName === "Actor");
}

async function handleTauntedAttack(message) {
  const context = message.flags?.pf2e?.context;
  if (!ATTACK_TYPES.includes(context?.type)) return;
  const enemy = message.actor;
  const target = message.target?.actor;
  if (!enemy || !target) return;
  for (const guardian of tauntingGuardians(enemy)) {
    const triggers = tauntTriggersOffGuard({
      guardianId: guardian.uuid,
      affectedIds: [target.uuid],
      isAllyOfGuardian: () => isAlly(guardian, target) || target.uuid === guardian.uuid,
    });
    if (triggers && await applyTauntOffGuard(enemy, guardian)) {
      notify("info", `${enemy.name} attacked ${target.name} while taunted by ${guardian.name}: off-guard until its next turn.`);
    }
  }
}

async function remindTauntedSpell(message) {
  const item = message.item;
  if (item?.type !== "spell" || message.flags?.pf2e?.context?.type) return;
  const enemy = message.actor;
  const guardians = enemy ? tauntingGuardians(enemy) : [];
  if (!guardians.length) return;
  await ChatMessage.create({
    whisper: game.users.filter((user) => user.isGM).map((user) => user.id),
    speaker: { alias: "PF2e Guarder" },
    content: tauntSpellCard({
      enemyUuid: enemy.uuid,
      enemyName: enemy.name,
      enemyImg: enemy.img,
      spellName: item.name,
      guardians: guardians.map((guardian) => ({ uuid: guardian.uuid, name: guardian.name })),
    }),
    flags: { [MODULE_ID]: { card: "taunt-spell" } },
  });
}

function decorateTauntCard(message, html) {
  if (!isTauntMessage(message) || !message.actor.isOwner) return;
  if (html.querySelector("[data-guarder-action=apply-taunt]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "guarder-card-button primary";
  button.dataset.guarderAction = "apply-taunt";
  button.innerHTML = `<i class="fa-solid fa-bullhorn"></i> Apply Taunt to targets`;
  button.addEventListener("click", () => void applyTauntFromMessage(message).catch((error) => notify("error", error.message)));
  (html.querySelector(".card-content") ?? html.querySelector(".message-content"))?.append(button);
}

function activateOffGuardButtons(html) {
  for (const button of html.querySelectorAll("[data-guarder-action=taunt-off-guard]")) {
    button.addEventListener("click", async () => {
      const enemy = await fromUuid(button.dataset.enemy);
      const guardian = await fromUuid(button.dataset.guardian);
      if (enemy && guardian && await applyTauntOffGuard(enemy, guardian)) notify("info", `${enemy.name} is off-guard.`);
    });
  }
}

export function registerTaunt() {
  registerOperation("taunt-apply", (payload) => applyTaunt(payload));

  Hooks.on("createChatMessage", (message) => {
    if (!setting("tauntEnabled")) return;
    if (isTauntMessage(message) && message.author?.id === game.user.id && game.user.targets?.size) {
      void applyTauntFromMessage(message).catch((error) => notify("error", `Taunt: ${error.message}`));
    }
    if (!isResponsibleGM(message.author?.id) || !setting("tauntOffGuard")) return;
    void handleTauntedAttack(message).catch((error) => console.error(`${MODULE_ID} | taunt off-guard`, error));
    void remindTauntedSpell(message).catch((error) => console.error(`${MODULE_ID} | taunt reminder`, error));
  });
}

/** Chat buttons; registered at load because the chat log renders before "ready". */
export function registerTauntChatButtons() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.flags?.[MODULE_ID]?.card) html.classList.add("pf2e-guarder-message");
    if (!setting("tauntEnabled")) return;
    decorateTauntCard(message, html);
    if (game.user.isGM) activateOffGuardButtons(html);
  });
}
