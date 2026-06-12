import { defineConfig } from '@playwright/test';

// E2E against the local dev stack (web :3001, core :3000, Keycloak :8081).
// Deterministic waits only — no timeout-based assertions (testing rules).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  // Serial: parallel first-compiles on the dev server caused flaky timeouts.
  workers: 1,
  use: {
    baseURL: 'http://localhost:3001',
    screenshot: 'only-on-failure',
  },
});
