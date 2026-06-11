import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Load .env before any module reads process.env (Node ≥20.12 built-in).
if (existsSync('.env')) process.loadEnvFile('.env');

async function bootstrap(): Promise<void> {
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
