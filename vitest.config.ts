import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // Contract tests share one WordPress and mutate site-wide state (options, routing, CORS,
    // redirects). Running files in parallel makes them race each other.
    fileParallelism: false,
  },
});
