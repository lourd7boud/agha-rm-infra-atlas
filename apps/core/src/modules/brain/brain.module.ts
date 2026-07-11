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
  CHAT_LLM_CLIENT,
  createChatLlmClientFromEnv,
  createLlmClientFromEnv,
  LLM_CLIENT,
  type LlmClient,
} from './llm.client';

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
    const client = createLlmClientFromEnv();
    if (!client) {
      log.warn(
        'No LLM provider configured (OPENROUTER_API_KEY / LLM_API_KEY) — brain endpoints disabled',
      );
      return null;
    }
    const provider =
      process.env.LLM_PROVIDER?.toLowerCase() === 'google'
        ? `Google · ${process.env.OPENROUTER_MODEL ?? 'gemini-2.5-flash-lite'}`
        : process.env.OPENROUTER_API_KEY
          ? `OpenRouter · ${process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash'}`
          : `Anthropic · ${process.env.LLM_API_BASE ?? 'api.anthropic.com'}`;
    log.log(`LLM client active (${provider})`);
    return client;
  },
};

/**
 * Dedicated STRONG client for the per-tender chat (TenderChatService) — runs the
 * chat on a top model (default claude-opus-4-8) instead of the fast/cheap
 * extraction model, since the chat is the surface users judge the "agent" by.
 * Null when CHAT_LLM_MODEL is unset → the chat falls back to the default client.
 */
const chatLlmClientProvider = {
  provide: CHAT_LLM_CLIENT,
  useFactory: (): LlmClient | null => {
    const log = new Logger('BrainModule');
    const client = createChatLlmClientFromEnv();
    if (!client) {
      log.log(
        'Chat LLM not configured (CHAT_LLM_MODEL unset) — per-tender chat uses the default client',
      );
      return null;
    }
    log.log(
      `Chat LLM active: ${process.env.CHAT_LLM_MODEL} — drives the per-tender /tenders chat`,
    );
    return client;
  },
};

@Module({
  controllers: [BrainController],
  providers: [llmClientProvider, chatLlmClientProvider],
  exports: [llmClientProvider, chatLlmClientProvider],
})
export class BrainModule {}
