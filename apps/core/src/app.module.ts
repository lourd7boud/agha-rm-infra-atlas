import { Controller, Get, Module } from '@nestjs/common';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule, Public } from './modules/auth/auth.module';
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
  imports: [AuthModule, AuditModule, VaultModule, TenderModule, WatchModule],
  controllers: [HealthController],
})
export class AppModule {}
