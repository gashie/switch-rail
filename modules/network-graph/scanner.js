// Three scanners — pure functions over edges/transactions. Each returns
// alert candidates with evidence; the alerts service persists them.
//
// 1. Mule ring (cycle): A → B → C → A within window with ~equal amounts.
// 2. Structuring: cumulative outbound > threshold, every tx < threshold.
// 3. Coordinated burst: N+ senders → single beneficiary in short window.

const within5Pct = (a, b) => {
  const x = BigInt(a);
  const y = BigInt(b);
  if (x === 0n || y === 0n) return false;
  const diff = x > y ? x - y : y - x;
  return diff * 20n <= (x > y ? x : y); // diff/max ≤ 1/20 = 5%
};

const buildAdjacency = (edges) => {
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from_account_key)) out.set(e.from_account_key, []);
    out.get(e.from_account_key).push(e);
  }
  return out;
};

const findCyclesFrom = (start, adjacency, maxDepth = 5) => {
  const cycles = [];
  const path = [start];
  const pathEdges = [];
  const visited = new Set([start]);

  const dfs = (current, depth) => {
    if (cycles.length >= 5) return; // cap
    if (depth > maxDepth) return;
    const edges = adjacency.get(current) || [];
    for (const edge of edges) {
      const next = edge.to_account_key;
      if (next === start && depth >= 2) {
        // Found a cycle. Validate amounts within 5% of each other.
        const allAmounts = [...pathEdges, edge].map((e) => e.total_amount_minor);
        let amountsAligned = allAmounts.length >= 2;
        for (let i = 1; i < allAmounts.length && amountsAligned; i += 1) {
          if (!within5Pct(allAmounts[0], allAmounts[i])) amountsAligned = false;
        }
        if (amountsAligned) {
          cycles.push({
            path: [...path, next],
            edges: [...pathEdges, edge].map((e) => ({
              from: e.from_account_key,
              to: e.to_account_key,
              amountMinor: e.total_amount_minor,
              currency: e.currency
            }))
          });
        }
        continue;
      }
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      pathEdges.push(edge);
      dfs(next, depth + 1);
      path.pop();
      pathEdges.pop();
      visited.delete(next);
    }
  };
  dfs(start, 0);
  return cycles;
};

export const scanMuleRings = async ({ model, client, windowHours = 24, minInbound = 1 }) => {
  const hotKeys = await model.hotInboundAccounts(client, { windowHours, minInbound });
  const alerts = [];
  for (const startKey of hotKeys) {
    // Pull edges from this start node only; for small graphs this is the
    // simplest correct algorithm. Production would prune more aggressively.
    const allEdges = [];
    const stack = [startKey];
    const seen = new Set();
    while (stack.length > 0 && allEdges.length < 200) {
      const k = stack.shift();
      if (seen.has(k)) continue;
      seen.add(k);
      const out = await model.outgoingFrom(client, k, { sinceHours: windowHours });
      for (const e of out) {
        allEdges.push(e);
        if (!seen.has(e.to_account_key)) stack.push(e.to_account_key);
      }
    }
    const adj = buildAdjacency(allEdges);
    const cycles = findCyclesFrom(startKey, adj);
    for (const cycle of cycles) {
      alerts.push({
        alertType: 'MULE_RING',
        accountKeys: cycle.path,
        evidence: {
          cycleLength: cycle.path.length - 1,
          edges: cycle.edges,
          windowHours
        },
        compositeScore: Math.min(100, 50 + cycle.path.length * 10)
      });
    }
  }
  return alerts;
};

export const scanStructuring = async ({
  model,
  client,
  windowHours = 24,
  cumulativeMinThresholdMinor = '1000000',
  individualMaxThresholdMinor = '500000'
}) => {
  const rows = await model.outboundCumulativeOver(client, {
    windowHours,
    cumulativeMinThresholdMinor,
    individualMaxThresholdMinor
  });
  return rows.map((row) => ({
    alertType: 'STRUCTURING',
    accountKeys: [row.from_key],
    evidence: {
      txCount: row.tx_count,
      sumMinor: row.sum_minor,
      distinctBeneficiaries: row.distinct_bene,
      currency: row.currency,
      windowHours,
      cumulativeMinThresholdMinor,
      individualMaxThresholdMinor
    },
    compositeScore: 80
  }));
};

export const scanCoordinatedBurst = async ({
  model,
  client,
  windowMinutes = 30,
  minSenders = 5
}) => {
  const rows = await model.coordinatedBurst(client, { windowMinutes, minSenders });
  return rows.map((row) => ({
    alertType: 'COORDINATED_BURST',
    accountKeys: [row.to_key],
    evidence: {
      txCount: row.tx_count,
      sumMinor: row.sum_minor,
      distinctSenders: row.distinct_senders,
      currency: row.currency,
      windowMinutes,
      minSenders
    },
    compositeScore: 75
  }));
};
