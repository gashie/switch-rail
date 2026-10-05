import { sendOk } from '../../core/http.js';

export const createNameEnquiryController = ({ service }) => ({
  resolve: async (req, res) => {
    const result = await service.resolve(req.body);
    sendOk(res, result);
  }
});
