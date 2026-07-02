import { Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import { BrainModule } from '../brain/brain.module';
import { IntelModule } from '../intel/intel.module';
import { TenderModule } from '../tender/tender.module';
import { VaultModule } from '../vault/vault.module';
import { AnthropicLlmClient, type LlmClient } from '../brain/llm.client';
import { ExpertController } from './expert.controller';
import { EXPERT_LLM_CLIENT, ExpertService } from './expert.service';
import {
  DrizzleKnowledgeSnapshotRepository,
  InMemoryKnowledgeSnapshotRepository,
  KNOWLEDGE_SNAPSHOT_REPOSITORY,
  type KnowledgeSnapshotRepository,
} from './knowledge-snapshot.repository';

/**
 * Dedicated top-tier brain for the expert's written avis (EXPERT_LLM_MODEL,
 * e.g. claude-fable-5 on the qcode Anthropic path). Extraction keeps the fast
 * Gemini client; the service falls back to it when this one is unavailable
 * (the gateway's fable-5 route is frequently at capacity).
 */
const expertLlmProvider = {
  provide: EXPERT_LLM_CLIENT,
  useFactory: (): LlmClient | null => {
    const model = process.env.EXPERT_LLM_MODEL;
    const apiKey = process.env.LLM_API_KEY;
    if (!model || !apiKey) return null;
    return new AnthropicLlmClient({
      apiKey,
      baseUrl: process.env.LLM_API_BASE,
      tierModels: { T3: model },
    });
  },
};

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
  providers: [ExpertService, knowledgeSnapshotProvider, expertLlmProvider],
  // The worker (WatchModule) refreshes the knowledge snapshot after sweeps.
  exports: [ExpertService],
})
export class ExpertModule {}
