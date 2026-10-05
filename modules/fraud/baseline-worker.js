// Baseline refresh worker. Wired into the EOD post-cutover hook so the
// daily refresh isn't blocked by the rest of the day's work; can also be
// invoked on-demand by an operator. The worker itself is just a thin
// scheduler around baselineService.refreshStaleBaselines.

export const createBaselineWorker = ({ baselineService, logger = console }) => {
  let timer = null;
  let stopRequested = false;
  let inFlight = null;

  // Default cadence: every 4 hours during dev; in production this would be
  // hooked off EOD. We don't ship a cron — the monolith starts the worker
  // and the worker schedules its own ticks.
  const intervalMs = 4 * 60 * 60 * 1000;

  const tick = async () => {
    if (stopRequested) return;
    inFlight = baselineService
      .refreshStaleBaselines({ staleSinceHours: 24, limit: 5000 })
      .catch((e) => {
        logger.error?.({ err: e }, 'baseline worker tick failed');
        return { scanned: 0, refreshed: 0, error: e?.message };
      });
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    if (!stopRequested) timer = setTimeout(tick, intervalMs);
  };

  return {
    start: () => {
      stopRequested = false;
      timer = setTimeout(tick, intervalMs);
    },
    stop: async () => {
      stopRequested = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight) await inFlight.catch(() => {});
    },
    runOnce: () => baselineService.refreshStaleBaselines({ staleSinceHours: 24, limit: 5000 })
  };
};
