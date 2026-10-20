// Square-grid geometry in grid cells. A footprint is { col, row, w, h }.

/** PF2e movement cost in feet: every second diagonal costs double. */
export function moveCost(dx, dy, gridDistance = 5) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const diagonal = Math.min(ax, ay);
  const straight = Math.max(ax, ay) - diagonal;
  return (straight + diagonal + Math.floor(diagonal / 2)) * gridDistance;
}

function axisSeparation(aStart, aSize, bStart, bSize) {
  if (bStart >= aStart + aSize) return bStart - (aStart + aSize) + 1;
  if (aStart >= bStart + bSize) return aStart - (bStart + bSize) + 1;
  return 0;
}

export function overlaps(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

/** Distance between two creatures in feet (adjacent = one grid step). */
export function creatureDistance(a, b, gridDistance = 5) {
  return moveCost(axisSeparation(a.col, a.w, b.col, b.w), axisSeparation(a.row, a.h, b.row, b.h), gridDistance);
}

export function isAdjacent(a, b, gridDistance = 5) {
  return !overlaps(a, b) && creatureDistance(a, b, gridDistance) <= gridDistance;
}

/** Every footprint position for `mover` that touches `ally` without sharing its space. */
export function adjacentPositions(ally, mover) {
  const positions = [];
  for (let col = ally.col - mover.w; col <= ally.col + ally.w; col++) {
    for (let row = ally.row - mover.h; row <= ally.row + ally.h; row++) {
      const candidate = { col, row, w: mover.w, h: mover.h };
      if (!overlaps(candidate, ally)) positions.push(candidate);
    }
  }
  return positions;
}

/**
 * Cheapest open position adjacent to the ally reachable within `budget` feet.
 * Returns the guardian's own footprint when it is already adjacent.
 * `blocked(candidate)` rejects occupied squares or paths through walls.
 */
export function chooseInterceptPosition({ guardian, ally, attacker = null, budget, gridDistance = 5, blocked = () => false }) {
  if (isAdjacent(guardian, ally, gridDistance)) return { ...guardian, cost: 0 };
  return interceptCandidates({ guardian, ally, attacker, budget, gridDistance, blocked })[0] ?? null;
}

/**
 * Every open position adjacent to the ally the guardian can reach within `budget` feet. With an
 * `attacker`, the squares closest to it come first (the guardian steps in toward the threat), then the cheapest.
 */
export function interceptCandidates({ guardian, ally, attacker = null, budget, gridDistance = 5, blocked = () => false }) {
  return adjacentPositions(ally, guardian)
    .map((candidate) => ({
      ...candidate,
      cost: moveCost(candidate.col - guardian.col, candidate.row - guardian.row, gridDistance),
      threat: attacker ? creatureDistance(candidate, attacker, gridDistance) : 0,
    }))
    .filter((candidate) => candidate.cost > 0 && candidate.cost <= budget && !blocked(candidate) && !(attacker && overlaps(candidate, attacker)))
    .sort((a, b) => a.threat - b.threat || a.cost - b.cost || a.row - b.row || a.col - b.col);
}

/** Every footprint the creature could reach moving up to `budget` feet (excluding staying put). */
function reachablePositions(mover, budget, gridDistance) {
  const steps = Math.floor(budget / gridDistance);
  const positions = [];
  for (let dc = -steps; dc <= steps; dc++) {
    for (let dr = -steps; dr <= steps; dr++) {
      if (!dc && !dr) continue;
      const cost = moveCost(dc, dr, gridDistance);
      if (cost <= budget) positions.push({ col: mover.col + dc, row: mover.row + dr, w: mover.w, h: mover.h, cost });
    }
  }
  return positions;
}

/**
 * Get Behind Me!: move the ally up to `budget` feet, staying within the guardian's reach,
 * farther from the attacker. Returns null when no square is farther from the attacker.
 */
export function getBehindCandidates({ ally, guardian, attacker, reach = 5, budget = 10, gridDistance = 5, blocked = () => false }) {
  const current = attacker ? creatureDistance(ally, attacker, gridDistance) : -Infinity;
  return reachablePositions(ally, budget, gridDistance)
    .filter((candidate) => !overlaps(candidate, guardian) && (!attacker || !overlaps(candidate, attacker)))
    .filter((candidate) => creatureDistance(candidate, guardian, gridDistance) <= reach)
    .map((candidate) => ({ ...candidate, away: attacker ? creatureDistance(candidate, attacker, gridDistance) : 0 }))
    .filter((candidate) => candidate.away > current && !blocked(candidate))
    .sort((a, b) => b.away - a.away || a.cost - b.cost || a.row - b.row || a.col - b.col);
}

/** The best Get Behind Me! square (farthest from the attacker, then shortest move), or null. */
export function chooseGetBehindPosition(options) {
  return getBehindCandidates(options)[0] ?? null;
}

/**
 * Unbelievable Interception: Stride directly toward the target. Picks the reachable square
 * closest to the target (never farther than now), preferring the shortest move.
 */
export function chooseTowardPosition({ mover, target, budget, gridDistance = 5, blocked = () => false }) {
  const current = creatureDistance(mover, target, gridDistance);
  const options = reachablePositions(mover, budget, gridDistance)
    .filter((candidate) => !overlaps(candidate, target))
    .map((candidate) => ({ ...candidate, distance: creatureDistance(candidate, target, gridDistance) }))
    .filter((candidate) => candidate.distance < current && !blocked(candidate))
    .sort((a, b) => a.distance - b.distance || a.cost - b.cost || a.row - b.row || a.col - b.col);
  return options[0] ?? null;
}

/**
 * The candidate footprint a pointer at grid coordinates (x, y) selects. Footprints of Large and bigger
 * creatures overlap, so among those covering the pointer the one whose centre is nearest wins.
 */
export function candidateAtPoint(candidates, x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (x < candidate.col || x >= candidate.col + candidate.w || y < candidate.row || y >= candidate.row + candidate.h) continue;
    const distance = (candidate.col + candidate.w / 2 - x) ** 2 + (candidate.row + candidate.h / 2 - y) ** 2;
    if (distance < bestDistance - 1e-9) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Every grid cell covered by at least one footprint, once each. */
export function coveredCells(candidates) {
  const cells = new Map();
  for (const { col, row, w, h } of candidates) {
    for (let c = col; c < col + w; c++) for (let r = row; r < row + h; r++) cells.set(`${c},${r}`, { col: c, row: r });
  }
  return [...cells.values()];
}

/**
 * The grid footprint of a token { x, y, width, height } (pixels / squares). Tiny creatures (under one
 * square) may sit inside a square: they occupy the square holding their centre.
 */
export function footprintOf({ x, y, width, height }, size = 100) {
  const w = Number(width) || 1;
  const h = Number(height) || 1;
  const cell = (position, span) => span < 1
    ? Math.floor((Number(position) + span * size / 2) / size)
    : Math.round(Number(position) / size);
  return { col: cell(x, w), row: cell(y, h), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}
