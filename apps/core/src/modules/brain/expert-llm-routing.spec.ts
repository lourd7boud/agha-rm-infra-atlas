import { describe, expect, test } from 'vitest';
import {
  AnthropicLlmClient,
  createChatLlmClientFromEnv,
  createExpertLlmClientFromEnv,
  GoogleLlmClient,
  isClaudeModel,
  OpenRouterLlmClient,
} from './llm.client';

/** Mirrors the real production env: default provider is Google (qcode /gemini),
 *  but the Anthropic path (LLM_API_KEY + LLM_API_BASE=…/api) is also configured
 *  for Claude models. This is exactly the setup that made the naive factory
 *  route a claude-* expert model onto /gemini/… → 404. */
const PROD_LIKE = {
  LLM_PROVIDER: 'google',
  OPENROUTER_API_KEY: 'or-key',
  OPENROUTER_API_BASE: 'https://api.qcode.cc',
  LLM_API_KEY: 'anthropic-key',
  LLM_API_BASE: 'https://api.qcode.cc/api',
} as unknown as NodeJS.ProcessEnv;

const withModel = (model: string, extra: Record<string, string> = {}) =>
  ({ ...PROD_LIKE, EXPERT_LLM_MODEL: model, ...extra }) as unknown as NodeJS.ProcessEnv;

describe('isClaudeModel', () => {
  test('recognises the Claude family (incl. fable/opus aliases)', () => {
    expect(isClaudeModel('claude-fable-5')).toBe(true);
    expect(isClaudeModel('claude-opus-4-8')).toBe(true);
    expect(isClaudeModel('fable-5')).toBe(true);
    expect(isClaudeModel('opus-4-8')).toBe(true);
    expect(isClaudeModel('gemini-2.5-pro')).toBe(false);
  });
});

describe('createExpertLlmClientFromEnv', () => {
  test('null when EXPERT_LLM_MODEL is unset', () => {
    expect(createExpertLlmClientFromEnv(PROD_LIKE)).toBeNull();
  });

  test('REGRESSION GUARD: a Claude model under LLM_PROVIDER=google routes to the Anthropic path, not Google', () => {
    expect(createExpertLlmClientFromEnv(withModel('claude-fable-5'))).toBeInstanceOf(
      AnthropicLlmClient,
    );
    expect(createExpertLlmClientFromEnv(withModel('claude-opus-4-8'))).toBeInstanceOf(
      AnthropicLlmClient,
    );
  });

  test('a Gemini expert model routes to the Google client', () => {
    expect(createExpertLlmClientFromEnv(withModel('gemini-2.5-pro'))).toBeInstanceOf(
      GoogleLlmClient,
    );
  });

  test('EXPERT_LLM_PROVIDER forces the client regardless of model family', () => {
    expect(
      createExpertLlmClientFromEnv(
        withModel('claude-opus-4-8', { EXPERT_LLM_PROVIDER: 'openrouter' }),
      ),
    ).toBeInstanceOf(OpenRouterLlmClient);
  });

  test('null when the routed provider has no usable key', () => {
    const env = {
      EXPERT_LLM_MODEL: 'claude-opus-4-8',
      EXPERT_LLM_PROVIDER: 'anthropic',
    } as unknown as NodeJS.ProcessEnv;
    expect(createExpertLlmClientFromEnv(env)).toBeNull();
  });
});

describe('createChatLlmClientFromEnv', () => {
  const withChat = (model: string, extra: Record<string, string> = {}) =>
    ({ ...PROD_LIKE, CHAT_LLM_MODEL: model, ...extra }) as unknown as NodeJS.ProcessEnv;

  test('null when CHAT_LLM_MODEL is unset → chat falls back to the default client', () => {
    expect(createChatLlmClientFromEnv(PROD_LIKE)).toBeNull();
  });

  test('claude-opus-4-8 under LLM_PROVIDER=google routes to the Anthropic path (reusing LLM_API_*)', () => {
    expect(createChatLlmClientFromEnv(withChat('claude-opus-4-8'))).toBeInstanceOf(
      AnthropicLlmClient,
    );
  });

  test('a dedicated CHAT_LLM_API_KEY/BASE still builds the Anthropic client', () => {
    const client = createChatLlmClientFromEnv(
      withChat('claude-opus-4-8', {
        CHAT_LLM_API_KEY: 'chat-key',
        CHAT_LLM_API_BASE: 'https://api.qcode.cc',
      }),
    );
    expect(client).toBeInstanceOf(AnthropicLlmClient);
  });

  test('CHAT_LLM_PROVIDER forces the client regardless of model family', () => {
    expect(
      createChatLlmClientFromEnv(
        withChat('claude-opus-4-8', { CHAT_LLM_PROVIDER: 'openrouter' }),
      ),
    ).toBeInstanceOf(OpenRouterLlmClient);
  });

  test('a Gemini chat model routes to the Google client', () => {
    expect(createChatLlmClientFromEnv(withChat('gemini-2.5-pro'))).toBeInstanceOf(
      GoogleLlmClient,
    );
  });

  test('null when the routed provider has no usable key', () => {
    const env = {
      CHAT_LLM_MODEL: 'claude-opus-4-8',
      CHAT_LLM_PROVIDER: 'anthropic',
    } as unknown as NodeJS.ProcessEnv;
    expect(createChatLlmClientFromEnv(env)).toBeNull();
  });
});
