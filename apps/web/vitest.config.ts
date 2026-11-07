import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only — `*.test.ts` under src/. Playwright owns e2e/*.spec.ts, so
// the suffix split keeps the two runners from colliding on `pnpm -r test`.
export default defineConfig({
  // Next.js compile le JSX avec le runtime automatique ; esbuild doit faire de
  // même pour les composants testés côté Node (sinon « React is not defined »).
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
