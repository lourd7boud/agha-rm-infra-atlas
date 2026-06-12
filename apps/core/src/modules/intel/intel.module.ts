import { join } from 'node:path';
import {
  Controller,
  Get,
  Inject,
  Logger,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { getDb } from '../../db/client';
import { Roles } from '../auth/auth.module';
import {
  FixturePortalSource,
  HttpPortalSource,
  PORTAL_SOURCE,
  type PortalSource,
} from '../watch/watch.source';
import {
  DrizzleIntelRepository,
  INTEL_REPOSITORY,
  InMemoryIntelRepository,
  type IntelRepository,
} from './intel.repository';
import { IntelService } from './intel.service';

@Controller('intel')
export class IntelController {
  constructor(
    @Inject(IntelService) private readonly service: IntelService,
    @Inject(INTEL_REPOSITORY) private readonly repository: IntelRepository,
  ) {}

  /** Run the Result Miner over the configured source. */
  @Roles('marches', 'direction', 'admin-si')
  @Post('harvest')
  async harvest() {
    return this.service.harvestOnce();
  }

  /** Competitor map: who wins what, for how much. */
  @Roles('marches', 'direction', 'admin-si')
  @Get('competitors')
  async competitors() {
    return this.repository.listCompetitorStats();
  }

  /** Recent published results (price observatory seed). */
  @Roles('marches', 'direction', 'admin-si')
  @Get('results')
  async results(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    const capped =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    return this.repository.listResults(capped);
  }
}

const intelSourceProvider = {
  provide: PORTAL_SOURCE,
  useFactory: (): PortalSource => {
    const logger = new Logger('IntelModule');
    if (process.env.INTEL_SOURCE === 'live' && process.env.INTEL_PMMP_URL) {
      logger.log(`Result Miner source: LIVE ${process.env.INTEL_PMMP_URL}`);
      return new HttpPortalSource(process.env.INTEL_PMMP_URL);
    }
    logger.warn(
      'Result Miner source: recorded fixture (set INTEL_SOURCE=live + INTEL_PMMP_URL for production)',
    );
    return new FixturePortalSource(
      join(process.cwd(), 'src/modules/intel/fixtures/pmmp-resultats.html'),
    );
  },
};

const intelRepositoryProvider = {
  provide: INTEL_REPOSITORY,
  useFactory: (): IntelRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleIntelRepository(getDb(url));
    new Logger('IntelModule').warn(
      'DATABASE_URL not set — intel uses a non-persistent in-memory repository',
    );
    return new InMemoryIntelRepository();
  },
};

@Module({
  controllers: [IntelController],
  providers: [intelSourceProvider, intelRepositoryProvider, IntelService],
})
export class IntelModule {}
