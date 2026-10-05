// Promise.race-based deadline. The provided promise still runs to completion
// in the background — for HTTP, pair this with an AbortController so the
// underlying request is actually torn down rather than orphaned.
export const withTimeout = (promise, ms, onTimeout) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        const err = onTimeout ? onTimeout() : new Error('timeout');
        reject(err);
      }, ms)
    )
  ]);
