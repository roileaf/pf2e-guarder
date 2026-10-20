// Imported by isolated QA browser sessions only; never loaded by module.json.
import { assertQaWorld } from './world-guard.mjs';

const SCOPE = 'pf2e-guarder';
// Fixture tags live in the world scope: Guarder skips chat messages carrying its own flags as its cards.
const TAG_SCOPE = 'world';
const TAG = 'guarderLiveTestRun';
const GRID = 100;
const hooks = [];
let pending = null;

// Native compendium sources, by the slug the module looks for.
const SOURCES = {
  guardian: ['pf2e.iconics', 'AwZRZftsnX2fIpwV'], // Grimmyr (Level 3), a Guardian
  ally: ['pf2e.iconics', 'fA0g6IWg7CR1feg1'],
  enemy: ['pf2e.iconics', 'QjHNnbpwWvCOAO94'],
  'steel-shield': ['pf2e.equipment-srd', 'Yr9yCuJiAlFh3QEB'],
  longsword: ['pf2e.equipment-srd', 'LJdbVTOZog39EEbi'],
  shortbow: ['pf2e.equipment-srd', 'hIgqLgH3YcLZBeoT'],
};
// Optional Guardian items an arrangement adds or removes. Several sources share one slug.
const OPTIONAL = {
  'not-so-fast': [['pf2e.feats-srd', '46mkvetP7cdi7LO0']],
  'long-distance-taunt': [['pf2e.feats-srd', 'BcrBeAtl1sVyGmy1']],
  'unbelievable-interception': [['pf2e.feats-srd', 'Bgnr0hw52Efr8Ew8']],
  'keep-up-the-good-fight': [['pf2e.feats-srd', 'DYayudEG8sZRB3Ot']],
  'disarming-intercept': [['pf2e.feats-srd', 'HoDs90589eYQwcre']],
  'reactive-strike': [['pf2e.feats-srd', 'NMWXHGWUcZGoLDKb'], ['pf2e.actionspf2e', 'KAVf7AmRnbCAHrkT']],
  'hampering-stance': [['pf2e.feats-srd', 'UKXaMhb9qlPYw1HD']],
  'quick-vengeance': [['pf2e.feats-srd', 'VeejX9bGhI9di1eL']],
  'armored-counterattack': [['pf2e.feats-srd', 'Vj7L46PhxciFNMpZ']],
  'energy-interceptor': [['pf2e.feats-srd', 'YezCCZgVOmgQPHhW']],
  bodyguard: [['pf2e.feats-srd', 'hLchognQOno3KWr1']],
  'group-taunt': [['pf2e.feats-srd', 'i991vEx2T7y5L6Ke']],
  'get-behind-me': [['pf2e.feats-srd', 'ia3eTMsQfVyaAXlX']],
  'shield-from-spells': [['pf2e.feats-srd', 'ueQoFDPHUe3dqmS1']],
  'reactive-shield': [['pf2e.feats-srd', 'w8Ycgeq2zfyshtoS']],
  'shield-from-arrows': [['pf2e.feats-srd', 'wzJnJI6d2PaoTZIZ']],
  clang: [['pf2e.feats-srd', 'xaYEUVetHiRgmVhd']],
  'tough-to-kill': [['pf2e.classfeatures', 'U9t3cmF4eXFiF7oI']],
  'reaction-time': [['pf2e.classfeatures', 'qgEIQPhtEV6d1zB2']],
};
// Reactions the module offers to any character holding them; stripped from the non-guardians.
const REACTION_SLUGS = [...Object.keys(OPTIONAL), 'shield-block', 'intercept-attack', 'taunt'];

export function validateRunId(runId) {
  if (typeof runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) throw Error('Invalid live-test run ID');
}

export function guard({ world, runId }, gm = false) {
  assertQaWorld(game.world.id, world);
  validateRunId(runId);
  if (gm && !game.user.isGM) throw Error('QA GM required');
}

// Flags are read directly: getFlag throws for scopes of inactive modules.
function tagged(document, runId) { return document?.flags?.[TAG_SCOPE]?.[TAG] === runId; }
const api = () => game.modules.get(SCOPE).api;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function preflight({ world }) {
  assertQaWorld(game.world.id, world);
  if (game.system.id !== 'pf2e' || Number(game.version.split('.')[0]) !== 14) throw Error('Foundry 14 / PF2e required');
  if (!api()?.open) throw Error('PF2e Guarder must be active and ready');
  return { world: game.world.id, user: game.user.id, isGM: game.user.isGM,
    scene: canvas.scene?.id ?? null, level: canvas.level?.id ?? null,
    controlled: canvas.tokens.controlled.map(t => t.id), targeted: [...game.user.targets].map(t => t.id),
    paused: game.paused, core: game.version, system: game.system.version,
    combat: game.combat?.id ?? null, worldTime: game.time.worldTime,
    userSettings: foundry.utils.deepClone(game.user.flags?.pf2e?.settings ?? null),
    module: game.modules.get(SCOPE).version,
    modules: [...game.modules.values()].filter(m => m.active).map(m => ({ id: m.id, version: m.version })) };
}

export function installTaggers(context) {
  guard(context);
  removeTaggers();
  const id = Hooks.on('preCreateChatMessage', document => {
    if (!tagged(canvas.scene, context.runId)) return;
    document.updateSource({ [`flags.${TAG_SCOPE}.${TAG}`]: context.runId });
  });
  hooks.push(['preCreateChatMessage', id]);
}

export function removeTaggers() {
  for (const [name, id] of hooks.splice(0)) Hooks.off(name, id);
}

async function source([packId, id]) {
  const document = await game.packs.get(packId)?.getDocument(id);
  if (!document) throw Error(`Prerequisite: missing native compendium entry ${packId}.${id}`);
  return document.toObject();
}

export async function prerequisites({ world }) {
  assertQaWorld(game.world.id, world);
  for (const entry of [...Object.values(SOURCES), ...Object.values(OPTIONAL).flat()]) {
    const index = await game.packs.get(entry[0])?.getIndex();
    if (!index?.has(entry[1])) return { blocked: `Missing native compendium entry ${entry.join('.')}` };
  }
  if (game.settings.get('pf2e', 'mythic') === 'disabled') return { blocked: 'PF2e mythic rules must be enabled for Unbelievable Interception' };
  return { items: [] };
}

function itemSource(raw) {
  delete raw._id;
  // The fixture tests item consumers, not character-building prompts.
  if (Array.isArray(raw.system?.rules)) raw.system.rules = raw.system.rules.filter(r => !['ChoiceSet', 'GrantItem'].includes(r.key));
  return raw;
}

export async function setup(context) {
  guard(context, true);
  const { runId, player } = context;
  const flags = { [TAG_SCOPE]: { [TAG]: runId } };
  const short = runId.slice(0, 8);
  const roles = [['guardian', 'Guardian', 'party', true], ['ally', 'Ally', 'party', true], ['enemy', 'Enemy', 'opposition', false], ['enemy2', 'Brute', 'opposition', false]];
  const actors = {};
  for (const [key, label, alliance, owned] of roles) {
    const raw = await source(SOURCES[key === 'enemy2' ? 'enemy' : key]);
    delete raw._id;
    raw.name = `QA ${label} ${short}`;
    raw.ownership = { default: 0, ...(owned ? { [player]: 3 } : {}) };
    raw.flags = flags;
    raw.system.details.alliance = alliance;
    // Non-guardians must not answer guardian reactions themselves.
    if (key !== 'guardian') raw.items = (raw.items ?? []).filter(i => !REACTION_SLUGS.includes(i.system?.slug));
    actors[key] = await Actor.create(raw, { renderSheet: false });
  }
  const shield = itemSource(await source(SOURCES['steel-shield']));
  shield.system.equipped = { carryType: 'held', handsHeld: 1, invested: null };
  const calling = { name: 'QA Calling', type: 'feat', system: { category: 'calling', level: { value: 1 }, traits: { value: ['mythic'], rarity: 'common' }, description: { value: '<p>Live-test mythic calling.</p>' } } };
  await actors.guardian.createEmbeddedDocuments('Item', [shield, calling]);
  for (const key of ['enemy', 'enemy2']) {
    const weapons = [];
    for (const slug of ['longsword', 'shortbow']) {
      if (actors[key].items.some(i => i.slug === slug)) continue;
      const raw = itemSource(await source(SOURCES[slug]));
      raw.system.equipped = { carryType: 'held', handsHeld: slug === 'shortbow' ? 2 : 1, invested: null };
      weapons.push(raw);
    }
    weapons.push({ name: 'QA Manipulate', type: 'action', system: { actionType: { value: 'action' }, actions: { value: 1 }, traits: { value: ['manipulate'], rarity: 'common' }, description: { value: '<p>Live-test manipulate action.</p>' } } });
    await actors[key].createEmbeddedDocuments('Item', weapons);
  }
  const scene = await globalThis.Scene.create({ name: `Guarder QA ${short}`,
    width: 3400, height: 1400, padding: 0, grid: { type: 1, size: GRID, distance: 5 },
    tokenVision: false, navigation: true, ownership: { default: 0, [player]: 3 }, flags,
  });
  const tokens = {};
  let column = 4;
  for (const [key] of roles) {
    // One-square tokens keep the geometry simple (Grimmyr is a Large jotunborn).
    const token = await actors[key].getTokenDocument({ name: actors[key].name, x: column * GRID, y: 6 * GRID, width: 1, height: 1,
      actorLink: true, flags: { ...flags, pf2e: { linkToActorSize: false, autoscale: false } } });
    const created = (await scene.createEmbeddedDocuments('Token', [token.toObject()]))[0];
    // The prototype size wins over getTokenDocument data, so resize after creation.
    if (created.width !== 1 || created.height !== 1) await created.update({ width: 1, height: 1 });
    tokens[key] = created.id;
    column += 3;
  }
  const combat = await globalThis.Combat.create({ scene: scene.id, flags });
  await combat.createEmbeddedDocuments('Combatant', Object.keys(tokens).map(key => ({ tokenId: tokens[key], sceneId: scene.id, actorId: actors[key].id, initiative: { guardian: 20, ally: 15, enemy: 10, enemy2: 5 }[key] })));
  await combat.startCombat();
  // Park the turn on the second enemy so no guardian turn reset runs mid-case.
  await combat.update({ turn: combat.turns.findIndex(c => c.tokenId === tokens.enemy2) });
  return { scene: scene.id, combat: combat.id, tokens,
    guardian: actors.guardian.id, ally: actors.ally.id, enemy: actors.enemy.id, enemy2: actors.enemy2.id };
}

function fixture(context) {
  guard(context);
  const f = context.fixture;
  const scene = game.scenes.get(f.scene);
  if (!tagged(scene, context.runId)) throw Error('Scene outside test fixture');
  const actor = key => {
    const document = game.actors.get(f[key]);
    if (!tagged(document, context.runId)) throw Error('Actor outside test fixture');
    return document;
  };
  const token = key => scene.tokens.get(f.tokens[key]);
  return { f, scene, actor, token, combat: game.combats.get(f.combat) };
}

export async function view(context) {
  const { scene } = fixture(context);
  await scene.view();
  if (canvas.scene?.id !== scene.id) throw Error('Fixture scene not viewed');
  // Rolls from automated Strikes and Disarm must not stop on a dialog.
  await game.user.update({ 'flags.pf2e.settings.showCheckDialogs': false, 'flags.pf2e.settings.showDamageDialogs': false });
  ui.sidebar?.changeTab?.('chat', 'primary');
  // Persistent banners (e.g. hardware acceleration) cover window headers in headless runs.
  for (const notice of document.querySelectorAll('#notifications .notification')) notice.remove();
}

export async function openPanel(context) {
  const { actor } = fixture(context);
  const guardian = actor('guardian');
  if (!guardian.isOwner) throw Error('Fixture owner required');
  await api().open(guardian);
}

/** Bring every fixture actor and token to a known state for one case. */
export async function arrange(context) {
  guard(context, true);
  const { actor, token, combat } = fixture(context);
  const spec = context.spec ?? {};
  const guardian = actor('guardian');
  const keys = ['guardian', 'ally', 'enemy', 'enemy2'];
  await pending?.catch(() => null);
  pending = null;
  // 1. Drop optional feats so repositioning triggers nothing.
  const wanted = new Set(spec.feats ?? []);
  const drop = guardian.items.filter(i => Object.hasOwn(OPTIONAL, i.slug) && !wanted.has(i.slug)).map(i => i.id);
  if (drop.length) await guardian.deleteEmbeddedDocuments('Item', drop);
  // 2. Effects and conditions off, HP full, flags clear.
  for (const key of keys) {
    const document = actor(key);
    const transient = document.items.filter(i => ['effect', 'condition'].includes(i.type)).map(i => i.id);
    if (transient.length) await document.deleteEmbeddedDocuments('Item', transient);
    await document.update({ 'system.attributes.hp.value': document.system.attributes.hp.max, 'system.attributes.hp.temp': 0,
      [`flags.${SCOPE}.-=toughToKill`]: null });
  }
  await guardian.update({ 'system.resources.mythicPoints.value': spec.mythicPoints ?? 0 });
  const shield = guardian.items.find(i => i.type === 'shield');
  if (shield) await shield.update({ 'system.hp.value': shield.system.hp.max });
  // 3. Positions (column, row in squares), without animation.
  const positions = { guardian: [4, 6], ally: [6, 6], enemy: [8, 6], enemy2: [20, 2], ...(spec.positions ?? {}) };
  for (const key of keys) {
    const [col, row] = positions[key];
    const document = token(key);
    const span = spec.sizes?.[key] ?? 1;
    if (document.width !== span || document.height !== span) await document.update({ width: span, height: span }, { animate: false });
    if (document.x !== col * GRID || document.y !== row * GRID) await document.update({ x: col * GRID, y: row * GRID }, { animate: false });
  }
  // Walls (pixel segments) for movement cases; none otherwise.
  const scene = game.scenes.get(context.fixture.scene);
  if (scene.walls.size) await scene.deleteEmbeddedDocuments('Wall', scene.walls.map(w => w.id));
  if (spec.walls?.length) await scene.createEmbeddedDocuments('Wall', spec.walls.map(c => ({ c, move: CONST.WALL_SENSE_TYPES.NORMAL, sight: CONST.WALL_SENSE_TYPES.NORMAL })));
  // 4. Requested feats back on.
  const have = new Set(guardian.items.map(i => i.slug));
  const add = [];
  for (const slug of wanted) if (!have.has(slug)) for (const entry of OPTIONAL[slug]) add.push(itemSource(await source(entry)));
  if (add.length) await guardian.createEmbeddedDocuments('Item', add);
  const intercept = guardian.items.find(i => i.slug === 'intercept-attack' && i.type === 'action');
  await intercept.update({ 'system.frequency': spec.interceptFrequency ?? null });
  const keepUp = guardian.items.find(i => i.slug === 'keep-up-the-good-fight' && i.system.frequency?.max);
  if (keepUp) await keepUp.update({ 'system.frequency.value': keepUp.system.frequency.max });
  // 5. Reactions, shield, stance and taunt.
  if (combat.turn !== combat.turns.findIndex(c => c.tokenId === token('enemy2').id)) {
    await combat.update({ turn: combat.turns.findIndex(c => c.tokenId === token('enemy2').id) });
  }
  await api().setReactions(guardian, spec.pool ?? { general: 1, guardian: 1 });
  if (spec.shieldRaised) await game.pf2e.actions.raiseAShield({ actors: [guardian] });
  if (spec.stance) {
    const { setHamperingStance } = await import('../../scripts/foundry/hampering.js');
    await setHamperingStance(guardian, true);
  }
  for (const key of spec.taunted ?? []) await tauntDirect(guardian, token('guardian'), token(key));
  for (const user of game.users) if (user.active) for (const t of [...(user.targets ?? [])]) if (user.isSelf) t.setTarget(false, { releaseOthers: false });
  await pause(250);
  return snapshot(context);
}

async function tauntDirect(guardian, guardianToken, enemyToken) {
  const { tauntTokens } = await import('../../scripts/foundry/taunt.js');
  await tauntTokens({ guardian, guardianToken, item: guardian.items.find(i => i.slug === 'taunt' && i.type === 'action'), targets: [enemyToken] });
}

function DamageRoll() {
  return CONFIG.Dice.rolls.find(R => R.name === 'DamageRoll');
}

/** Damage a fixture actor as PF2e's damage buttons do. Does not wait: prompts may be pending. */
export async function damage(context) {
  guard(context, true);
  const { actor, token } = fixture(context);
  const { target = 'ally', formula = '8[slashing]', attacker = 'enemy', weapon = 'longsword', shieldBlock = false } = context;
  const roll = await new (DamageRoll())(formula).evaluate();
  const victim = actor(target);
  const item = attacker ? actor(attacker).items.find(i => i.slug === weapon) : null;
  pending = victim.applyDamage({ damage: roll, token: token(target), item, rollOptions: new Set(), shieldBlockRequest: shieldBlock });
  pending.catch(error => console.error('pf2e-guarder live | damage', error));
  return { total: roll.total };
}

export async function settle(context) {
  guard(context);
  const result = await Promise.race([pending?.then(() => 'done'), pause(context.ms ?? 45000).then(() => 'timeout')]);
  pending = null;
  return result ?? 'none';
}

/** A deterministic attack-roll card, as PF2e posts it after a Strike. */
export async function attack(context) {
  guard(context, true);
  const { actor, token } = fixture(context);
  const { attacker = 'enemy', target = 'ally', weapon = 'longsword', outcome = 'success', total = 20, dc = null, die = 10, type = 'attack-roll' } = context;
  const source = actor(attacker);
  const victim = actor(target);
  const item = type === 'attack-roll' ? source.items.find(i => i.slug === weapon) : null;
  const ranged = weapon === 'shortbow' || type === 'spell-attack-roll';
  const roll = await new Roll(`${total}`).evaluate();
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: source, token: token(attacker) }),
    flavor: `<h4 class="action">QA Strike: ${item?.name ?? weapon}</h4>`,
    rolls: [roll],
    flags: { pf2e: {
      context: { type, outcome, dc: { value: dc ?? victim.attributes.ac.value }, die,
        options: [ranged ? 'item:ranged' : 'item:melee', 'item:damage:category:physical', `item:damage:type:${ranged ? 'piercing' : 'slashing'}`],
        target: { actor: victim.uuid, token: token(target).uuid } },
      origin: item ? { uuid: item.uuid, type: item.type } : null,
    } },
  });
  return { messageId: message.id };
}

/** A spell card from the enemy, as PF2e posts it when the spell is cast. */
export async function castSpell(context) {
  guard(context, true);
  const { actor, token } = fixture(context);
  const caster = actor(context.actor ?? 'enemy');
  let spell = caster.items.find(i => i.type === 'spell' && i.name === 'QA Spell');
  if (!spell) [spell] = await caster.createEmbeddedDocuments('Item', [{ name: 'QA Spell', type: 'spell',
    system: { level: { value: 1 }, traits: { value: ['concentrate', 'manipulate'], rarity: 'common', traditions: ['arcane'] }, description: { value: '<p>Live-test spell.</p>' } } }]);
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster, token: token(context.actor ?? 'enemy') }),
    content: '<p>QA Spell</p>',
    flags: { pf2e: { context: { type: 'spell-cast' }, origin: { uuid: spell.uuid, type: 'spell' } } },
  });
  return { messageId: message.id };
}

/** Change one Guarder world setting, returning the previous value. */
export async function setSetting(context) {
  guard(context, true);
  const previous = game.settings.get(SCOPE, context.key);
  await game.settings.set(SCOPE, context.key, context.value);
  return previous;
}

/** Post a fixture item to chat from this client (owner only). */
export async function postItem(context) {
  const { actor, token } = fixture(context);
  const document = actor(context.actor ?? 'guardian');
  // Taunt is both a class feature and the action; post the action unless asked otherwise.
  const matches = document.items.filter(i => (i.slug === context.slug || i.name === context.name)
    && (!context.reaction || i.system.actionType?.value === 'reaction'));
  const item = matches.find(i => i.type === (context.type ?? 'action')) ?? matches[0];
  if (!item) throw Error(`Item ${context.slug ?? context.name} missing`);
  if (context.targets) setTargets({ ...context, keys: context.targets });
  void token;
  const message = await item.toMessage(undefined, { create: true });
  return { messageId: message?.id ?? null };
}

export function setTargets(context) {
  const { token } = fixture(context);
  for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false });
  for (const [index, key] of (context.keys ?? []).entries()) token(key).object?.setTarget(true, { releaseOthers: index === 0, groupSelection: index > 0 });
  return [...game.user.targets].map(t => t.id);
}

/** pf2e-toolbelt's "Set targets" on a card: its Target Helper targets flag. */
export async function setToolbeltTargets(context) {
  guard(context, true);
  const { token } = fixture(context);
  const message = game.messages.get(context.messageId);
  if (!tagged(message, context.runId)) throw Error('Message outside test fixture');
  await message.update({ 'flags.pf2e-toolbelt.targetHelper.targets': context.keys.map(key => token(key).uuid) });
}

/** Before each case: only Guarder panels open, chat tab showing, no banners or pickers. */
export async function tidy(context) {
  guard(context);
  for (const app of [...foundry.applications.instances.values()]) {
    // Framed windows only (other modules' pop-ups, sheets, configs); the UI itself has no frame.
    if (app.rendered && app.hasFrame && !app.id?.startsWith(`${SCOPE}-panel-`)) await app.close().catch(() => {});
  }
  for (const app of Object.values(ui.windows)) await app.close().catch(() => {});
  canvas.hud?.token?.close?.();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  for (const notice of document.querySelectorAll('#notifications .notification')) notice.remove();
  ui.sidebar?.changeTab?.('chat', 'primary');
  ui.sidebar?.expand?.();
  if (!foundry.applications.instances.has(`${SCOPE}-panel-${context.fixture.guardian}`)) {
    const guardian = game.actors.get(context.fixture.guardian);
    if (guardian?.isOwner) await api().open(guardian);
  }
}

export async function closePrompts(context) {
  guard(context);
  for (const app of [...foundry.applications.instances.values()]) if (app.element?.classList.contains('pf2e-guarder-prompt-app')) await app.close();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

export async function closePanels(context) {
  guard(context);
  for (const app of [...foundry.applications.instances.values()]) if (app.id?.startsWith(`${SCOPE}-panel-`)) await app.close();
}

export async function openSheet(context) {
  const { actor } = fixture(context);
  await actor('guardian').sheet.render(true);
}

export async function closeSheet(context) {
  const { actor } = fixture(context);
  await actor('guardian').sheet.close();
}

export async function openHud(context) {
  const { token } = fixture(context);
  const placeable = token('guardian').object;
  placeable.control({ releaseOthers: true });
  canvas.hud.token.bind(placeable);
  await pause(300);
}

export async function showCombat(context) {
  const { combat } = fixture(context);
  ui.sidebar?.changeTab?.('combat', 'primary');
  ui.sidebar?.expand?.();
  await ui.combat.render({ force: true, combat });
  await pause(300);
}

/** Browser coordinates of the centre of grid cell (col, row) on this client's canvas. */
export function screenPoint(context) {
  fixture(context);
  const point = canvas.clientCoordinatesFromCanvas({ x: (context.col + 0.5) * GRID, y: (context.row + 0.5) * GRID });
  return { x: point.x, y: point.y };
}

export async function moveToken(context) {
  guard(context, true);
  const { token } = fixture(context);
  const document = token(context.key);
  await document.update({ x: context.col * GRID, y: context.row * GRID });
  await document.object?.movementAnimationPromise;
}

export async function setDying(context) {
  guard(context, true);
  const { actor } = fixture(context);
  await actor(context.key ?? 'guardian').increaseCondition('dying', { value: context.value ?? 3 });
}

export async function advanceTurnTo(context) {
  guard(context, true);
  const { combat, token } = fixture(context);
  await combat.update({ turn: combat.turns.findIndex(c => c.tokenId === token(context.key).id) });
}

export async function setFlag(context) {
  guard(context, true);
  const { actor } = fixture(context);
  await actor(context.key).update(context.changes);
}

export async function snapshot(context) {
  const { f, scene, actor, token, combat } = fixture(context);
  const view = key => {
    const document = actor(key);
    const t = token(key);
    return {
      hp: document.system.attributes.hp.value, max: document.system.attributes.hp.max, temp: document.system.attributes.hp.temp,
      col: Math.round(t.x / GRID), row: Math.round(t.y / GRID),
      effects: document.itemTypes.effect.map(e => e.slug ?? e.name),
      conditions: document.itemTypes.condition.map(c => ({ slug: c.slug, value: c.value ?? null })),
      tauntedBy: document.itemTypes.effect.filter(e => e.slug === 'effect-taunt').map(e => e.system.context?.origin?.actor ?? null),
    };
  };
  const guardian = actor('guardian');
  const combatant = combat?.combatants.find(c => c.actorId === guardian.id);
  const messages = game.messages.filter(m => tagged(m, context.runId) || Object.values(f.tokens).includes(m.speaker?.token)).slice(-25);
  const shield = guardian.attributes.shield;
  return {
    guardian: { ...view('guardian'), uuid: guardian.uuid, mythicPoints: guardian.system.resources?.mythicPoints?.value ?? null,
      shield: { raised: shield.raised, hp: shield.hp?.value ?? null },
      toughToKill: guardian.flags?.[SCOPE]?.toughToKill ?? null,
      intercept: guardian.items.find(i => i.slug === 'intercept-attack' && i.type === 'action')?.system.frequency ?? null,
      keepUp: guardian.items.find(i => i.slug === 'keep-up-the-good-fight')?.system.frequency ?? null },
    ally: { ...view('ally'), uuid: actor('ally').uuid }, enemy: { ...view('enemy'), uuid: actor('enemy').uuid }, enemy2: view('enemy2'),
    pool: combatant?.flags?.[SCOPE]?.reactions ?? null,
    regions: [...scene.regions].filter(r => r.flags?.[SCOPE]?.hamperingStance).map(r => ({ id: r.id,
      attached: r.attachment?.token?.id ?? r._source.attachment?.token ?? null, behaviors: r.behaviors.map(b => ({ type: b.type, alliance: b.system?.affects?.alliance ?? null })) })),
    messages: messages.map(m => ({ id: m.id, card: m.flags?.[SCOPE]?.card ?? null, type: m.flags?.pf2e?.context?.type ?? null,
      outcome: m.flags?.pf2e?.context?.outcome ?? null, retargeted: !!m.flags?.[SCOPE]?.retargeted, outcomeChanged: !!m.flags?.[SCOPE]?.outcomeChanged,
      target: m.flags?.pf2e?.context?.target?.actor ?? null, speaker: m.speaker?.actor ?? null, item: m.item?.slug ?? null,
      modifiers: (m.flags?.pf2e?.modifiers ?? []).map(x => x.slug), text: (m.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      flavor: (m.flavor ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) })),
    prompts: [...foundry.applications.instances.values()].filter(a => a.element?.classList.contains('pf2e-guarder-prompt-app')).map(a => a.title),
  };
}

export async function moduleConfiguration(context) {
  guard(context, true);
  return game.settings.get('core', 'moduleConfiguration');
}

/** Enable Sundry for its case, or put the saved configuration back. */
export async function configureSundry(context) {
  guard(context, true);
  const config = foundry.utils.deepClone(game.settings.get('core', 'moduleConfiguration'));
  if (context.restore) {
    if (context.saved.exists) config.sundry = context.saved.value;
    else delete config.sundry;
  } else config.sundry = true;
  await game.settings.set('core', 'moduleConfiguration', config);
}

export async function sundryState(context) {
  const { actor } = fixture(context);
  const effect = actor('guardian').itemTypes.effect.find(e => e.slug === 'effect-reaction-used');
  return { active: game.modules.get('sundry')?.active === true, api: typeof globalThis.sundry?.api?.reactionUsed === 'function',
    tracking: game.modules.get('sundry')?.active ? game.settings.get('sundry', 'track.reaction-usage') : null,
    used: effect ? Number(effect.system?.badge?.value ?? 1) : 0 };
}

export function toolbeltState(context) {
  guard(context);
  const active = game.modules.get('pf2e-toolbelt')?.active === true;
  let targetHelper;
  try { targetHelper = active && game.settings.get('pf2e-toolbelt', 'targetHelper.enabled') === true; } catch { targetHelper = false; }
  return { active, targetHelper };
}

export function leftovers(context) {
  guard(context, true);
  const actors = game.actors.filter(d => tagged(d, context.runId));
  const scenes = game.scenes.filter(d => tagged(d, context.runId));
  const actorIds = new Set(actors.map(d => d.id));
  const sceneIds = new Set(scenes.map(d => d.id));
  return {
    // Only QA-tagged messages or messages spoken by QA actors / on the QA scene.
    messages: game.messages.filter(d => tagged(d, context.runId) || actorIds.has(d.speaker?.actor) || sceneIds.has(d.speaker?.scene)).map(d => d.id),
    combats: game.combats.filter(d => tagged(d, context.runId) || sceneIds.has(d.scene?.id)).map(d => d.id),
    scenes: [...sceneIds], actors: [...actorIds],
  };
}

export async function cleanup(context) {
  const ids = leftovers(context);
  if (ids.messages.length) await ChatMessage.deleteDocuments(ids.messages);
  const failures = [];
  for (const [type, key] of [['Combat', 'combats'], ['Scene', 'scenes'], ['Actor', 'actors']]) {
    try { if (ids[key].length) await globalThis[type].deleteDocuments(ids[key]); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Fixture cleanup failed');
}

export async function restore(context) {
  guard(context);
  const saved = context.saved;
  if (game.user.id !== saved.user) throw Error('Restoration requires original account');
  for (const app of [...foundry.applications.instances.values()]) {
    if (app.id?.startsWith(`${SCOPE}-panel-`) || app.element?.classList.contains('pf2e-guarder-prompt-app')) await app.close();
  }
  await game.user.update({ 'flags.pf2e.settings': saved.userSettings ?? { showCheckDialogs: true, showDamageDialogs: true } });
  if (saved.scene) {
    if (!game.scenes.has(saved.scene)) throw Error('Original scene missing');
    await game.scenes.get(saved.scene).view(saved.level ? { level: saved.level } : {});
    if (canvas.scene?.id !== saved.scene) throw Error('Original scene not restored');
  } else await canvas.draw(null);
  canvas.tokens.releaseAll();
  for (const id of saved.controlled) canvas.tokens.get(id)?.control({ releaseOthers: false });
  for (const token of [...game.user.targets]) token.setTarget(false);
  for (const id of saved.targeted) canvas.tokens.get(id)?.setTarget(true, { releaseOthers: false });
  removeTaggers();
}

export async function setPause(context) {
  guard(context, true);
  await game.togglePause(context.paused, { broadcast: true });
}

export async function restoreWorldTime(context) {
  guard(context, true);
  await game.time.advance(context.value - game.time.worldTime);
}
