import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config for the M1 golden paths (CLAUDE.md section 6, "End to end").
 *
 * There is deliberately no `webServer` block: the server is started by the operator (or CI)
 * against a throwaway data directory, so a run never touches `data/kanban.db`:
 *
 *   npm run build --prefix frontend
 *   KANBAN_PORT=8020 KANBAN_DATA_DIR=./.tmp-verify KANBAN_LOGIN_RATE_LIMIT=200/300 python -m kanban
 *   npx playwright test -c e2e/playwright.config.ts
 *
 * The raised login bucket is not optional: every spec registers its own account, and the
 * default `10/300` of Section 4.1 refuses the last few of a full run with 429 `rate_limited`.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:8020',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
});
