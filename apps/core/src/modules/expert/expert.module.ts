import { Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import { BrainModule } from '../brain/brain.module';
import { IntelModule } from '../intel/intel.module';
import { TenderModule } from '../tender/tender.module';
import { VaultModule } from '../vault/vault.module';
import { ExpertController } from './expert.controller';
import { ExpertService } from './expert.service';
import {
  DrizzleKnowledgeSnapshotRepository,
  InMemoryKnowledgeSnapshotRepository,
  KNOWLEDGE_SNAPSHOT_REPOSITORY,
  type KnowledgeSnapshotRepository,
} from './knowledge-snapshot.repository';

const knowledgeSnapshotProvider = {
  provide: KNOWLEDGE_SNAPSHOT_REPOSITORY,
  useFactory: (): KnowledgeSnapshotRepository => {
    const url = process.env.DATABASE_URL;
    if (url) return new DrizzleKnowledgeSnapshotRepository(getDb(url));
    return new InMemoryKnowledgeSnapshotRepository();
  },
};

/**
 * Agent AGHA-RM-INFRA — the company's public-procurement expert. Pulls its
 * grounding from the modules that already own the data: TenderModule
 * (catalogue + DCE extractions), IntelModule (published bids + rebate
 * calibration), BrainModule (LLM), VaultModule (company documents).
 */
@Module({
  imports: [TenderModule, IntelModule, BrainModule, VaultModule],
  controllers: [ExpertController],
  providers: [ExpertService, knowledgeSnapshotProvider],
  // The worker (WatchModule) refreshes the knowledge snapshot after sweeps.
  exports: [ExpertService],
})
export class ExpertModule {}
