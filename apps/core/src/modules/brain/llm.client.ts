import { Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Model routing per task tier (ai-architecture §2). The gateway
 * (api.qcode.cc) speaks the native Anthropic Messages protocol, so the
 * official SDK is used with a custom baseURL.
 */
export type LlmTier = 'T1' | 'T2' | 'T3';

export const DEFAULT_TIER_MODELS: Record<LlmTier, string> = {
  // T1 bulk: extraction, classification — cheap and fast.
  T1: 'claude-haiku-4-5-20251001',
  // T2 standard: DCE parsing, drafting, synthesis.
  T2: 'claude-sonnet-4-6',
  // T3 strategic: Go/No-Go briefs, pricing memos — deepest reasoning.
  T3: 'claude-fable-5',
};

export interface LlmCompletion {
  /** Raw completion text as returned by the provider (prefill NOT included). */
  text: string;
  /** Echo of the request prefill, for parse-time reassembly. */
  prefill?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmRequest {
  tier: LlmTier;
  prompt: string;
  system?: string;
  maxTokens?: number;
  /** Assistant prefill — forces the response to start with this text (e.g. "{"). */
  prefill?: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmCompletion>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');

export interface AnthropicClientOptions {
  apiKey: string;
  baseUrl?: string;
  tierModels?: Partial<Record<LlmTier, string>>;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly tierModels: Record<LlmTier, string>;

  constructor(options: AnthropicClientOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
    });
    this.tierModels = { ...DEFAULT_TIER_MODELS, ...options.tierModels };
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const model = this.tierModels[request.tier];
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: request.prompt },
    ];
    if (request.prefill) {
      messages.push({ role: 'assistant', content: request.prefill });
    }
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens ?? 1024,
        temperature: 0,
        system: request.system,
        messages,
      });
    } catch (error) {
      // Full provider error stays server-side; the client gets a clean 503.
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      new Logger('LlmClient').error(
        `LLM call failed (${model}): ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        `Service IA momentanément indisponible${status ? ` (HTTP ${status})` : ''} — réessayer dans quelques instants`,
      );
    }
    const completionText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      // Gateways differ: some honor prefill (text continues it), some return
      // a complete answer. Callers reassemble via parseModelJson.
      text: completionText,
      prefill: request.prefill,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

/** Test double returning queued canned responses and recording requests. */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly queue: string[];

  constructor(responses: readonly string[]) {
    this.queue = [...responses];
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    this.requests.push(request);
    const text = this.queue.shift();
    if (text === undefined) throw new Error('FakeLlmClient queue exhausted');
    return { text, model: `fake-${request.tier}`, inputTokens: 10, outputTokens: 10 };
  }
}
