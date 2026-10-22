# Changelog

## 0.1.4

- Fixed: Intercept Attack's "Also Shield Block" toggle was offered, and Shield Block applied, even with only one
  reaction left. Shield Block alongside Intercept needs a second reaction (Ever Ready at initiative, Reaction Time each
  turn): with one left the toggle is disabled and says why, and Shield Block only applies when its reaction is spent.
  A GM force-intercept can still go beyond the tracked reactions.

## 0.1.3

- PF2E Visioner integration: with Visioner 8.14.7+ and its auto-cover on, Covering Stance's lesser cover goes through
  Visioner ("at least lesser cover" against every attacker), so it shows in Visioner's attack messages and never lowers
  or stacks with other cover. Without it, Guarder keeps its +1 circumstance AC effect.

## 0.1.2

- High-level Guardian feats:
  - **Boundless Reprisals**: an extra guardian-only reaction at the start of each enemy's turn, lasting that turn. It is
    spent before your other reactions and shows as its own glyph in the panel and trackers.
  - **Paragon's Guard**: posting the stance (or its chat/panel button) keeps your shield raised while you're in it, so
    Shield Block and Shield from Arrows are always available. Entering another stance ends it.
  - **Tough Cookie**: posting it at half HP or less grants temporary HP equal to half your maximum for 1 minute, once
    per day (with an override prompt).
  - **Shield Salvation**: a Shield Block that would destroy your shield leaves it at 1 HP, once per shield per day.
  - **Opening Stance**: rolling initiative asks whether to drop into one of your stances for free.
- Guardian feat actions: post the feat from the sheet with the enemy targeted, and Guarder rolls PF2e's Strikes and saves
  and applies the results with their durations:
  - Strike riders: Taunting Strike, Shoulder Check, Shield Wallop (+ Devastating Shield Wallop's save), Weakening
    Assault, Ring Their Bell, Bloody Denial, Lock Down, Belly Flop, Momentum Strike (pick the target's new square).
  - Shield and Taunt: Shielding Taunt, Guarded Advance, Shielded Attrition, Blanket Defense.
  - Saves and buffs: Stomp Ground (Reflex saves within 5 ft), Armored Courage (temporary HP, frightened −1, once per hour).
  - Move-then-act feats get card buttons after you move your token: Defensive Advance, Juggernaut Charge and Retaliating
    Rescue (Strike an enemy in reach, push an ally), Scattering Charge (Shove up to three creatures).
  - After Shield Block: Aggressive Block (the attacker is shoved 5 ft or off-guard) and Repositioning Block (Reposition button).
  - **Covering Stance**: at the end of your turn, an adjacent ally gets lesser cover until it moves away.
- Requirements (armor, shield, taunted enemy, stance, frequency) are checked, with a "Use it anyway" override.

## 0.1.1

**Install / update link changed.** Use `https://raw.githubusercontent.com/roileaf/pf2e-guarder/main/module.json`.
It always offers the newest version, pre-releases included. The 0.1.0 link did not work for updates, so reinstall once
with the new link.

- Intercept Attack: the automatic Step (or taunted-enemy Stride) now ends on the square next to the ally that is closest
  to the attacker, putting the guardian between them, instead of the cheapest square.
- Intercept Attack: "I'll move" is now **Choose square**: the player clicks one of the highlighted open squares next to
  the ally within the Step/Stride range instead of moving freely.
- Movement never passes through walls: Intercept's Step/Stride, Choose square, Get Behind Me! and the Stride toward the
  attacker (Clang!, Unbelievable Interception) skip squares behind walls and closed doors.
- Square picker: Large and bigger creatures pick the exact placement under the pointer, and overlapping placements are
  drawn cleanly. Tiny creatures inside a square are measured from the right square.
- PF2e HUD: guardians' reaction glyphs now show in PF2e HUD's combat tracker, with the same click to spend and
  right-click to restore.
- Fixed: restoring reactions from the tracker badge could go past the guardian's maximum and pile up extra glyphs.
- Live Foundry test suite (46 workflows, GM and player sessions) under `tests/live`.

## 0.1.0

First release.

- Intercept Attack: detect eligible guardians when an ally takes damage, prompt them (with a live GM override
  board), Step or Stride into place, and redirect the damage through the guardian's own IWR and Shield Block.
- Intercept follow-ups: Get Behind Me! (player picks the ally's square), Disarming Intercept, Armored
  Counterattack, Quick Vengeance, Guardian's Intercept frequency, and Unbelievable Interception (mythic).
- Guardian reactions: Shield from Arrows / Shield from Spells, Reactive Shield, Clang!, Reactive Strike
  (ranged attacks, manipulate actions, movement), Not So Fast!, Keep Up the Good Fight, Tough to Kill.
- Taunt: apply PF2e's Effect: Taunt with range, Group Taunt, Long-Distance Taunt and one-taunt rules,
  and automate off-guard for taunted enemies attacking allies.
- Hampering Stance: difficult terrain for enemies within 5 feet that follows the guardian, with Enter/End
  buttons on the chat card and in the Guardian panel.
- Reaction tracking for guardians, including Ever Ready and Reaction Time, shown with PF2e action glyphs;
  PF2e's own Shield Block button and reaction feats posted from the sheet also spend tracked reactions.
- Guardian panel: companion window from the sheet header and token HUD, with Bodyguard charge selection and
  clickable reaction glyphs.
- Integrations: pf2e-toolbelt (Target Helper targets decide Taunt off-guard; enemies-only terrain) and
  Sundry (spent reactions add its "Reaction Used" counter without double-counting).
- ApplicationV2 windows and chat cards in the PF2e Commanderer style with an ember-orange signature color.
