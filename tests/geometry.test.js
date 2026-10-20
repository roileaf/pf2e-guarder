import test from "node:test";
import assert from "node:assert/strict";
import {
  adjacentPositions, candidateAtPoint, chooseInterceptPosition, coveredCells, creatureDistance, footprintOf, interceptCandidates, isAdjacent, moveCost,
} from "../scripts/domain/geometry.js";

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

test("Choose square offers every open square next to the ally within the Step", () => {
  const options = interceptCandidates({ guardian: at(0, 1), ally: at(2, 1), budget: 5 });
  assert.deepEqual(options.map(({ col, row }) => [col, row]), [[1, 0], [1, 1], [1, 2]]);
  assert.ok(options.every((option) => option.cost === 5));
  const blocked = interceptCandidates({ guardian: at(0, 1), ally: at(2, 1), budget: 5, blocked: (c) => c.row === 1 });
  assert.deepEqual(blocked.map(({ col, row }) => [col, row]), [[1, 0], [1, 2]]);
  assert.equal(interceptCandidates({ guardian: at(0, 1), ally: at(3, 1), budget: 5 }).length, 0);
  assert.ok(interceptCandidates({ guardian: at(0, 1), ally: at(3, 1), budget: 10 }).length > 0);
});

test("the intercepting Step prefers the square toward the attacker", () => {
  // Guardian west of the ally, attacker east: the guardian ends between them when it can.
  const options = interceptCandidates({ guardian: at(2, 0), ally: at(2, 2), attacker: at(5, 2), budget: 10 });
  assert.deepEqual([options[0].col, options[0].row], [3, 1]);
  const pick = chooseInterceptPosition({ guardian: at(0, 1), ally: at(2, 1), attacker: at(2, 4), budget: 5 });
  assert.deepEqual([pick.col, pick.row], [1, 2]);
  assert.ok(interceptCandidates({ guardian: at(0, 1), ally: at(2, 1), attacker: at(3, 1), budget: 15 }).every((c) => !(c.col === 3 && c.row === 1)));
});

test("picking among overlapping Large footprints takes the one centred nearest the pointer", () => {
  const options = [at(0, 0, 2, 2), at(1, 0, 2, 2), at(1, 1, 2, 2)];
  assert.equal(candidateAtPoint(options, 0.5, 0.5), options[0]);
  assert.equal(candidateAtPoint(options, 2.6, 0.4), options[1]);
  assert.equal(candidateAtPoint(options, 2.6, 2.4), options[2]);
  assert.equal(candidateAtPoint(options, 5, 5), null);
  assert.equal(coveredCells(options).length, 8);
});

test("footprints: Large spans squares, Tiny sits in the square holding its centre", () => {
  assert.deepEqual(footprintOf({ x: 200, y: 300, width: 2, height: 2 }), at(2, 3, 2, 2));
  assert.deepEqual(footprintOf({ x: 150, y: 250, width: 0.5, height: 0.5 }), at(1, 2));
  assert.deepEqual(footprintOf({ x: 100, y: 200, width: 0.5, height: 0.5 }), at(1, 2));
});
