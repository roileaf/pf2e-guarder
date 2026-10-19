export const PHYSICAL_TYPES = Object.freeze(["bludgeoning", "piercing", "slashing", "bleed"]);
// Energy Interceptor lists these five explicitly; force, vitality, and void stay excluded.
export const ENERGY_INTERCEPTOR_TYPES = Object.freeze(["acid", "cold", "electricity", "fire", "sonic"]);

export function interceptableTypes({ energyInterceptor = false } = {}) {
  return energyInterceptor ? [...PHYSICAL_TYPES, ...ENERGY_INTERCEPTOR_TYPES] : [...PHYSICAL_TYPES];
}

/**
 * Split damage instances into the part the guardian takes and the part the ally keeps.
 * scope "trigger": only the triggering damage types move to the guardian.
 * scope "all": the whole damage roll moves to the guardian.
 */
export function partitionInstances(instances, triggerTypes, scope = "trigger") {
  const list = [...(instances ?? [])];
  const triggers = new Set(triggerTypes);
  const triggered = list.some((instance) => triggers.has(instance.type) && !instance.persistent && instance.total > 0);
  if (!triggered) return { triggered: false, intercepted: [], remainder: list };
  if (scope === "all") return { triggered: true, intercepted: list, remainder: [] };
  return {
    triggered: true,
    intercepted: list.filter((instance) => triggers.has(instance.type)),
    remainder: list.filter((instance) => !triggers.has(instance.type)),
  };
}

function flavor(instance, extra = []) {
  return [...extra, instance.type, ...[...(instance.materials ?? [])].sort()].join(",");
}

/** A fixed-value formula term that reproduces an evaluated instance for IWR purposes. */
export function instanceTerm(instance) {
  if (instance.persistent) {
    const expression = instance.head?.expression ?? instance.expression ?? "1";
    return `(${expression})[${flavor(instance, ["persistent"])}]`;
  }
  return `${Math.max(0, Math.trunc(Number(instance.total) || 0))}[${flavor(instance)}]`;
}

export function damageFormula(instances) {
  const terms = instances.map(instanceTerm);
  if (!terms.length) return null;
  return terms.length === 1 ? terms[0] : `{${terms.join(",")}}`;
}

export function instancesTotal(instances) {
  return instances.reduce((sum, instance) => sum + (instance.persistent ? 0 : Number(instance.total) || 0), 0);
}
