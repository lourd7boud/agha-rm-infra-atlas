import { Logger, Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import { BidController } from './bid.controller';
import {
  BID_WORKSPACE_REPOSITORY,
  DrizzleBidWorkspaceRepository,
  InMemoryBidWorkspaceRepository,
  type BidWorkspaceRepository,
} from './bid.repository';
import { BidWorkspaceService } from './bid.service';
import { VaultModule } from '../vault/vault.module';
import { BidPackageController } from './bid-package.controller';
import {
  BID_PACKAGE_REPOSITORY,
  DrizzleBidPackageRepository,
  InMemoryBidPackageRepository,
  type BidPackageRepository,
} from './bid-package.repository';
import { BidPackageService } from './bid-package.service';
import {
  BidSigningBridgeController,
  BidSigningController,
  SigningLeaseGuard,
} from './bid-signing.controller';
import {
  BID_SIGNING_REPOSITORY,
  DrizzleBidSigningRepository,
  InMemoryBidSigningRepository,
  type BidSigningRepository,
} from './bid-signing.repository';
import { BidSigningService } from './bid-signing.service';
import { BidSigningArtifactService } from './bid-signing-artifact.service';
import { BidSigningExpiryWorker } from './bid-signing-expiry.worker';
import {
  SigningUploadConcurrencyGuard,
  SigningUploadLimiter,
  SigningUploadReleaseInterceptor,
} from './bid-signing-upload-limiter';

interface BidRepositoryFactoryOptions {
  nodeEnv?: string;
  databaseUrl?: string;
  warn?: (message: string) => void;
}

export function createBidWorkspaceRepository(
  options: BidRepositoryFactoryOptions,
): BidWorkspaceRepository {
  if (options.databaseUrl) {
    return new DrizzleBidWorkspaceRepository(getDb(options.databaseUrl));
  }
  if (options.nodeEnv === 'production') {
    throw new Error('DATABASE_URL is required for bid workspaces in production');
  }
  (options.warn ?? ((message) => new Logger('BidModule').warn(message)))(
    'DATABASE_URL not set — bid workspaces use non-persistent memory storage',
  );
  return new InMemoryBidWorkspaceRepository();
}

export function createBidSigningRepository(
  options: BidRepositoryFactoryOptions,
): BidSigningRepository {
  if (options.databaseUrl) {
    return new DrizzleBidSigningRepository(getDb(options.databaseUrl));
  }
  if (options.nodeEnv === 'production') {
    throw new Error('DATABASE_URL is required for bid signing in production');
  }
  (options.warn ?? ((message) => new Logger('BidModule').warn(message)))(
    'DATABASE_URL not set — bid signing uses non-persistent memory storage',
  );
  return new InMemoryBidSigningRepository();
}

const bidWorkspaceRepositoryProvider = {
  provide: BID_WORKSPACE_REPOSITORY,
  useFactory: (): BidWorkspaceRepository =>
    createBidWorkspaceRepository({
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL,
    }),
};

const bidPackageRepositoryProvider = {
  provide: BID_PACKAGE_REPOSITORY,
  useFactory: (): BidPackageRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleBidPackageRepository(getDb(url));
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is required for bid packages in production');
    }
    new Logger('BidModule').warn(
      'DATABASE_URL not set — bid packages use non-persistent memory storage',
    );
    return new InMemoryBidPackageRepository();
  },
};

const bidSigningRepositoryProvider = {
  provide: BID_SIGNING_REPOSITORY,
  useFactory: (): BidSigningRepository =>
    createBidSigningRepository({
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL,
    }),
};

@Module({
  imports: [VaultModule],
  controllers: [
    BidController,
    BidPackageController,
    BidSigningController,
    BidSigningBridgeController,
  ],
  providers: [
    bidWorkspaceRepositoryProvider,
    bidPackageRepositoryProvider,
    bidSigningRepositoryProvider,
    BidWorkspaceService,
    BidPackageService,
    BidSigningService,
    BidSigningArtifactService,
    BidSigningExpiryWorker,
    SigningLeaseGuard,
    SigningUploadLimiter,
    SigningUploadConcurrencyGuard,
    SigningUploadReleaseInterceptor,
  ],
  exports: [
    BidWorkspaceService,
    BidPackageService,
    BidSigningService,
    BidSigningArtifactService,
  ],
})
export class BidModule {}
