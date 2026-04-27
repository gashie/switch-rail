import { sendOk } from '../../core/http.js';

export const createFTRController = ({ service }) => ({
  invoke: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const result = await service.invoke({
      ...req.body,
      invokedBy: operatorId
    });
    sendOk(res, result, 201);
  },

  confirmReversal: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const result = await service.confirmReversal({
      id: req.params.id,
      confirmedBy: operatorId
    });
    sendOk(res, result);
  },

  getById: async (req, res) => {
    const ftr = await service.findById(req.params.id);
    if (!ftr) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, ftr });
  },

  list: async (req, res) => {
    const items = await service.list(req.query);
    sendOk(res, { items });
  }
});
