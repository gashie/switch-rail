import { sendOk } from '../../core/http.js';

export const createAliasesController = ({ service }) => ({
  register: async (req, res) => {
    const result = await service.register(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },

  resolve: async (req, res) => {
    const alias = await service.resolve(req.query);
    if (!alias) {
      sendOk(res, { found: false });
      return;
    }
    sendOk(res, { found: true, alias });
  },

  listByAccount: async (req, res) => {
    const aliases = await service.listByAccount(req.params.accountId);
    sendOk(res, { aliases });
  },

  revoke: async (req, res) => {
    const result = await service.revoke(req.params.id);
    sendOk(res, result);
  }
});
