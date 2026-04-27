// Async scanner worker. Runs the three scanners on a fixed cadence; never
// in the auth hot path. Started/stopped by the monolith (or via the
// /scan admin endpoint for ad-hoc runs).

export const createScannerWorker = ({ alertsService, intervalMs = 5 * 60 * 1000, logger = console }) => {
  let timer = null;
  let stopped = false;
  let inFlight = null;

  const tick = async () => {
    if (stopped) return;
    inFlight = alertsService.runScan({ windowHours: 24 }).catch((e) => {
      logger.error?.({ err: e }, 'network-graph scanner tick failed');
      return null;
    });
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  return {
    start: () => {
      stopped = false;
      timer = setTimeout(tick, intervalMs);
    },
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight.catch(() => {});
    },
    runOnce: () => alertsService.runScan({ windowHours: 24 })
  };
};
