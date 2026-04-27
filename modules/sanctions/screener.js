// Pure screening algorithm. Trigram-indexed fuzzy match against the
// watchlist_entries table, confirmed in-process with Jaro-Winkler.
//
// The screener is the only piece that needs to know the matching math; the
// rest of the module is plumbing around it. Performance budget: 15ms p95
// for the sanctions check (cache-warm path tighter; cold-path bounded by
// the trigram index returning at most 10 candidates).

import { normalizeForCompare, jaroWinkler } from '../../core/strings.js';
import { uuidv7 } from '../../core/uuid.js';

const STRONG_MATCH_THRESHOLD = 0.92;
const WEAK_MATCH_THRESHOLD = 0.80;

// Tiny LRU cache for high-frequency name screening. 60-second TTL so a
// new sanctions list addition surfaces within the cache window.
const CACHE_SIZE = 10_000;
const CACHE_TTL_MS = 60_000;

const createCache = () => {
  const m = new Map();
  return {
    get(key) {
      const entry = m.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        m.delete(key);
        return null;
      }
      // Re-insert to mark as recently used.
      m.delete(key);
      m.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      if (m.has(key)) m.delete(key);
      m.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      while (m.size > CACHE_SIZE) {
        const oldest = m.keys().next().value;
        m.delete(oldest);
      }
    },
    clear() { m.clear(); }
  };
};

export const createScreener = ({ model, cache = createCache() }) => {
  const screen = async ({ name, accountNumber, ghanacardPin, party = 'BENEFICIARY', client, transactionId }) => {
    const t0 = Date.now();
    if (!name && !accountNumber && !ghanacardPin) {
      return { hit: false, matches: [], durationMs: 0 };
    }
    const normalized = name ? normalizeForCompare(name) : '';
    const cacheKey = `${normalized}|${accountNumber || ''}|${ghanacardPin || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, durationMs: Date.now() - t0, cacheHit: true };
    }

    const matches = [];

    if (!client) throw new Error('screener.screen requires a DB client');

    // 1. Direct-key checks first (cheapest).
    if (ghanacardPin) {
      const rows = await model.findByGhanacardPin(client, ghanacardPin);
      for (const row of rows) {
        matches.push({
          entryId: row.id,
          source: row.source,
          listType: row.list_type,
          similarity: 1.0,
          matchType: 'GHANACARD_MATCH',
          primaryName: row.primary_name
        });
      }
    }
    if (accountNumber) {
      const rows = await model.findByAccountNumber(client, accountNumber);
      for (const row of rows) {
        matches.push({
          entryId: row.id,
          source: row.source,
          listType: row.list_type,
          similarity: 1.0,
          matchType: 'ACCOUNT_MATCH',
          primaryName: row.primary_name
        });
      }
    }

    // 2. Trigram-indexed fuzzy match on the normalized name. Capped to top
    //    10 candidates by the SQL ORDER BY sim DESC LIMIT 10.
    if (normalized) {
      const candidates = await model.findFuzzyCandidates(client, normalized);
      for (const cand of candidates) {
        // Confirm with Jaro-Winkler on primary_name_norm and each alias.
        const candidatesToCheck = [cand.primary_name_norm, ...(cand.alias_norms || [])];
        let bestSim = 0;
        for (const c of candidatesToCheck) {
          const sim = jaroWinkler(normalized, c);
          if (sim > bestSim) bestSim = sim;
        }
        if (bestSim >= WEAK_MATCH_THRESHOLD) {
          matches.push({
            entryId: cand.id,
            source: cand.source,
            listType: cand.list_type,
            similarity: Math.round(bestSim * 1000) / 1000,
            matchType: bestSim >= STRONG_MATCH_THRESHOLD ? 'STRONG_MATCH' : 'WEAK_MATCH',
            primaryName: cand.primary_name
          });
        }
      }
    }

    // De-dup by entryId; keep the highest similarity.
    const byEntry = new Map();
    for (const m of matches) {
      const prev = byEntry.get(m.entryId);
      if (!prev || prev.similarity < m.similarity) byEntry.set(m.entryId, m);
    }
    const final = [...byEntry.values()];

    // hit = STRONG_MATCH on SANCTIONS or BLACKLIST. PEP/GREYLIST → no hit
    // (those go to REVIEW, not BLOCK; the fraud engine handles that via
    // R013 watchlist signal).
    const hit = final.some(
      (m) =>
        (m.matchType === 'STRONG_MATCH' ||
          m.matchType === 'GHANACARD_MATCH' ||
          m.matchType === 'ACCOUNT_MATCH') &&
        (m.listType === 'SANCTIONS' || m.listType === 'BLACKLIST')
    );

    const watchlistHit = final.some(
      (m) =>
        (m.matchType === 'STRONG_MATCH' ||
          m.matchType === 'GHANACARD_MATCH' ||
          m.matchType === 'ACCOUNT_MATCH') &&
        (m.listType === 'PEP' || m.listType === 'GREYLIST')
    );

    const result = { hit, matches: final, watchlistHit, party };
    cache.set(cacheKey, result);

    // Persist the screening row if a transactionId was provided.
    if (transactionId && client) {
      await model.insertScreening(client, {
        id: uuidv7(),
        transactionId,
        party,
        queryName: name || '',
        queryAccount: accountNumber || null,
        hit,
        matches: final
      });
    }

    return { ...result, durationMs: Date.now() - t0, cacheHit: false };
  };

  return { screen, _cache: cache };
};

export const SCREENER_THRESHOLDS = Object.freeze({
  STRONG_MATCH_THRESHOLD,
  WEAK_MATCH_THRESHOLD
});
