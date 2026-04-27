import { sendOk } from '../../core/http.js';

export const createFeesController = ({ service }) => ({
  list: async (req, res) => {
    const schedules = await service.listSchedules(req.query);
    sendOk(res, { schedules });
  },

  publish: async (req, res) => {
    const operatorId = req.ctx?.user?.id || null;
    const row = await service.publishSchedule({
      ...req.body,
      createdBy: operatorId
    });
    sendOk(res, { schedule: row }, 201);
  },

  getByCode: async (req, res) => {
    const row = await service.findByCode(req.params.code);
    if (!row) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, schedule: row });
  },

  calculate: async (req, res) => {
    const result = await service.calculateFee(req.body);
    sendOk(res, result);
  },

  summary: async (req, res) => {
    const rows = await service.summary({
      participantCode: req.query.participantCode,
      since: req.query.since,
      until: req.query.until
    });
    sendOk(res, { rows });
  }
});
