import { sendOk } from '../../core/http.js';

// closing_journal_seq is BIGINT/BIGSERIAL on the operating_days row, so it
// comes back as BigInt from pg. JSON.stringify can't handle BigInt; coerce
// to string before sending. Applied wherever an operating_day row crosses
// the HTTP boundary.
const sanitizeDay = (day) => {
  if (!day) return day;
  return {
    ...day,
    closing_journal_seq:
      day.closing_journal_seq != null ? String(day.closing_journal_seq) : null
  };
};

export const createEodController = ({ service }) => ({
  listDays: async (_req, res) => {
    const days = await service.listDays();
    sendOk(res, { days: days.map(sanitizeDay) });
  },

  getDay: async (req, res) => {
    let out = await service.getDay(req.params.date);
    if (!out) {
      // Demo convenience: opening today on first read keeps the EOD loop
      // self-bootstrapping without a separate "open day" admin call.
      const today = new Date().toISOString().slice(0, 10);
      if (req.params.date === today) {
        await service.ensureToday();
        out = await service.getDay(req.params.date);
      }
    }
    if (!out) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { ...sanitizeDay(out.day), statements: out.statements });
  },

  cutover: async (req, res) => {
    const result = await service.cutover(req.body);
    sendOk(res, { ...result, day: sanitizeDay(result.day) }, 201);
  },

  listStatements: async (req, res) => {
    const statements = await service.listStatements(req.params.date);
    sendOk(res, statements);
  },

  getStatement: async (req, res) => {
    const stmt = await service.findStatement(
      req.params.date,
      req.params.participantCode,
      req.params.currency
    );
    if (!stmt) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, stmt);
  },

  verify: async (req, res) => {
    const out = await service.verify(req.body);
    sendOk(res, out);
  }
});
