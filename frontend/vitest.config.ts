import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Extends vite.config.ts so the plugin list and the "@" alias stay single-sourced.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      // The card modal renders the detail payload, the activity feed and two nested droppables
      // behind msw, which costs 3-5s per case on a loaded machine: vitest's 5s default failed
      // those tests in the full run while they passed on their own. The budget is per test, so
      // raising it cannot hide a slow suite, only a hung one.
      testTimeout: 20_000,
      setupFiles: ['src/test/setup.ts'],
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        // lib/ holds the pure functions; CLAUDE.md section 6 gates them at 100%.
        include: ['src/lib/**/*.ts'],
        exclude: ['src/lib/**/*.test.ts'],
        reporter: ['text', 'lcov'],
        thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  }),
);
