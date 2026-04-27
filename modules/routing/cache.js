// In-memory routing cache. Reload rebuilds from DB and bumps the version
// stamp; cross-cluster invalidation is out of scope for the monolith but
// the version stamp is the foundation for it (workers can compare stamps
// over a heartbeat channel).
let state = {
  version: 0,
  byType: new Map() // ruleType -> array of rules sorted by (priority asc, length(pattern) desc)
};

export const getVersion = () => state.version;

export const replaceWith = (rules) => {
  const byType = new Map();
  for (const r of rules) {
    if (!byType.has(r.rule_type)) byType.set(r.rule_type, []);
    byType.get(r.rule_type).push(r);
  }
  for (const [k, arr] of byType) {
    arr.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.pattern.length - a.pattern.length;
    });
    byType.set(k, arr);
  }
  state = { version: state.version + 1, byType };
  return state;
};

export const lookupExact = (ruleType, value) => {
  const arr = state.byType.get(ruleType) || [];
  return arr.find((r) => r.pattern === value) || null;
};

export const lookupLongestPrefix = (ruleType, value) => {
  const arr = state.byType.get(ruleType) || [];
  for (const r of arr) {
    if (String(value).startsWith(r.pattern)) return r;
  }
  return null;
};

export const stats = () => ({
  version: state.version,
  rulesCount: Array.from(state.byType.values()).reduce((n, a) => n + a.length, 0),
  ruleTypes: Array.from(state.byType.keys())
});
