// Movement walls between two points, from plain wall data. Pure functions, no Foundry globals.

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return Math.min(a.x, c.x) - 1e-9 <= b.x && b.x <= Math.max(a.x, c.x) + 1e-9
    && Math.min(a.y, c.y) - 1e-9 <= b.y && b.y <= Math.max(a.y, c.y) + 1e-9;
}

/** Do segments p1-p2 and q1-q2 touch or cross? */
export function segmentsIntersect(p1, p2, q1, q2) {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(p1, q1, p2)) || (o2 === 0 && onSegment(p1, q2, p2))
    || (o3 === 0 && onSegment(q1, p1, q2)) || (o4 === 0 && onSegment(q1, p2, q2));
}

/**
 * Whether moving in a straight line from `from` to `to` crosses a wall that blocks movement.
 * Each wall: { c: [x1, y1, x2, y2], move, door, ds }. `move` 0 never blocks; an open door (ds 1) doesn't either.
 */
export function wallBlocksPath(walls, from, to) {
  return walls.some((wall) => {
    if (!wall?.c || Number(wall.move) === 0) return false;
    if (Number(wall.door) > 0 && Number(wall.ds) === 1) return false;
    const [x1, y1, x2, y2] = wall.c;
    return segmentsIntersect(from, to, { x: x1, y: y1 }, { x: x2, y: y2 });
  });
}

/** Pixel centre of a footprint { col, row, w, h } on a grid of `size` pixels. */
export function footprintCenter({ col, row, w = 1, h = 1 }, size) {
  return { x: (col + w / 2) * size, y: (row + h / 2) * size };
}
