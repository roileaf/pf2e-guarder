import { chooseInterceptPosition, overlaps } from "../domain/geometry.js";
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

/**
 * Move the guardian to the cheapest open square adjacent to the ally within `budget` feet.
 * Returns { moved, cost, reason } where reason explains why no move happened.
 */
export async function moveAdjacent(guardianToken, allyToken, { budget }) {
  const guardian = tokenDocument(guardianToken);
  const ally = tokenDocument(allyToken);
  const scene = guardian?.parent;
  if (!guardian || !ally || scene?.id !== ally.parent?.id) return { moved: false, reason: "different-scene" };
  if (!squareGrid(scene)) return { moved: false, reason: "unsupported-grid" };
  const size = gridSize(scene);
  const others = [...scene.tokens]
    .filter((token) => token.id !== guardian.id && token.id !== ally.id && !token.hidden)
    .map(footprint);
  const position = chooseInterceptPosition({
    guardian: footprint(guardian),
    ally: footprint(ally),
    budget,
    gridDistance: gridDistance(scene),
    blocked: (candidate) => others.some((other) => overlaps(candidate, other)) || wallBlocks(guardian, candidate, size),
  });
  if (!position) return { moved: false, reason: "no-space" };
  if (position.cost === 0) return { moved: false, cost: 0, reason: "adjacent" };
  await guardian.update({ x: position.col * size, y: position.row * size });
  await guardian.object?.movementAnimationPromise;
  return { moved: true, cost: position.cost, reason: null };
}
