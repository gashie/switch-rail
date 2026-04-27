import { sendOk } from '../../core/http.js';

export const createSettlementController = ({ service }) => ({
  list: async (req, res) => {
    const positions = await service.listPositions({ currency: req.query.currency });
    sendOk(res, { positions });
  },

  forParticipant: async (req, res) => {
    const positions = await service.listForParticipant(req.params.participantCode);
    sendOk(res, positions);
  },

  recompute: async (req, res) => {
    const result = await service.recomputeAll(req.body || {});
    sendOk(res, result, 201);
  }
});
