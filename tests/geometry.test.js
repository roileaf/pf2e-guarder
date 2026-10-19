import test from "node:test";
import assert from "node:assert/strict";
import { adjacentPositions, chooseInterceptPosition, creatureDistance, isAdjacent, moveCost } from "../scripts/domain/geometry.js";

const at = (col, row, w = 1, h = 1) => ({ col, row, w, h });

test("movement uses the 5-10-5 diagonal rule", () => {
  assert.equal(moveCost(1, 0), 5);
  assert.equal(moveCost(1, 1), 5);
  assert.equal(moveCost(2, 2), 15);
  assert.equal(moveCost(3, 1), 15);
});

test("creature distance counts from the nearest edges", () => {
  assert.equal(creatureDistance(at(0, 0), at(1, 0)), 5);
  assert.equal(creatureDistance(at(0, 0), at(2, 0)), 10);
  assert.equal(creatureDistance(at(0, 0), at(3, 0)), 15);
  assert.equal(creatureDistance(at(0, 0, 2, 2), at(3, 0)), 10);
  assert.ok(isAdjacent(at(0, 0), at(1, 1)));
  assert.ok(!isAdjacent(at(0, 0), at(2, 0)));
});

test("adjacent positions ring the ally without overlapping it", () => {
  assert.equal(adjacentPositions(at(5, 5), at(0, 0)).length, 8);
  assert.equal(adjacentPositions(at(5, 5, 2, 2), at(0, 0)).length, 12);
});

test("an adjacent guardian does not move", () => {
  const position = chooseInterceptPosition({ guardian: at(4, 5), ally: at(5, 5), budget: 5 });
  assert.equal(position.cost, 0);
});

test("a guardian two squares away Steps into the nearest open square", () => {
  const position = chooseInterceptPosition({ guardian: at(3, 5), ally: at(5, 5), budget: 5 });
  assert.deepEqual({ col: position.col, row: position.row, cost: position.cost }, { col: 4, row: 4, cost: 5 });
});

test("blocked squares are skipped and out-of-budget squares rejected", () => {
  const blocked = (candidate) => candidate.col === 4;
  assert.equal(chooseInterceptPosition({ guardian: at(3, 5), ally: at(5, 5), budget: 5, blocked }), null);
  const stride = chooseInterceptPosition({ guardian: at(3, 5), ally: at(5, 5), budget: 25, blocked });
  assert.ok(stride && stride.col !== 4 && stride.cost > 5);
});
