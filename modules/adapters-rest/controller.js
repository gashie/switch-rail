import { sendOk } from '../../core/http.js';

export const createRestController = ({ service }) => ({
  inbound: async (req, res) => {
    const result = await service.inbound(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },

  outbound: async (req, res) => {
    const signed = await service.outbound(req.body);
    sendOk(res, { envelope: signed });
  }
});
