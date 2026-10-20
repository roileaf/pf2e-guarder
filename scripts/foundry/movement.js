import { chooseInterceptPosition, interceptCandidates, overlaps } from "../domain/geometry.js";
import { pickSquare } from "../canvas/square-picker.js";
import { footprint, gridDistance, tokenDocument } from "./actors.js";

function gridSize(scene) {
  return Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100) || 100;
}

function squareGrid(scene) {
  const type = scene?.grid?.type;
  const square = globalThis.CONST?.GRID_TYPES?.SQUARE ?? 1;
  return type === undefined || type === square;
}

function wallBlocks(token, candidate, size) {
  const placeable = token.object;
  if (typeof placeable?.checkCollision !== "function") return false;
  const destination = { x: (candidate.col + candidate.w / 2) * size, y: (candidate.row + candidate.h / 2) * size };
  try {
    return Boolean(placeable.checkCollision(destination, { type: "move", mode: "any" }));
  } catch {
    return false;
  }
}

function plan(guardianToken, allyToken) {
  const guardian = tokenDocument(guardianToken);
  const ally = tokenDocument(allyToken);
  const scene = guardian?.parent;
  if (!guardian || !ally || scene?.id !== ally.parent?.id) return { reason: "different-scene" };
  if (!squareGrid(scene)) return { reason: "unsupported-grid" };
  const size = gridSize(scene);
  const others = [...scene.tokens]
    .filter((token) => token.id !== guardian.id && token.id !== ally.id && !token.hidden)
    .map(footprint);
  return {
    guardian, ally, scene, size,
    options: {
      guardian: footprint(guardian),
      ally: footprint(ally),
      gridDistance: gridDistance(scene),
      blocked: (candidate) => others.some((other) => overlaps(candidate, other)) || wallBlocks(guardian, candidate, size),
    },
  };
}

async function moveTo(guardian, position, size) {
  await guardian.update({ x: position.col * size, y: position.row * size });
  await guardian.object?.movementAnimationPromise;
  return { moved: true, cost: position.cost, reason: null };
}

/**
 * Move the guardian to the cheapest open square adjacent to the ally within `budget` feet.
 * Returns { moved, cost, reason } where reason explains why no move happened.
 */
export async function moveAdjacent(guardianToken, allyToken, { budget }) {
  const { guardian, size, options, reason } = plan(guardianToken, allyToken);
  if (reason) return { moved: false, reason };
  const position = chooseInterceptPosition({ ...options, budget });
  if (!position) return { moved: false, reason: "no-space" };
  if (position.cost === 0) return { moved: false, cost: 0, reason: "adjacent" };
  return moveTo(guardian, position, size);
}

/**
 * "I'll move": the guardian's player clicks one of the open squares adjacent to the ally that the
 * Step (or taunted-enemy Stride) can reach. Escape, right-click or the timeout leaves the guardian in place.
 */
export async function pickAdjacent(guardianToken, allyToken, { budget, label = "Step", timeoutMs = 40_000 }) {
  const { guardian, ally, scene, size, options, reason } = plan(guardianToken, allyToken);
  if (reason) return { moved: false, reason };
  const candidates = interceptCandidates({ ...options, budget });
  if (!candidates.length) {
    return { moved: false, reason: chooseInterceptPosition({ ...options, budget })?.cost === 0 ? "adjacent" : "no-space" };
  }
  if (globalThis.canvas?.scene?.id !== scene.id) return moveAdjacent(guardianToken, allyToken, { budget });
  const position = await pickSquare({
    candidates,
    timeoutMs,
    prompt: `Intercept Attack: click where ${guardian.name} goes next to ${ally.name} (${label} up to ${budget} feet). Enter takes the brightest square; Escape stays in place.`,
  });
  if (!position) return { moved: false, reason: "stayed" };
  return moveTo(guardian, position, size);
}
