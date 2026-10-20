# PF2e Guarder

Guardian class automation for Pathfinder Second Edition on Foundry VTT v14 (PF2e 8.5+).

The goal is fewer interruptions in combat: the module handles what it can determine reliably,
and players and the GM can always override a decision.

## Installation

In Foundry's **Install Module** dialog, paste this manifest URL:

```
https://raw.githubusercontent.com/roileaf/pf2e-guarder/main/module.json
```

The link never changes and always offers the newest release, pre-releases included, so Foundry's update check
keeps working. If you installed 0.1.0, reinstall once with this link.

## Features

### Intercept Attack

When an ally takes physical damage (plus acid, cold, electricity, fire, and sonic with **Energy Interceptor**),
every eligible guardian is asked whether to Intercept Attack:

- Eligible means: has Intercept Attack, is an ally, within 10 feet (15 feet when the damage comes from
  the guardian's taunted enemy), conscious, above 0 HP, and has a reaction left.
- The prompt goes to the guardian's player (the GM when no player is online, or always the GM by setting)
  and declines automatically after a timeout.
- Several eligible guardians are prompted at once; the first to accept intercepts.
- The GM sees a waiting dialog with **force intercept** and **apply to ally** overrides.
- On acceptance the guardian Steps to the nearest open square adjacent to the ally on square grids
  (Strides, when the taunted-enemy extension applies), or **Choose square** lets the player click one of
  the highlighted open squares next to the ally within that same Step/Stride range.
- The guardian takes the triggering damage through PF2e's own `applyDamage`, so the **guardian's**
  immunities, weaknesses, resistances (including Guardian's Armor) and Shield Block apply, not the ally's.
- By default the guardian takes only the triggering damage types and the ally keeps the rest of a mixed roll;
  a setting sends the whole roll to the guardian instead.
- An optional **Shield Block** toggle appears when the guardian's shield is raised.

### Intercept follow-ups

- **Get Behind Me!** — a toggle in the prompt. After the damage resolves, the guardian's player clicks the
  ally's new square on the map: only legal squares are highlighted (up to 10 feet, within the guardian's reach,
  farther from the attacker). Enter takes the suggested square; Escape leaves the ally in place.
- **Disarming Intercept** and **Armored Counterattack** — free-action buttons on the Intercept chat card when
  their triggers apply (adjacent attacker; melee weapon / melee Strike). Disarm uses PF2e's own action with the
  feat's armor-potency bonus; a Counterattack hit Taunts the attacker.
- **Quick Vengeance** — quickened until the end of the guardian's next turn, with the Stride/Strike restriction noted.
- **Guardian's Intercept** (archetype) — the once-per-10-minutes frequency is respected and spent.
- **Unbelievable Interception** (mythic) — prompted on an attack roll against an ally: spends a Mythic Point,
  Strides twice toward the enemy, retargets the attack card to the guardian and compares the roll to the
  guardian's AC; on a miss, offers a Strike at mythic proficiency.

### Guardian reactions

Each reaction prompts the guardian's player (GM fallback) when its trigger happens, spends the tracked
reaction, and posts a card. Foundry rolls attacks instantly, so reactions that change an attack re-grade
the existing attack card and note the change on it.

- **Shield from Arrows** (and **Shield from Spells**) — an adjacent ally is hit by a ranged attack while your
  shield is raised: +4 AC against it.
- **Reactive Shield** — a melee Strike hits you: Raise a Shield and re-grade with its AC bonus.
- **Clang!** — an attack critically misses you: Strike, or Stride toward the enemy and make it off-guard
  until the end of your next turn if you end adjacent.
- **Reactive Strike** — a creature within reach makes a ranged attack, uses a manipulate action, or leaves a
  square during movement (detected from Foundry's token movement). **Not So Fast!** is offered alongside it
  while you're in Hampering Stance (posting the stance from the sheet starts it), with its Speed-penalty results.
- **Keep Up the Good Fight** — an enemy drops you to 0 HP: back to 1 HP, wounded +1, temporary HP; once per hour.
  Works with modules that auto-apply dying/unconscious at 0 HP (those are undone, wounded isn't doubled).
- **Tough to Kill** — the first dying 3+ each day becomes dying 2, automatically.
- Reactions used outside the module also count: PF2e's own **Shield Block** button (which also triggers
  Quick Vengeance) and reaction feats posted from the sheet spend a tracked reaction.

### High-level feats

- **Boundless Reprisals**: at the start of each enemy's turn you gain a guardian-only reaction for that turn. It is
  spent first and shown as its own glyph in the panel and trackers.
- **Paragon's Guard**: a stance (chat card, panel, or posting it from the sheet) that keeps your shield raised, using
  PF2e's own Raise a Shield rule. Only one stance at a time: entering Hampering Stance ends it, and vice versa.
- **Tough Cookie**: posting it at half HP or less gives temporary HP equal to half your maximum for 1 minute (PF2e's
  TempHP rule removes them when the effect ends). Once per day; an override prompt covers the exceptions.
- **Shield Salvation**: when a Shield Block (PF2e's button or Intercept Attack's toggle) would destroy your shield, it
  stays at 1 HP instead, once per shield until the next day.
- **Opening Stance**: when you roll initiative, you're asked which of your stances to enter for free.

### Feat actions

Post a Guardian feat from the sheet with the enemy targeted, and Guarder runs it with PF2e's own Strikes and saves (rolled
against your class DC), then applies the result with the right duration ("until the start of your next turn" counts from
your initiative). Unmet requirements ask before continuing.

| Feat | What happens |
| --- | --- |
| Taunting Strike / Shielding Taunt | Strike (or Raise a Shield), then Taunt the target |
| Shoulder Check | Fist or gauntlet Strike; off-guard results by degree (you on a critical failure) |
| Shield Wallop (+ Devastating Shield Wallop) | Shield Strike: stupefied 1/2 (+1 with a tower shield); then the Fortitude save: off-guard, prone, or prone and stunned 1 |
| Weakening Assault | Two Strikes at your taunted enemy: enfeebled 1, or 3 if both hit |
| Ring Their Bell | Fist Strike at a taunted, off-guard enemy, then the incapacitation save: stunned 1-3 |
| Bloody Denial | Strike, then the save (one degree worse on a crit): no reactions, plus stunned 1 on a critical failure |
| Lock Down / Belly Flop | Held in your reach / you drop prone, Strike without the prone penalty, immobilize the target |
| Momentum Strike | Strike; on a hit you click the target's new square (5 or 10 ft, within reach, no walls) |
| Stomp Ground | Everyone within 5 ft rolls Reflex: off-guard, prone, or prone plus 1d6 falling damage |
| Armored Courage | Temporary HP equal to your level for 1 minute, frightened −1, once per hour |
| Guarded Advance / Shielded Attrition / Blanket Defense | Raise a Shield, with a reminder effect where the feat lasts |
| Defensive Advance / Juggernaut Charge / Retaliating Rescue / Scattering Charge | You move your token; the card has Strike, push-ally (+2) and Shove buttons for what is in reach then |
| Aggressive Block / Repositioning Block | After a Shield Block against an adjacent attacker: shoved 5 ft or off-guard (the GM chooses for it) / a Reposition button |
| Covering Stance | At the end of your turn, an adjacent ally gets lesser cover (+1 AC) until the start of your next turn or until it moves away |

Still resolved at the table: Improved Reflexive Shield, Great Shield Mastery, Phalanx Formation and Larger than Life
(they depend on PF2e's area-save and cover math), and Momentum Strike's push into another creature.

### Hampering Stance

Posting Hampering Stance from the sheet (or the Enter/End button on its chat card, or the Guardian panel)
starts the stance: a 5-foot emanation Region is attached to the guardian's token and follows it. Ending the
stance removes it.

- With **pf2e-toolbelt** active, the area uses Toolbelt's Difficult Terrain behavior set to affect only the
  guardian's **enemies**, as the feat intends.
- Without Toolbelt, it uses PF2e's native **Difficult Terrain** behavior. That behavior has no alliance filter,
  so it slows everyone in the area, allies and the guardian included.

### pf2e-toolbelt integration

- **Target Helper**: a taunted enemy's spells and actions use Toolbelt's recorded targets, so Taunt's off-guard
  ("includes an ally but not you") is decided automatically instead of a GM reminder, and re-checked when the
  targets are changed later with "Set targets".
- Target Helper's per-target damage and Shield Block buttons go through PF2e's damage application, so Intercept
  Attack prompts, Keep Up the Good Fight and reaction counting work from them unchanged.
- Auto Cover's DC on attack cards is respected when Shield from Arrows / Reactive Shield re-grade an attack.

### Sundry integration

With **Sundry** active, reactions spent through Guarder also add Sundry's "Effect: Reaction Used" counter via
`sundry.api.reactionUsed`, and restoring a reaction from the panel or tracker badge removes one. Reactions Sundry
already counts on its own (reaction items posted to chat, and Strikes when its Reactive Strike tracking is on)
are left to Sundry so nothing is counted twice.

### Guardian panel

A companion window like Commander's, opened from the actor sheet header, the token HUD, or
`game.modules.get("pf2e-guarder").api.open(actor)`: reactions (GM can spend/restore), armor resistance, shield
with Raise a Shield, taunted enemies (with End), Taunt targets, Bodyguard charge picker, allies in Intercept
range, active intercept feats, and every Guardian feature tagged Automated / PF2e / Manual.

### Taunt

Using the Taunt action with enemies targeted applies PF2e's own `Effect: Taunt` with the guardian as origin,
so the native −1 attack penalty, DC toggle, and Bodyguard −2 work unchanged. The module adds:

- Range check (30 feet, 120 with **Long-Distance Taunt**) with an override prompt.
- One taunt at a time: the previous taunt ends. **Group Taunt** allows three targets and three taunted
  enemies, asking which to keep when over the limit.
- An **Apply Taunt to targets** button on the Taunt chat card for taunting after posting.
- Expiration at the start of the guardian's next turn.
- Off-guard: when a taunted enemy's attack roll targets one of the guardian's allies instead of the guardian,
  the enemy becomes off-guard until the start of its next turn.
- Spells cast by a taunted enemy whisper the GM a reminder with an off-guard button.

### Reaction tracking

In combat, each guardian's reactions are tracked on its combatant:

- One reaction at the start of each turn, plus a guardian-only reaction from **Reaction Time**.
- **Ever Ready** guardian-only reaction(s) when combat starts.
- Intercept Attack spends a guardian-only reaction first.
- A badge in the combat tracker shows what is left; the GM clicks to spend one and right-clicks to restore one.

## Native PF2e automation (not duplicated)

| Feature | PF2e 8.6 | PF2e Guarder |
| --- | --- | --- |
| Guardian's Armor physical resistance | Resistance rule element | Uses it |
| Effect: Taunt penalties, DC toggle, Bodyguard | Effect rules | Applies the effect with a correct origin |
| Taunt targeting, range, one-taunt limit, Group Taunt | Not automated | Automated |
| Taunt off-guard | Note only | Automated for attacks, reminder for spells |
| Intercept Attack | Description only | Fully assisted |
| Ever Ready / Reaction Time reactions | Not tracked | Tracked |

## Known limits

- When a mixed roll is split, the guardian's portion is rebuilt from instance totals: damage type, materials
  and persistent damage are kept; precision and splash sub-components are not.
- Auto-Step works on square grids only. Gridless and hex scenes ask the guardian to move manually.
- Reactions spent outside this module (Reactive Strike, a manual Shield Block) are adjusted from the
  combat tracker badge.

## API

`game.modules.get("pf2e-guarder").api` exposes `reactions(actor)`, `setReactions(actor, { general, guardian })`,
`applyTaunt(message)`, and `applyTauntOffGuard(enemy, guardian)`.

## Development

```bash
npm install
npm test
npm run lint
```

### Live tests

`npm run test:live:full` drives two real Foundry sessions (a QA GM and a QA player) with Playwright through every
automated feature: 44 workflows that click the actual prompts, chat buttons, panel and tracker controls and check the
resulting Foundry state. It builds its own scene, Guardian, ally and enemies tagged with the run ID and deletes them
afterwards (`npm run test:live:cleanup` recovers an interrupted run). It only runs in the QA world (`test` by default,
or `GUARDER_DISPOSABLE_WORLD`); `--saved` uses the accounts in `~/.config/pf2e-guarder/live.json`, falling back to
`~/.config/pf2e-commanderer/live.json`. `GUARDER_LIVE_CASE=name,name` runs selected cases; `npm run test:live:list` lists them.
