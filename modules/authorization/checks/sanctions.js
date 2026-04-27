import { sanctionsService } from '../../sanctions/index.js';

/**
 * Real Phase 6 sanctions screening. Screens the originator AND beneficiary
 * names (and account numbers) against the merged watchlist. STRONG match
 * on a SANCTIONS or BLACKLIST list → BLOCK with `SANCTIONS_HIT`. PEP /
 * GREYLIST hits don't block here — they propagate through the fraud
 * engine's R013 watchlist signal and surface as REVIEW.
 *
 * The check writes a watchlist_screenings row per party so operators have
 * a full audit trail of what was queried and what hit.
 */
export const sanctions = async ({ transaction, envelope, client, skipFraudPersistence }) => {
  if (!transaction) {
    return {
      pass: true,
      framework: { originatorScreened: null, beneficiaryScreened: null, listsConsulted: [] }
    };
  }
  // Names come from the envelope when available (richer), fall back to the
  // participant code on the transaction otherwise.
  const originatorName = envelope?.originator?.name || transaction.originator_participant;
  const beneficiaryName = envelope?.beneficiary?.name || transaction.beneficiary_participant;
  const txId = skipFraudPersistence ? null : transaction.id;

  const [origScreen, beneScreen] = await Promise.all([
    sanctionsService.screen({
      name: originatorName,
      accountNumber: transaction.originator_account,
      ghanacardPin: envelope?.originator?.ghanacardPin,
      party: 'ORIGINATOR',
      transactionId: txId,
      client
    }),
    sanctionsService.screen({
      name: beneficiaryName,
      accountNumber: transaction.beneficiary_account,
      ghanacardPin: envelope?.beneficiary?.ghanacardPin,
      party: 'BENEFICIARY',
      transactionId: txId,
      client
    })
  ]);

  if (origScreen.hit || beneScreen.hit) {
    const hits = [];
    if (origScreen.hit) hits.push({ party: 'ORIGINATOR', matches: origScreen.matches });
    if (beneScreen.hit) hits.push({ party: 'BENEFICIARY', matches: beneScreen.matches });
    return {
      pass: false,
      code: 'SANCTIONS_HIT',
      message: `sanctions/blacklist match on ${hits.map((h) => h.party).join(',')}`,
      hits
    };
  }

  return {
    pass: true,
    framework: {
      originatorScreened: originatorName,
      beneficiaryScreened: beneficiaryName,
      listsConsulted: ['OFAC', 'UN', 'BOG', 'INTERNAL'],
      watchlistHit: origScreen.watchlistHit || beneScreen.watchlistHit
    }
  };
};
