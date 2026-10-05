import { sendOk } from '../../core/http.js';

export const createTransactionsController = ({ service, orchestrator }) => ({
  ingest: async (req, res) => {
    const tx = await service.ingestFromEnvelope(req.body.envelope);
    sendOk(res, { transaction: tx });
  },

  process: async (req, res) => {
    const result = await orchestrator.process(req.body.envelope);
    sendOk(res, {
      transaction: result.transaction,
      deduped: !!result.deduped,
      state: result.transaction.state,
      reasonCode: result.transaction.reason_code,
      transactionId: result.transaction.id
    });
  },

  getById: async (req, res) => {
    const tx = await service.findById(req.params.id);
    if (!tx) {
      sendOk(res, { found: false }, 404);
      return;
    }
    const history = await service.listHistory(req.params.id);
    sendOk(res, { found: true, transaction: tx, history });
  },

  getHistory: async (req, res) => {
    const history = await service.listHistory(req.params.id);
    sendOk(res, { history });
  },

  list: async (req, res) => {
    const { participantCode, state, limit, offset } = req.query;
    if (!participantCode) {
      sendOk(res, { rows: [], total: 0 });
      return;
    }
    const result = await service.listForParticipant(participantCode, {
      state,
      limit,
      offset
    });
    sendOk(res, result);
  },

  kill: async (req, res) => {
    const tx = await service.operatorKillSwitch({
      id: req.params.id,
      reason: req.body?.reason,
      operatorId: req.ctx.user?.id || null
    });
    sendOk(res, { transaction: tx });
  }
});
