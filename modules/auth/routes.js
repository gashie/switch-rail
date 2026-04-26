import { Router } from 'express';
import { asyncHandler, validateBody } from '../../core/http.js';
import * as db from '../../core/db.js';
import { createAuthModel } from './model.js';
import { createAuthService } from './service.js';
import { createAuthController } from './controller.js';
import { createRequireAuth } from './middleware.js';
import { loginSchema, passwordChangeSchema } from './schema.js';

const model = createAuthModel();
const service = createAuthService({ db, model });
const controller = createAuthController({ service });
const requireAuth = createRequireAuth({ service });

const router = Router();

router.post('/login', validateBody(loginSchema), asyncHandler(controller.login));
router.post('/logout', asyncHandler(controller.logout));
router.get('/me', requireAuth, asyncHandler(controller.me));
router.post('/password', requireAuth, validateBody(passwordChangeSchema), asyncHandler(controller.changePassword));

export { router as default, service, requireAuth };
