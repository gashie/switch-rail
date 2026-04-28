import { sendOk } from '../../core/http.js';

export const createSettlementAssetsController = ({ service }) => ({
  settle: async (req, res) => {
    const r = await service.settle(req.body);
    sendOk(res, r, 201);
  },
  adapters: async (_req, res) => {
    const items = service.adapters();
    sendOk(res, { items });
  }
});
