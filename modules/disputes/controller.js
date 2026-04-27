import { sendOk } from '../../core/http.js';

export const createDisputesController = ({ service }) => ({
  file: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const result = await service.file({
      ...req.body,
      filedByUser: operatorId
    });
    sendOk(res, { case: result }, 201);
  },

  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  },

  getByCaseNumber: async (req, res) => {
    const item = await service.findByCaseNumber(req.params.caseNumber);
    if (!item) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, case: item });
  },

  listForTransaction: async (req, res) => {
    const items = await service.listForTransaction(req.params.txId);
    sendOk(res, { items });
  },

  history: async (req, res) => {
    const c = await service.findByCaseNumber(req.params.caseNumber);
    if (!c) {
      sendOk(res, { found: false }, 404);
      return;
    }
    const items = await service.listHistory(c.id);
    sendOk(res, { items });
  },

  kill: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const result = await service.operatorKill({
      id: req.params.id,
      reason: req.body.reason,
      killedByUser: operatorId
    });
    sendOk(res, { case: result });
  }
});
