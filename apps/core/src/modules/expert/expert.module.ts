import { Module } from '@nestjs/common';
import { getDb } from '../../db/client';
import { BrainModule } from '../brain/brain.module';
import { IntelModule } from '../intel/intel.module';
import { TenderModule } from '../tender/tender.module';
import { VaultModule } from '../vault/vault.module';
import { Logger } from '@nestjs/common';
import {
  createExpertLlmClientFromEnv,
  isClaudeModel,
  type LlmClient,
} from '../brain/llm.client';
import { ExpertController } from './expert.controller';
import { EXPERT_LLM_CLIENT, ExpertService } from './expert.service';
import {
  DrizzleKnowledgeSnapshotRepository,
  InMemoryKnowledgeSnapshotRepository,
  KNOWLEDGE_SNAPSHOT_REPOSITORY,
  type KnowledgeSnapshotRepository,
} from './knowledge-snapshot.repository';

/**
 * Dedicated TOP-TIER brain for the two surfaces the company depends on: the BPU
 * pricing and the written Go/No-Go avis. Both run at tier T3, so EXPERT_LLM_MODEL
 * is forced onto T2+T3 here — this is where "use the strong model, not the
 * economical one" is wired. The client matches whatever provider the platform
 * runs on, so a single env var upgrades the expert WITHOUT a second key:
 *   LLM_PROVIDER=google + OPENROUTER_API_KEY → e.g. EXPERT_LLM_MODEL=gemini-2.5-pro
 *   OPENROUTER_API_KEY (OpenAI proto)        → e.g. EXPERT_LLM_MODEL=... strong ...
 *   LLM_API_KEY (Anthropic Messages / qcode) → e.g. EXPERT_LLM_MODEL=claude-fable-5
 * Unset EXPERT_LLM_MODEL = the expert falls back to the default extraction client
 * (fast Gemini) for these too — the service degrades gracefully either way.
 */
const expertLlmProvider = {
  provide: EXPERT_LLM_CLIENT,
  useFactory: (): LlmClient | null => {
    const log = new Logger('ExpertModule');
    const model = process.env.EXPERT_LLM_MODEL;
    const client = createExpertLlmClientFromEnv();
    if (!client) {
      log.log(
        'Expert LLM not configured (EXPERT_LLM_MODEL unset) — pricing + avis use the default extraction client',
      );
      return null;
    }
    const path = isClaudeModel(model ?? '') ? 'Anthropic' : 'provider-inferred';
    log.log(`Expert LLM active: ${model} (${path} path) — drives pricing + avis`);
    return client;
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
