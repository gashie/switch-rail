import { uuidv7 } from '../../core/uuid.js';

// Locked menu tree. New entries require a new release of this module —
// the callback's "text" cumulative input is split on '*' and walked
// through this tree.
const ROOT_MENU =
  'CON Welcome to Sika\n' +
  '1. Send money\n' +
  '2. Check balance\n' +
  '3. Verify receipt\n' +
  '4. Open a dispute';

const END_GENERIC = 'END Thanks. We logged your selection.';

const respondTo = (steps) => {
  if (steps.length === 0 || steps[0] === '') {
    return { step: 'root', response: ROOT_MENU, outcome: 'PROMPTED' };
  }
  const [first] = steps;
  switch (first) {
    case '1':
      return { step: 'send_money/picker',
               response: 'CON Send money — enter beneficiary alias',
               outcome: 'PROMPTED' };
    case '2':
      return { step: 'check_balance',
               response: 'END Balance lookup queued. You will receive an SMS shortly.',
               outcome: 'COMPLETED' };
    case '3':
      return { step: 'verify_receipt/prompt',
               response: 'CON Enter the transaction id to verify',
               outcome: 'PROMPTED' };
    case '4':
      return { step: 'open_dispute/prompt',
               response: 'CON Enter the transaction id to dispute',
               outcome: 'PROMPTED' };
    default:
      return { step: 'invalid', response: END_GENERIC, outcome: 'INVALID' };
  }
};

export const createUssdGatewayService = ({ db, model }) => ({
  handleCallback: async ({ sessionId, msisdn, serviceCode, text }) => {
    const steps = (text || '').split('*');
    const { step, response, outcome } = respondTo(steps);
    await db.withTransaction((c) =>
      model.insertSession(c, {
        id: uuidv7(),
        msisdn,
        shortCode: serviceCode,
        step,
        inputText: text || null,
        responseText: response,
        outcome,
        metadata: { sessionId }
      })
    );
    // Telco aggregators expect a plain-text response, not JSON.
    return response;
  },

  listSessions: ({ msisdn, limit }) =>
    db.withClient((c) => model.listSessions(c, { msisdn, limit }))
});
