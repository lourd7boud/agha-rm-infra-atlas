import { defineConfig } from '@playwright/test';

// Vérification visuelle LOCALE (hors CI) contre la pile docker-compose
// `platform/docker-compose.local-atlas.yml` (web publié sur :13001, Keycloak
// navigateur sur :18081). Ne fait pas partie de `pnpm test:e2e` : ce dossier
// `e2e-local/` est un outil ponctuel, supprimable.
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  expect: { timeout: 25_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:13001',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 1000 },
  },
});
