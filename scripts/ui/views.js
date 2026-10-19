// HTML for Guarder windows and chat cards. Pure string builders: no Foundry calls.

const DEFAULT_IMG = "icons/svg/mystery-man.svg";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

function portrait(img, name, extra = "") {
  return `<img class="guarder-portrait ${extra}" src="${escapeHtml(img || DEFAULT_IMG)}" alt="${escapeHtml(name)}">`;
}

export function damageChips(parts = []) {
  return parts.map((part) => `<span class="guarder-chip damage ${escapeHtml(part.type)}">
      ${part.icon ? `<i class="${escapeHtml(part.icon)}"></i>` : ""}<strong>${part.persistent ? escapeHtml(part.formula ?? "") : Number(part.total) || 0}</strong>
      ${escapeHtml(part.label ?? part.type)}${part.persistent ? " (persistent)" : ""}</span>`).join("");
}

/** PF2e's action font: "1"-"3" actions, "F" free action, "R" reaction. */
export function actionGlyph(code, extra = "") {
  return `<span class="action-glyph ${extra}">${escapeHtml(code)}</span>`;
}

export function reactionPips(pool) {
  if (!pool) return `<span class="guarder-pips untracked" data-tooltip="Reactions are tracked in combat only">${actionGlyph("R")}<small>∞</small></span>`;
  const pips = [];
  for (let index = 0; index < (pool.general ?? 0); index++) pips.push(actionGlyph("R", "general"));
  for (let index = 0; index < (pool.guardian ?? 0); index++) pips.push(actionGlyph("R", "guardian"));
  if (!pips.length) pips.push(actionGlyph("R", "spent"));
  const tooltip = `${pool.general ?? 0} reaction${pool.general === 1 ? "" : "s"}${pool.guardian ? ` + ${pool.guardian} guardian-only` : ""}`;
  return `<span class="guarder-pips" data-tooltip="${escapeHtml(tooltip)}">${pips.join("")}</span>`;
}

const MOVEMENT_LABEL = {
  adjacent: { icon: "fa-solid fa-check", text: "Already adjacent" },
  step: { icon: "fa-solid fa-shoe-prints", text: "Step into place" },
  stride: { icon: "fa-solid fa-person-running", text: "Stride allowed (taunted enemy)" },
};

/** Body of the guardian's Intercept Attack prompt. */
export function interceptPromptBody(view) {
  const movement = MOVEMENT_LABEL[view.movement] ?? MOVEMENT_LABEL.step;
  const shield = view.canShieldBlock
    ? `<label class="guarder-toggle"><input type="checkbox" name="shieldBlock">
        <span class="track"></span><span>${actionGlyph("R")} Also Shield Block <small>spends another reaction</small></span></label>`
    : "";
  const behind = view.getBehindMe
    ? `<label class="guarder-toggle"><input type="checkbox" name="getBehindMe" checked>
        <span class="track"></span><span><i class="fa-solid fa-people-arrows"></i> Get Behind Me! <small>move ${escapeHtml(view.allyName)} up to 10 ft away from the attacker</small></span></label>`
    : "";
  return `<header class="guarder-hero">
      ${portrait(view.guardianImg, view.guardianName, "large")}
      <div class="guarder-identity">
        <span class="guarder-eyebrow">${actionGlyph("R")} Intercept Attack</span>
        <h2>${escapeHtml(view.guardianName)}</h2>
        <p>${reactionPips(view.pool)} <span class="guarder-muted">${Math.round(view.distance)} ft from ${escapeHtml(view.allyName)}</span></p>
      </div>
    </header>
    <section class="guarder-threat">
      <div class="guarder-figure">${portrait(view.attackerImg, view.attackerName ?? "Unknown source")}<span>${escapeHtml(view.attackerName ?? "Unknown")}</span></div>
      <div class="guarder-arrow"><div class="guarder-chips">${damageChips(view.parts)}</div><i class="fa-solid fa-arrow-right-long"></i></div>
      <div class="guarder-figure ally">${portrait(view.allyImg, view.allyName)}<span>${escapeHtml(view.allyName)}</span></div>
    </section>
    <ul class="guarder-facts">
      <li><i class="${movement.icon}"></i> ${movement.text}</li>
      ${view.keeps?.length ? `<li><i class="fa-solid fa-arrow-turn-down"></i> ${escapeHtml(view.allyName)} still takes ${damageChips(view.keeps)}</li>` : ""}
    </ul>
    ${shield}${behind}`;
}

const STATUS = {
  waiting: { icon: "fa-solid fa-hourglass-half", text: "Deciding…" },
  declined: { icon: "fa-solid fa-xmark", text: "Declined" },
  timeout: { icon: "fa-solid fa-clock", text: "No answer" },
  accepted: { icon: "fa-solid fa-shield-halved", text: "Intercepting" },
};

/** Body of the GM waiting board; each row has a Force button. */
export function overrideBoardBody(view) {
  const rows = view.candidates.map((candidate, index) => `<li class="guarder-row" data-index="${index}" data-status="waiting">
      ${portrait(candidate.img, candidate.name)}
      <div class="guarder-row-text"><strong>${escapeHtml(candidate.name)}</strong>
        <small><i class="fa-solid fa-user"></i> ${escapeHtml(candidate.userName)} · ${Math.round(candidate.distance)} ft</small></div>
      <span class="guarder-status"><i class="${STATUS.waiting.icon}"></i> <span>${STATUS.waiting.text}</span></span>
      <button type="button" class="guarder-button subtle compact" data-action="choose" data-value="force-${index}">
        <i class="fa-solid fa-gavel"></i><span>Force</span></button>
    </li>`).join("");
  return `<header class="guarder-hero compact">
      ${portrait(view.allyImg, view.allyName, "large")}
      <div class="guarder-identity">
        <span class="guarder-eyebrow"><i class="fa-solid fa-hourglass-half"></i> Waiting on guardians</span>
        <h2>${escapeHtml(view.allyName)}</h2>
        <p class="guarder-chips">${damageChips(view.parts)}</p>
      </div>
    </header>
    <ul class="guarder-rows">${rows}</ul>
    <p class="guarder-hint">GM override: force a guardian to intercept, or apply the damage to the ally now.</p>`;
}

export function overrideRowStatus(element, index, status) {
  const row = element?.querySelector?.(`.guarder-row[data-index="${index}"]`);
  if (!row) return;
  const state = STATUS[status] ?? STATUS.waiting;
  row.dataset.status = status;
  const label = row.querySelector(".guarder-status");
  if (label) label.innerHTML = `<i class="${state.icon}"></i> <span>${state.text}</span>`;
}

/** Rows of enemies for the Taunt pickers. */
export function enemyRows(enemies, { input = null } = {}) {
  return `<ul class="guarder-rows">${enemies.map((enemy) => `<li class="guarder-row">
      ${input ? `<label class="guarder-check"><input type="checkbox" name="${input}" value="${escapeHtml(enemy.value)}"><span></span></label>` : ""}
      ${portrait(enemy.img, enemy.name)}
      <div class="guarder-row-text"><strong>${escapeHtml(enemy.name)}</strong>
        <small><i class="fa-solid fa-ruler"></i> ${Math.round(enemy.distance)} ft</small></div>
    </li>`).join("")}</ul>`;
}

export function tauntRangeBody(view) {
  return `<header class="guarder-hero compact">
      ${portrait(view.guardianImg, view.guardianName, "large")}
      <div class="guarder-identity">
        <span class="guarder-eyebrow">${actionGlyph("1")} Taunt · out of range</span>
        <h2>${escapeHtml(view.guardianName)}</h2>
        <p class="guarder-muted">Taunt reaches enemies within ${view.range} feet.</p>
      </div>
    </header>${enemyRows(view.enemies)}`;
}

export function tauntKeepBody(view) {
  return `<header class="guarder-hero compact">
      ${portrait(view.guardianImg, view.guardianName, "large")}
      <div class="guarder-identity">
        <span class="guarder-eyebrow">${actionGlyph("1")} Group Taunt</span>
        <h2>Keep ${view.capacity} taunted ${view.capacity === 1 ? "enemy" : "enemies"}</h2>
        <p class="guarder-muted">The rest stop being taunted.</p>
      </div>
    </header>${enemyRows(view.enemies, { input: "keep" })}`;
}

/** Free-action follow-ups; the guardian's owner sees and uses them (others' copies are removed on render). */
function followUpButtons(view) {
  if (!view.followUps?.length || !view.attackerTokenUuid) return "";
  return `<div class="guarder-card-actions">${view.followUps.map((followUp) => `<button type="button" class="guarder-card-button"
      data-guarder-followup="${escapeHtml(followUp.kind)}" data-guardian="${escapeHtml(view.guardianUuid)}" data-attacker="${escapeHtml(view.attackerTokenUuid)}">
      ${actionGlyph(followUp.glyph ?? "F")} ${escapeHtml(followUp.label)}</button>`).join("")}</div>`;
}

/** Chat card posted when a guardian intercepts. */
export function interceptCard(view) {
  const notes = view.notes?.length ? `<ul class="guarder-card-notes">${view.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : "";
  return `<div class="guarder-card">
    <header class="guarder-card-header">
      ${portrait(view.guardianImg, view.guardianName)}
      <div><span class="guarder-card-eyebrow">@UUID[${view.actionUuid}]{Intercept Attack}</span>
        <h3>${escapeHtml(view.guardianName)} shields ${escapeHtml(view.allyName)}</h3></div>
      ${portrait(view.allyImg, view.allyName, "small")}
    </header>
    <div class="guarder-card-chips">${damageChips(view.parts)}${view.forced ? `<span class="guarder-chip override"><i class="fa-solid fa-gavel"></i> GM override</span>` : ""}</div>
    ${notes}
    ${followUpButtons(view)}
    <footer class="guarder-card-footer">Reactions left ${reactionPips(view.pool)}</footer>
  </div>`;
}

/** Prompt for Unbelievable Interception (mythic): before the attack resolves. */
export function unbelievablePromptBody(view) {
  return `<header class="guarder-hero">
      ${portrait(view.guardianImg, view.guardianName, "large")}
      <div class="guarder-identity">
        <span class="guarder-eyebrow">${actionGlyph("R")} Mythic reaction</span>
        <h2>${escapeHtml(view.guardianName)}</h2>
        <p>${reactionPips(view.pool)} <span class="guarder-chip mythic"><i class="fa-solid fa-circle-m"></i> ${Number(view.mythicPoints) || 0} mythic</span></p>
      </div>
    </header>
    <section class="guarder-threat">
      <div class="guarder-figure">${portrait(view.attackerImg, view.attackerName)}<span>${escapeHtml(view.attackerName)}</span></div>
      <div class="guarder-arrow"><div class="guarder-chips"><span class="guarder-chip"><i class="fa-solid fa-dice-d20"></i><strong>${escapeHtml(view.total ?? "?")}</strong> to hit</span></div><i class="fa-solid fa-arrow-right-long"></i></div>
      <div class="guarder-figure ally">${portrait(view.allyImg, view.allyName)}<span>${escapeHtml(view.allyName)}</span></div>
    </section>
    <ul class="guarder-facts">
      <li><i class="fa-solid fa-person-running"></i> Spend a Mythic Point and Stride twice toward ${escapeHtml(view.attackerName)} (${Math.round(view.distance)} ft away)</li>
      <li><i class="fa-solid fa-crosshairs"></i> If you end within the attack's reach, you become its target; the roll is compared to your AC</li>
    </ul>`;
}

const OUTCOME_LABEL = { criticalSuccess: "Critical hit", success: "Hit", failure: "Miss", criticalFailure: "Critical miss" };

export function unbelievableCard(view) {
  const notes = view.notes?.length ? `<ul class="guarder-card-notes">${view.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : "";
  const result = view.outcome
    ? `<span class="guarder-chip"><i class="fa-solid fa-dice-d20"></i><strong>${escapeHtml(view.total)}</strong> vs AC ${escapeHtml(view.ac)}</span>
       <span class="guarder-chip outcome ${escapeHtml(view.outcome)}">${OUTCOME_LABEL[view.outcome] ?? escapeHtml(view.outcome)}</span>`
    : "";
  const counter = view.counter
    ? `<div class="guarder-card-actions"><button type="button" class="guarder-card-button primary" data-guarder-followup="mythic-strike"
        data-guardian="${escapeHtml(view.guardianUuid)}" data-attacker="${escapeHtml(view.attackerTokenUuid)}">
        ${actionGlyph("F")} Strike back at mythic proficiency</button></div>`
    : "";
  return `<div class="guarder-card">
    <header class="guarder-card-header">
      ${portrait(view.guardianImg, view.guardianName)}
      <div><span class="guarder-card-eyebrow">${actionGlyph("R")} Unbelievable Interception</span>
        <h3>${escapeHtml(view.guardianName)} ${view.outcome ? "takes" : "races toward"} ${escapeHtml(view.attackerName)}'s attack on ${escapeHtml(view.allyName)}</h3></div>
    </header>
    <div class="guarder-card-chips">${result}</div>
    ${notes}${counter}
    <footer class="guarder-card-footer">Reactions left ${reactionPips(view.pool)}</footer>
  </div>`;
}

/** Generic guardian reaction prompt: hero, optional threat strip, facts. Buttons come from the caller. */
export function reactionPromptBody(view) {
  const threat = view.attackerName
    ? `<section class="guarder-threat">
      <div class="guarder-figure">${portrait(view.attackerImg, view.attackerName)}<span>${escapeHtml(view.attackerName)}</span></div>
      <div class="guarder-arrow"><div class="guarder-chips">${(view.chips ?? []).map((chip) => `<span class="guarder-chip">${chip.icon ? `<i class="${escapeHtml(chip.icon)}"></i>` : ""}${escapeHtml(chip.text)}</span>`).join("")}</div><i class="fa-solid fa-arrow-right-long"></i></div>
      <div class="guarder-figure ally">${portrait(view.targetImg, view.targetName)}<span>${escapeHtml(view.targetName)}</span></div>
    </section>`
    : "";
  const facts = (view.facts ?? []).map((fact) => `<li><i class="${escapeHtml(fact.icon ?? "fa-solid fa-circle-info")}"></i> ${escapeHtml(fact.text)}</li>`).join("");
  return `<header class="guarder-hero">
      ${portrait(view.guardianImg, view.guardianName, "large")}
      <div class="guarder-identity">
        <span class="guarder-eyebrow">${actionGlyph("R")} ${escapeHtml(view.eyebrow)}</span>
        <h2>${escapeHtml(view.guardianName)}</h2>
        <p>${reactionPips(view.pool)}</p>
      </div>
    </header>
    ${threat}
    ${facts ? `<ul class="guarder-facts">${facts}</ul>` : ""}`;
}

/** Generic guardian reaction chat card. */
export function reactionCard(view) {
  const notes = view.notes?.length ? `<ul class="guarder-card-notes">${view.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : "";
  const chips = (view.chips ?? []).map((chip) => `<span class="guarder-chip ${escapeHtml(chip.class ?? "")}">${chip.icon ? `<i class="${escapeHtml(chip.icon)}"></i>` : ""}${escapeHtml(chip.text)}</span>`).join("");
  return `<div class="guarder-card">
    <header class="guarder-card-header">
      ${portrait(view.guardianImg, view.guardianName)}
      <div><span class="guarder-card-eyebrow">${view.glyph === null ? "" : `${actionGlyph(view.glyph ?? "R")} `}${escapeHtml(view.eyebrow)}</span>
        <h3>${escapeHtml(view.headline)}</h3></div>
    </header>
    ${chips ? `<div class="guarder-card-chips">${chips}</div>` : ""}
    ${notes}
    <footer class="guarder-card-footer">Reactions left ${reactionPips(view.pool)}</footer>
  </div>`;
}

/** GM whisper when a taunted enemy casts a spell. */
export function tauntSpellCard(view) {
  const buttons = view.guardians.map((guardian) => `<button type="button" class="guarder-card-button" data-guarder-action="taunt-off-guard"
      data-enemy="${escapeHtml(view.enemyUuid)}" data-guardian="${escapeHtml(guardian.uuid)}">
      <i class="fa-solid fa-bullhorn"></i> Off-guard (${escapeHtml(guardian.name)})</button>`).join("");
  return `<div class="guarder-card">
    <header class="guarder-card-header">
      ${portrait(view.enemyImg, view.enemyName)}
      <div><span class="guarder-card-eyebrow">${actionGlyph("1")} Taunted spellcaster</span>
        <h3>${escapeHtml(view.enemyName)} casts ${escapeHtml(view.spellName)}</h3></div>
    </header>
    <p class="guarder-card-text">If the spell affects the guardian's allies but not the guardian, enable the Taunt DC penalty toggle and make the caster off-guard.</p>
    <div class="guarder-card-actions">${buttons}</div>
  </div>`;
}
