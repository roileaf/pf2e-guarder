// Live workflows: real prompts and buttons in both sessions, asserted on persisted Foundry state.
// The guardian (and ally) belong to the QA player, so prompts go to the player's client.

const SQUARE = (s, key) => `${s[key].col},${s[key].row}`;
const adjacent = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) === 1;
const poolLeft = (s) => (s.pool?.general ?? 0) + (s.pool?.guardian ?? 0);
const hasCard = (s, card, text = '') => s.messages.some(m => m.card === card && m.text.includes(text));
const featCard = (s, feat) => s.messages.findLast(m => m.card === 'feat' && m.feat === feat);
const guardianAttacks = (s, guardianId) => s.messages.filter(m => m.type === 'attack-roll' && m.speaker === guardianId);
const savesBy = (s, actorUuid) => s.messages.filter(m => m.type === 'saving-throw' && actorUuid.endsWith(m.speaker));
const conditionValue = (side, slug) => side.conditions.find(c => c.slug === slug)?.value ?? (side.conditions.some(c => c.slug === slug) ? true : null);
// The feat actions post the feat's own card from the player's sheet, with the enemy targeted.
async function useFeat(ctx, h, slug, targets = ['enemy']) {
  await ctx.rpc(ctx.player, 'postItem', { slug, type: 'feat', targets });
  await h.until(`${slug} card posted`, s => Boolean(featCard(s, slug)));
  return h.state();
}

function helpers(ctx) {
  const { gm, rpc, check, eventually } = ctx;
  const state = (page = gm) => rpc(page, 'snapshot');
  const until = (label, predicate) => eventually(label, async () => predicate(await state()));
  const prompt = (page, title) => page.locator('.pf2e-guarder-prompt-app').filter({ has: page.locator('.window-title', { hasText: title }) });
  async function choose(page, title, value) {
    const window = prompt(page, title).first();
    await window.waitFor({ state: 'visible', timeout: 20000 });
    await window.locator(`[data-action="choose"][data-value="${value}"]`).click();
    await window.waitFor({ state: 'detached', timeout: 20000 });
  }
  async function noPrompt(page, title, ms = 2500) {
    await page.waitForTimeout(ms);
    check(`No "${title}" prompt`, await prompt(page, title).count() === 0);
  }
  const arrange = spec => rpc(gm, 'arrange', { spec });
  // Panel buttons get the click event directly: in a long run other windows can sit on top of the panel.
  const panel = page => page.locator('[id^="pf2e-guarder-panel-"]');
  const settle = async () => check('Triggering damage settled', (await rpc(gm, 'settle')) !== 'timeout');
  return { state, until, prompt, choose, noPrompt, arrange, panel, settle };
}

async function intercept(ctx, h, { value = 'auto', before, after } = {}) {
  await h.prompt(ctx.player, 'Intercept Attack').first().waitFor({ state: 'visible' });
  await before?.();
  await ctx.screenshot('prompt');
  await h.choose(ctx.player, 'Intercept Attack', value);
  await after?.();
  await h.settle();
}

const CASES = [
  // ------------------------------------------------------------ Intercept Attack
  { name: 'intercept-step', smoke: true, description: 'Player accepts Intercept Attack: guardian Steps adjacent and takes the damage through its own IWR.',
    async run(ctx, h) {
      const start = await h.arrange({});
      await ctx.rpc(ctx.gm, 'damage', { formula: '12[slashing]' });
      await h.prompt(ctx.gm, 'Intercept Attack — GM').first().waitFor({ state: 'visible' });
      await intercept(ctx, h);
      await h.until('Ally keeps full HP', s => s.ally.hp === s.ally.max);
      const s = await h.state();
      ctx.check('Guardian takes the damage', s.guardian.hp < start.guardian.hp);
      ctx.check('Guardian Stepped adjacent to the ally', adjacent(s.guardian, s.ally) && SQUARE(s, 'guardian') !== SQUARE(start, 'guardian'));
      ctx.check('Guardian-only reaction spent first', s.pool?.general === 1 && s.pool?.guardian === 0);
      ctx.check('Intercept card posted', hasCard(s, 'intercept'));
      ctx.check('GM override board closed', await h.prompt(ctx.gm, 'Intercept Attack — GM').count() === 0);
    } },
  { name: 'intercept-choose-square', description: 'Choose square: the player picks the guardian\'s square next to the ally, limited to the Step.',
    async run(ctx, h) {
      const start = await h.arrange({});
      await ctx.rpc(ctx.gm, 'damage', { formula: '9[slashing]' });
      await intercept(ctx, h, { value: 'manual', after: async () => {
        await ctx.player.waitForTimeout(800);
        await ctx.screenshot('picker');
        await ctx.player.keyboard.press('Enter');
      } });
      const s = await h.state();
      ctx.check('Guardian moved to a chosen square next to the ally', adjacent(s.guardian, s.ally) && SQUARE(s, 'guardian') !== SQUARE(start, 'guardian'));
      ctx.check('Move stayed within the 5-foot Step', Math.max(Math.abs(s.guardian.col - start.guardian.col), Math.abs(s.guardian.row - start.guardian.row)) === 1);
      ctx.check('Ally keeps full HP', s.ally.hp === s.ally.max);
    } },
  { name: 'intercept-large-choose-square', description: 'Large guardian: Choose square picks the exact 2x2 placement clicked, not the suggestion.',
    async run(ctx, h) {
      // A 2x2 guardian west of the ally: its Step can end at (4,5), (4,6) or (4,7); those footprints overlap.
      await h.arrange({ sizes: { guardian: 2 }, positions: { guardian: [3, 6], ally: [6, 6], enemy: [9, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { formula: '9[slashing]' });
      await intercept(ctx, h, { value: 'manual', after: async () => {
        await ctx.player.waitForTimeout(800);
        // Cell (5,8) is covered only by the (4,7) footprint, the last choice in the list.
        const point = await ctx.rpc(ctx.player, 'screenPoint', { col: 5, row: 8 });
        await ctx.player.mouse.move(point.x, point.y);
        await ctx.player.waitForTimeout(200);
        await ctx.screenshot('picker');
        await ctx.player.mouse.click(point.x, point.y);
      } });
      const s = await h.state();
      ctx.check('Large guardian lands on the clicked placement', s.guardian.col === 4 && s.guardian.row === 7);
      ctx.check('Ally keeps full HP', s.ally.hp === s.ally.max);
    } },
  { name: 'intercept-decline', description: 'Player declines: the ally takes the damage and no reaction is spent.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.gm, 'damage', { formula: '7[piercing]' });
      await intercept(ctx, h, { value: 'decline' });
      const s = await h.state();
      ctx.check('Ally takes the damage', s.ally.hp === s.ally.max - 7);
      ctx.check('Guardian untouched', s.guardian.hp === s.guardian.max);
      ctx.check('No reaction spent', poolLeft(s) === 2);
    } },
  { name: 'intercept-gm-force', description: 'GM forces the interception from the override board; the player prompt closes.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.gm, 'damage', { formula: '10[bludgeoning]' });
      await h.prompt(ctx.player, 'Intercept Attack').first().waitFor({ state: 'visible' });
      await ctx.screenshot('board');
      await h.prompt(ctx.gm, 'Intercept Attack — GM').locator('[data-action="choose"][data-value="force-0"]').click();
      await h.settle();
      await ctx.eventually('Player prompt dismissed', async () => await h.prompt(ctx.player, 'Intercept Attack').count() === 0);
      const s = await h.state();
      ctx.check('Ally keeps full HP', s.ally.hp === s.ally.max);
      ctx.check('Guardian takes the damage', s.guardian.hp < s.guardian.max);
      ctx.check('Intercept card posted', hasCard(s, 'intercept'));
    } },
  { name: 'intercept-split', description: 'Mixed roll: the guardian takes the physical part, the ally keeps the fire part.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.gm, 'damage', { formula: '{9[slashing],5[fire]}' });
      await intercept(ctx, h);
      await h.until('Ally takes only the fire damage', s => s.ally.hp === s.ally.max - 5);
      ctx.check('Guardian takes the slashing damage', (await h.state()).guardian.hp < (await h.state()).guardian.max);
    } },
  { name: 'energy-interceptor', description: 'Fire damage triggers Intercept only with Energy Interceptor.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.gm, 'damage', { formula: '6[fire]' });
      await h.settle();
      await h.noPrompt(ctx.player, 'Intercept Attack', 500);
      ctx.check('Without the feat the ally takes fire damage', (await h.state()).ally.hp === (await h.state()).ally.max - 6);
      await h.arrange({ feats: ['energy-interceptor'] });
      await ctx.rpc(ctx.gm, 'damage', { formula: '6[fire]' });
      await intercept(ctx, h);
      const s = await h.state();
      ctx.check('With Energy Interceptor the guardian takes it', s.ally.hp === s.ally.max && s.guardian.hp < s.guardian.max);
    } },
  { name: 'intercept-taunted-stride', description: 'Damage from the guardian\'s taunted enemy: 15 ft range and a Stride into place.',
    async run(ctx, h) {
      await h.arrange({ positions: { guardian: [3, 6], ally: [6, 6], enemy: [8, 6] }, taunted: ['enemy'] });
      ctx.check('Enemy is taunted by the guardian', (await h.state()).enemy.tauntedBy.length === 1);
      await ctx.rpc(ctx.gm, 'damage', { formula: '9[slashing]' });
      await intercept(ctx, h);
      const s = await h.state();
      ctx.check('Guardian Strode adjacent from 15 feet', adjacent(s.guardian, s.ally));
      ctx.check('Guardian ends on the attacker\'s side, between ally and enemy', s.guardian.col > s.ally.col && adjacent(s.guardian, s.enemy));
      ctx.check('Ally keeps full HP', s.ally.hp === s.ally.max);
      ctx.check('Card notes a Stride', hasCard(s, 'intercept', 'Strides'));
    } },
  { name: 'intercept-walls', description: 'Intercept movement and Get Behind Me! never pass through walls.',
    async run(ctx, h) {
      // A wall east of the ally: the guardian may not Stride around to the attacker's side through it.
      await h.arrange({ positions: { guardian: [3, 6], ally: [6, 6], enemy: [8, 6] }, taunted: ['enemy'], walls: [[700, 0, 700, 1400]] });
      await ctx.rpc(ctx.gm, 'damage', { formula: '9[slashing]' });
      await intercept(ctx, h);
      let s = await h.state();
      ctx.check('Guardian reached the ally', adjacent(s.guardian, s.ally));
      ctx.check('Guardian stayed on its side of the wall', s.guardian.col < 7);
      // Walls above and below the ally's row: Get Behind Me! can only move it along the row.
      const start = await h.arrange({ feats: ['get-behind-me'], positions: { guardian: [4, 6], ally: [5, 6], enemy: [7, 6] },
        walls: [[0, 600, 1400, 600], [0, 700, 1400, 700]] });
      await ctx.rpc(ctx.gm, 'damage', { formula: '8[slashing]' });
      await intercept(ctx, h);
      await ctx.player.waitForTimeout(800);
      await ctx.screenshot('picker');
      await ctx.player.keyboard.press('Enter');
      await h.until('Ally moved', x => SQUARE(x, 'ally') !== SQUARE(start, 'ally'));
      s = await h.state();
      ctx.check('Ally stayed between the walls', s.ally.row === 6);
    } },
  { name: 'intercept-shield-block', description: 'Shield Block toggle in the Intercept prompt spends a second reaction.',
    async run(ctx, h) {
      await h.arrange({ shieldRaised: true });
      ctx.check('Shield is raised', (await h.state()).guardian.shield.raised);
      await ctx.rpc(ctx.gm, 'damage', { formula: '14[slashing]' });
      await intercept(ctx, h, { before: () => h.prompt(ctx.player, 'Intercept Attack').locator('input[name="shieldBlock"]').check({ force: true }) });
      await h.until('Both reactions spent', s => poolLeft(s) === 0);
    } },
  // ------------------------------------------------------------ Intercept follow-ups
  { name: 'get-behind-me', description: 'Get Behind Me!: the player picks the ally\'s new square (Enter takes the suggestion).',
    async run(ctx, h) {
      const start = await h.arrange({ feats: ['get-behind-me'], positions: { guardian: [4, 6], ally: [5, 6], enemy: [7, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { formula: '8[slashing]' });
      await intercept(ctx, h, { before: async () => ctx.check('Get Behind Me! toggle is on', await h.prompt(ctx.player, 'Intercept Attack').locator('input[name="getBehindMe"]').isChecked()) });
      await ctx.player.waitForTimeout(800);
      await ctx.screenshot('picker');
      await ctx.player.keyboard.press('Enter');
      await h.until('Ally moved away from the attacker', s => SQUARE(s, 'ally') !== SQUARE(start, 'ally') && Math.abs(s.ally.col - s.enemy.col) >= Math.abs(start.ally.col - start.enemy.col));
    } },
  { name: 'intercept-follow-up-buttons', description: 'Disarming Intercept and Armored Counterattack buttons; Disarm rolls PF2e\'s Disarm.',
    async run(ctx, h) {
      await h.arrange({ feats: ['disarming-intercept', 'armored-counterattack'], positions: { guardian: [6, 7], ally: [6, 6], enemy: [7, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { formula: '8[slashing]' });
      await intercept(ctx, h);
      const card = ctx.player.locator('.chat-message.pf2e-guarder-message').last();
      await card.locator('[data-guarder-followup="disarm"]').waitFor({ state: 'visible' });
      ctx.check('Armored Counterattack button shown', await card.locator('[data-guarder-followup="counterattack"]').count() === 1);
      await ctx.screenshot('card');
      await card.locator('[data-guarder-followup="disarm"]').click();
      await h.until('Disarm check rolled', s => s.messages.some(m => m.type === 'skill-check' && /disarm/i.test(`${m.flavor} ${m.text}`)));
    } },
  { name: 'quick-vengeance', description: 'Quick Vengeance: quickened effect after Intercept Attack.',
    async run(ctx, h) {
      await h.arrange({ feats: ['quick-vengeance'] });
      await ctx.rpc(ctx.gm, 'damage', { formula: '8[slashing]' });
      await intercept(ctx, h);
      await h.until('Guardian has Effect: Quick Vengeance', s => s.guardian.effects.includes('effect-quick-vengeance'));
    } },
  { name: 'guardians-intercept-frequency', description: 'Guardian\'s Intercept frequency is spent; a second hit in 10 minutes is not offered.',
    async run(ctx, h) {
      await h.arrange({ interceptFrequency: { max: 1, value: 1, per: 'PT10M' } });
      await ctx.rpc(ctx.gm, 'damage', { formula: '8[slashing]' });
      await intercept(ctx, h);
      await h.until('Frequency spent', s => s.guardian.intercept?.value === 0);
      await ctx.rpc(ctx.gm, 'damage', { formula: '5[slashing]' });
      await h.settle();
      await h.noPrompt(ctx.player, 'Intercept Attack', 500);
      ctx.check('Ally takes the second hit', (await h.state()).ally.hp === (await h.state()).ally.max - 5);
    } },
  { name: 'unbelievable-interception', description: 'Unbelievable Interception retargets the attack to the guardian; a miss offers a mythic Strike.',
    async run(ctx, h) {
      const start = await h.arrange({ feats: ['unbelievable-interception'], mythicPoints: 1 });
      ctx.check('Guardian has a Mythic Point', start.guardian.mythicPoints === 1);
      const { messageId } = await ctx.rpc(ctx.gm, 'attack', { target: 'ally', total: 4, outcome: 'success', die: 3 });
      await h.prompt(ctx.player, 'Unbelievable Interception').first().waitFor({ state: 'visible' });
      await ctx.screenshot('prompt');
      await h.choose(ctx.player, 'Unbelievable Interception', 'go');
      await h.until('Attack retargeted to the guardian', s => s.messages.some(m => m.id === messageId && m.retargeted && m.target === s.guardian.uuid));
      const s = await h.state();
      ctx.check('Mythic Point spent', s.guardian.mythicPoints === 0);
      ctx.check('Unbelievable card posted', hasCard(s, 'unbelievable'));
      const button = ctx.player.locator('[data-guarder-followup="mythic-strike"]').last();
      await button.waitFor({ state: 'visible' });
      await ctx.screenshot('card');
      await button.click();
      await h.until('Counter-Strike uses mythic proficiency', x => x.messages.some(m => m.type === 'attack-roll' && m.speaker === ctx.fixture.guardian && m.modifiers.includes('mythic-proficiency')));
    } },
  // ------------------------------------------------------------ Guardian reactions
  { name: 'shield-from-arrows', description: 'Shield from Arrows: +4 AC re-grades a ranged hit on an adjacent ally.',
    async run(ctx, h) {
      await h.arrange({ feats: ['shield-from-arrows'], shieldRaised: true, positions: { guardian: [5, 6], ally: [6, 6], enemy: [14, 6] } });
      const { messageId } = await ctx.rpc(ctx.gm, 'attack', { target: 'ally', weapon: 'shortbow', total: 20, dc: 18, outcome: 'success' });
      await h.prompt(ctx.player, 'Shield from Arrows').first().waitFor({ state: 'visible' });
      await ctx.screenshot('prompt');
      await h.choose(ctx.player, 'Shield from Arrows', 'go');
      await h.until('Attack re-graded to a miss', s => s.messages.some(m => m.id === messageId && m.outcome === 'failure' && m.outcomeChanged));
      ctx.check('Reaction spent', poolLeft(await h.state()) === 1);
    } },
  { name: 'shield-from-spells', description: 'Shield from Spells: a spell attack on an adjacent ally also qualifies.',
    async run(ctx, h) {
      await h.arrange({ feats: ['shield-from-arrows', 'shield-from-spells'], shieldRaised: true, positions: { guardian: [5, 6], ally: [6, 6], enemy: [14, 6] } });
      const { messageId } = await ctx.rpc(ctx.gm, 'attack', { type: 'spell-attack-roll', target: 'ally', total: 20, dc: 18, outcome: 'success' });
      await h.choose(ctx.player, 'Shield from Arrows', 'go');
      await h.until('Spell attack re-graded to a miss', s => s.messages.some(m => m.id === messageId && m.outcome === 'failure' && m.outcomeChanged));
      await h.arrange({ feats: ['shield-from-arrows'], shieldRaised: true, positions: { guardian: [5, 6], ally: [6, 6], enemy: [14, 6] } });
      await ctx.rpc(ctx.gm, 'attack', { type: 'spell-attack-roll', target: 'ally', total: 20, dc: 18, outcome: 'success' });
      await h.noPrompt(ctx.player, 'Shield from Arrows');
    } },
  { name: 'reactive-shield', description: 'Reactive Shield raises the shield and re-grades a melee hit.',
    async run(ctx, h) {
      await h.arrange({ feats: ['reactive-shield'], positions: { guardian: [4, 6], ally: [2, 6], enemy: [5, 6] } });
      const { messageId } = await ctx.rpc(ctx.gm, 'attack', { target: 'guardian', total: 19, dc: 18, outcome: 'success' });
      await h.choose(ctx.player, 'Reactive Shield', 'go');
      await h.until('Melee hit re-graded to a miss', s => s.messages.some(m => m.id === messageId && m.outcome === 'failure' && m.outcomeChanged));
      ctx.check('Shield raised', (await h.state()).guardian.shield.raised);
    } },
  { name: 'clang', description: 'Clang!: Stride toward the attacker after a critical miss and make it off-guard.',
    async run(ctx, h) {
      await h.arrange({ feats: ['clang'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [8, 6] } });
      await ctx.rpc(ctx.gm, 'attack', { target: 'guardian', total: 2, dc: 18, outcome: 'criticalFailure', die: 1 });
      await h.choose(ctx.player, 'Clang!', 'stride');
      await h.until('Guardian ends adjacent to the attacker', s => adjacent(s.guardian, s.enemy));
      await h.until('Attacker is off-guard from Clang!', s => s.enemy.effects.some(e => /clang/i.test(e)));
      ctx.check('Clang! card posted', hasCard(await h.state(), 'reaction', 'Clang'));
    } },
  { name: 'clang-strike', description: 'Clang!: the Strike choice rolls the guardian\'s melee Strike at the attacker.',
    async run(ctx, h) {
      await h.arrange({ feats: ['clang'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'attack', { target: 'guardian', total: 2, dc: 18, outcome: 'criticalFailure', die: 1 });
      await h.choose(ctx.player, 'Clang!', 'strike');
      await h.until('Guardian Strikes the attacker', s => s.messages.some(m => m.type === 'attack-roll' && m.speaker === ctx.fixture.guardian && m.target === s.enemy.uuid));
      await h.until('Clang! card notes the Strike', s => hasCard(s, 'reaction', 'Strikes'));
    } },
  { name: 'reactive-strike-ranged', description: 'Reactive Strike when an adjacent enemy makes a ranged attack.',
    async run(ctx, h) {
      await h.arrange({ feats: ['reactive-strike'], positions: { guardian: [4, 6], ally: [9, 6], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'attack', { target: 'ally', weapon: 'shortbow', total: 5, dc: 18, outcome: 'failure' });
      await h.choose(ctx.player, 'Reaction', 'reactive-strike');
      await h.until('Reactive Strike card and Strike posted', s => hasCard(s, 'reaction', 'ranged attack') && s.messages.some(m => m.type === 'attack-roll' && m.speaker === ctx.fixture.guardian));
      ctx.check('Reaction spent', poolLeft(await h.state()) === 1);
    } },
  { name: 'reactive-strike-manipulate', description: 'Reactive Strike when an adjacent enemy uses a manipulate action.',
    async run(ctx, h) {
      await h.arrange({ feats: ['reactive-strike'], positions: { guardian: [4, 6], ally: [9, 6], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'postItem', { actor: 'enemy', name: 'QA Manipulate' });
      await h.choose(ctx.player, 'Reaction', 'reactive-strike');
      await h.until('Card names the manipulate trigger', s => hasCard(s, 'reaction', 'manipulate'));
    } },
  { name: 'reactive-strike-movement', description: 'Reactive Strike when an enemy leaves a square within reach.',
    async run(ctx, h) {
      await h.arrange({ feats: ['reactive-strike'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'moveToken', { key: 'enemy', col: 9, row: 6 });
      await h.choose(ctx.player, 'Reaction', 'reactive-strike');
      await h.until('Card names the movement trigger', s => hasCard(s, 'reaction', 'left a square'));
    } },
  { name: 'not-so-fast', description: 'Not So Fast! is offered in Hampering Stance when an enemy moves away.',
    async run(ctx, h) {
      await h.arrange({ feats: ['not-so-fast', 'hampering-stance'], stance: true, positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'moveToken', { key: 'enemy', col: 9, row: 6 });
      await h.choose(ctx.player, 'Reaction', 'not-so-fast');
      await h.until('Not So Fast! card posted', s => hasCard(s, 'reaction', 'Not So Fast'));
    } },
  { name: 'keep-up-the-good-fight', description: 'Keep Up the Good Fight: 1 HP, wounded, no dying after an enemy drops the guardian.',
    async run(ctx, h) {
      await h.arrange({ feats: ['keep-up-the-good-fight'], positions: { guardian: [4, 6], ally: [12, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { target: 'guardian', formula: '200[bludgeoning]' });
      await h.settle();
      await h.choose(ctx.player, 'Keep Up the Good Fight', 'go');
      await h.until('Keep Up the Good Fight card posted', s => hasCard(s, 'reaction', 'Keep Up the Good Fight'));
      await h.until('Guardian back at 1 HP, wounded, not dying', s => s.guardian.hp === 1 && s.guardian.conditions.some(c => c.slug === 'wounded')
        && !s.guardian.conditions.some(c => ['dying', 'unconscious'].includes(c.slug)));
      const s = await h.state();
      await h.until('Frequency spent', x => x.guardian.keepUp?.value === 0);
      ctx.check('Wounded only once', s.guardian.conditions.find(c => c.slug === 'wounded')?.value === 1);
    } },
  { name: 'tough-to-kill', description: 'Tough to Kill: the first dying 3 of the day becomes dying 2.',
    async run(ctx, h) {
      await h.arrange({ feats: ['tough-to-kill'] });
      await ctx.rpc(ctx.gm, 'setDying', { value: 3 });
      await h.until('Dying clamped to 2', s => s.guardian.conditions.find(c => c.slug === 'dying')?.value === 2);
      await h.until('Day marked and card posted', s => s.guardian.toughToKill !== null && hasCard(s, 'reaction', 'Tough to Kill'));
    } },
  { name: 'shield-block-native', description: 'PF2e\'s own Shield Block spends a tracked reaction and triggers Quick Vengeance.',
    async run(ctx, h) {
      await h.arrange({ feats: ['quick-vengeance'], shieldRaised: true, positions: { guardian: [4, 6], ally: [12, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { target: 'guardian', formula: '12[slashing]', shieldBlock: true });
      await h.settle();
      await h.until('Reaction spent by Shield Block', s => poolLeft(s) === 1);
      await h.until('Quick Vengeance granted', s => s.guardian.effects.includes('effect-quick-vengeance'));
    } },
  { name: 'posted-reaction-spends', description: 'A reaction feat posted from the sheet spends a tracked reaction.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.player, 'postItem', { slug: 'shield-block', reaction: true });
      await h.until('Posting Shield Block spent a reaction', s => poolLeft(s) === 1);
    } },
  // ------------------------------------------------------------ Taunt
  { name: 'taunt-apply', smoke: true, description: 'Player Taunts a targeted enemy: PF2e\'s Effect: Taunt with the guardian as origin.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.player, 'postItem', { slug: 'taunt', targets: ['enemy'] });
      await h.until('Enemy taunted by the guardian', s => s.enemy.tauntedBy.includes(s.guardian.uuid));
      await ctx.eventually('Panel lists the taunted enemy', async () => await h.panel(ctx.player).locator('[data-action="endTaunt"]').count() === 1);
      await h.panel(ctx.player).locator('[data-action="endTaunt"]').dispatchEvent('click');
      await h.until('End removes the taunt', s => !s.enemy.tauntedBy.length);
    } },
  { name: 'taunt-limits', description: 'One taunt at a time; Group Taunt keeps several.',
    async run(ctx, h) {
      await h.arrange({ positions: { enemy2: [8, 8] } });
      await ctx.rpc(ctx.player, 'postItem', { slug: 'taunt', targets: ['enemy'] });
      await h.until('First enemy taunted', s => s.enemy.tauntedBy.length === 1);
      await ctx.rpc(ctx.player, 'postItem', { slug: 'taunt', targets: ['enemy2'] });
      await h.until('Second taunt replaces the first', s => s.enemy2.tauntedBy.length === 1 && !s.enemy.tauntedBy.length);
      await h.arrange({ feats: ['group-taunt'], positions: { enemy2: [8, 8] } });
      await ctx.rpc(ctx.player, 'postItem', { slug: 'taunt', targets: ['enemy', 'enemy2'] });
      await h.until('Group Taunt taunts both', s => s.enemy.tauntedBy.length === 1 && s.enemy2.tauntedBy.length === 1);
    } },
  { name: 'taunt-range', description: 'Out-of-range Taunt asks; "Taunt anyway" applies it.',
    async run(ctx, h) {
      await h.arrange({ positions: { enemy: [14, 6] } });
      await ctx.rpc(ctx.player, 'postItem', { slug: 'taunt', targets: ['enemy'] });
      await h.prompt(ctx.player, 'Taunt').first().waitFor({ state: 'visible' });
      await ctx.screenshot('prompt');
      await h.choose(ctx.player, 'Taunt', 'include');
      await h.until('Out-of-range enemy taunted', s => s.enemy.tauntedBy.length === 1);
    } },
  { name: 'long-distance-taunt', description: 'Long-Distance Taunt: 120-foot range without asking.',
    async run(ctx, h) {
      await h.arrange({ feats: ['long-distance-taunt'], positions: { enemy: [24, 6] } });
      await ctx.rpc(ctx.player, 'postItem', { slug: 'taunt', targets: ['enemy'] });
      await h.until('Enemy 100 ft away taunted', s => s.enemy.tauntedBy.length === 1);
      await h.noPrompt(ctx.player, 'Taunt', 500);
    } },
  { name: 'taunt-card-button', description: 'Apply Taunt to targets button on a Taunt card posted without targets.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.player, 'postItem', { slug: 'taunt', targets: [] });
      const button = ctx.player.locator('[data-guarder-action="apply-taunt"]').last();
      await button.waitFor({ state: 'visible' });
      await ctx.rpc(ctx.player, 'setTargets', { keys: ['enemy'] });
      await button.click();
      await h.until('Button taunts the targeted enemy', s => s.enemy.tauntedBy.length === 1);
    } },
  { name: 'taunt-off-guard', description: 'A taunted enemy attacking an ally becomes off-guard.',
    async run(ctx, h) {
      await h.arrange({ taunted: ['enemy'] });
      await ctx.rpc(ctx.gm, 'attack', { target: 'ally', total: 5, dc: 18, outcome: 'failure' });
      await h.until('Enemy off-guard for attacking an ally', s => s.enemy.effects.includes('effect-taunted-off-guard'));
    } },
  { name: 'taunt-spell-reminder', description: 'A taunted enemy\'s spell without known targets whispers the GM an off-guard button.',
    async run(ctx, h) {
      await h.arrange({ taunted: ['enemy'] });
      await ctx.rpc(ctx.gm, 'castSpell', {});
      const button = ctx.gm.locator('[data-guarder-action="taunt-off-guard"]').last();
      await button.waitFor({ state: 'visible' });
      ctx.check('Player does not see the GM reminder', await ctx.player.locator('[data-guarder-action="taunt-off-guard"]').count() === 0);
      await ctx.screenshot('reminder');
      await button.click();
      await h.until('Reminder button makes the enemy off-guard', s => s.enemy.effects.includes('effect-taunted-off-guard'));
    } },
  { name: 'taunt-toolbelt-targets', environment: { modules: ['pf2e-toolbelt'] }, description: 'Toolbelt Target Helper targets on a taunted enemy\'s action decide off-guard.',
    async run(ctx, h) {
      const toolbelt = await ctx.rpc(ctx.gm, 'toolbeltState');
      if (!toolbelt.active) return { blocked: 'pf2e-toolbelt is not active' };
      await h.arrange({ taunted: ['enemy'] });
      const { messageId } = await ctx.rpc(ctx.gm, 'postItem', { actor: 'enemy', name: 'QA Manipulate' });
      await ctx.rpc(ctx.gm, 'setToolbeltTargets', { messageId, keys: ['ally'] });
      await h.until('Set targets on the card makes the enemy off-guard', s => s.enemy.effects.includes('effect-taunted-off-guard'));
    } },
  // ------------------------------------------------------------ Hampering Stance
  { name: 'hampering-stance-chat', description: 'Posting Hampering Stance starts it with an enemy-only terrain area; the card button ends and restarts it.',
    async run(ctx, h) {
      await h.arrange({ feats: ['hampering-stance'] });
      await ctx.rpc(ctx.player, 'postItem', { slug: 'hampering-stance' });
      await h.until('Stance effect and attached terrain region', s => s.guardian.effects.includes('guarder-hampering-stance')
        && s.regions.length === 1 && s.regions[0].attached === ctx.fixture.tokens.guardian);
      const s = await h.state();
      const toolbelt = (await ctx.rpc(ctx.gm, 'toolbeltState')).active;
      const behavior = s.regions[0].behaviors[0];
      ctx.check(toolbelt ? 'Toolbelt terrain affects enemies only' : 'Native difficult terrain', toolbelt
        ? behavior.type === 'pf2e-toolbelt.difficult-terrain' && behavior.alliance === 'enemies' : behavior.type === 'modifyMovementCost');
      await ctx.rpc(ctx.gm, 'moveToken', { key: 'guardian', col: 4, row: 9 });
      await h.until('Region stays attached after moving', x => x.regions.length === 1 && x.regions[0].attached === ctx.fixture.tokens.guardian);
      const card = ctx.player.locator('[data-guarder-action="stance"][data-stance="hampering-stance"]').last();
      await ctx.eventually('Card offers End', async () => /End Hampering Stance/.test(await card.innerText()));
      await ctx.screenshot('stance');
      await card.click();
      await h.until('Ending removes effect and region', x => !x.guardian.effects.includes('guarder-hampering-stance') && !x.regions.length);
      await ctx.eventually('Card offers Enter', async () => /Enter Hampering Stance/.test(await card.innerText()));
      await card.click();
      await h.until('Enter restarts the stance', x => x.guardian.effects.includes('guarder-hampering-stance') && x.regions.length === 1);
    } },
  { name: 'hampering-stance-panel', description: 'Guardian panel toggles Hampering Stance.',
    async run(ctx, h) {
      await h.arrange({ feats: ['hampering-stance'] });
      const toggle = h.panel(ctx.player).locator('[data-action="toggleStance"]');
      await toggle.waitFor({ state: 'visible' });
      await toggle.click();
      await h.until('Panel enters the stance', s => s.guardian.effects.includes('guarder-hampering-stance') && s.regions.length === 1);
      await ctx.screenshot('stance');
      await h.panel(ctx.player).locator('[data-action="toggleStance"]').dispatchEvent('click');
      await h.until('Panel ends the stance', s => !s.guardian.effects.includes('guarder-hampering-stance') && !s.regions.length);
    } },
  // ------------------------------------------------------------ Panel, tracker, reactions
  { name: 'panel-open', smoke: true, description: 'Guardian panel opens from the sheet header and the token HUD.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.player, 'closePanels');
      await ctx.rpc(ctx.player, 'openSheet');
      const sheet = ctx.player.locator('.app.sheet, .application.sheet').filter({ hasText: 'QA Guardian' }).first();
      await sheet.waitFor({ state: 'visible' });
      // PF2e's character sheet is an Application V1: a header button with the control's class.
      // The sheet animates open; a click during the animation can miss, so retry until the panel shows.
      const header = ctx.player.locator('.window-header a.pf2e-guarder-panel').first();
      await header.waitFor({ state: 'visible' });
      for (let attempt = 0; attempt < 3 && !(await h.panel(ctx.player).isVisible()); attempt++) {
        await ctx.player.waitForTimeout(400);
        await header.click();
        await h.panel(ctx.player).waitFor({ state: 'visible', timeout: 4000 }).catch(() => null);
      }
      await h.panel(ctx.player).waitFor({ state: 'visible' });
      ctx.check('Panel shows the guardian', /QA Guardian/.test(await h.panel(ctx.player).innerText()));
      await ctx.screenshot('header');
      await ctx.rpc(ctx.player, 'closePanels');
      await ctx.rpc(ctx.player, 'closeSheet');
      await ctx.rpc(ctx.player, 'openHud');
      await ctx.player.locator('#token-hud [data-action="pf2e-guarder-panel"]').click();
      await h.panel(ctx.player).waitFor({ state: 'visible' });
      check(ctx, 'Player panel has no GM reaction buttons', await h.panel(ctx.player).locator('[data-action="toggleReaction"]').count() === 0);
    } },
  { name: 'panel-reaction-glyphs', description: 'GM clicks reaction glyphs in the panel to spend and restore.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.gm, 'openPanel');
      const glyph = spent => h.panel(ctx.gm).locator(`[data-action="toggleReaction"][data-spent="${spent}"]`).first();
      await glyph(false).dispatchEvent('click');
      await h.until('Glyph click spends one', s => poolLeft(s) === 1);
      await ctx.screenshot('spent');
      await glyph(true).dispatchEvent('click');
      await h.until('Spent glyph click restores it', s => poolLeft(s) === 2);
    } },
  { name: 'bodyguard', description: 'Panel Bodyguard charge applies PF2e\'s Effect: Bodyguard to the ally.',
    async run(ctx, h) {
      const start = await h.arrange({ feats: ['bodyguard'] });
      const select = h.panel(ctx.player).locator('select[name="charge"]');
      await select.waitFor({ state: 'visible' });
      await select.selectOption(start.ally.uuid);
      await h.until('Ally has Effect: Bodyguard', s => s.ally.effects.includes('effect-bodyguard'));
      await h.panel(ctx.player).locator('select[name="charge"]').selectOption('');
      await h.until('Clearing the charge removes it', s => !s.ally.effects.includes('effect-bodyguard'));
    } },
  { name: 'tracker-badge', description: 'Combat tracker badge: click spends, right-click restores.',
    async run(ctx, h) {
      await h.arrange({});
      await ctx.rpc(ctx.gm, 'showCombat');
      await ctx.rpc(ctx.player, 'showCombat');
      const badge = ctx.gm.locator('.pf2e-guarder-reactions').first();
      await badge.waitFor({ state: 'visible' });
      ctx.check('Player sees the badge', await ctx.player.locator('.pf2e-guarder-reactions').count() > 0);
      await badge.click();
      await h.until('Badge click spends one', s => poolLeft(s) === 1);
      await ctx.screenshot('badge');
      await ctx.gm.locator('.pf2e-guarder-reactions').first().click({ button: 'right' });
      await h.until('Right-click restores it', s => poolLeft(s) === 2);
      for (let i = 0; i < 3; i++) await ctx.gm.locator('.pf2e-guarder-reactions').first().click({ button: 'right' });
      await ctx.gm.waitForTimeout(800);
      ctx.check('Restores stop at the guardian\'s maximum', poolLeft(await h.state()) === 2);
    } },
  // ------------------------------------------------------------ High-level feats
  { name: 'boundless-reprisals', description: 'Boundless Reprisals: an extra guardian reaction only during enemy turns, spent first.',
    async run(ctx, h) {
      await h.arrange({ feats: ['boundless-reprisals'], pool: { general: 1, guardian: 0 } });
      await ctx.rpc(ctx.gm, 'advanceTurnTo', { key: 'ally' });
      await h.until('No Boundless reaction on an ally\'s turn', s => (s.pool?.boundless ?? 0) === 0);
      await ctx.rpc(ctx.gm, 'advanceTurnTo', { key: 'enemy' });
      await h.until('Boundless reaction at the start of an enemy\'s turn', s => s.pool?.boundless === 1 && s.pool?.general === 1);
      await ctx.eventually('Panel shows the Boundless glyph', async () => await h.panel(ctx.player).locator('.action-glyph.boundless').count() === 1);
      await ctx.screenshot('boundless');
      await ctx.rpc(ctx.gm, 'damage', { formula: '8[slashing]' });
      await intercept(ctx, h);
      await h.until('Intercept spends the Boundless reaction first', s => s.pool?.boundless === 0 && s.pool?.general === 1);
      await ctx.rpc(ctx.gm, 'advanceTurnTo', { key: 'ally' });
      await h.until('Still none on the next non-enemy turn', s => (s.pool?.boundless ?? 0) === 0);
    } },
  { name: 'paragons-guard', description: 'Paragon\'s Guard: posting the stance keeps the shield raised; entering Hampering Stance ends it.',
    async run(ctx, h) {
      await h.arrange({ feats: ['paragons-guard', 'hampering-stance'] });
      await ctx.rpc(ctx.player, 'postItem', { slug: 'paragons-guard' });
      await h.until('Stance effect keeps the shield raised', s => s.guardian.effects.includes('guarder-paragons-guard') && s.guardian.shield.raised);
      const card = ctx.player.locator('[data-guarder-action="stance"][data-stance="paragons-guard"]').last();
      await ctx.eventually('Card offers End Paragon\'s Guard', async () => /End Paragon/.test(await card.innerText()));
      await ctx.screenshot('stance');
      await h.panel(ctx.player).locator('[data-action="toggleStance"][data-slug="hampering-stance"]').dispatchEvent('click');
      await h.until('Hampering Stance replaces Paragon\'s Guard', s => s.guardian.effects.includes('guarder-hampering-stance')
        && !s.guardian.effects.includes('guarder-paragons-guard') && !s.guardian.shield.raised);
      await h.panel(ctx.player).locator('[data-action="toggleStance"][data-slug="paragons-guard"]').dispatchEvent('click');
      await h.until('Panel switches back to Paragon\'s Guard', s => s.guardian.effects.includes('guarder-paragons-guard') && !s.guardian.effects.includes('guarder-hampering-stance'));
    } },
  { name: 'tough-cookie', description: 'Tough Cookie: half-max temporary HP at half HP or less, once per day, with an override prompt.',
    async run(ctx, h) {
      const start = await h.arrange({ feats: ['tough-cookie'], hp: 20 });
      await ctx.rpc(ctx.player, 'postItem', { slug: 'tough-cookie' });
      const amount = Math.floor(start.guardian.max / 2);
      await h.until('Temporary HP equal to half maximum', s => s.guardian.temp === amount && s.guardian.effects.includes('guarder-tough-cookie'));
      ctx.check('Tough Cookie card posted', hasCard(await h.state(), 'reaction', 'Tough Cookie'));
      await ctx.rpc(ctx.player, 'postItem', { slug: 'tough-cookie' });
      await h.prompt(ctx.player, 'Tough Cookie').first().waitFor({ state: 'visible' });
      await ctx.screenshot('again');
      await h.choose(ctx.player, 'Tough Cookie', 'cancel');
      ctx.check('Second use the same day is refused when cancelled', (await h.state()).messages.filter(m => m.card === 'reaction' && m.text.includes('Tough Cookie')).length === 1);
    } },
  { name: 'shield-salvation', description: 'Shield Salvation: a Shield Block that would destroy the shield leaves it at 1 HP, once per day.',
    async run(ctx, h) {
      await h.arrange({ feats: ['shield-salvation'], shieldRaised: true, positions: { guardian: [4, 6], ally: [12, 9], enemy: [5, 6] } });
      // 11 HP: intact (Broken Threshold 10), so it can Shield Block; 30 damage minus hardness 5 would destroy it.
      await ctx.rpc(ctx.gm, 'setShieldHp', { value: 11 });
      await ctx.rpc(ctx.gm, 'damage', { target: 'guardian', formula: '30[slashing]', shieldBlock: true });
      await h.settle();
      await h.until('Shield survives at 1 HP', s => s.guardian.shield.hp === 1 && !s.guardian.shield.destroyed);
      ctx.check('Shield Salvation card posted', hasCard(await h.state(), 'reaction', 'Shield Salvation'));
      await ctx.rpc(ctx.gm, 'setShieldHp', { value: 11 });
      await ctx.rpc(ctx.gm, 'damage', { target: 'guardian', formula: '30[slashing]', shieldBlock: true });
      await h.settle();
      await h.until('Second time the same day the shield is destroyed', s => s.guardian.shield.hp === 0);
    } },
  { name: 'opening-stance', description: 'Opening Stance: rolling initiative offers a free stance.',
    async run(ctx, h) {
      await h.arrange({ feats: ['opening-stance', 'hampering-stance', 'paragons-guard'] });
      await ctx.rpc(ctx.gm, 'setInitiative', { value: 18 });
      await h.prompt(ctx.player, 'Opening Stance').first().waitFor({ state: 'visible' });
      ctx.check('Both stances are offered', await h.prompt(ctx.player, 'Opening Stance').locator('[data-value="hampering-stance"], [data-value="paragons-guard"]').count() === 2);
      await ctx.screenshot('prompt');
      await h.choose(ctx.player, 'Opening Stance', 'paragons-guard');
      await h.until('Chosen stance entered', s => s.guardian.effects.includes('guarder-paragons-guard') && s.guardian.shield.raised);
      await ctx.rpc(ctx.gm, 'setInitiative', { value: 12 });
      await h.noPrompt(ctx.player, 'Opening Stance');
    } },
  // ------------------------------------------------------------ Feat actions
  { name: 'feat-taunting-strike', description: 'Taunting Strike Strikes and then Taunts the target; Shielding Taunt raises the shield and Taunts.',
    async run(ctx, h) {
      await h.arrange({ feats: ['taunting-strike', 'shielding-taunt'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      let s = await useFeat(ctx, h, 'taunting-strike');
      ctx.check('Taunting Strike rolled a Strike', guardianAttacks(s, ctx.fixture.guardian).length === 1);
      ctx.check('Taunting Strike taunted the target', s.enemy.tauntedBy.includes(s.guardian.uuid));
      await h.arrange({ feats: ['shielding-taunt'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      s = await useFeat(ctx, h, 'shielding-taunt');
      ctx.check('Shielding Taunt raised the shield and taunted', s.guardian.shield.raised && s.enemy.tauntedBy.includes(s.guardian.uuid));
    } },
  { name: 'feat-shield-wallop', description: 'Shield Wallop stupefies on a hit; Devastating Shield Wallop applies its save result.',
    async run(ctx, h) {
      await h.arrange({ feats: ['shield-wallop', 'devastating-shield-wallop'], attackBonus: 40, saveMalus: -40, positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      const s = await useFeat(ctx, h, 'shield-wallop');
      const attack = guardianAttacks(s, ctx.fixture.guardian).at(-1);
      ctx.check('Shield Strike hit', attack && attack.degree >= 2);
      await h.until('Stupefied by degree', x => x.enemy.effects.some(e => e.startsWith('guarder-shield-wallop'))
        && conditionValue(x.enemy, 'stupefied') === (attack.degree === 3 ? 2 : 1));
      const save = savesBy(await h.state(), s.enemy.uuid).at(-1);
      ctx.check('Devastating Shield Wallop save rolled', save && save.degree !== null);
      const x = await h.state();
      const expected = { 2: () => x.enemy.effects.some(e => e.startsWith('guarder-devastating')), 1: () => conditionValue(x.enemy, 'prone'), 0: () => conditionValue(x.enemy, 'prone') && conditionValue(x.enemy, 'stunned') === 1, 3: () => true }[save.degree];
      await h.until('Devastating result applied for the save rolled', y => { void y; return expected(); });
    } },
  { name: 'feat-weakening-assault', description: 'Weakening Assault: two Strikes at a taunted enemy, enfeebled by hits.',
    async run(ctx, h) {
      await h.arrange({ feats: ['weakening-assault'], attackBonus: 40, taunted: ['enemy'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      const s = await useFeat(ctx, h, 'weakening-assault');
      const hits = guardianAttacks(s, ctx.fixture.guardian).slice(-2).filter(a => a.degree >= 2).length;
      ctx.check('Two Strikes rolled', guardianAttacks(s, ctx.fixture.guardian).length >= 2);
      await h.until('Enfeebled 1 or 3 by hits', x => conditionValue(x.enemy, 'enfeebled') === (hits >= 2 ? 3 : hits === 1 ? 1 : null));
    } },
  { name: 'feat-ring-their-bell', description: 'Ring Their Bell: fist Strike at a taunted off-guard enemy, stunned by the incapacitation save.',
    async run(ctx, h) {
      await h.arrange({ feats: ['ring-their-bell'], attackBonus: 40, saveMalus: -40, taunted: ['enemy'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'attack', { target: 'ally', total: 5, dc: 18, outcome: 'failure' });
      await h.until('Taunted enemy off-guard for attacking an ally', x => x.enemy.effects.includes('effect-taunted-off-guard'));
      const s = await useFeat(ctx, h, 'ring-their-bell');
      const save = savesBy(s, s.enemy.uuid).at(-1);
      ctx.check('Incapacitation save rolled after the hit', save && save.degree !== null);
      const stunned = { 3: null, 2: 1, 1: 2, 0: 3 }[save.degree];
      await h.until('Stunned by the save', x => conditionValue(x.enemy, 'stunned') === stunned);
    } },
  { name: 'feat-bloody-denial', description: 'Bloody Denial: Strike, save (worse on a crit), no-reactions effect.',
    async run(ctx, h) {
      await h.arrange({ feats: ['bloody-denial'], attackBonus: 40, saveMalus: -40, positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      const s = await useFeat(ctx, h, 'bloody-denial');
      const save = savesBy(s, s.enemy.uuid).at(-1);
      ctx.check('Save rolled after the hit', save && save.degree !== null);
      await h.until('No-reactions effect applied', x => save.degree === 3 || x.enemy.effects.some(e => e.startsWith('guarder-bloody-denial')));
    } },
  { name: 'feat-shoulder-check', description: 'Shoulder Check: fist Strike with off-guard results by degree.',
    async run(ctx, h) {
      await h.arrange({ feats: ['shoulder-check'], attackBonus: 40, positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      const s = await useFeat(ctx, h, 'shoulder-check');
      const attack = guardianAttacks(s, ctx.fixture.guardian).at(-1);
      ctx.check('Fist Strike hit', attack && attack.degree >= 2);
      await h.until('Target off-guard from Shoulder Check', x => x.enemy.effects.some(e => e.startsWith('guarder-shoulder-check')));
    } },
  { name: 'feat-stomp-ground', description: 'Stomp Ground: Reflex saves within 5 ft, prone on a failure.',
    async run(ctx, h) {
      await h.arrange({ feats: ['stomp-ground'], saveMalus: -40, positions: { guardian: [4, 6], ally: [12, 9], enemy: [5, 6], enemy2: [3, 6] } });
      const s = await useFeat(ctx, h, 'stomp-ground', []);
      ctx.check('Both adjacent creatures saved', savesBy(s, s.enemy.uuid).length >= 1);
      await h.until('Failed saves knock creatures prone', x => conditionValue(x.enemy, 'prone') && conditionValue(x.enemy2, 'prone'));
      ctx.check('Far ally unaffected', !conditionValue((await h.state()).ally, 'prone'));
    } },
  { name: 'feat-armored-courage', description: 'Armored Courage: temporary HP equal to level, frightened reduced, once per hour.',
    async run(ctx, h) {
      await h.arrange({ feats: ['armored-courage'] });
      await ctx.rpc(ctx.gm, 'setCondition', { key: 'guardian', slug: 'frightened', value: 2 });
      const s = await useFeat(ctx, h, 'armored-courage', []);
      await h.until('Temporary HP equal to level', x => x.guardian.temp === 3 && x.guardian.effects.includes('guarder-armored-courage'));
      ctx.check('Frightened reduced by 1', conditionValue((await h.state()).guardian, 'frightened') === 1);
      void s;
      await ctx.rpc(ctx.player, 'postItem', { slug: 'armored-courage', type: 'feat', targets: [] });
      await h.prompt(ctx.player, 'Armored Courage').first().waitFor({ state: 'visible' });
      await h.choose(ctx.player, 'Armored Courage', 'cancel');
    } },
  { name: 'feat-lock-down-belly-flop', description: 'Lock Down in Hampering Stance and Belly Flop on a prone enemy.',
    async run(ctx, h) {
      await h.arrange({ feats: ['lock-down', 'hampering-stance'], stance: true, attackBonus: 40, positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      await useFeat(ctx, h, 'lock-down');
      await h.until('Locked down', x => x.enemy.effects.some(e => e.startsWith('guarder-lock-down')));
      await h.arrange({ feats: ['belly-flop'], attackBonus: 40, prone: ['enemy'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      await useFeat(ctx, h, 'belly-flop');
      await h.until('Guardian prone, target immobilized', x => conditionValue(x.guardian, 'prone') && conditionValue(x.enemy, 'immobilized'));
    } },
  { name: 'feat-momentum-strike', description: 'Momentum Strike: on a hit the player picks the target\'s square within reach.',
    async run(ctx, h) {
      const start = await h.arrange({ feats: ['momentum-strike'], attackBonus: 40, positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.player, 'postItem', { slug: 'momentum-strike', type: 'feat', targets: ['enemy'] });
      await ctx.player.waitForTimeout(2500);
      await ctx.screenshot('picker');
      await ctx.player.keyboard.press('Enter');
      await h.until('Target moved and still within reach', x => SQUARE(x, 'enemy') !== SQUARE(start, 'enemy')
        && Math.max(Math.abs(x.enemy.col - x.guardian.col), Math.abs(x.enemy.row - x.guardian.row)) <= 1);
    } },
  { name: 'feat-movement-buttons', description: 'Defensive Advance raises the shield and its card Strikes an enemy in reach.',
    async run(ctx, h) {
      await h.arrange({ feats: ['defensive-advance'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      const s = await useFeat(ctx, h, 'defensive-advance', []);
      ctx.check('Shield raised', s.guardian.shield.raised);
      const button = ctx.player.locator('[data-guarder-followup="strike-in-reach"]').last();
      await button.waitFor({ state: 'visible' });
      await button.click();
      await h.until('Card button Strikes the enemy in reach', x => guardianAttacks(x, ctx.fixture.guardian).some(a => a.target === x.enemy.uuid));
    } },
  { name: 'feat-shield-block-follow-ups', description: 'Aggressive Block (GM picks off-guard) and Repositioning Block button after Shield Block.',
    async run(ctx, h) {
      await h.arrange({ feats: ['aggressive-block', 'repositioning-block'], shieldRaised: true, positions: { guardian: [4, 6], ally: [12, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { target: 'guardian', formula: '12[slashing]', shieldBlock: true });
      await h.settle();
      await h.prompt(ctx.gm, 'Aggressive Block').first().waitFor({ state: 'visible' });
      await ctx.screenshot('aggressive');
      await h.choose(ctx.gm, 'Aggressive Block', 'off-guard');
      await h.until('Attacker off-guard from Aggressive Block', x => x.enemy.effects.some(e => e.startsWith('guarder-aggressive-block')));
      await ctx.player.locator('[data-guarder-followup="reposition"]').last().waitFor({ state: 'visible' });
    } },
  { name: 'feat-covering-stance', description: 'Covering Stance: at the end of the guardian\'s turn, an adjacent ally gets lesser cover until it moves away.',
    async run(ctx, h) {
      await h.arrange({ feats: ['covering-stance'], positions: { guardian: [4, 6], ally: [5, 6], enemy: [9, 6] } });
      await ctx.rpc(ctx.player, 'postItem', { slug: 'covering-stance', type: 'feat', targets: [] });
      await h.until('Covering Stance entered', x => x.guardian.effects.includes('guarder-covering-stance'));
      await ctx.rpc(ctx.gm, 'advanceTurnTo', { key: 'guardian' });
      await ctx.rpc(ctx.gm, 'advanceTurnTo', { key: 'ally' });
      await h.prompt(ctx.player, 'Covering Stance').first().waitFor({ state: 'visible' });
      await h.choose(ctx.player, 'Covering Stance', (await h.state()).ally.token);
      await h.until('Ally has lesser cover', x => x.ally.effects.includes('guarder-covering-stance-cover'));
      // The cover must reach a real attack: through Visioner's auto-cover when it's on, else Guarder's +1 AC.
      const visioner = await ctx.rpc(ctx.gm, 'visionerState');
      if (visioner.minimum) {
        await ctx.rpc(ctx.gm, 'realStrike', { attacker: 'enemy', target: 'ally' });
        await h.until('Visioner applies at least lesser cover to the enemy\'s Strike', x => {
          const strike = x.messages.findLast(m => m.type === 'attack-roll' && m.speaker === ctx.fixture.enemy);
          return ['lesser', 'standard', 'greater'].includes(strike?.cover);
        });
        ctx.check('The cover effect carries Visioner\'s rule', visioner.coverRule === 'PF2eVisionerEffect');
      } else ctx.check('Without Visioner\'s minimum cover, the effect carries Guarder\'s +1 AC', visioner.coverRule === 'FlatModifier');
      await ctx.rpc(ctx.gm, 'moveToken', { key: 'ally', col: 9, row: 9 });
      await h.until('Cover lost after moving away', x => !x.ally.effects.includes('guarder-covering-stance-cover'));
    } },
  { name: 'feat-shield-moves', description: 'Guarded Advance, Shielded Attrition and Blanket Defense raise the shield (with reminder effects).',
    async run(ctx, h) {
      for (const [slug, effect] of [['guarded-advance', null], ['shielded-attrition', 'guarder-shielded-attrition'], ['blanket-defense', 'guarder-blanket-defense']]) {
        await h.arrange({ feats: [slug] });
        const s = await useFeat(ctx, h, slug, []);
        ctx.check(`${slug} raised the shield`, s.guardian.shield.raised);
        if (effect) await h.until(`${slug} reminder effect`, x => x.guardian.effects.includes(effect));
      }
    } },
  { name: 'feat-juggernaut-charge', description: 'Juggernaut Charge: the card Strikes an enemy in reach after the guardian moves.',
    async run(ctx, h) {
      await h.arrange({ feats: ['juggernaut-charge'], positions: { guardian: [2, 6], ally: [2, 9], enemy: [8, 6] } });
      await useFeat(ctx, h, 'juggernaut-charge', []);
      await ctx.rpc(ctx.gm, 'moveToken', { key: 'guardian', col: 7, row: 6 });
      await ctx.player.locator('[data-guarder-followup="strike-in-reach"]').last().click();
      await h.until('Strike at the enemy now in reach', x => guardianAttacks(x, ctx.fixture.guardian).some(a => a.target === x.enemy.uuid));
    } },
  { name: 'feat-retaliating-rescue', description: 'Retaliating Rescue: push an adjacent ally 5 ft (picker), then Strike with +2.',
    async run(ctx, h) {
      const start = await h.arrange({ feats: ['retaliating-rescue'], positions: { guardian: [4, 6], ally: [5, 6], enemy: [5, 5] } });
      await useFeat(ctx, h, 'retaliating-rescue', []);
      await ctx.player.locator('[data-guarder-followup="push-ally"]').last().click();
      await ctx.player.waitForTimeout(800);
      await ctx.player.keyboard.press('Enter');
      await h.until('Ally pushed 5 feet', x => SQUARE(x, 'ally') !== SQUARE(start, 'ally'));
      await ctx.player.locator('[data-guarder-followup="strike-in-reach"][data-bonus="2"]').last().click();
      await h.until('Strike carries the +2', x => guardianAttacks(x, ctx.fixture.guardian).some(a => a.modifiers.includes('retaliating-rescue')));
    } },
  { name: 'feat-scattering-charge', description: 'Scattering Charge: Shove up to three creatures in reach from the card.',
    async run(ctx, h) {
      await h.arrange({ feats: ['scattering-charge'], positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6], enemy2: [5, 7] } });
      await useFeat(ctx, h, 'scattering-charge', []);
      await ctx.player.locator('[data-guarder-followup="shove-in-reach"]').last().click();
      const choose = h.prompt(ctx.player, 'Shove which creatures?').first();
      await choose.waitFor({ state: 'visible' });
      for (const box of await choose.locator('input[name="pick"]').all()) await box.check({ force: true });
      await ctx.screenshot('choose');
      await choose.locator('[data-action="choose"][data-value="ok"]').click();
      await h.until('Two Shove checks rolled', x => x.messages.filter(m => m.type === 'skill-check' && m.speaker === ctx.fixture.guardian && /shove/i.test(`${m.flavor} ${m.text}`)).length >= 2);
    } },
  { name: 'feat-aggressive-block-shove', description: 'Aggressive Block: when the GM picks "shoved", the attacker moves 5 ft straight back.',
    async run(ctx, h) {
      await h.arrange({ feats: ['aggressive-block'], shieldRaised: true, positions: { guardian: [4, 6], ally: [12, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { target: 'guardian', formula: '12[slashing]', shieldBlock: true });
      await h.settle();
      await h.choose(ctx.gm, 'Aggressive Block', 'shove');
      await h.until('Attacker shoved one square away', x => x.enemy.col === 6 && x.enemy.row === 6);
    } },
  { name: 'feat-repositioning-block', description: 'Repositioning Block: the card button rolls PF2e\'s Reposition against the attacker.',
    async run(ctx, h) {
      await h.arrange({ feats: ['repositioning-block'], shieldRaised: true, positions: { guardian: [4, 6], ally: [12, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { target: 'guardian', formula: '12[slashing]', shieldBlock: true });
      await h.settle();
      const button = ctx.player.locator('[data-guarder-followup="reposition"]').last();
      await button.waitFor({ state: 'visible' });
      await button.click();
      await h.until('Reposition check rolled', x => x.messages.some(m => m.type === 'skill-check' && m.speaker === ctx.fixture.guardian && /reposition/i.test(`${m.flavor} ${m.text}`)));
    } },
  { name: 'opening-stance-other', description: 'Opening Stance offers stances Guarder doesn\'t run, posting their card.',
    async run(ctx, h) {
      await h.arrange({ feats: ['opening-stance'], extraStance: true });
      await ctx.rpc(ctx.gm, 'setInitiative', { value: 17 });
      await h.choose(ctx.player, 'Opening Stance', 'qa-stance');
      await h.until('The stance\'s card is posted', x => x.messages.some(m => m.item === 'qa-stance'));
    } },
  // ------------------------------------------------------------ GM side: a guardian with no player
  { name: 'gm-intercept', description: 'No player: the GM gets the Intercept prompt (no override board) and the Get Behind Me! picker.',
    async run(ctx, h) {
      const start = await h.arrange({ gmOnly: true, feats: ['get-behind-me'], positions: { guardian: [4, 6], ally: [5, 6], enemy: [7, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { formula: '8[slashing]' });
      await h.prompt(ctx.gm, 'Intercept Attack').first().waitFor({ state: 'visible' });
      ctx.check('No override board when the GM answers', await h.prompt(ctx.gm, 'Intercept Attack — GM').count() === 0);
      ctx.check('The player is not asked', await h.prompt(ctx.player, 'Intercept Attack').count() === 0);
      await ctx.screenshot('prompt');
      await h.choose(ctx.gm, 'Intercept Attack', 'auto');
      await h.settle();
      await ctx.gm.waitForTimeout(800);
      await ctx.gm.keyboard.press('Enter');
      await h.until('GM intercepted and moved the ally', x => x.ally.hp === x.ally.max && SQUARE(x, 'ally') !== SQUARE(start, 'ally'));
    } },
  { name: 'gm-reactions', description: 'No player: the GM answers Reactive Strike and Keep Up the Good Fight.',
    async run(ctx, h) {
      await h.arrange({ gmOnly: true, feats: ['reactive-strike'], positions: { guardian: [4, 6], ally: [9, 6], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'attack', { target: 'ally', weapon: 'shortbow', total: 5, dc: 18, outcome: 'failure' });
      await h.choose(ctx.gm, 'Reaction', 'reactive-strike');
      await h.until('GM-run Reactive Strike', x => hasCard(x, 'reaction', 'ranged attack'));
      await h.arrange({ gmOnly: true, feats: ['keep-up-the-good-fight'], positions: { guardian: [4, 6], ally: [12, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'damage', { target: 'guardian', formula: '200[bludgeoning]' });
      await h.settle();
      await h.choose(ctx.gm, 'Keep Up the Good Fight', 'go');
      await h.until('GM-run Keep Up the Good Fight', x => x.guardian.hp === 1 && hasCard(x, 'reaction', 'Keep Up the Good Fight'));
    } },
  { name: 'gm-feat-actions', description: 'No player: the GM posts feat actions and stances and gets their prompts.',
    async run(ctx, h) {
      await h.arrange({ gmOnly: true, feats: ['taunting-strike', 'shield-wallop'], attackBonus: 40, positions: { guardian: [4, 6], ally: [2, 9], enemy: [5, 6] } });
      await ctx.rpc(ctx.gm, 'postItem', { slug: 'taunting-strike', type: 'feat', targets: ['enemy'] });
      await h.until('GM Taunting Strike: Strike and Taunt', x => guardianAttacks(x, ctx.fixture.guardian).length >= 1 && x.enemy.tauntedBy.includes(x.guardian.uuid));
      await ctx.rpc(ctx.gm, 'postItem', { slug: 'shield-wallop', type: 'feat', targets: ['enemy'] });
      await h.until('GM Shield Wallop: stupefied', x => conditionValue(x.enemy, 'stupefied'));
      await h.arrange({ gmOnly: true, feats: ['opening-stance', 'paragons-guard'] });
      await ctx.rpc(ctx.gm, 'setInitiative', { value: 16 });
      await h.choose(ctx.gm, 'Opening Stance', 'paragons-guard');
      await h.until('GM Opening Stance', x => x.guardian.effects.includes('guarder-paragons-guard'));
      ctx.check('The player was never asked', await h.prompt(ctx.player, 'Opening Stance').count() === 0);
    } },
  { name: 'hud-tracker-badge', environment: { modules: ['pf2e-hud'] }, description: 'PF2e HUD tracker shows the reaction badge: click spends, right-click restores.',
    async run(ctx, h) {
      const hud = await ctx.gm.evaluate(() => game.modules.get('pf2e-hud')?.active === true);
      if (!hud) return { blocked: 'pf2e-hud is not active' };
      await h.arrange({});
      const badge = page => page.locator('#pf2e-hud-tracker .pf2e-guarder-reactions');
      try { await badge(ctx.gm).first().waitFor({ state: 'visible', timeout: 10000 }); }
      catch { return { blocked: 'PF2e HUD tracker is not shown in this world' }; }
      ctx.check('Badge sits on the guardian row only', await badge(ctx.gm).count() === 1);
      // Visible means on screen inside its row, not clipped by the HUD's overflow rules.
      const shown = await badge(ctx.gm).first().evaluate(element => {
        const box = element.getBoundingClientRect();
        const row = element.closest('.combatant').getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return box.width > 8 && box.right <= row.right + 1 && box.bottom <= row.bottom + 1 && element.contains(hit);
      });
      ctx.check('Badge is actually visible in the HUD row', shown);
      await ctx.eventually('Player sees the badge on their guardian', async () => await badge(ctx.player).count() === 1);
      await badge(ctx.gm).first().click();
      await h.until('HUD badge click spends one', s => poolLeft(s) === 1);
      await ctx.eventually('HUD badge re-renders with one glyph left', async () => (await badge(ctx.gm).first().locator('.action-glyph').count()) === 1);
      await ctx.screenshot('hud');
      await badge(ctx.gm).first().click({ button: 'right' });
      await h.until('HUD badge right-click restores it', s => poolLeft(s) === 2);
      await badge(ctx.gm).first().click({ button: 'right' });
      await ctx.gm.waitForTimeout(800);
      ctx.check('Restoring at full adds nothing', poolLeft(await h.state()) === 2);
    } },
  { name: 'reaction-turn-reset', description: 'The guardian\'s turn start refreshes its reaction.',
    async run(ctx, h) {
      await h.arrange({ pool: { general: 0, guardian: 0 } });
      ctx.check('Reactions spent', poolLeft(await h.state()) === 0);
      await ctx.rpc(ctx.gm, 'advanceTurnTo', { key: 'guardian' });
      await h.until('Turn start restores the reaction', s => s.pool?.general === 1 && s.pool?.guardian === 0);
      await h.arrange({ feats: ['reaction-time'], pool: { general: 0, guardian: 0 } });
      await ctx.rpc(ctx.gm, 'advanceTurnTo', { key: 'guardian' });
      await h.until('Reaction Time adds a guardian-only reaction', s => s.pool?.general === 1 && s.pool?.guardian === 1);
    } },
  { name: 'intercept-timeout', description: 'An unanswered Intercept prompt declines itself after the timeout.',
    async run(ctx, h) {
      const previous = await ctx.rpc(ctx.gm, 'setSetting', { key: 'interceptTimeout', value: 5 });
      try {
        await h.arrange({});
        await ctx.rpc(ctx.gm, 'damage', { formula: '6[slashing]' });
        await h.prompt(ctx.player, 'Intercept Attack').first().waitFor({ state: 'visible' });
        await h.settle();
        await h.until('Ally takes the damage after the timeout', s => s.ally.hp === s.ally.max - 6 && s.guardian.hp === s.guardian.max);
        ctx.check('Prompt closed itself', await h.prompt(ctx.player, 'Intercept Attack').count() === 0);
      } finally {
        await ctx.rpc(ctx.gm, 'setSetting', { key: 'interceptTimeout', value: previous });
      }
    } },
  { name: 'panel-actions', description: 'Panel Raise a Shield and Taunt targets buttons.',
    async run(ctx, h) {
      await h.arrange({});
      await h.panel(ctx.player).locator('[data-action="raiseShield"]').dispatchEvent('click');
      await h.until('Raise a Shield from the panel', s => s.guardian.shield.raised);
      await ctx.rpc(ctx.player, 'setTargets', { keys: ['enemy'] });
      await h.panel(ctx.player).locator('[data-action="tauntTargets"]').dispatchEvent('click');
      await h.until('Taunt targets from the panel', s => s.enemy.tauntedBy.length === 1);
    } },
  { name: 'sundry-reaction-used', sundry: true, description: 'Spending a reaction adds Sundry\'s Reaction Used counter; restoring removes it.',
    async run(ctx, h) {
      const sundry = await ctx.rpc(ctx.gm, 'sundryState');
      if (!sundry.api) return { blocked: 'Sundry API unavailable after enabling the module' };
      await h.arrange({});
      await ctx.rpc(ctx.gm, 'openPanel');
      await h.panel(ctx.gm).locator('[data-action="toggleReaction"][data-spent="false"]').first().dispatchEvent('click');
      await ctx.eventually('Sundry counter added', async () => (await ctx.rpc(ctx.gm, 'sundryState')).used === 1);
      await h.panel(ctx.gm).locator('[data-action="toggleReaction"][data-spent="true"]').first().dispatchEvent('click');
      await ctx.eventually('Sundry counter removed', async () => (await ctx.rpc(ctx.gm, 'sundryState')).used === 0);
    } },
];

function check(ctx, label, passed) { ctx.check(label, passed); }

export const fullCases = CASES.map(({ run: _run, ...entry }) => entry);

export async function executeWorkflow(name, ctx) {
  const scenario = CASES.find(c => c.name === name);
  if (!scenario) throw Error(`Unknown live case: ${name}`);
  const h = helpers(ctx);
  const outcome = await scenario.run(ctx, h);
  if (outcome?.blocked) return outcome;
  await ctx.screenshot('final');
  return outcome;
}
