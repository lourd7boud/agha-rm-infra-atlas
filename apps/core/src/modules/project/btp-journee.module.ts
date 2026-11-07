import { Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import { BtpJourneeController } from './btp-journee.controller';
import {
  BTP_JOURNEE_REPOSITORY,
  DrizzleBtpJourneeRepository,
  type BtpJourneeRepository,
} from './btp-journee.repository';
import { unavailableBtpRepository } from './btp.repository';
@Module({
  controllers: [BtpJourneeController],
  providers: [
    {
      provide: BTP_JOURNEE_REPOSITORY,
      useFactory: (): BtpJourneeRepository =>
        process.env.DATABASE_URL
          ? new DrizzleBtpJourneeRepository(getDb(process.env.DATABASE_URL))
          : unavailableBtpRepository<BtpJourneeRepository>(
              'BtpJourneeRepository',
            ),
    },
  ],
})
export class BtpJourneeModule {}
