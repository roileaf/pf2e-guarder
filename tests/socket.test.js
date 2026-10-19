import test from "node:test";
import assert from "node:assert/strict";
import { broadcast, isResponsibleGM, registerListener, registerOperation, requestOperation } from "../scripts/foundry/socket.js";

function withGame(game, callback) {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  globalThis.game = game;
  globalThis.foundry = { utils: { randomID: () => "request" } };
  return Promise.resolve(callback()).finally(() => {
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
  });
}

test("a directed prompt to the local user runs locally", () => withGame({
  user: { id: "player" },
  users: { activeGM: { id: "gm" } },
  socket: { emit: () => assert.fail("should not emit") },
}, async () => {
  registerOperation("local-op", async (payload, userId) => ({ payload, userId }));
  const result = await requestOperation("local-op", { value: 1 }, { authorityUserId: "player", directed: true });
  assert.deepEqual(result, { payload: { value: 1 }, userId: "player" });
}));

test("a directed prompt to another user is emitted and times out as an error", () => {
  let emitted;
  return withGame({
    user: { id: "gm" },
    users: { activeGM: { id: "gm" } },
    socket: { emit: (_channel, packet) => { emitted = packet; } },
  }, async () => {
    await assert.rejects(() => requestOperation("remote-op", {}, { authorityUserId: "player", directed: true, timeoutMs: 5 }), /did not answer/);
    assert.equal(emitted.authorityUserId, "player");
  });
});

test("broadcast reaches local listeners and the socket", () => {
  const emitted = [];
  const heard = [];
  return withGame({
    user: { id: "gm" },
    users: { activeGM: { id: "gm" } },
    socket: { emit: (_channel, packet) => emitted.push(packet) },
  }, () => {
    registerListener("dismiss", (payload) => heard.push(payload));
    broadcast("dismiss", { requestId: "r1" });
    assert.equal(emitted[0].type, "broadcast");
    assert.deepEqual(heard, [{ requestId: "r1" }]);
  });
});

test("GM-only operations fail fast without a GM", () => withGame({
  user: { id: "player" },
  users: { activeGM: null, find: () => null },
  socket: { emit() {} },
}, async () => {
  await assert.rejects(() => requestOperation("gm-op", {}, { gmRequired: true }), /active GM.*required/i);
}));

test("a second GM runs GM-only work locally instead of waiting on the active GM", () => withGame({
  user: { id: "second-gm", isGM: true },
  users: { activeGM: { id: "first-gm", isGM: true, active: true } },
  socket: { emit: () => assert.fail("should not emit") },
}, async () => {
  registerOperation("gm-local", async (_payload, userId) => userId);
  assert.equal(await requestOperation("gm-local", {}, { gmRequired: true }), "second-gm");
}));

test("the GM who caused an event handles it; player events go to the active GM", () => {
  const first = { id: "first-gm", isGM: true, active: true };
  const second = { id: "second-gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  const users = new Map([[first.id, first], [second.id, second], [player.id, player]]);
  return withGame({ user: second, users: { activeGM: first, get: (id) => users.get(id) } }, () => {
    assert.equal(isResponsibleGM("second-gm"), true);
    assert.equal(isResponsibleGM("first-gm"), false);
    assert.equal(isResponsibleGM("player"), false);
  });
});
