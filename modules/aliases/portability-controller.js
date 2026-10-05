import { sendOk } from '../../core/http.js';

export const createPortabilityController = ({ service }) => ({
  initiate: async (req, res) => {
    const result = await service.initiate({
      aliasId: req.params.id,
      toParticipant: req.body.toParticipant,
      toAccountId: req.body.toAccountId,
      initiatedBy: req.ctx.user?.id || null
    });
    sendOk(res, result, 201);
  },

  consent: async (req, res) => {
    const result = await service.consent({
      requestId: req.params.reqId,
      code: req.body.code
    });
    sendOk(res, result);
  },

  getRequest: async (req, res) => {
    const request = await service.getRequest(req.params.reqId);
    sendOk(res, { request });
  }
});
