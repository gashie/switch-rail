import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    passWithNoTests: true,
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // TX_TEST_MODE drives the credit-leg + simulator + recovery into short
    // timeout/backoff windows so the suite finishes in single-digit seconds.
    // Production runs leave the variable unset.
    env: {
      TX_TEST_MODE: 'true',
      // Lowered to keep the fast-track quota test fast — production default
      // is 1000/month, in tests we only need to prove the boundary.
      FAST_TRACK_INVOKE_MONTHLY_QUOTA: '3'
    }
  }
});
