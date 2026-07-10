import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgentsModule } from './modules/agents/agents.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule, Public } from './modules/auth/auth.module';
import { BrainModule } from './modules/brain/brain.module';
import { ComptaModule } from './modules/compta/compta.module';
import { BdcModule } from './modules/bdc/bdc.module';
import { DigestModule } from './modules/digest/digest.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { ExpertModule } from './modules/expert/expert.module';
import { FieldModule } from './modules/field/field.module';
import { FinanceModule } from './modules/finance/finance.module';
import { IntelModule } from './modules/intel/intel.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { PeopleModule } from './modules/people/people.module';
import { PortalModule } from './modules/portal/portal.module';
import { BtpModule } from './modules/project/btp.module';
import { ProjectModule } from './modules/project/project.module';
import { SalesModule } from './modules/sales/sales.module';
import { StockModule } from './modules/stock/stock.module';
import { SupplyModule } from './modules/supply/supply.module';
import { TenderModule } from './modules/tender/tender.module';
import { VaultModule } from './modules/vault/vault.module';
import { WatchModule } from './modules/watch/watch.module';

const STARTED_AT = Date.now();

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  get() {
    // Public surface stays minimal — backend topology (DB engine, etc.)
    // is not disclosed to unauthenticated callers.
    return {
      status: 'ok',
      service: 'atlas-core',
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    };
  }
}

@Module({
  imports: [
    // Global rate limit: 120 req/min per client; LLM routes are tighter
    // via @Throttle (security-compliance §5).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthModule,
    AgentsModule,
    AuditModule,
    BrainModule,
    BdcModule,
    BtpModule,
    ComptaModule,
    DigestModule,
    EquipmentModule,
    ExpertModule,
    FieldModule,
    FinanceModule,
    IntelModule,
    MetricsModule,
    PeopleModule,
    PortalModule,
    ProjectModule,
    SalesModule,
    StockModule,
    SupplyModule,
    VaultModule,
    TenderModule,
    WatchModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
