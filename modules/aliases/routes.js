import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { registerSchema, resolveQuerySchema } from './schema.js';
import { createAliasesModel } from './model.js';
import { createAliasesService } from './service.js';
import { createAliasesController } from './controller.js';
import { buildVerificationRouter } from './verification-routes.js';

const model = createAliasesModel();
const service = createAliasesService({ db, model });
const controller = createAliasesController({ service });
const { router: verifyRouter, service: verificationService } = buildVerificationRouter({
  aliasesService: service
});

const router = Router();

router.post('/', requireAuth, validateBody(registerSchema), asyncHandler(controller.register));
router.get('/resolve', requireAuth, validateQuery(resolveQuerySchema), asyncHandler(controller.resolve));
router.get('/by-account/:accountId', requireAuth, asyncHandler(controller.listByAccount));
router.post('/:id/revoke', requireAuth, asyncHandler(controller.revoke));
router.use('/verify', verifyRouter);

export { router as default, service, verificationService, model };
