import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      // Domain/service/repository logic is the tested core. Exclude wiring,
      // entrypoints, generated migrations and specs themselves so the number
      // reflects real behavioral coverage, not boilerplate.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.module.ts',
        'src/main.ts',
        'src/db/schema/**',
        'src/db/schema.ts',
        'src/db/client.ts',
      ],
    },
  },
});
