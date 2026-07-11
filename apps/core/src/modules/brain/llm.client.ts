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
  /** Gemini controlled-generation schema (OpenAPI-subset). When set, the Google
   *  client forces the response to this exact shape — required for inputs that
   *  look like key:value pairs, which Gemini otherwise echoes back as JSON
   *  instead of following the prompt. Ignored by Anthropic/OpenRouter clients
   *  (they steer via prefill / response_format). */
  responseSchema?: Record<string, unknown>;
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
  /** Gemini controlled-generation schema (see LlmRequest.responseSchema). */
  responseSchema?: Record<string, unknown>;
}

/** Per-chunk event of a streaming completion. `delta` carries new text appended
 *  to the assistant's response as it generates; `finish` arrives exactly once,
 *  last, with the model + final token counts (so callers can log + bill). */
export type LlmStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'finish'; model: string; inputTokens: number; outputTokens: number };

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmCompletion>;
  /** OPTIONAL streaming variant — yields delta chunks as they arrive then a
   *  final `finish` event. Providers that implement this enable token-by-token
   *  UX on /chat. When undefined, the chat service falls back to `complete()`
   *  and emits one big delta + finish to keep the SSE protocol uniform. */
  streamComplete?(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
  /** Vision read of a single image (scanned notices, plans…) → text. */
  completeVision(request: LlmVisionRequest): Promise<LlmCompletion>;
  /** Multi-image document read (scanned DCE pages) → structured answer. The
   *  model does OCR + layout understanding + extraction in ONE call, which is
   *  both faster (no local CPU OCR) and higher quality on scans/tables than
   *  tesseract→text→LLM. */
  completeVisionDoc(request: LlmVisionDocRequest): Promise<LlmCompletion>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');

/** DI token for the per-tender chat's DEDICATED strong client (see
 *  createChatLlmClientFromEnv). Separate from LLM_CLIENT so the chat can run on a
 *  top model (Opus) while extraction/enrichment stay on the fast/cheap one. */
export const CHAT_LLM_CLIENT = Symbol('CHAT_LLM_CLIENT');

/** Default model for the per-tender chat when CHAT_LLM_MODEL is left unset —
 *  the strong Anthropic model, routed over the Anthropic Messages path. */
export const DEFAULT_CHAT_MODEL = 'claude-opus-4-8';

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

  /** Streams an Anthropic completion via the SDK's `messages.stream` API,
   *  mapping each `content_block_delta` (text-delta type) to our `delta` event
   *  and emitting a single `finish` once the stream resolves. Errors before the
   *  first byte (auth/quota/timeout) surface as ServiceUnavailableException —
   *  same as `complete()` — so the controller can return a clean HTTP code
   *  before any SSE bytes are written. */
  async *streamComplete(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const model = this.tierModels[request.tier];
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: request.prompt },
    ];
    if (request.prefill) {
      messages.push({ role: 'assistant', content: request.prefill });
    }
    let stream: ReturnType<Anthropic['messages']['stream']>;
    try {
      stream = this.client.messages.stream({
        model,
        max_tokens: request.maxTokens ?? 1024,
        temperature: 0,
        system: request.system,
        messages,
      });
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      new Logger('LlmClient').error(
        `LLM stream call failed (${model}): ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        `Service IA momentanément indisponible${status ? ` (HTTP ${status})` : ''} — réessayer dans quelques instants`,
      );
    }
    try {
      for await (const ev of stream) {
        if (
          ev.type === 'content_block_delta' &&
          ev.delta.type === 'text_delta' &&
          ev.delta.text
        ) {
          yield { type: 'delta', text: ev.delta.text };
        }
      }
      const final = await stream.finalMessage();
      yield {
        type: 'finish',
        model: final.model,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      };
    } catch (error) {
      // Mid-stream provider failures bubble — the controller logs them; the
      // browser has already received SSE prelude and will show whatever bytes
      // arrived. Don't translate to 503 here (headers are already flushed).
      new Logger('LlmClient').warn(
        `LLM stream mid-error (${model}): ${(error as Error).message}`,
      );
      throw error;
    }
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

export interface GoogleClientOptions {
  apiKey: string;
  /** Base URL up to (NOT including) the Gemini path. For qcode:
   *  https://api.qcode.cc → calls /gemini/v1beta/models/<model>:generateContent.
   *  For Google direct: https://generativelanguage.googleapis.com → /v1beta/... */
  baseUrl: string;
  tierModels?: Partial<Record<LlmTier, string>>;
  timeoutMs?: number;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
}

const GEMINI_DEFAULT_TIER_MODELS: Record<LlmTier, string> = {
  T1: 'gemini-2.5-flash-lite',
  T2: 'gemini-2.5-flash',
  T3: 'gemini-2.5-pro',
};

/** qcode returns a 200 "upstream busy" fallback (Chinese) with ~0 tokens under
 *  load — detect it so we retry instead of persisting garbage. */
const QCODE_BUSY = /(上游暂时繁忙|msg_fallback|稍后重试)/;

/**
 * Google Gemini client speaking the native generateContent protocol. Used both
 * for Google AI Studio direct AND for the qcode gateway (which exposes Gemini
 * only on /gemini/v1beta/...:generateContent, NOT the OpenAI/Anthropic paths).
 * Vision = inline_data image parts; retries 503/429/5xx + the qcode busy fallback.
 */
export class GoogleLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly tierModels: Record<LlmTier, string>;
  private readonly timeoutMs: number;
  private readonly log = new Logger('GoogleLlmClient');

  constructor(options: GoogleClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tierModels = { ...GEMINI_DEFAULT_TIER_MODELS, ...options.tierModels };
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: {
        temperature: 0,
        // NOTE: do NOT disable Gemini 2.5 "thinking" here — the dossier
        // extraction (find budget/caution/BPU in a long DCE) regressed to
        // all-nulls / invalid output with thinkingBudget:0. Thinking stays on.
        maxOutputTokens: request.maxTokens ?? 1024,
        ...(request.responseSchema
          ? { responseMimeType: 'application/json', responseSchema: request.responseSchema }
          : request.prefill
            ? { responseMimeType: 'application/json' }
            : {}),
      },
    };
    if (request.system) body.system_instruction = { parts: [{ text: request.system }] };
    const model = this.tierModels[request.tier];
    return this.toCompletion(await this.post(model, body), model, request.prefill);
  }

  async completeVision(request: LlmVisionRequest): Promise<LlmCompletion> {
    const model = this.tierModels[request.tier];
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: request.mediaType, data: request.imageBase64 } },
            { text: request.prompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: request.maxTokens ?? 1024,
      },
    };
    return this.toCompletion(await this.post(model, body), model);
  }

  async completeVisionDoc(request: LlmVisionDocRequest): Promise<LlmCompletion> {
    const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
    for (const img of request.images) {
      parts.push({ inline_data: { mime_type: img.mediaType, data: img.base64 } });
    }
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: request.maxTokens ?? 1024,
        ...(request.responseSchema
          ? { responseMimeType: 'application/json', responseSchema: request.responseSchema }
          : request.jsonMode
            ? { responseMimeType: 'application/json' }
            : {}),
      },
    };
    if (request.system) body.system_instruction = { parts: [{ text: request.system }] };
    const model = this.tierModels[request.tier];
    return this.toCompletion(await this.post(model, body), model);
  }

  private toCompletion(data: GeminiResponse, model: string, prefill?: string): LlmCompletion {
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
    return {
      text,
      prefill,
      model,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  private async post(model: string, body: unknown): Promise<GeminiResponse> {
    const url = `${this.baseUrl}/gemini/v1beta/models/${model}:generateContent`;
    const BACKOFF_MS = [0, 2_000, 5_000, 12_000];
    const RETRYABLE = new Set([429, 500, 502, 503, 504]);
    for (let attempt = 1; attempt <= BACKOFF_MS.length; attempt++) {
      if (BACKOFF_MS[attempt - 1]! > 0) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]!));
      }
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (attempt < BACKOFF_MS.length) {
          this.log.warn(`Gemini network error (${model}) — retry ${attempt}/${BACKOFF_MS.length - 1}`);
          continue;
        }
        this.log.error(`Gemini call failed (${model}): ${(error as Error).message}`);
        throw new ServiceUnavailableException(
          'Service IA momentanément indisponible — réessayer dans quelques instants',
        );
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        if (RETRYABLE.has(res.status) && attempt < BACKOFF_MS.length) {
          this.log.warn(`Gemini HTTP ${res.status} (${model}) — retry ${attempt}/${BACKOFF_MS.length - 1}`);
          continue;
        }
        this.log.error(`Gemini HTTP ${res.status} (${model}): ${detail.slice(0, 300)}`);
        throw new ServiceUnavailableException(
          `Service IA momentanément indisponible (HTTP ${res.status}) — réessayer dans quelques instants`,
        );
      }
      const data = (await res.json()) as GeminiResponse;
      if (data.error) {
        const code = Number(data.error.code);
        // Gateways (qcode) often return 200 with a transient error body and NO
        // numeric code: "Service temporarily unavailable", "Internal server
        // error", "overloaded". Treat those as retryable too.
        const transient =
          RETRYABLE.has(code) ||
          /temporarily unavailable|internal server error|overload|try again|busy|繁忙/i.test(
            data.error.message ?? '',
          );
        if (transient && attempt < BACKOFF_MS.length) {
          this.log.warn(
            `Gemini error "${data.error.message ?? code}" (${model}) — retry ${attempt}/${BACKOFF_MS.length - 1}`,
          );
          continue;
        }
        this.log.error(`Gemini error (${model}): ${data.error.message ?? 'inconnue'}`);
        throw new ServiceUnavailableException(
          'Service IA momentanément indisponible — réessayer dans quelques instants',
        );
      }
      // qcode 200 "upstream busy" fallback (no real tokens) → retry.
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      if (QCODE_BUSY.test(text) && (data.usageMetadata?.promptTokenCount ?? 0) === 0) {
        if (attempt < BACKOFF_MS.length) {
          this.log.warn(`gateway busy fallback (${model}) — retry ${attempt}/${BACKOFF_MS.length - 1}`);
          continue;
        }
        throw new ServiceUnavailableException(
          'Service IA momentanément surchargé — réessayer dans quelques instants',
        );
      }
      return data;
    }
    throw new ServiceUnavailableException(
      'Service IA momentanément indisponible — réessayer dans quelques instants',
    );
  }
}

/**
 * Single source of truth for selecting the LLM provider from env, used by both
 * the Nest DI factory and the standalone CLI scripts. Precedence:
 *   LLM_PROVIDER=google → GoogleLlmClient (Gemini native / qcode gateway)
 *   OPENROUTER_API_KEY  → OpenRouterLlmClient (OpenAI protocol)
 *   LLM_API_KEY         → AnthropicLlmClient (Anthropic Messages)
 */
export function createLlmClientFromEnv(): LlmClient | null {
  const env = process.env;
  const tiers = (model: string): Record<LlmTier, string> => ({
    T1: model,
    T2: env.OPENROUTER_MODEL_T2 ?? model,
    T3: env.OPENROUTER_MODEL_T3 ?? model,
  });

  if (env.LLM_PROVIDER?.toLowerCase() === 'google' && env.OPENROUTER_API_KEY) {
    const model = env.OPENROUTER_MODEL ?? 'gemini-2.5-flash-lite';
    return new GoogleLlmClient({
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_API_BASE ?? 'https://generativelanguage.googleapis.com',
      tierModels: tiers(model),
    });
  }
  if (env.OPENROUTER_API_KEY) {
    const model = env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash';
    return new OpenRouterLlmClient({
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_API_BASE,
      tierModels: tiers(model),
      appUrl: env.PUBLIC_WEB_URL ?? 'https://atlas.marocinfra.com',
      appTitle: 'ATLAS - AGHA RM INFRA',
    });
  }
  if (env.LLM_API_KEY) {
    return new AnthropicLlmClient({
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_API_BASE,
      tierModels: {
        ...(env.LLM_MODEL_T1 ? { T1: env.LLM_MODEL_T1 } : {}),
        ...(env.LLM_MODEL_T2 ? { T2: env.LLM_MODEL_T2 } : {}),
        ...(env.LLM_MODEL_T3 ? { T3: env.LLM_MODEL_T3 } : {}),
      },
    });
  }
  return null;
}

/** Claude-family model ids speak the Anthropic Messages protocol, NOT the Gemini
 *  generateContent path — a claude-* model sent to GoogleLlmClient 404s. */
const CLAUDE_MODEL_RE = /^(claude|fable|opus|sonnet|haiku)/i;
export function isClaudeModel(model: string): boolean {
  return CLAUDE_MODEL_RE.test(model);
}

type ExpertProvider = 'anthropic' | 'google' | 'openrouter';

/**
 * Resolves which provider protocol a dedicated (expert/chat) client must speak
 * for `model`. Precedence: an explicit override (EXPERT_/CHAT_LLM_PROVIDER) wins;
 * otherwise route by MODEL FAMILY — a Claude model ALWAYS goes over the Anthropic
 * Messages path even when the default provider is Google (else claude-* hits the
 * /gemini path and 404s); a gemini-* model over the Google path; an unknown
 * family mirrors the default provider selection. Shared by the expert and chat
 * factories so both route identically.
 */
function resolveProviderForModel(
  model: string,
  env: NodeJS.ProcessEnv,
  explicitProvider?: string,
): ExpertProvider {
  const explicit = explicitProvider?.toLowerCase();
  if (explicit === 'anthropic' || explicit === 'google' || explicit === 'openrouter') {
    return explicit;
  }
  if (isClaudeModel(model)) return 'anthropic';
  if (/gemini/i.test(model)) return 'google';
  if (env.LLM_PROVIDER?.toLowerCase() === 'google' && env.OPENROUTER_API_KEY) {
    return 'google';
  }
  if (env.OPENROUTER_API_KEY) return 'openrouter';
  return 'anthropic';
}

function expertProvider(model: string, env: NodeJS.ProcessEnv): ExpertProvider {
  return resolveProviderForModel(model, env, env.EXPERT_LLM_PROVIDER);
}

/**
 * Selects the EXPERT agent's dedicated TOP-TIER client from env. The model is
 * explicit (EXPERT_LLM_MODEL) and forced onto T2+T3 — the tiers the expert uses.
 * Unlike the default client, the provider is inferred from the MODEL FAMILY, so
 * EXPERT_LLM_MODEL=claude-fable-5 / claude-opus-4-8 always speaks the Anthropic
 * Messages protocol (LLM_API_KEY + LLM_API_BASE, e.g. the qcode gateway) even
 * when LLM_PROVIDER=google — otherwise a claude-* model hits /gemini/... and 404s.
 * Overridable via EXPERT_LLM_PROVIDER / EXPERT_LLM_API_KEY / EXPERT_LLM_API_BASE.
 * Returns null when EXPERT_LLM_MODEL is unset (the service uses the default client).
 */
export function createExpertLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LlmClient | null {
  const model = env.EXPERT_LLM_MODEL;
  if (!model) return null;
  const tierModels: Partial<Record<LlmTier, string>> = { T2: model, T3: model };
  const provider = expertProvider(model, env);

  if (provider === 'anthropic') {
    const apiKey = env.EXPERT_LLM_API_KEY ?? env.LLM_API_KEY ?? env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    return new AnthropicLlmClient({
      apiKey,
      baseUrl: env.EXPERT_LLM_API_BASE ?? env.LLM_API_BASE,
      tierModels,
    });
  }
  if (provider === 'openrouter') {
    const apiKey = env.EXPERT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    return new OpenRouterLlmClient({
      apiKey,
      baseUrl: env.EXPERT_LLM_API_BASE ?? env.OPENROUTER_API_BASE,
      tierModels,
      appUrl: env.PUBLIC_WEB_URL ?? 'https://atlas.marocinfra.com',
      appTitle: 'ATLAS - AGHA RM INFRA (expert)',
    });
  }
  // google
  const apiKey = env.EXPERT_LLM_API_KEY ?? env.OPENROUTER_API_KEY ?? env.LLM_API_KEY;
  if (!apiKey) return null;
  return new GoogleLlmClient({
    apiKey,
    baseUrl:
      env.EXPERT_LLM_API_BASE ??
      env.OPENROUTER_API_BASE ??
      'https://generativelanguage.googleapis.com',
    tierModels,
  });
}

/**
 * Selects the per-tender chat's DEDICATED client. The chat (TenderChatService) is
 * a low-volume, high-value surface where the fast/cheap extraction model reads
 * poorly (identity drift, shallow analysis), so it runs on a STRONG model —
 * default `claude-opus-4-8` over the Anthropic Messages path (qcode gateway).
 *
 * Enabled only when CHAT_LLM_MODEL is set (mirrors the expert's opt-in): unset →
 * returns null and the chat falls back to the default extraction client. ALL
 * tiers are pinned to the chat model because the chat calls tier 'T1'. Provider
 * is inferred from the MODEL FAMILY (Claude → Anthropic path even under
 * LLM_PROVIDER=google), overridable via CHAT_LLM_PROVIDER. Credentials fall back
 * CHAT_* → LLM_* → OPENROUTER_* so a single gateway key (e.g. qcode) serves it
 * without a second credential; set CHAT_LLM_API_KEY/CHAT_LLM_API_BASE to bill it
 * to a dedicated key. Returns null (→ safe fallback) when no key is resolvable.
 */
export function createChatLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LlmClient | null {
  const model = env.CHAT_LLM_MODEL;
  if (!model) return null;
  const tierModels: Record<LlmTier, string> = { T1: model, T2: model, T3: model };
  const provider = resolveProviderForModel(model, env, env.CHAT_LLM_PROVIDER);

  if (provider === 'anthropic') {
    const apiKey = env.CHAT_LLM_API_KEY ?? env.LLM_API_KEY ?? env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    return new AnthropicLlmClient({
      apiKey,
      baseUrl: env.CHAT_LLM_API_BASE ?? env.LLM_API_BASE,
      tierModels,
    });
  }
  if (provider === 'openrouter') {
    const apiKey = env.CHAT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    return new OpenRouterLlmClient({
      apiKey,
      baseUrl: env.CHAT_LLM_API_BASE ?? env.OPENROUTER_API_BASE,
      tierModels,
      appUrl: env.PUBLIC_WEB_URL ?? 'https://atlas.marocinfra.com',
      appTitle: 'ATLAS - AGHA RM INFRA (chat)',
    });
  }
  // google
  const apiKey = env.CHAT_LLM_API_KEY ?? env.OPENROUTER_API_KEY ?? env.LLM_API_KEY;
  if (!apiKey) return null;
  return new GoogleLlmClient({
    apiKey,
    baseUrl:
      env.CHAT_LLM_API_BASE ??
      env.OPENROUTER_API_BASE ??
      'https://generativelanguage.googleapis.com',
    tierModels,
  });
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

  /** Streams the next queued response as 3 deterministic chunks + finish, so
   *  the chat-service stream tests are stable without timing assumptions. */
  async *streamComplete(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    this.requests.push(request);
    const text = this.queue.shift();
    if (text === undefined) throw new Error('FakeLlmClient queue exhausted');
    // Split into 3 roughly-equal parts. Keep order deterministic for tests.
    const third = Math.max(1, Math.ceil(text.length / 3));
    for (let i = 0; i < text.length; i += third) {
      yield { type: 'delta', text: text.slice(i, i + third) };
    }
    yield {
      type: 'finish',
      model: `fake-${request.tier}`,
      inputTokens: 10,
      outputTokens: 10,
    };
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
