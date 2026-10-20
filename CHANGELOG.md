# Changelog

## Unreleased

- Intercept Attack: "I'll move" is now **Choose square**: the player clicks one of the highlighted open squares next to
  the ally within the Step (or taunted-enemy Stride) range instead of moving freely.
- Live Foundry test suite (44 workflows, GM and player sessions) under `tests/live`.

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
