// Let the user click one of several legal destination squares on the canvas.
// Enter takes the suggested (first) square; Escape or right-click cancels.

import { candidateAtPoint, coveredCells } from "../domain/geometry.js";

let cancelActive = null;

const ORANGE = 0xe8862e;
const ORANGE_BRIGHT = 0xffb15c;

/**
 * @param {object} options
 * @param {Array<{col,row,w,h}>} options.candidates  legal footprints, best first
 * @param {string} options.prompt                    notification text
 * @param {number} [options.timeoutMs]               give up (resolve null) after this long
 * @returns {Promise<object|null>} the chosen candidate, or null when cancelled
 */
export function pickSquare({ candidates, prompt, timeoutMs = 0 }) {
  cancelActive?.();
  if (!globalThis.canvas?.ready || !candidates.length) return Promise.resolve(null);
  const stage = canvas.stage;
  const view = canvas.app.canvas ?? canvas.app.view;
  const size = canvas.grid.size;
  return new Promise((resolve) => {
    const graphics = new PIXI.Graphics();
    graphics.eventMode = "none";
    stage.addChild(graphics);
    const previousCursor = view.style.cursor;
    view.style.cursor = "crosshair";

    // Footprints of Large and bigger creatures overlap: paint each reachable cell once, then outline
    // the suggested footprint and the one under the pointer.
    const cells = coveredCells(candidates);
    const outline = (candidate, width, color, alpha, fill) => graphics.lineStyle(width, color, alpha)
      .beginFill(ORANGE, fill)
      .drawRoundedRect(candidate.col * size + 3, candidate.row * size + 3, candidate.w * size - 6, candidate.h * size - 6, 8)
      .endFill();
    const draw = (hovered) => {
      graphics.clear();
      for (const cell of cells) {
        graphics.lineStyle(1, ORANGE, 0.5).beginFill(ORANGE, 0.14)
          .drawRoundedRect(cell.col * size + 3, cell.row * size + 3, size - 6, size - 6, 8).endFill();
      }
      if (candidates[0] !== hovered) outline(candidates[0], 2, ORANGE, 0.9, 0.18);
      if (hovered) outline(hovered, 3, ORANGE_BRIGHT, 1, 0.35);
    };
    const location = (event) => {
      const rect = view.getBoundingClientRect();
      return stage.toLocal({
        x: (event.clientX - rect.left) * canvas.app.screen.width / rect.width,
        y: (event.clientY - rect.top) * canvas.app.screen.height / rect.height,
      });
    };
    const candidateAt = (event) => {
      const point = location(event);
      return candidateAtPoint(candidates, point.x / size, point.y / size);
    };
    let timer = null;
    const cleanup = (result = null) => {
      clearTimeout(timer);
      view.removeEventListener("pointermove", move, true);
      view.removeEventListener("pointerdown", click, true);
      view.removeEventListener("contextmenu", cancel, true);
      document.removeEventListener("keydown", key, true);
      Hooks.off("canvasTearDown", teardown);
      view.style.cursor = previousCursor;
      graphics.destroy();
      cancelActive = null;
      resolve(result);
    };
    const cancel = (event) => {
      event?.preventDefault();
      event?.stopImmediatePropagation();
      cleanup();
    };
    const key = (event) => {
      if (event.key === "Escape") cancel(event);
      else if (event.key === "Enter") {
        event.preventDefault();
        cleanup(candidates[0]);
      }
    };
    const move = (event) => draw(candidateAt(event));
    const click = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button !== 0) return cleanup();
      const chosen = candidateAt(event);
      if (!chosen) return ui.notifications.warn("Choose one of the highlighted squares.");
      cleanup(chosen);
    };
    const teardown = Hooks.on("canvasTearDown", () => cleanup());
    cancelActive = () => cleanup();
    view.addEventListener("pointermove", move, true);
    view.addEventListener("pointerdown", click, true);
    view.addEventListener("contextmenu", cancel, true);
    document.addEventListener("keydown", key, true);
    draw(null);
    if (timeoutMs > 0) timer = setTimeout(() => cleanup(), timeoutMs);
    ui.notifications.info(prompt);
  });
}
