import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Load .env before any module reads process.env (Node ≥20.12 built-in).
if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * Production refuses to boot with silent in-memory fallbacks: every module
 * that degrades gracefully in dev (security-compliance §1) must be backed by
 * real infrastructure once NODE_ENV=production.
 */
function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const required = [
    'DATABASE_URL',
    'OIDC_ISSUER',
    'REDIS_URL',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `FATAL: missing required production env: ${missing.join(', ')}`,
    );
  }
}

async function bootstrap(): Promise<void> {
  assertProductionEnv();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(
    `ATLAS Core listening on http://localhost:${port}/api/health`,
  );
}

bootstrap().catch((error) => {
  // Bootstrap failure: no logger infrastructure is guaranteed yet.
  console.error('Fatal bootstrap error', error);
  process.exit(1);
});
