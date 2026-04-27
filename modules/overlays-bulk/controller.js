import { AppError } from '../../core/errors.js';
import { sendOk } from '../../core/http.js';
import { uploadFieldsSchema } from './schema.js';

const fileFromReq = (req) => {
  const f = req.files?.file;
  if (!f) throw new AppError('VALIDATION_FAILED', 'file upload missing (field "file")', 400);
  return {
    buffer: Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data),
    filename: f.name,
    mimeType: f.mimetype
  };
};

export const createOverlaysBulkController = ({ service }) => ({
  upload: async (req, res) => {
    const { value, error } = uploadFieldsSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });
    if (error) {
      throw new AppError('VALIDATION_FAILED', error.message, 400, { details: error.details });
    }
    const file = fileFromReq(req);
    const userId = req.ctx?.user?.id || null;
    const out = await service.upload({
      originatorParticipant: value.originatorParticipant,
      sourceFormat: value.sourceFormat,
      sourceFilename: file.filename,
      buffer: file.buffer,
      uploadedByUser: userId
    });
    sendOk(res, out, 201);
  },

  list: async (req, res) => {
    const items = await service.listRuns(req.query);
    sendOk(res, { items });
  },

  getRun: async (req, res) => {
    const r = await service.findRunByNumber(req.params.runNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { found: true, run: r });
  },

  listLines: async (req, res) => {
    const r = await service.findRunByNumber(req.params.runNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    const items = await service.listLines(r.id, 1000);
    sendOk(res, { items });
  },

  runBatch: async (req, res) => {
    const r = await service.findRunByNumber(req.params.runNumber);
    if (!r) {
      sendOk(res, { found: false }, 404);
      return;
    }
    const out = await service.runToCompletion({ runId: r.id });
    sendOk(res, out);
  }
});
