// HTML for the Guardian panel. Pure string builders: no Foundry calls.
import { actionGlyph, escapeHtml, reactionPips } from "./views.js";

const STATUS_LABEL = { automated: "Automated", native: "PF2e", manual: "Manual" };

function portrait(img, name, extra = "") {
  return `<img class="guarder-portrait ${extra}" src="${escapeHtml(img || "icons/svg/mystery-man.svg")}" alt="${escapeHtml(name)}">`;
}

function section(title, glyph, body, actions = "") {
  return `<section class="guarder-section">
    <header class="guarder-section-header"><h3>${glyph ?? ""} ${escapeHtml(title)}</h3><div class="guarder-section-actions">${actions}</div></header>
    ${body}
  </section>`;
}

function empty(text) {
  return `<p class="guarder-empty">${escapeHtml(text)}</p>`;
}

/**
 * One glyph per reaction slot: lit when available, dimmed when spent. For the GM each glyph is a
 * button that spends (lit) or restores (dimmed) that reaction.
 */
export function reactionSlots(view) {
  const slots = [];
  for (const kind of ["general", "guardian", "boundless"]) {
    if (kind === "boundless" && view.poolMax?.boundless === undefined) continue;
    const available = Math.max(0, view.pool?.[kind] ?? 0);
    const total = Math.max(available, view.poolMax?.[kind] ?? 0);
    for (let index = 0; index < total; index++) slots.push({ kind, spent: index >= available });
  }
  return slots.map(({ kind, spent }) => {
    const label = { guardian: "Guardian-only reaction", boundless: "Boundless Reprisals (this enemy turn only)" }[kind] ?? "Reaction";
    const tooltip = `${label}${spent ? " (spent)" : ""}${view.isGM ? ` — click to ${spent ? "restore" : "spend"}` : ""}`;
    const classes = `action-glyph ${kind}${spent ? " spent" : ""}`;
    return view.isGM
      ? `<button type="button" class="guarder-glyph-button ${classes}" data-action="toggleReaction" data-kind="${kind}" data-spent="${spent}" data-tooltip="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">R</button>`
      : `<span class="${classes}" data-tooltip="${escapeHtml(tooltip)}">R</span>`;
  }).join("");
}

function heroBody(view) {
  const armor = view.armor
    ? `<span class="guarder-chip"><i class="fa-solid fa-shirt"></i> ${escapeHtml(view.armor.name)}${view.armor.resistance ? ` · physical ${view.armor.resistance}` : ""}</span>`
    : `<span class="guarder-chip warn"><i class="fa-solid fa-triangle-exclamation"></i> No medium or heavy armor</span>`;
  const shield = view.shield
    ? `<span class="guarder-chip ${view.shield.raised ? "active" : ""}"><i class="fa-solid fa-shield"></i> ${escapeHtml(view.shield.name)} ${view.shield.hp}/${view.shield.max} · hardness ${view.shield.hardness}${view.shield.broken ? " · broken" : ""}</span>`
    : "";
  const raise = view.shield && !view.shield.raised && view.isOwner
    ? `<button type="button" class="guarder-button subtle compact" data-action="raiseShield">${actionGlyph("1")}<span>Raise a Shield</span></button>`
    : "";
  const reactions = view.pool
    ? `<span class="guarder-reaction-control">${reactionSlots(view)}</span>`
    : `<span class="guarder-muted">${reactionPips(null)} out of combat</span>`;
  return `<header class="guarder-hero">
      ${portrait(view.img, view.name, "large")}
      <div class="guarder-identity">
        <span class="guarder-eyebrow"><i class="fa-solid fa-shield-halved"></i> Guardian</span>
        <h2>${escapeHtml(view.name)}</h2>
        <p class="guarder-muted">Level ${view.level} ${escapeHtml(view.className)}</p>
        <p class="guarder-hero-chips">${armor}${shield}${raise}</p>
      </div>
      <div class="guarder-hero-side">${reactions}</div>
    </header>`;
}

function tauntBody(view) {
  const rows = view.taunted.length
    ? `<ul class="guarder-rows">${view.taunted.map((enemy) => `<li class="guarder-row taunted">
        ${portrait(enemy.img, enemy.name)}
        <div class="guarder-row-text"><strong>${escapeHtml(enemy.name)}</strong>
          <small><i class="fa-solid fa-ruler"></i> ${Number.isFinite(enemy.distance) ? `${Math.round(enemy.distance)} ft` : "—"}${enemy.offGuard ? " · off-guard" : ""}</small></div>
        ${view.isOwner ? `<button type="button" class="guarder-button subtle compact" data-action="endTaunt" data-effects="${escapeHtml(enemy.effects.join(","))}">
          <i class="fa-solid fa-xmark"></i><span>End</span></button>` : ""}
      </li>`).join("")}</ul>`
    : empty("No enemy is taunted.");
  const limits = `<p class="guarder-hint">Range ${view.tauntLimits.range} ft · up to ${view.tauntLimits.maxTaunted} taunted ${view.tauntLimits.maxTaunted === 1 ? "enemy" : "enemies"}</p>`;
  const charge = view.bodyguard
    ? `<div class="guarder-subsection"><label class="guarder-field"><span><i class="fa-solid fa-user-shield"></i> Bodyguard charge</span>
        <select name="charge" data-action-change="setCharge" ${view.isOwner ? "" : "disabled"}>
          <option value="">— none —</option>
          ${view.bodyguard.options.map((ally) => `<option value="${escapeHtml(ally.uuid)}" ${ally.uuid === view.bodyguard.current ? "selected" : ""}>${escapeHtml(ally.name)}</option>`).join("")}
        </select></label></div>`
    : "";
  const button = view.isOwner && view.hasTaunt
    ? `<button type="button" class="guarder-button primary compact" data-action="tauntTargets">${actionGlyph("1")}<span>Taunt targets</span></button>`
    : "";
  return section("Taunt", actionGlyph("1"), `${rows}${limits}${charge}`, button);
}

function stanceBody(view) {
  if (!view.stances?.length) return "";
  const rows = view.stances.map((stance) => `<li class="guarder-row ${stance.active ? "in-range" : ""}">
      <div class="guarder-row-text"><strong>${escapeHtml(stance.name)}</strong>
        <small>${escapeHtml(stance.active ? stance.activeText : stance.inactiveText)}</small></div>
      ${view.isOwner ? `<button type="button" class="guarder-button ${stance.active ? "subtle" : "primary"} compact" data-action="toggleStance" data-slug="${escapeHtml(stance.slug)}">
        ${stance.active ? `<i class="fa-solid fa-xmark"></i><span>End stance</span>` : `${actionGlyph("1")}<span>Enter stance</span>`}</button>` : ""}
    </li>`).join("");
  return section("Stance", actionGlyph("1"), `<ul class="guarder-rows">${rows}</ul>`);
}

function interceptBody(view) {
  const allies = view.allies.length
    ? `<ul class="guarder-rows compact">${view.allies.map((ally) => `<li class="guarder-row ${ally.inRange ? "in-range" : "out-of-range"}">
        ${portrait(ally.img, ally.name)}
        <div class="guarder-row-text"><strong>${escapeHtml(ally.name)}</strong>
          <small><i class="fa-solid fa-ruler"></i> ${Math.round(ally.distance)} ft · ${ally.inRange ? "in reach of Intercept" : "too far"}</small></div>
      </li>`).join("")}</ul>`
    : empty("No allies on this scene.");
  const chips = view.interceptFeatures.map((feature) => `<span class="guarder-chip ${feature.active ? "active" : ""}" data-tooltip="${escapeHtml(feature.detail)}">${escapeHtml(feature.label)}</span>`).join("");
  return section("Intercept Attack", actionGlyph("R"), `${chips ? `<p class="guarder-chips left">${chips}</p>` : ""}${allies}`);
}

function featuresBody(view) {
  if (!view.features.length) return "";
  const rows = view.features.map((feature) => `<li class="guarder-feature ${feature.status}">
      <span class="guarder-feature-name">${escapeHtml(feature.name)}</span>
      <span class="guarder-feature-status" data-tooltip="${escapeHtml(feature.detail)}">${STATUS_LABEL[feature.status]}</span>
    </li>`).join("");
  return section("Guardian features", `<i class="fa-solid fa-list-check"></i>`, `<ul class="guarder-features">${rows}</ul>`);
}

export function guardianPanelBody(view) {
  return `<div class="guarder-panel">
    ${heroBody(view)}
    ${tauntBody(view)}
    ${stanceBody(view)}
    ${interceptBody(view)}
    ${featuresBody(view)}
  </div>`;
}
