// Bulk runner worker — drives QUEUED/RUNNING runs to completion in a polling
// loop. Bounded concurrency comes from processBatch's batchSize argument
// (per-call), not parallel JS dispatch — we keep it sequential per-line so
// the orchestrator's transaction model holds.

import { config } from '../../core/config.js';

export const createRunnerWorker = ({ service, model }) => {
  let timer = null;
  let running = false;

  const runOnce = async () => {
    const due = await service && (await import('../../core/db.js')).withClient((c) => model.pickQueuedRuns(c, 5));
    const results = [];
    for (const r of due || []) {
      const out = await service.runToCompletion({ runId: r.id, batchSize: config.bulkRunnerConcurrency });
      results.push({ runId: r.id, processed: out.processed, finalState: out.run.state });
    }
    return { picked: due?.length || 0, results };
  };

  const start = (intervalSeconds = 30) => {
    if (timer) return;
    running = true;
    const loop = async () => {
      if (!running) return;
      try {
        await runOnce();
      } catch (e) {
        console.error('[bulk runner]', e?.message || String(e));
      }
      if (running) timer = setTimeout(loop, intervalSeconds * 1000);
    };
    timer = setTimeout(loop, intervalSeconds * 1000);
  };

  const stop = async () => {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return { start, stop, runOnce };
};
