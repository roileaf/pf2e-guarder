import { SOCKET_NAME } from "../constants.js";

const handlers = new Map();
const listeners = new Map();
const pending = new Map();

export function activeGM() {
  return game.users?.activeGM ?? game.users?.find((user) => user.active && user.isGM) ?? null;
}

/**
 * Whether this client should react to a world event caused by `userId`:
 * the causing user when they are a GM, otherwise the active GM. Exactly one client answers.
 */
export function isResponsibleGM(userId) {
  const author = game.users?.get?.(userId);
  if (author?.isGM && author.active) return author.id === game.user.id;
  return activeGM()?.id === game.user.id;
}

function isAuthority(authorityUserId, gmRequired, directed = false) {
  if (gmRequired) return activeGM()?.id === game.user.id;
  if (directed) return authorityUserId === game.user.id;
  return (activeGM()?.id ?? authorityUserId) === game.user.id;
}

async function receive(packet) {
  if (packet.type === "broadcast") {
    if (packet.userIds && !packet.userIds.includes(game.user.id)) return;
    listeners.get(packet.operation)?.(packet.payload, packet.userId);
    return;
  }
  if (packet.type === "response") {
    const request = pending.get(packet.requestId);
    if (!request) return;
    pending.delete(packet.requestId);
    clearTimeout(request.timeout);
    packet.ok ? request.resolve(packet.result) : request.reject(new Error(packet.error));
    return;
  }
  if (packet.type !== "request" || !isAuthority(packet.authorityUserId, packet.gmRequired, packet.directed)) return;
  const handler = handlers.get(packet.operation);
  if (!handler) {
    game.socket.emit(SOCKET_NAME, {
      type: "response",
      requestId: packet.requestId,
      ok: false,
      error: `Client cannot handle "${packet.operation}". Update PF2e Guarder and hard-reload that client.`,
    });
    return;
  }
  try {
    const result = await handler(packet.payload, packet.userId);
    game.socket.emit(SOCKET_NAME, { type: "response", requestId: packet.requestId, ok: true, result });
  } catch (error) {
    console.error(`${SOCKET_NAME} | ${packet.operation}`, error);
    game.socket.emit(SOCKET_NAME, { type: "response", requestId: packet.requestId, ok: false, error: error.message });
  }
}

export function registerSocket() {
  game.socket.on(SOCKET_NAME, receive);
}

export function registerOperation(name, handler) {
  handlers.set(name, handler);
}

export function registerListener(name, listener) {
  listeners.set(name, listener);
}

/** Fire-and-forget message to other clients; delivered locally too when this user is addressed. */
export function broadcast(operation, payload, { userIds = null } = {}) {
  const packet = { type: "broadcast", operation, payload, userIds, userId: game.user.id };
  game.socket.emit(SOCKET_NAME, packet);
  if (!userIds || userIds.includes(game.user.id)) listeners.get(operation)?.(payload, game.user.id);
}

export async function requestOperation(operation, payload, {
  authorityUserId = game.user.id,
  gmRequired = false,
  directed = false,
  timeoutMs = 12_000,
} = {}) {
  const packet = {
    type: "request",
    requestId: foundry.utils.randomID(),
    operation,
    payload,
    authorityUserId,
    gmRequired,
    directed,
    userId: game.user.id,
  };
  if (gmRequired && !activeGM()) {
    throw new Error("An active GM with PF2e Guarder enabled is required for this action.");
  }
  // Any GM may perform GM work for its own requests; incoming requests still go to one GM only.
  if ((gmRequired && game.user.isGM) || isAuthority(authorityUserId, gmRequired, directed)) {
    const handler = handlers.get(operation);
    if (!handler) throw new Error(`No handler registered for ${operation}.`);
    return handler(payload, game.user.id);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(packet.requestId);
      const message = gmRequired
        ? "Active GM did not answer the Guarder request. Hard-reload PF2e Guarder on the GM client."
        : "Guarder client did not answer. Hard-reload PF2e Guarder on that client.";
      reject(new Error(message));
    }, timeoutMs);
    pending.set(packet.requestId, { resolve, reject, timeout });
    game.socket.emit(SOCKET_NAME, packet);
  });
}
