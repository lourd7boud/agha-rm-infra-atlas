import { Logger, Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import {
  BTP_ASSETS_REPOSITORY,
  DrizzleBtpAssetsRepository,
  type BtpAssetsRepository,
} from './btp-assets.repository';
import {
  BTP_REGISTRES_REPOSITORY,
  DrizzleBtpRegistresRepository,
  type BtpRegistresRepository,
} from './btp-registres.repository';
import {
  BTP_EXECUTION_REPOSITORY,
  DrizzleBtpExecutionRepository,
  unavailableBtpRepository,
  type BtpExecutionRepository,
} from './btp.repository';

/**
 * Leaf module owning the three BTP repository tokens (exécution, registres,
 * assets). Same shape as ProjectRepositoryModule: import this, never the full
 * BtpModule, when only data access is needed. Unlike the legacy repository
 * there is NO in-memory fallback — the BTP chain is Postgres-only, so without
 * DATABASE_URL the providers fail fast with an explicit message.
 */
const logMissingDb = (which: string) => {
  new Logger('BtpRepositoryModule').warn(
    `DATABASE_URL not set — ${which} unavailable (BTP module requires Postgres)`,
  );
};

export const btpExecutionRepositoryProvider = {
  provide: BTP_EXECUTION_REPOSITORY,
  useFactory: (): BtpExecutionRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleBtpExecutionRepository(getDb(url));
    logMissingDb('BtpExecutionRepository');
    return unavailableBtpRepository<BtpExecutionRepository>('BtpExecutionRepository');
  },
};

export const btpRegistresRepositoryProvider = {
  provide: BTP_REGISTRES_REPOSITORY,
  useFactory: (): BtpRegistresRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleBtpRegistresRepository(getDb(url));
    logMissingDb('BtpRegistresRepository');
    return unavailableBtpRepository<BtpRegistresRepository>('BtpRegistresRepository');
  },
};

export const btpAssetsRepositoryProvider = {
  provide: BTP_ASSETS_REPOSITORY,
  useFactory: (): BtpAssetsRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleBtpAssetsRepository(getDb(url));
    logMissingDb('BtpAssetsRepository');
    return unavailableBtpRepository<BtpAssetsRepository>('BtpAssetsRepository');
  },
};

@Module({
  providers: [
    btpExecutionRepositoryProvider,
    btpRegistresRepositoryProvider,
    btpAssetsRepositoryProvider,
  ],
  exports: [
    btpExecutionRepositoryProvider,
    btpRegistresRepositoryProvider,
    btpAssetsRepositoryProvider,
  ],
})
export class BtpRepositoryModule {}
