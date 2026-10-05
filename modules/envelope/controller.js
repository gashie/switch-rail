import { sendOk } from '../../core/http.js';

export const createEnvelopeController = ({ service }) => ({
  ingest: async (req, res) => {
    const result = await service.ingest(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },

  getById: async (req, res) => {
    const env = await service.findByEnvelopeId(req.params.envelopeId);
    sendOk(res, { envelope: env });
  },

  list: async (req, res) => {
    const result = await service.list(req.query);
    sendOk(res, result);
  }
});
