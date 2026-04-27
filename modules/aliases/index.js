export {
  default as aliasesRoutes,
  service as aliasesService,
  verificationService as aliasesVerificationService
} from './routes.js';
export { normalizeAliasValue } from './service.js';
export {
  ALIAS_TYPES,
  ALIAS_STATUSES,
  VERIFICATION_METHODS,
  RESERVED_HANDLES
} from './schema.js';
export { NIA_FAKE_REGISTRY } from './nia-client.js';
