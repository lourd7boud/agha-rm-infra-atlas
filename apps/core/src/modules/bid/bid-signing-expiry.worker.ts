import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  BID_SIGNING_REPOSITORY,
  type BidSigningRepository,
} from './bid-signing.repository';
import { OBJECT_STORAGE, type ObjectStorage } from '../vault/storage';

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH_SIZE = 100;

@Injectable()
export class BidSigningExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BidSigningExpiryWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(BID_SIGNING_REPOSITORY)
    private readonly repository: BidSigningRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onModuleInit(): void {
    if (process.env.WATCH_WORKER_ENABLED !== 'true') return;
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(now = new Date()): Promise<number> {
    try {
      const expired = await this.repository.expireAllStale(
        now,
        SWEEP_BATCH_SIZE,
      );
      const uploads = await this.repository.claimExpiredUploads(
        now,
        SWEEP_BATCH_SIZE,
      );
      for (const upload of uploads) {
        try {
          await this.storage.delete(upload.objectKey);
          await this.repository.abandonUpload(upload.id, now);
        } catch (error) {
          await this.repository.abandonUpload(
            upload.id,
            now,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      if (expired > 0) this.logger.log(`Recovered ${expired} expired signing task(s)`);
      return expired;
    } catch (error) {
      this.logger.error(
        'Signing expiry sweep failed',
        error instanceof Error ? error.stack : undefined,
      );
      return 0;
    }
  }
}
