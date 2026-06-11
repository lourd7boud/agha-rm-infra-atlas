import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Dev default mirrors platform/docker-compose.dev.yml; prod always sets DATABASE_URL.
    url: process.env.DATABASE_URL ?? 'postgres://atlas:atlas-dev@localhost:5433/atlas',
  },
});
