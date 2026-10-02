import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config for the golden paths of CLAUDE.md section 6 ("End to end").
 *
 * There is deliberately no `webServer` block: the server is started by the operator (or CI)
 * against a throwaway data directory, so a run never touches `data/kanban.db`:
 *
 *   npm run build --prefix frontend
 *   KANBAN_PORT=8020 KANBAN_DATA_DIR=./.tmp-verify python -m kanban
 *   npx playwright test -c e2e/playwright.config.ts
 *
 * There is no sign-in anywhere in the suite and no `globalSetup` to arrange one: the app has no
 * accounts, so every spec navigates to `/` and starts work. What one spec writes is therefore
 * visible to the next, which is why each file names its board with a per-run suffix instead of
 * relying on a private account for isolation.
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
