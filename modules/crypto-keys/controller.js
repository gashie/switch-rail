import { sendOk } from '../../core/http.js';

export const createCryptoKeysController = ({ service }) => ({
  listRailActive: async (_req, res) => {
    const keys = await service.listActive({ ownerType: 'rail', ownerId: null });
    sendOk(res, { keys });
  },

  list: async (req, res) => {
    const { ownerType, ownerId } = req.query;
    const keys = await service.listActive({ ownerType, ownerId });
    sendOk(res, { keys });
  },

  generate: async (req, res) => {
    const result = await service.generateForOwner(req.body);
    sendOk(res, result, 201);
  },

  rotate: async (req, res) => {
    const result = await service.rotate(req.body);
    sendOk(res, result);
  },

  revoke: async (req, res) => {
    const result = await service.revoke({ kid: req.params.kid });
    sendOk(res, result);
  }
});
