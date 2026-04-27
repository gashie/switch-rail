import { AppError } from '../../core/errors.js';
import {
  jaroWinkler,
  maskName,
  normalizeAndSortTokens,
  tokensSubset
} from '../../core/strings.js';
import { auditService } from '../audit/index.js';

// CoP score thresholds — single source of truth, exported so demo scripts and
// Phase 4 (which gates payments on CoP) reference the same numbers.
export const COP_THRESHOLDS = Object.freeze({
  closeMatch: 0.92,
  partialMatch: 0.75
});

const scoreFor = (similarity, canonical, supplied) => {
  if (similarity >= COP_THRESHOLDS.closeMatch) return 'close-match';
  if (similarity >= COP_THRESHOLDS.partialMatch) return 'partial-match';
  if (tokensSubset(canonical, supplied)) return 'partial-match';
  return 'no-match';
};

export const createCopService = ({ db, nameEnquiryService }) => ({
  cop: async ({ input, suppliedName }) => {
    if (typeof suppliedName !== 'string' || suppliedName.trim() === '') {
      throw new AppError('VALIDATION_FAILED', 'suppliedName is required', 400);
    }
    const account = await nameEnquiryService.resolveAccount({ input });
    if (!account) {
      return { found: false };
    }
    const canonical = account.account_name_normalized;
    const canonicalSorted = normalizeAndSortTokens(canonical);
    const suppliedSorted = normalizeAndSortTokens(suppliedName);

    let score;
    let similarity;
    if (canonicalSorted === suppliedSorted) {
      score = 'match';
      similarity = 1;
    } else {
      similarity = jaroWinkler(canonicalSorted, suppliedSorted);
      score = scoreFor(similarity, canonical, suppliedName);
    }

    const result = {
      found: true,
      score,
      similarity: Number(similarity.toFixed(4)),
      maskedName: maskName(canonical),
      participantCode: account.participant_code,
      accountNumber: account.account_number,
      accountType: account.account_type
    };
    if (score === 'close-match' || score === 'partial-match') {
      result.canonicalName = canonical;
    }

    await db.withTransaction((client) =>
      auditService.record(client, {
        actorType: 'system',
        eventType: 'cop.executed',
        resourceType: 'account',
        resourceId: account.id,
        payload: {
          score,
          similarity: result.similarity,
          participantCode: account.participant_code
        }
      })
    );

    return result;
  }
});
