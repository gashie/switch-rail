// Scheduler worker — periodically calls service.tick() to drain due
// mandates. Designed to be started by the monolith at boot or invoked
// imperatively by tests via tick().

import { config } from '../../core/config.js';

export const createSchedulerWorker = ({ service }) => {
  let timer = null;
  let running = false;

  const start = (intervalSeconds = config.mandateSchedulerIntervalSeconds) => {
    if (timer) return;
    running = true;
    const loop = async () => {
      if (!running) return;
      try {
        await service.tick();
      } catch (e) {
        console.error('[mandates scheduler]', e?.message || String(e));
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

  return { start, stop, runOnce: () => service.tick() };
};
