import { sendOk } from '../../core/http.js';

export const createParticipantsController = ({ service }) => ({
  create: async (req, res) => {
    const result = await service.create(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },

  list: async (req, res) => {
    const result = await service.list(req.query);
    sendOk(res, result);
  },

  getByCode: async (req, res) => {
    const participant = await service.getByCode(req.params.code);
    sendOk(res, { participant });
  },

  update: async (req, res) => {
    const result = await service.update(req.params.code, req.body);
    sendOk(res, result);
  },

  listKeys: async (req, res) => {
    const keys = await service.listKeysFor(req.params.code);
    sendOk(res, { keys });
  }
});
