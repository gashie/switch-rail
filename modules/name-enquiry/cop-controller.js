import { sendOk } from '../../core/http.js';

export const createCopController = ({ service }) => ({
  cop: async (req, res) => {
    const result = await service.cop(req.body);
    sendOk(res, result);
  }
});
