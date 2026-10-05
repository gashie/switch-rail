import { sendOk, sendText } from '../../core/http.js';

export const createUssdGatewayController = ({ service }) => ({
  callback: async (req, res) => {
    const text = await service.handleCallback(req.body);
    sendText(res, text);
  },

  listSessions: async (req, res) => {
    const rows = await service.listSessions(req.query);
    sendOk(res, { rows, total: rows.length });
  }
});
