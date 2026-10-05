import { AppError } from '../../core/errors.js';
import { sendOk } from '../../core/http.js';

const clientIp = (req) =>
  // Express's req.ip respects trust-proxy. Fall back to the raw socket peer.
  req.ip || req.socket?.remoteAddress || null;

export const createCustomerPortalController = ({ portalService }) => ({
  lookup: async (req, res) => {
    const { fingerprint } = req.query;
    const result = await portalService.lookup({
      caseNumber: req.params.caseNumber,
      fingerprint,
      ip: clientIp(req)
    });
    if (!result.found) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, result);
  },

  comment: async (req, res) => {
    const { fingerprint, comment } = req.body;
    if (!comment) {
      throw new AppError('VALIDATION_FAILED', 'comment body missing', 400);
    }
    const result = await portalService.comment({
      caseNumber: req.params.caseNumber,
      fingerprint,
      ip: clientIp(req),
      body: comment
    });
    sendOk(res, result, 201);
  }
});
