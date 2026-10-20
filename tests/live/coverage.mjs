export function casePassed(result) {
  return result?.status === 'pass' && result.assertions?.length > 0 &&
    result.assertions.every(a => a.passed === true) && result.screenshots?.length > 0 && !result.errors?.length;
}

export function coverageFor(catalog, results) {
  const byName = new Map(results.map(r => [r.name, r]));
  return {
    required: catalog.length,
    passed: catalog.filter(c => casePassed(byName.get(c.name))).map(c => c.name),
    failed: catalog.filter(c => byName.has(c.name) && !casePassed(byName.get(c.name))).map(c => c.name),
    unrun: catalog.filter(c => !byName.has(c.name)).map(c => c.name),
  };
}

export function selectCases(catalog, { full = false, filter = '' } = {}) {
  const names = filter.split(',').map(s => s.trim()).filter(Boolean);
  if (new Set(catalog.map(c => c.name)).size !== catalog.length || catalog.some(c => !/^[a-z0-9-]+$/.test(c.name))) throw Error('Invalid case catalog');
  for (const name of names) if (!catalog.some(c => c.name === name)) throw Error(`Unknown live case: ${name}`);
  return catalog.filter(c => names.length ? names.includes(c.name) : full || c.smoke);
}
