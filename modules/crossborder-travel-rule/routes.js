import { Router } from 'express';
import { asyncHandler, validateBody, validateQuery } from '../../core/http.js';
import * as db from '../../core/db.js';
import { requireAuth } from '../auth/index.js';
import { enforceBodySchema, listQuerySchema } from './schema.js';
import { createTravelRuleModel } from './model.js';
import { createTravelRuleService } from './service.js';
import { createTravelRuleController } from './controller.js';
import { setTravelRuleService } from '../crossborder-tx/index.js';

const model = createTravelRuleModel();
const service = createTravelRuleService({ db, model });
const controller = createTravelRuleController({ service });

// Wire the travel-rule service into the cross-border coordinator so it
// runs as part of the PvP pre-flight (B9.4 leaves an injection point).
setTravelRuleService(service);

const router = Router();

router.post('/enforce', requireAuth, validateBody(enforceBodySchema), asyncHandler(controller.enforce));
router.get('/', requireAuth, validateQuery(listQuerySchema), asyncHandler(controller.list));

export { router as default, service, model };
