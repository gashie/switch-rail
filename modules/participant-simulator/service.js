import { createHash } from 'node:crypto';
import { uuidv7 } from '../../core/uuid.js';
import { forceBehaviorFor, responseForBehavior, delaysMs } from './rules.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const intermittentChoosesSuccess = (transactionId) => {
  const h = createHash('sha256').update(String(transactionId)).digest();
  return (h[0] & 1) === 0;
};

export const createSimulatorService = ({ db, model }) => {
  const resolveBehavior = async ({ participantCode, accountNumber }) => {
    const force = forceBehaviorFor(accountNumber);
    if (force) return force;
    const override = await db.withClient((c) =>
      model.findOverride(c, { participantCode, accountNumber })
    );
    if (override) {
      return {
        behavior: override.behavior,
        reasonCode: override.reason_code,
        delayMs: override.delay_ms
      };
    }
    return { behavior: 'SUCCESS' };
  };

  const handleCreditLeg = async ({ participantCode, request }) => {
    const accountNumber = request.beneficiary.accountId;
    const txId = request.transactionId;
    const decision = await resolveBehavior({ participantCode, accountNumber });
    let resolvedBehavior = decision.behavior;
    if (resolvedBehavior === 'INTERMITTENT') {
      resolvedBehavior = intermittentChoosesSuccess(txId) ? 'SUCCESS' : 'TIMEOUT';
    }
    const response = responseForBehavior(
      resolvedBehavior,
      { reasonCode: decision.reasonCode },
      { transactionId: txId }
    );
    if (response.kind === 'http_success_after') {
      await sleep(response.delayMs);
      return { kind: 'http_success', body: response.body, behavior: resolvedBehavior };
    }
    if (response.kind === 'never_respond') {
      // Sleep just past the rail's hard timeout so the rail's AbortController
      // fires before we return. In test mode delaysMs().timeoutHard is 1.5s.
      await sleep(delaysMs().timeoutHard);
      return {
        kind: 'http_success',
        body: {
          ok: true,
          data: {
            responseCode: 'ACSC',
            creditedAt: new Date().toISOString(),
            beneficiaryRef: `SIM-LATE-${(txId || '').slice(0, 8)}`,
            note: 'this response was meant to be lost to timeout'
          }
        },
        behavior: resolvedBehavior
      };
    }
    return { ...response, behavior: resolvedBehavior };
  };

  const handleStatusCheck = async ({ participantCode, request }) => {
    const decision = await resolveBehavior({
      participantCode,
      accountNumber: request.beneficiary?.accountId || request.accountNumber || ''
    });
    let status;
    switch (decision.behavior) {
      case 'SUCCESS':
        status = 'credited';
        break;
      case 'REJECT_AM04':
      case 'REJECT_AC04':
      case 'REJECT_AC06':
      case 'REJECT_AG01':
      case 'REJECT_RR04':
        status = 'not_credited';
        break;
      case 'TIMEOUT':
      case 'SLOW_RESPONSE':
        status = 'pending';
        break;
      case 'INTERMITTENT':
        status = intermittentChoosesSuccess(request.transactionId) ? 'credited' : 'pending';
        break;
      case 'UNREACHABLE':
        status = 'pending';
        break;
      default:
        status = 'credited';
    }
    return {
      ok: true,
      data: {
        found: true,
        status,
        creditedAt: status === 'credited' ? new Date().toISOString() : null
      }
    };
  };

  const handleReversal = async () => ({
    ok: true,
    data: { reversedAt: new Date().toISOString() }
  });

  // Freeze endpoint introduced in B6.7. Reuses the force-account behavior
  // table — 9999000003 returns "account closed", 9999000007 times out, etc.
  // The default is success with a frozenAt timestamp.
  const handleFreeze = async ({ participantCode, request }) => {
    const accountNumber = request.accountId;
    const decision = await resolveBehavior({ participantCode, accountNumber });
    switch (decision.behavior) {
      case 'REJECT_AC04':
        return { kind: 'http_failure', body: { ok: false, error: { code: 'AC04', message: 'Closed Account Number' } } };
      case 'REJECT_AM04':
        return { kind: 'http_failure', body: { ok: false, error: { code: 'AM04', message: 'Insufficient Funds' } } };
      case 'TIMEOUT':
        await sleep(delaysMs().timeoutHard);
        return { kind: 'http_success', body: { ok: true, data: { frozenAt: new Date().toISOString(), note: 'late' } } };
      case 'UNREACHABLE':
        return { kind: 'tcp_error' };
      default:
        return {
          kind: 'http_success',
          body: { ok: true, data: { frozenAt: new Date().toISOString() } }
        };
    }
  };

  return {
    creditLeg: handleCreditLeg,
    statusCheck: handleStatusCheck,
    reversal: handleReversal,
    freeze: handleFreeze,
    upsertOverride: ({ participantCode, accountNumber, behavior, reasonCode, delayMs }) =>
      db.withTransaction((client) =>
        model.upsertOverride(client, {
          id: uuidv7(),
          participantCode,
          accountNumber,
          behavior,
          reasonCode,
          delayMs: delayMs ?? 50
        })
      ),
    listOverrides: (input) => db.withClient((c) => model.listOverrides(c, input))
  };
};
