import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { createUssdGatewayModel } from './model.js';
import { createUssdGatewayService } from './service.js';
import { createUssdGatewayController } from './controller.js';
import { ussdCallbackSchema, listSessionsSchema } from './schema.js';

const model = createUssdGatewayModel();
const service = createUssdGatewayService({ db, model });
const controller = createUssdGatewayController({ service });

const router = Router();

// Public callback for the telco aggregator. No auth — payload is signed at
// the network edge by the carrier; replay protection lives in the
// aggregator's idempotent sessionId.
router.post('/callback', validateBody(ussdCallbackSchema), asyncHandler(controller.callback));

// Operator read for audit + replay.
router.get('/sessions', requireAuth, validateQuery(listSessionsSchema), asyncHandler(controller.listSessions));

export { router as default, service };
