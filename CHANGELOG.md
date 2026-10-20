# Changelog

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
