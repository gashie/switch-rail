import { sendOk } from '../../core/http.js';

export const createVerificationController = ({ service }) => ({
  startOtp: async (req, res) => {
    const result = await service.startOtp(req.body);
    sendOk(res, result, 201);
  },
  consumeOtp: async (req, res) => {
    const result = await service.consumeOtp(req.body);
    sendOk(res, result);
  },
  startEmail: async (req, res) => {
    const result = await service.startEmailLink(req.body);
    sendOk(res, result, 201);
  },
  consumeEmail: async (req, res) => {
    const result = await service.consumeEmailLink(req.body);
    sendOk(res, result);
  },
  verifyGhanacard: async (req, res) => {
    const result = await service.verifyGhanacard(req.body);
    sendOk(res, result);
  }
});
