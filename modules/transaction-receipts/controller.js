import { sendOk } from '../../core/http.js';

export const createReceiptsController = ({ service }) => ({
  byTransaction: async (req, res) => {
    const out = await service.findForTransaction(req.params.txId);
    if (!out.found) {
      sendOk(res, { found: false, receipts: [] }, 404);
      return;
    }
    sendOk(res, { found: true, transaction: out.transaction, receipts: out.receipts });
  },

  verify: async (req, res) => {
    const out = await service.verify(req.body);
    sendOk(res, out);
  },

  listForParticipant: async (req, res) => {
    const { participantCode, limit, offset } = req.query;
    if (!participantCode) {
      sendOk(res, { rows: [], total: 0 });
      return;
    }
    const result = await service.listForParticipant(participantCode, { limit, offset });
    sendOk(res, result);
  }
});
