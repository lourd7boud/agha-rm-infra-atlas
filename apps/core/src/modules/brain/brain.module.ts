import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Logger,
  Module,
  Optional,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import { extractAvis } from './extractor';
import {
  AnthropicLlmClient,
  LLM_CLIENT,
  OpenRouterLlmClient,
  type LlmClient,
  type LlmTier,
} from './llm.client';

/** Fast, cheap default for OpenRouter bulk reads (extraction/classification). */
const OPENROUTER_DEFAULT_MODEL = 'google/gemini-2.5-flash';

const extractBodySchema = z.object({
  text: z
    .string()
    .min(20, 'Texte trop court pour une extraction')
    .max(50_000, 'Texte trop long (50 000 caractères max)'),
});

@Controller('brain')
export class BrainController {
  constructor(
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
  ) {}

  /** Extractor (A2): structured fields from raw avis/DCE text. */
  @Roles('marches', 'direction', 'admin-si')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('extract-avis')
  async extractAvisEndpoint(@Body() body: unknown) {
    if (!this.llm) {
      throw new ServiceUnavailableException(
        'LLM non configuré (LLM_API_KEY manquant)',
      );
    }
    const parsed = extractBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return extractAvis(this.llm, parsed.data.text);
  }
}

const llmClientProvider = {
  provide: LLM_CLIENT,
  useFactory: (): LlmClient | null => {
    const log = new Logger('BrainModule');

    // OpenRouter (OpenAI-protocol) takes precedence when configured — a single
    // fast model serves every tier unless an explicit per-tier override is set.
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (openrouterKey) {
      const model = process.env.OPENROUTER_MODEL ?? OPENROUTER_DEFAULT_MODEL;
      const tierModels: Partial<Record<LlmTier, string>> = {
        T1: model,
        T2: process.env.OPENROUTER_MODEL_T2 ?? model,
        T3: process.env.OPENROUTER_MODEL_T3 ?? model,
      };
      log.log(`LLM client active (OpenRouter · ${model})`);
      return new OpenRouterLlmClient({
        apiKey: openrouterKey,
        baseUrl: process.env.OPENROUTER_API_BASE,
        tierModels,
        appUrl: process.env.PUBLIC_WEB_URL ?? 'https://atlas.marocinfra.com',
        appTitle: 'ATLAS — AGHA RM INFRA',
      });
    }

    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      log.warn(
        'No LLM provider configured (OPENROUTER_API_KEY / LLM_API_KEY) — brain endpoints disabled',
      );
      return null;
    }
    const baseUrl = process.env.LLM_API_BASE;
    log.log(`LLM client active (${baseUrl ?? 'api.anthropic.com'})`);
    return new AnthropicLlmClient({
      apiKey,
      baseUrl,
      tierModels: {
        ...(process.env.LLM_MODEL_T1 ? { T1: process.env.LLM_MODEL_T1 } : {}),
        ...(process.env.LLM_MODEL_T2 ? { T2: process.env.LLM_MODEL_T2 } : {}),
        ...(process.env.LLM_MODEL_T3 ? { T3: process.env.LLM_MODEL_T3 } : {}),
      },
    });
  },
};

@Module({
  controllers: [BrainController],
  providers: [llmClientProvider],
  exports: [llmClientProvider],
})
export class BrainModule {}
