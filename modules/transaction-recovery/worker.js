import { config } from '../../core/config.js';

/**
 * Polling loop that drains PENDING_RECONCILIATION transactions whose
 * `next_attempt_at` is due. Started by the monolith server at boot. Stops
 * cleanly when `stop()` is called.
 *
 * The worker holds no state of its own — everything decisional lives in
 * the recovery service. The loop's only job is timing.
 */
export const createRecoveryWorker = ({ service, logger = console }) => {
  let running = false;
  let stopRequested = false;
  let timer = null;
  let inFlight = null;

  const pollIntervalMs = () => (config.txTestMode ? 25 : 1_000);
  const batchSize = 10;

  const tick = async () => {
    if (stopRequested) return;
    inFlight = service.runBatch({ limit: batchSize }).catch((e) => {
      logger.error?.({ err: e }, 'recovery worker tick failed');
      return [];
    });
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    if (!stopRequested) {
      timer = setTimeout(tick, pollIntervalMs());
    }
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      stopRequested = false;
      timer = setTimeout(tick, pollIntervalMs());
    },

    stop: async () => {
      stopRequested = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight) {
        await inFlight.catch(() => {});
      }
      running = false;
    },

    isRunning: () => running,

    runOnceForId: (id) => service.runOnceForId(id),
    runBatch: (opts) => service.runBatch(opts)
  };
};
