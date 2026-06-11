import { Controller, Get, Module } from '@nestjs/common';
import { VaultModule } from './modules/vault/vault.module';

const STARTED_AT = Date.now();

@Controller('health')
export class HealthController {
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
  imports: [VaultModule],
  controllers: [HealthController],
})
export class AppModule {}
