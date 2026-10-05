import { AppError } from '../../core/errors.js';
import { sendOk } from '../../core/http.js';

const fileBuffer = (req) => {
  const f = req.files?.file;
  if (!f) throw new AppError('VALIDATION_FAILED', 'file upload missing (field "file")', 400);
  return Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
};

export const createBulkController = ({ service }) => ({
  csv: async (req, res) => {
    const result = await service.ingestCsv(fileBuffer(req), {
      originatorParticipant: req.body?.originatorParticipant
    });
    sendOk(res, result, 201);
  },
  xlsx: async (req, res) => {
    const result = await service.ingestXlsx(fileBuffer(req), {
      originatorParticipant: req.body?.originatorParticipant
    });
    sendOk(res, result, 201);
  },
  pain001: async (req, res) => {
    const buf = fileBuffer(req);
    const result = await service.ingestPain001(buf, {
      originatorParticipant: req.body?.originatorParticipant
    });
    sendOk(res, result, 201);
  },
  getBatch: async (req, res) => {
    const batch = await service.getBatch(req.params.batchId);
    sendOk(res, { batch });
  }
});
