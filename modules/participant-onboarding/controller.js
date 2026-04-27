import { AppError } from '../../core/errors.js';
import { sendOk } from '../../core/http.js';
import { KYB_DOC_TYPES } from './schema.js';

const fileBufferAndName = (req) => {
  const f = req.files?.file;
  if (!f) throw new AppError('VALIDATION_FAILED', 'file upload missing (field "file")', 400);
  return {
    fileBuffer: Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data),
    fileName: f.name
  };
};

export const createOnboardingController = ({ service }) => ({
  uploadKyb: async (req, res) => {
    const docType = req.body?.docType;
    if (!KYB_DOC_TYPES.includes(docType)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `docType must be one of: ${KYB_DOC_TYPES.join(', ')}`,
        400
      );
    }
    const { fileBuffer, fileName } = fileBufferAndName(req);
    const result = await service.uploadKyb({
      code: req.params.code,
      docType,
      fileBuffer,
      fileName,
      uploadedBy: req.ctx.user?.id || null
    });
    sendOk(res, result, 201);
  },

  reviewKyb: async (req, res) => {
    const { docType } = req.params;
    if (!KYB_DOC_TYPES.includes(docType)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `docType must be one of: ${KYB_DOC_TYPES.join(', ')}`,
        400
      );
    }
    const result = await service.reviewKyb({
      code: req.params.code,
      docType,
      status: req.body.status,
      note: req.body.note,
      reviewedBy: req.ctx.user?.id || null
    });
    sendOk(res, result);
  },

  runCert: async (req, res) => {
    const result = await service.runCertSuite({
      code: req.params.code,
      suite: req.params.suite
    });
    sendOk(res, result);
  },

  transition: async (req, res) => {
    const result = await service.transition({
      code: req.params.code,
      to: req.body.to,
      reason: req.body.reason,
      actorId: req.ctx.user?.id || null
    });
    sendOk(res, result);
  },

  getStatus: async (req, res) => {
    const result = await service.getStatus({ code: req.params.code });
    sendOk(res, result);
  }
});
