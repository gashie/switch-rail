import { sendOk } from '../../core/http.js';

export const createLedgerController = ({ service }) => ({
  listAccounts: async (req, res) => {
    const accounts = await service.listAccounts(req.query);
    sendOk(res, { accounts });
  },

  ensureAccount: async (req, res) => {
    const account = await service.ensureAccount(req.body);
    sendOk(res, { account }, 201);
  },

  balanceFor: async (req, res) => {
    const balance = await service.balanceFor(req.params.code);
    sendOk(res, { accountCode: req.params.code, balanceMinor: balance.toString() });
  },

  getJournal: async (req, res) => {
    const out = await service.journalById(req.params.id);
    if (!out) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, journal: out.journal, postings: out.postings });
  },

  postJournal: async (req, res) => {
    const result = await service.postJournal(req.body);
    sendOk(res, result, 201);
  },

  verifyDay: async (req, res) => {
    const result = await service.verifyDayChain(req.params.date);
    sendOk(res, result);
  }
});
