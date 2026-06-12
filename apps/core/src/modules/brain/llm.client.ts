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
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmRequest {
  tier: LlmTier;
  prompt: string;
  system?: string;
  maxTokens?: number;
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
    const response = await this.client.messages.create({
      model,
      max_tokens: request.maxTokens ?? 1024,
      temperature: 0,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      text,
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
