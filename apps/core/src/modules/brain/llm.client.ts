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

export type LlmImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface LlmVisionRequest {
  tier: LlmTier;
  /** Base64-encoded image bytes (no data: prefix). */
  imageBase64: string;
  mediaType: LlmImageMediaType;
  prompt: string;
  maxTokens?: number;
}

export interface LlmVisionDocImage {
  /** Base64-encoded image bytes (no data: prefix). */
  base64: string;
  mediaType: LlmImageMediaType;
}

export interface LlmVisionDocRequest {
  tier: LlmTier;
  system?: string;
  prompt: string;
  /** One or more page images (e.g. a scanned DCE rendered page-by-page). */
  images: LlmVisionDocImage[];
  maxTokens?: number;
  /** Ask the provider for a JSON object response (OpenAI response_format). */
  jsonMode?: boolean;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmCompletion>;
  /** Vision read of a single image (scanned notices, plans…) → text. */
  completeVision(request: LlmVisionRequest): Promise<LlmCompletion>;
  /** Multi-image document read (scanned DCE pages) → structured answer. The
   *  model does OCR + layout understanding + extraction in ONE call, which is
   *  both faster (no local CPU OCR) and higher quality on scans/tables than
   *  tesseract→text→LLM. */
  completeVisionDoc(request: LlmVisionDocRequest): Promise<LlmCompletion>;
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

  async completeVision(request: LlmVisionRequest): Promise<LlmCompletion> {
    const model = this.tierModels[request.tier];
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens ?? 1024,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: request.mediaType,
                  data: request.imageBase64,
                },
              },
              { type: 'text', text: request.prompt },
            ],
          },
        ],
      });
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      new Logger('LlmClient').error(
        `LLM vision call failed (${model}): ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        `Service IA momentanément indisponible${status ? ` (HTTP ${status})` : ''} — réessayer dans quelques instants`,
      );
    }
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

  async completeVisionDoc(request: LlmVisionDocRequest): Promise<LlmCompletion> {
    const model = this.tierModels[request.tier];
    const content: Anthropic.ContentBlockParam[] = request.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    }));
    content.push({ type: 'text', text: request.prompt });
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens ?? 1024,
        temperature: 0,
        system: request.system,
        messages: [{ role: 'user', content }],
      });
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      new Logger('LlmClient').error(
        `LLM vision-doc call failed (${model}): ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        `Service IA momentanément indisponible${status ? ` (HTTP ${status})` : ''} — réessayer dans quelques instants`,
      );
    }
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

export interface OpenRouterClientOptions {
  apiKey: string;
  /** Defaults to https://openrouter.ai/api/v1 */
  baseUrl?: string;
  tierModels?: Partial<Record<LlmTier, string>>;
  timeoutMs?: number;
  /** Optional OpenRouter attribution headers. */
  appUrl?: string;
  appTitle?: string;
}

const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_TIMEOUT_MS = 60_000;

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number | string };
}

/**
 * OpenRouter speaks the OpenAI Chat Completions protocol (NOT Anthropic
 * Messages), so this is a small fetch-based client rather than a reuse of the
 * Anthropic SDK. It implements the same LlmClient contract, so every brain
 * agent + the enrichment service work through it unchanged. A `prefill` request
 * (JSON expected) can't be "continued" in the OpenAI protocol, so we force a
 * JSON object via response_format instead and echo the prefill so the shared
 * parseModelJson reassembly stays compatible.
 */
export class OpenRouterLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly tierModels: Record<LlmTier, string>;
  private readonly timeoutMs: number;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    // Validate the base URL at construction — a misconfigured OPENROUTER_API_BASE
    // would otherwise send the bearer key to an arbitrary host for the process
    // lifetime. Fail fast instead of silently redirecting traffic.
    const base = (options.baseUrl ?? OPENROUTER_DEFAULT_BASE).replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(base);
    } catch {
      throw new Error(`OPENROUTER_API_BASE invalide (URL malformée): ${base}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`OPENROUTER_API_BASE doit utiliser http(s): ${base}`);
    }
    this.baseUrl = base;
    this.tierModels = { ...DEFAULT_TIER_MODELS, ...options.tierModels };
    this.timeoutMs = options.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
    // HTTP header values must be a ByteString (Latin-1, ≤ 255). Strip any
    // non-ASCII char (e.g. an em dash in the app title) so fetch() never throws.
    const asciiHeader = (value: string) => value.replace(/[^\x20-\x7E]/g, '-');
    this.extraHeaders = {
      ...(options.appUrl ? { 'HTTP-Referer': asciiHeader(options.appUrl) } : {}),
      ...(options.appTitle ? { 'X-Title': asciiHeader(options.appTitle) } : {}),
    };
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const model = this.tierModels[request.tier];
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });
    const data = await this.post(
      {
        model,
        messages,
        temperature: 0,
        max_tokens: request.maxTokens ?? 1024,
        ...(request.prefill ? { response_format: { type: 'json_object' } } : {}),
      },
      model,
    );
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      prefill: request.prefill,
      model: data.model ?? model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }

  async completeVision(request: LlmVisionRequest): Promise<LlmCompletion> {
    const model = this.tierModels[request.tier];
    const data = await this.post(
      {
        model,
        temperature: 0,
        max_tokens: request.maxTokens ?? 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: request.prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${request.mediaType};base64,${request.imageBase64}`,
                },
              },
            ],
          },
        ],
      },
      model,
    );
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model: data.model ?? model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }

  async completeVisionDoc(request: LlmVisionDocRequest): Promise<LlmCompletion> {
    const model = this.tierModels[request.tier];
    const userContent: Array<Record<string, unknown>> = [
      { type: 'text', text: request.prompt },
    ];
    for (const img of request.images) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      });
    }
    const messages: Array<{ role: string; content: unknown }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: userContent });
    const data = await this.post(
      {
        model,
        temperature: 0,
        max_tokens: request.maxTokens ?? 1024,
        messages,
        ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      },
      model,
    );
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model: data.model ?? model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }

  private async post(body: unknown, model: string): Promise<OpenAiChatResponse> {
    const log = new Logger('OpenRouterLlmClient');
    // Backoff schedule before attempts 2..N. Absorbs the transient 503
    // "model experiencing high demand" the free Gemini tier returns under load,
    // and short 429 rate-limit windows. Daily-quota exhaustion keeps failing
    // through all retries → surfaced as a normal failure (retried days later).
    const BACKOFF_MS = [0, 2_000, 5_000, 12_000];
    const RETRYABLE = new Set([429, 500, 502, 503, 504]);
    let lastDetail = '';
    for (let attempt = 1; attempt <= BACKOFF_MS.length; attempt++) {
      if (BACKOFF_MS[attempt - 1]! > 0) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]!));
      }
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            ...this.extraHeaders,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        lastDetail = (error as Error).message;
        if (attempt < BACKOFF_MS.length) {
          log.warn(`LLM network error (${model}) — retry ${attempt}/${BACKOFF_MS.length - 1}`);
          continue;
        }
        log.error(`LLM call failed (${model}): ${lastDetail}`);
        throw new ServiceUnavailableException(
          'Service IA momentanément indisponible — réessayer dans quelques instants',
        );
      }
      if (!res.ok) {
        lastDetail = await res.text().catch(() => '');
        if (RETRYABLE.has(res.status) && attempt < BACKOFF_MS.length) {
          log.warn(`LLM HTTP ${res.status} (${model}) — retry ${attempt}/${BACKOFF_MS.length - 1}`);
          continue;
        }
        log.error(`LLM HTTP ${res.status} (${model}): ${lastDetail.slice(0, 300)}`);
        throw new ServiceUnavailableException(
          `Service IA momentanément indisponible (HTTP ${res.status}) — réessayer dans quelques instants`,
        );
      }
      const data = (await res.json()) as OpenAiChatResponse;
      if (data.error) {
        const code = Number(data.error.code);
        if (RETRYABLE.has(code) && attempt < BACKOFF_MS.length) {
          log.warn(`LLM error ${code} (${model}) — retry ${attempt}/${BACKOFF_MS.length - 1}`);
          continue;
        }
        log.error(`LLM error (${model}): ${data.error.message ?? 'inconnue'}`);
        throw new ServiceUnavailableException(
          'Service IA momentanément indisponible — réessayer dans quelques instants',
        );
      }
      return data;
    }
    throw new ServiceUnavailableException(
      'Service IA momentanément indisponible — réessayer dans quelques instants',
    );
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

  async completeVision(request: LlmVisionRequest): Promise<LlmCompletion> {
    this.requests.push({ tier: request.tier, prompt: request.prompt });
    const text = this.queue.shift();
    if (text === undefined) throw new Error('FakeLlmClient queue exhausted');
    return {
      text,
      model: `fake-vision-${request.tier}`,
      inputTokens: 10,
      outputTokens: 10,
    };
  }

  async completeVisionDoc(request: LlmVisionDocRequest): Promise<LlmCompletion> {
    this.requests.push({ tier: request.tier, prompt: request.prompt, system: request.system });
    const text = this.queue.shift();
    if (text === undefined) throw new Error('FakeLlmClient queue exhausted');
    return {
      text,
      model: `fake-vision-doc-${request.tier}`,
      inputTokens: 10,
      outputTokens: 10,
    };
  }
}
