import { sendOk } from '../../core/http.js';

export const createCreditLegController = ({ service }) => ({
  runById: async (req, res) => {
    const result = await service.runById(req.params.transactionId);
    sendOk(res, { result });
  }
});
