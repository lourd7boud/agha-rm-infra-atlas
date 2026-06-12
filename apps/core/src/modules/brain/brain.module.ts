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
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      new Logger('BrainModule').warn(
        'LLM_API_KEY not set — brain endpoints disabled',
      );
      return null;
    }
    const baseUrl = process.env.LLM_API_BASE;
    new Logger('BrainModule').log(
      `LLM client active (${baseUrl ?? 'api.anthropic.com'})`,
    );
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
