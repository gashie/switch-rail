import { sendOk } from '../../core/http.js';

export const createDirectoryController = ({ service }) => ({
  register: async (req, res) => {
    const result = await service.register(req.body);
    sendOk(res, result, result.deduped ? 200 : 201);
  },

  list: async (req, res) => {
    const result = await service.list(req.query);
    sendOk(res, result);
  },

  search: async (req, res) => {
    const accounts = await service.searchByName(req.query);
    sendOk(res, { accounts });
  },

  getByAccount: async (req, res) => {
    const account = await service.findByAccount({
      participantCode: req.params.participantCode,
      accountNumber: req.params.accountNumber
    });
    sendOk(res, { account });
  },

  freeze: async (req, res) => {
    const result = await service.freeze({
      participantCode: req.params.participantCode,
      accountNumber: req.params.accountNumber
    });
    sendOk(res, result);
  },

  unfreeze: async (req, res) => {
    const result = await service.unfreeze({
      participantCode: req.params.participantCode,
      accountNumber: req.params.accountNumber
    });
    sendOk(res, result);
  },

  close: async (req, res) => {
    const result = await service.close({
      participantCode: req.params.participantCode,
      accountNumber: req.params.accountNumber
    });
    sendOk(res, result);
  }
});
