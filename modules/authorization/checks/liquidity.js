import { liquidityService } from '../../liquidity/index.js';

/**
 * Liquidity check — real Phase 5 implementation.
 *
 * Calls liquidityService.canDebit with the originator's projected debit
 * (transaction amount). Returns:
 *   - pass when no limits configured (opt-in per participant) or projected
 *     position is below the throttle threshold
 *   - fail with AG01 (TRANSACTION_FORBIDDEN) when over-ceiling or
 *     probabilistically throttled
 */
export const liquidity = async ({ transaction }) => {
  const result = await liquidityService.canDebit({
    participantCode: transaction.originator_participant,
    currency: transaction.amount_currency,
    amountMinor: String(transaction.amount_value)
  });
  if (result.ok) {
    return { pass: true, projectedMinor: result.projectedMinor || null };
  }
  return {
    pass: false,
    code: 'TRANSACTION_FORBIDDEN',
    message:
      result.reason === 'INSUFFICIENT_LIQUIDITY'
        ? `originator at or above ceiling (${result.ceilingMinor})`
        : `originator throttled at ${result.projectedMinor}/${result.ceilingMinor}`
  };
};
