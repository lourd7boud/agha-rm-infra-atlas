import { afterEach, expect, test, vi } from 'vitest';
import {
  AnthropicLlmClient,
  createChatLlmClientFromEnv,
  createExpertLlmClientFromEnv,
  createLlmClientFromEnv,
  GoogleLlmClient,
} from './llm.client';

afterEach(() => vi.unstubAllEnvs());

function configureLegacyGemini(enabled: string | undefined) {
  vi.stubEnv('DEFAULT_LLM_ENABLED', enabled);
  vi.stubEnv('LLM_PROVIDER', 'google');
  vi.stubEnv('OPENROUTER_API_KEY', 'unused-test-key');
  vi.stubEnv('LLM_API_KEY', 'unused-test-key');
}

test.each(['false', ' FALSE '])('does not activate a default provider when explicitly disabled: %s', (enabled) => {
  configureLegacyGemini(enabled);
  expect(createLlmClientFromEnv()).toBeNull();
});

test('preserves the existing default route when the switch is absent', () => {
  configureLegacyGemini(undefined);
  expect(createLlmClientFromEnv()).toBeInstanceOf(GoogleLlmClient);
});

test('disabling default extraction keeps explicitly configured Claude clients available', () => {
  const env = {
    DEFAULT_LLM_ENABLED: 'false', LLM_PROVIDER: 'google',
    OPENROUTER_API_KEY: 'unused-test-key', LLM_API_KEY: 'unused-test-key',
    CHAT_LLM_MODEL: 'claude-opus-4-8', EXPERT_LLM_MODEL: 'claude-opus-4-8',
  };
  expect(createChatLlmClientFromEnv(env)).toBeInstanceOf(AnthropicLlmClient);
  expect(createExpertLlmClientFromEnv(env)).toBeInstanceOf(AnthropicLlmClient);
});
