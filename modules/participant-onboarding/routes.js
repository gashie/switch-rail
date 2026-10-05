import { Router } from 'express';
import expressFileUpload from 'express-fileupload';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { reviewBodySchema, transitionBodySchema } from './schema.js';
import { createOnboardingModel } from './model.js';
import { createOnboardingService } from './service.js';
import { createOnboardingController } from './controller.js';

const model = createOnboardingModel();
const service = createOnboardingService({ db, model });
const controller = createOnboardingController({ service });

const fileUpload = expressFileUpload({ limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

router.get('/:code', requireAuth, asyncHandler(controller.getStatus));
router.post('/:code/kyb', requireAuth, fileUpload, asyncHandler(controller.uploadKyb));
router.post(
  '/:code/kyb/:docType/review',
  requireAuth,
  validateBody(reviewBodySchema),
  asyncHandler(controller.reviewKyb)
);
router.post(
  '/:code/transition',
  requireAuth,
  validateBody(transitionBodySchema),
  asyncHandler(controller.transition)
);
router.post(
  '/:code/certifications/:suite/run',
  requireAuth,
  asyncHandler(controller.runCert)
);

export { router as default, service };
