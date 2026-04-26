import { sendOk } from '../../core/http.js';

export const createIso8583Controller = ({ service }) => ({
  inbound: async (req, res) => {
    const version = req.query.version || '1987';
    const result = await service.inbound(req.body, version);
    sendOk(res, result, result.deduped ? 200 : 201);
  },
  outbound: async (req, res) => {
    const version = req.query.version || '1987';
    const mti = req.query.mti;
    const buf = service.outbound({ envelope: req.body, version, mti });
    sendOk(res, { version, mti: mti || null, base64: buf.toString('base64') });
  }
});
