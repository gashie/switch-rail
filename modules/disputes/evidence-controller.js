import { AppError } from '../../core/errors.js';
import { sendOk } from '../../core/http.js';
import { evidenceUploadFieldsSchema } from './schema.js';

const fileFromReq = (req) => {
  const f = req.files?.file;
  if (!f) throw new AppError('VALIDATION_FAILED', 'evidence file missing (field "file")', 400);
  return {
    buffer: Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data),
    filename: f.name,
    size: f.size,
    mimeType: f.mimetype
  };
};

export const createEvidenceController = ({ evidenceService }) => ({
  upload: async (req, res) => {
    // express-fileupload puts text fields on req.body. Validate them via the
    // shared Joi schema (controller doesn't import Joi — schema does).
    const { value, error } = evidenceUploadFieldsSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });
    if (error) {
      throw new AppError('VALIDATION_FAILED', error.message, 400, { details: error.details });
    }
    const f = fileFromReq(req);
    f.evidenceType = value.evidenceType;
    const operatorId = req.ctx?.user?.id || null;
    const inserted = await evidenceService.upload({
      caseNumber: req.params.caseNumber,
      side: value.side,
      uploadedByParticipant: value.uploadedByParticipant,
      uploadedByUser: operatorId,
      file: f,
      description: value.description
    });
    sendOk(res, { evidence: inserted }, 201);
  },

  list: async (req, res) => {
    const out = await evidenceService.listForCase({
      caseNumber: req.params.caseNumber,
      side: req.query.side
    });
    if (!out) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, { items: out.items });
  },

  verifyChain: async (req, res) => {
    const out = await evidenceService.verifyChain(req.params.caseNumber);
    sendOk(res, out);
  },

  signaturePayload: async (req, res) => {
    const out = await evidenceService.signaturePayloadFor(req.params.id);
    if (!out) {
      sendOk(res, { found: false }, 404);
      return;
    }
    sendOk(res, out);
  },

  expireWindow: async (req, res) => {
    const out = await evidenceService.expireWindowAndAdvance(req.params.id);
    sendOk(res, out);
  }
});
