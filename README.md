# PF2e Guarder

Guardian class automation for Pathfinder Second Edition on Foundry VTT v14 (PF2e 8.5+).

The goal is fewer interruptions in combat: the module handles what it can determine reliably,
and players and the GM can always override a decision.

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
  (Strides, when the taunted-enemy extension applies), or the player can choose to move themselves.
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
