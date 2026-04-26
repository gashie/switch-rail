import { sendOk } from '../../core/http.js';

export const createIso20022Controller = ({ service }) => ({
  inboundPacs008: async (req, res) => {
    const result = await service.inboundPacs008(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },
  inboundPacs002: async (req, res) => {
    const result = await service.inboundPacs002(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },
  inboundPacs004: async (req, res) => {
    const result = await service.inboundPacs004(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },
  inboundPacs007: async (req, res) => {
    const result = await service.inboundPacs007(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },
  inboundCamt056: async (req, res) => {
    const result = await service.inboundCamt056(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },
  outbound: async (req, res) => {
    const xml = await service.outbound({ type: req.params.type, envelope: req.body });
    sendOk(res, { type: req.params.type, xml });
  }
});
