import { uuidv7 } from '../../core/uuid.js';

export const createSignalsService = ({ db, model }) => {
  const recordOnClient = async (client, input) =>
    model.insert(client, {
      id: uuidv7(),
      transactionId: input.transactionId,
      source: input.source || 'rules',
      compositeVerdict: input.compositeVerdict,
      compositeScore: input.compositeScore,
      ruleHits: input.ruleHits || [],
      mlScore: input.mlScore != null ? Number(input.mlScore) : null,
      mlFeatures: input.mlFeatures || null,
      evaluatedBy: input.evaluatedBy || 'in-line'
    });

  const record = (clientOrInput, maybeInput) => {
    if (clientOrInput && typeof clientOrInput.query === 'function') {
      return recordOnClient(clientOrInput, maybeInput);
    }
    return db.withTransaction((c) => recordOnClient(c, clientOrInput));
  };

  const listByTransaction = (transactionId) =>
    db.withClient((c) => model.listByTransaction(c, transactionId));

  return { record, listByTransaction };
};
