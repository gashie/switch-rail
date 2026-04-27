import { sendOk } from '../../core/http.js';

export const createLiquidityController = ({ service }) => ({
  listLimits: async (req, res) => {
    const limits = await service.listLimits({ currency: req.query.currency });
    sendOk(res, { limits });
  },

  putLimits: async (req, res) => {
    const row = await service.configureLimits({
      participantCode: req.params.participantCode,
      currency: req.params.currency,
      ...req.body
    });
    sendOk(res, { limits: row }, 201);
  },

  topup: async (req, res) => {
    const result = await service.applyTopUp({
      ...req.body,
      appliedBy: req.ctx?.user?.id || null
    });
    sendOk(res, result, 201);
  },

  listTopups: async (req, res) => {
    const topups = await service.listTopups(req.query);
    sendOk(res, { topups });
  }
});
