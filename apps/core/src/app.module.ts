import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule, Public } from './modules/auth/auth.module';
import { BrainModule } from './modules/brain/brain.module';
import { DigestModule } from './modules/digest/digest.module';
import { IntelModule } from './modules/intel/intel.module';
import { TenderModule } from './modules/tender/tender.module';
import { VaultModule } from './modules/vault/vault.module';
import { WatchModule } from './modules/watch/watch.module';

const STARTED_AT = Date.now();

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  get() {
    return {
      status: 'ok',
      service: 'atlas-core',
      version: '0.1.0',
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      persistence: process.env.DATABASE_URL ? 'postgres' : 'in-memory',
    };
  }
}

@Module({
  imports: [
    // Global rate limit: 120 req/min per client; LLM routes are tighter
    // via @Throttle (security-compliance §5).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthModule,
    AuditModule,
    BrainModule,
    DigestModule,
    IntelModule,
    VaultModule,
    TenderModule,
    WatchModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
