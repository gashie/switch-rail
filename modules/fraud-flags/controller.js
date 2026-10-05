import { sendOk } from '../../core/http.js';

export const createFlagsController = ({ service }) => ({
  flag: async (req, res) => {
    const flag = await service.flag(req.body);
    sendOk(res, { flag }, 201);
  },

  withdraw: async (req, res) => {
    const flag = await service.withdraw({
      id: req.params.id,
      withdrawnBy: req.body.withdrawnBy
    });
    if (!flag) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { flag });
  },

  listActive: async (req, res) => {
    const flags = await service.listActive(req.query);
    sendOk(res, { flags });
  }
});
