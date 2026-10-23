export const BASE_INTERCEPT_RANGE = 10;
export const TAUNTED_INTERCEPT_RANGE = 15;
export const STEP_DISTANCE = 5;

export function interceptRange({ sourceTaunted = false } = {}) {
  return sourceTaunted ? TAUNTED_INTERCEPT_RANGE : BASE_INTERCEPT_RANGE;
}

/** Feet the guardian may move: a Step, or a Stride when the taunted-enemy extension applies. */
export function interceptMovementBudget({ sourceTaunted = false, speed = 0 } = {}) {
  return sourceTaunted ? Math.max(STEP_DISTANCE, Number(speed) || 0) : STEP_DISTANCE;
}

/**
 * Decide whether one guardian may Intercept Attack.
 * Returns { eligible, reason } so the GM can see why a guardian was skipped.
 */
export function interceptEligibility({
  isSelf = false,
  isAlly = false,
  hasIntercept = false,
  incapacitated = false,
  alive = true,
  distance = Infinity,
  sourceTaunted = false,
  reactionsLeft = Infinity,
} = {}) {
  if (isSelf) return { eligible: false, reason: "is the damaged creature" };
  if (!hasIntercept) return { eligible: false, reason: "lacks Intercept Attack" };
  if (!isAlly) return { eligible: false, reason: "is not an ally" };
  if (!alive) return { eligible: false, reason: "is at 0 HP" };
  if (incapacitated) return { eligible: false, reason: "cannot use reactions" };
  if (reactionsLeft <= 0) return { eligible: false, reason: "has no reaction left" };
  const range = interceptRange({ sourceTaunted });
  if (!(distance <= range)) return { eligible: false, reason: `is farther than ${range} feet` };
  return { eligible: true, reason: null };
}

/**
 * Shield Block alongside Intercept Attack needs a second reaction, which only Reaction Time gives (one extra
 * each turn, and at initiative with Ever Ready). `reactionsLeft` is Infinity when reactions aren't tracked.
 */
export function shieldBlockOption({ shieldReady, reactionsLeft }) {
  if (!shieldReady) return { show: false, available: false, reason: null };
  if (reactionsLeft >= 2) return { show: true, available: true, reason: null };
  return { show: true, available: false, reason: "needs a second reaction (Reaction Time)" };
}

/** Whether the Shield Block request goes through: its reaction was spent, or the GM forced the interception. */
export function shieldBlockApplies({ requested, spent, forced = false }) {
  return Boolean(requested && (spent >= 2 || forced));
}
