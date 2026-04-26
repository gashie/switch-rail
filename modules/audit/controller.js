import { sendOk } from '../../core/http.js';

export const createAuditController = ({ service }) => ({
  list: async (req, res) => {
    const result = await service.list(req.query);
    sendOk(res, result);
  },

  verifyDay: async (req, res) => {
    const result = await service.verifyDay(req.query.day);
    sendOk(res, result);
  }
});
