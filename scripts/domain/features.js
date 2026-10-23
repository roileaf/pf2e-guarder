// How each Guardian feature is handled, for the Guardian panel's status list.

export const AUTOMATED = Object.freeze({
  "intercept-attack": "Prompted on ally damage, Step/Stride, damage redirected",
  "guardians-intercept": "Once-per-10-minutes Intercept Attack tracked",
  taunt: "Effect applied to targets, one taunt at a time, off-guard on attacks",
  "group-taunt": "Up to three taunted enemies, keep choice",
  "long-distance-taunt": "120-foot range check",
  "energy-interceptor": "Acid, cold, electricity, fire, sonic trigger Intercept",
  "guardians-techniques": "Ever Ready: a guardian-only reaction when you roll initiative",
  "reaction-time": "Extra guardian reaction each turn",
  "shield-block": "Offered inside Intercept Attack",
  "get-behind-me": "Ally moved away from the attacker",
  "disarming-intercept": "Disarm button after intercepting adjacent melee weapon attacks",
  "armored-counterattack": "Strike button after intercepting adjacent melee Strikes; Taunts on hit",
  "quick-vengeance": "Quickened effect after Intercept Attack",
  "unbelievable-interception": "Mythic prompt on ally attacks, retargets the attack",
  bodyguard: "Charge picker in this panel; penalty handled by PF2e",
  "shield-from-arrows": "Prompted when an adjacent ally is targeted by a ranged attack; re-grades it at +4 AC",
  "shield-from-spells": "Extends Shield from Arrows to ranged spell attacks",
  "reactive-shield": "Prompted when a melee Strike hits you; raises the shield and re-grades the attack",
  clang: "Prompted on a critical miss against you: Strike, or Stride and make it off-guard",
  "reactive-strike": "Prompted on ranged attacks, manipulate actions and movement within reach",
  "not-so-fast": "Prompted with Reactive Strike while in Hampering Stance",
  "hampering-stance": "5-foot difficult terrain for enemies that follows you; enables Not So Fast!",
  "keep-up-the-good-fight": "Prompted at 0 HP: back to 1 HP, wounded +1, temporary HP",
  "tough-to-kill": "First dying 3+ each day becomes dying 2",
  "boundless-reprisals": "Extra guardian-only reaction during each enemy's turn",
  "paragons-guard": "Stance that keeps your shield raised; panel and chat buttons",
  "tough-cookie": "Temporary HP for 1 minute when posted at half HP or less, once per day",
  "shield-salvation": "Shield Block can't destroy your shield: it stays at 1 HP, once per shield per day",
  "opening-stance": "Prompted to enter a stance when you roll initiative",
  "taunting-strike": "Strikes the target, then Taunts it",
  "shielding-taunt": "Raises your shield, then Taunts the target",
  "shoulder-check": "Fist or gauntlet Strike; off-guard results applied by degree",
  "shield-wallop": "Shield Strike; stupefied by degree (tower shields +1)",
  "devastating-shield-wallop": "Fortitude save after Shield Wallop: off-guard, prone, or prone and stunned",
  "weakening-assault": "Two Strikes at your taunted enemy; enfeebled 1 or 3",
  "ring-their-bell": "Fist Strike, then the incapacitation save: stunned 1-3",
  "bloody-denial": "Strike, then the save: no reactions, stunned on a critical failure",
  "lock-down": "Strike in Hampering Stance; the target is held in your reach",
  "belly-flop": "Drop prone and Strike without the prone penalty; immobilizes on a hit",
  "stomp-ground": "Reflex saves within 5 feet: off-guard, prone, falling damage",
  "armored-courage": "Temporary HP equal to your level, frightened reduced, once per hour",
  "guarded-advance": "Raises your shield; you Step twice",
  "shielded-attrition": "Raises your shield; reminder effect for reactions you draw",
  "blanket-defense": "Raises your shield; reminder effect for blocking for adjacent allies",
  "defensive-advance": "Raises your shield; Strike button for enemies in reach after you move",
  "juggernaut-charge": "Strike button for enemies in reach after you move",
  "retaliating-rescue": "Push-ally and Strike (+2) buttons after you move",
  "scattering-charge": "Shove up to three creatures in reach after you move",
  "momentum-strike": "Strike; on a hit you pick the target's new square within reach",
  "aggressive-block": "After Shield Block: the attacker is shoved 5 ft or becomes off-guard",
  "repositioning-block": "After Shield Block: Reposition button for the attacker",
  "covering-stance": "Stance; at the end of your turn an adjacent ally gets lesser cover",
});

export const NATIVE = Object.freeze([
  "guardians-armor", "area-armor", "shield-warfare", "raise-haft", "shield-your-eyes", "mighty-bulwark",
  "guardian-mastery", "unyielding-force", "unyielding-resolve", "battle-hardened", "perfect-protection",
  "demolish-defenses", "clobber", "proud-nail", "flying-tackle", "armor-break", "punishing-shove",
  "sure-footed", "reflexive-shield", "weapon-expertise", "right-where-you-want-them",
]);

/** Status rows for the items an actor owns: { slug, name, status: automated|native|manual, detail }. */
export function featureStatuses(items) {
  const rows = [];
  const seen = new Set();
  for (const item of items) {
    if (!item?.slug || seen.has(item.slug)) continue;
    // PF2e exposes traits as a Set; plain sources may carry an array.
    const traits = item.traits ?? item.system?.traits?.value ?? [];
    const guardianTrait = traits.has?.("guardian") ?? traits.includes?.("guardian") ?? false;
    const guardianItem = guardianTrait || item.slug in AUTOMATED;
    if (!guardianItem) continue;
    seen.add(item.slug);
    if (item.slug in AUTOMATED) rows.push({ slug: item.slug, name: item.name, status: "automated", detail: AUTOMATED[item.slug] });
    else if (NATIVE.includes(item.slug)) rows.push({ slug: item.slug, name: item.name, status: "native", detail: "Rule elements in PF2e" });
    else rows.push({ slug: item.slug, name: item.name, status: "manual", detail: "Resolve at the table" });
  }
  const order = { automated: 0, native: 1, manual: 2 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}
