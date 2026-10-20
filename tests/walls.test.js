import test from "node:test";
import assert from "node:assert/strict";
import { footprintCenter, segmentsIntersect, wallBlocksPath } from "../scripts/domain/walls.js";

const p = (x, y) => ({ x, y });
const wall = (c, extra = {}) => ({ c, move: 20, door: 0, ds: 0, ...extra });

test("segments that cross or touch intersect; parallel or apart ones don't", () => {
  assert.ok(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0)));
  assert.ok(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(5, 5)));
  assert.ok(!segmentsIntersect(p(0, 0), p(10, 0), p(0, 5), p(10, 5)));
  assert.ok(!segmentsIntersect(p(0, 0), p(4, 0), p(5, -5), p(5, 5)));
});

test("a movement wall between the squares blocks the path", () => {
  const from = footprintCenter({ col: 4, row: 6 }, 100);
  const to = footprintCenter({ col: 5, row: 6 }, 100);
  assert.deepEqual(from, p(450, 650));
  assert.ok(wallBlocksPath([wall([500, 400, 500, 900])], from, to));
  assert.ok(!wallBlocksPath([wall([500, 400, 500, 600])], from, to));
});

test("walls that don't block movement and open doors are ignored", () => {
  const from = p(450, 650);
  const to = p(550, 650);
  assert.ok(!wallBlocksPath([wall([500, 0, 500, 900], { move: 0 })], from, to));
  assert.ok(!wallBlocksPath([wall([500, 0, 500, 900], { door: 1, ds: 1 })], from, to));
  assert.ok(wallBlocksPath([wall([500, 0, 500, 900], { door: 1, ds: 0 })], from, to));
  assert.ok(wallBlocksPath([wall([500, 0, 500, 900], { door: 1, ds: 2 })], from, to));
});
