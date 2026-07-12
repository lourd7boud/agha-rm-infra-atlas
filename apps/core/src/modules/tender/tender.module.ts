import { Logger, Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import { BrainModule } from '../brain/brain.module';
import { VaultModule } from '../vault/vault.module';
import { IntelModule } from '../intel/intel.module';
import { PortalModule } from '../portal/portal.module';
import { TenderController } from './tender.controller';
import { TenderListsController } from './tender-lists.controller';
import { DossierService } from './dossier.service';
import { DossierExtractionService } from './dossier-extraction.service';
import { EnrichmentService } from './enrichment.service';
import { TenderChatService } from './tender-chat.service';
import { CompanyLegalService } from './company-legal.service';
import { ComptaRepositoryModule } from '../compta/compta-repository.module';
import { TenderListsService } from './tender-lists.service';
import { TenderAssistantService } from './tender-assistant.service';
import { PricingService } from './pricing.service';
import { QualifierService } from './qualifier.service';
import {
  DrizzleTenderRepository,
  InMemoryTenderRepository,
  TENDER_REPOSITORY,
  type TenderRepository,
} from './tender.repository';
import {
  DrizzleEventRepository,
  DrizzleOutcomeRepository,
  InMemoryEventRepository,
  InMemoryOutcomeRepository,
  OUTCOME_REPOSITORY,
  TENDER_EVENT_REPOSITORY,
  type EventRepository,
  type OutcomeRepository,
} from './ledger.repository';

const tenderRepositoryProvider = {
  provide: TENDER_REPOSITORY,
  useFactory: (): TenderRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleTenderRepository(getDb(url));
    new Logger('TenderModule').warn(
      'DATABASE_URL not set — tender uses a non-persistent in-memory repository',
    );
    return new InMemoryTenderRepository();
  },
};

const outcomeRepositoryProvider = {
  provide: OUTCOME_REPOSITORY,
  useFactory: (): OutcomeRepository => {
    const url = process.env.DATABASE_URL;
    return url
      ? new DrizzleOutcomeRepository(getDb(url))
      : new InMemoryOutcomeRepository();
  },
};

const eventRepositoryProvider = {
  provide: TENDER_EVENT_REPOSITORY,
  useFactory: (): EventRepository => {
    const url = process.env.DATABASE_URL;
    return url
      ? new DrizzleEventRepository(getDb(url))
      : new InMemoryEventRepository();
  },
};

// Listes + Recherches sauvegardées — DB-backed only (no in-memory fallback;
// nothing to organize without a real DB).
const tenderListsServiceProvider = {
  provide: TenderListsService,
  useFactory: (): TenderListsService => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      new Logger('TenderModule').warn(
        'DATABASE_URL not set — Listes + Recherches sauvegardées disabled',
      );
      // Throws on every method call until the DB is configured — better than
      // silently dropping user data into an in-memory store.
      return new TenderListsService(null as unknown as ReturnType<typeof getDb>);
    }
    return new TenderListsService(getDb(url));
  },
};

@Module({
  imports: [BrainModule, IntelModule, VaultModule, PortalModule, ComptaRepositoryModule],
  controllers: [TenderController, TenderListsController],
  providers: [
    tenderRepositoryProvider,
    outcomeRepositoryProvider,
    eventRepositoryProvider,
    tenderListsServiceProvider,
    QualifierService,
    EnrichmentService,
    DossierService,
    DossierExtractionService,
    TenderChatService,
    CompanyLegalService,
    TenderAssistantService,
    PricingService,
  ],
  // EnrichmentService + DossierExtractionService are exported so the Sentinel
  // (watch module) can chain a bounded enrich+extract after each crawl — making
  // every newly-detected consultation analysed automatically.
  exports: [tenderRepositoryProvider, EnrichmentService, DossierExtractionService],
})
export class TenderModule {}
