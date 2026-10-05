import { sendOk } from '../../core/http.js';

export const createReversalsController = ({ service }) => ({
  initiate: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const result = await service.initiate({
      originalTxId: req.body.originalTxId,
      reasonCode: req.body.reasonCode,
      reasonMessage: req.body.reasonMessage,
      initiatedBy: operatorId ? `operator:${operatorId}` : 'system'
    });
    sendOk(
      res,
      {
        reversal: result.reversal,
        original: result.originalUpdated,
        category: result.category
      },
      201
    );
  },

  getById: async (req, res) => {
    const reversal = await service.findById(req.params.id);
    if (!reversal) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, reversal });
  },

  listForOriginal: async (req, res) => {
    const reversals = await service.listForOriginal(req.params.originalTxId);
    sendOk(res, { reversals });
  }
});
