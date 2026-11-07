import { describe, expect, it, vi } from 'vitest';
import { InMemoryObjectStorage } from './storage';
import { InMemoryVaultRepository } from './vault.repository';
import { createObjectStorage, createVaultRepository } from './vault.module';

describe('VaultModule persistence policy', () => {
  it('refuses non-persistent metadata storage in production', () => {
    expect(() =>
      createVaultRepository({ nodeEnv: 'production', databaseUrl: undefined }),
    ).toThrow('DATABASE_URL is required for Vault in production');
  });

  it('refuses non-persistent object storage in production', () => {
    expect(() => createObjectStorage({ nodeEnv: 'production' })).toThrow(
      'S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY are required for Vault in production',
    );
  });

  it('keeps explicit in-memory fallbacks for tests and local development', () => {
    expect(
      createVaultRepository({ nodeEnv: 'test', warn: vi.fn() }),
    ).toBeInstanceOf(InMemoryVaultRepository);
    expect(createObjectStorage({ nodeEnv: 'test', warn: vi.fn() })).toBeInstanceOf(
      InMemoryObjectStorage,
    );
  });
});
