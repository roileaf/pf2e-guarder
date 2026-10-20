# Changelog

## Unreleased

- Guardian reactions: Shield from Arrows / Shield from Spells, Reactive Shield, Clang!, Reactive Strike
  (ranged attacks, manipulate actions, movement), Not So Fast!, Keep Up the Good Fight, Tough to Kill.
- PF2e's own Shield Block button and reaction feats posted from the sheet now spend tracked reactions;
  native Shield Block also grants Quick Vengeance.
- Hampering Stance creates difficult terrain for enemies within 5 feet that follows the guardian, with an
  Enter/End stance toggle in the Guardian panel. Areas are kept in sync on every scene the guardian has a
  token on, and repaired on load if a GM client missed the change.
- pf2e-toolbelt integration: Target Helper targets decide Taunt off-guard on spells and actions.
- Sundry integration: spent reactions add Sundry's "Reaction Used" counter (restores remove one), without
  double-counting what Sundry tracks itself.
- Guardian panel reaction glyphs are clickable (spend lit / restore dimmed); stance cards have Enter/End buttons.
- Fix: Keep Up the Good Fight no longer misses when a character is briefly reported dead at 0 HP.
- Fix: spells (context "spell-cast") now trigger Taunt handling and Reactive Strike on manipulate actions.

## 0.1.0

- Intercept Attack: detect eligible guardians when an ally takes damage, prompt them (with a live GM override
  board), Step or Stride into place, and redirect the damage through the guardian's own IWR and Shield Block.
- Intercept follow-ups: Get Behind Me! (player picks the ally's square), Disarming Intercept, Armored
  Counterattack, Quick Vengeance, Guardian's Intercept frequency, and Unbelievable Interception (mythic).
- Taunt: apply PF2e's Effect: Taunt with range, Group Taunt, Long-Distance Taunt and one-taunt rules,
  and automate off-guard for taunted enemies attacking allies.
- Reaction tracking for guardians, including Ever Ready and Reaction Time, shown with PF2e action glyphs.
- Guardian panel: companion window from the sheet header and token HUD, with Bodyguard charge selection.
- ApplicationV2 windows and chat cards in the PF2e Commanderer style with an ember-orange signature color.
