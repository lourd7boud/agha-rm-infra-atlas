import { afterEach, describe, expect, test, vi } from 'vitest';
import { OpenRouterLlmClient } from './llm.client';

interface MockInit {
  ok?: boolean;
  status?: number;
}

interface MockReqInit {
  body: string;
  method: string;
  headers: Record<string, string>;
}

function mockFetch(response: unknown, init: MockInit = {}) {
  const fn = vi.fn(async (_url: string, _init: MockReqInit) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => response,
    text: async () => JSON.stringify(response),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function bodyOf(fn: ReturnType<typeof mockFetch>, call = 0): Record<string, unknown> {
  const args = fn.mock.calls[call]!;
  return JSON.parse(args[1].body) as Record<string, unknown>;
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenRouterLlmClient', () => {
  test('posts an OpenAI-style request and maps the response', async () => {
    const fn = mockFetch({
      choices: [{ message: { content: '{"ok":true}' } }],
      model: 'google/gemini-2.5-flash',
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    });
    const client = new OpenRouterLlmClient({
      apiKey: 'sk-test',
      tierModels: { T1: 'google/gemini-2.5-flash' },
    });

    const out = await client.complete({
      tier: 'T1',
      prompt: 'salut',
      system: 'sys',
      prefill: '{',
    });

    expect(out.text).toBe('{"ok":true}');
    expect(out.model).toBe('google/gemini-2.5-flash');
    expect(out.inputTokens).toBe(12);
    expect(out.outputTokens).toBe(7);
    expect(out.prefill).toBe('{');

    const args = fn.mock.calls[0]!;
    expect(args[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(args[1].method).toBe('POST');
    expect(args[1].headers.Authorization).toBe('Bearer sk-test');

    const body = bodyOf(fn);
    expect(body.model).toBe('google/gemini-2.5-flash');
    expect(body.temperature).toBe(0);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'salut' },
    ]);
    // A prefill request forces a JSON object (OpenAI protocol can't continue).
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  test('omits response_format when there is no prefill', async () => {
    const fn = mockFetch({
      choices: [{ message: { content: 'hi' } }],
      model: 'm',
      usage: {},
    });
    const client = new OpenRouterLlmClient({ apiKey: 'k' });
    await client.complete({ tier: 'T1', prompt: 'x' });
    expect(bodyOf(fn).response_format).toBeUndefined();
  });

  test('maps an HTTP failure to a 503-style error', async () => {
    mockFetch({ error: { message: 'rate limited' } }, { ok: false, status: 429 });
    const client = new OpenRouterLlmClient({ apiKey: 'k' });
    await expect(client.complete({ tier: 'T1', prompt: 'x' })).rejects.toThrow(
      /indisponible/i,
    );
  });

  test('maps a JSON-body error to a 503-style error', async () => {
    mockFetch({ error: { message: 'no endpoints', code: 404 } });
    const client = new OpenRouterLlmClient({ apiKey: 'k' });
    await expect(client.complete({ tier: 'T1', prompt: 'x' })).rejects.toThrow(
      /indisponible/i,
    );
  });

  test('completeVision sends an image_url data URL', async () => {
    const fn = mockFetch({
      choices: [{ message: { content: 'desc' } }],
      model: 'm',
      usage: {},
    });
    const client = new OpenRouterLlmClient({ apiKey: 'k' });
    const out = await client.completeVision({
      tier: 'T1',
      imageBase64: 'AAAA',
      mediaType: 'image/png',
      prompt: 'lis',
    });
    expect(out.text).toBe('desc');
    const body = bodyOf(fn) as {
      messages: Array<{ content: Array<{ image_url?: { url: string } }> }>;
    };
    expect(body.messages[0]!.content[1]!.image_url!.url).toBe(
      'data:image/png;base64,AAAA',
    );
  });

  test('sanitises non-ASCII header values (em dash) so fetch cannot throw', async () => {
    const fn = mockFetch({ choices: [{ message: { content: 'x' } }], model: 'm', usage: {} });
    const client = new OpenRouterLlmClient({
      apiKey: 'k',
      appTitle: 'ATLAS — AGHA RM INFRA', // contains U+2014 em dash (> 255)
      appUrl: 'https://atlas.marocinfra.com',
    });
    await client.complete({ tier: 'T1', prompt: 'x' });
    const init = fn.mock.calls[0]![1] as unknown as {
      headers: Record<string, string>;
    };
    expect(init.headers['X-Title']).toBe('ATLAS - AGHA RM INFRA');
    // Every header byte must be Latin-1 representable.
    for (const value of Object.values(init.headers)) {
      expect([...value].every((c) => c.charCodeAt(0) <= 255)).toBe(true);
    }
  });

  test('rejects a non-http(s) or malformed base URL at construction', () => {
    expect(() => new OpenRouterLlmClient({ apiKey: 'k', baseUrl: 'ftp://evil/api' })).toThrow(
      /OPENROUTER_API_BASE/,
    );
    expect(() => new OpenRouterLlmClient({ apiKey: 'k', baseUrl: 'pas une url' })).toThrow(
      /OPENROUTER_API_BASE/,
    );
  });

  test('honours a custom baseUrl and strips trailing slashes', async () => {
    const fn = mockFetch({ choices: [{ message: { content: 'x' } }], model: 'm', usage: {} });
    const client = new OpenRouterLlmClient({
      apiKey: 'k',
      baseUrl: 'https://gw.example/api/v1/',
    });
    await client.complete({ tier: 'T1', prompt: 'x' });
    expect(fn.mock.calls[0]![0]).toBe('https://gw.example/api/v1/chat/completions');
  });
});
