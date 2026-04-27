import { runPipeline } from './pipeline.js';

/**
 * Authorization service.
 *
 * Pure orchestration over the pipeline — no DB access, no cross-module
 * calls. Callers (the transaction orchestrator in B4.7) gather the needed
 * context (resolved accounts, recent-e2e count, daily/monthly volumes,
 * caps) and pass it in. This keeps authorization independent of the
 * transactions module and avoids a circular dependency.
 */
export const createAuthorizationService = () => ({
  authorize: (ctx) => runPipeline(ctx)
});
