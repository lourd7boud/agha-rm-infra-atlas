import { Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import { BtpTerrainReconciliationController } from './btp-terrain-reconciliation.controller';
import {
  BTP_TERRAIN_RECONCILIATION_REPOSITORY,
  DrizzleBtpTerrainReconciliationRepository,
  type BtpTerrainReconciliationRepository,
} from './btp-terrain-reconciliation.repository';
import { unavailableBtpRepository } from './btp.repository';

@Module({
  controllers: [BtpTerrainReconciliationController],
  providers: [
    {
      provide: BTP_TERRAIN_RECONCILIATION_REPOSITORY,
      useFactory: (): BtpTerrainReconciliationRepository =>
        process.env.DATABASE_URL
          ? new DrizzleBtpTerrainReconciliationRepository(getDb(process.env.DATABASE_URL))
          : unavailableBtpRepository<BtpTerrainReconciliationRepository>(
              'BtpTerrainReconciliationRepository',
            ),
    },
  ],
})
export class BtpTerrainReconciliationModule {}
