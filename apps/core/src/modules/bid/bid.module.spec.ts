import { describe, expect, it, vi } from 'vitest';
import {
  DrizzleBidWorkspaceRepository,
  InMemoryBidWorkspaceRepository,
} from './bid.repository';
import { createBidSigningRepository, createBidWorkspaceRepository } from './bid.module';
import {
  DrizzleBidSigningRepository,
  InMemoryBidSigningRepository,
} from './bid-signing.repository';

describe('BidModule persistence policy', () => {
  it('fails closed in production when DATABASE_URL is missing', () => {
    expect(() =>
      createBidWorkspaceRepository({ nodeEnv: 'production', databaseUrl: undefined }),
    ).toThrow('DATABASE_URL is required for bid workspaces in production');
  });

  it('uses in-memory storage only outside production when the database is absent', () => {
    const repository = createBidWorkspaceRepository({
      nodeEnv: 'test',
      databaseUrl: undefined,
      warn: vi.fn(),
    });
    expect(repository).toBeInstanceOf(InMemoryBidWorkspaceRepository);
  });

  it('uses PostgreSQL whenever DATABASE_URL is configured', () => {
    const repository = createBidWorkspaceRepository({
      nodeEnv: 'production',
      databaseUrl: 'postgresql://atlas:atlas@localhost:5432/atlas',
    });
    expect(repository).toBeInstanceOf(DrizzleBidWorkspaceRepository);
  });

  it('applies the same fail-closed policy to signing tasks', () => {
    expect(() =>
      createBidSigningRepository({ nodeEnv: 'production', databaseUrl: undefined }),
    ).toThrow('DATABASE_URL is required for bid signing in production');
    expect(
      createBidSigningRepository({ nodeEnv: 'test', warn: vi.fn() }),
    ).toBeInstanceOf(InMemoryBidSigningRepository);
    expect(
      createBidSigningRepository({
        nodeEnv: 'production',
        databaseUrl: 'postgresql://atlas:atlas@localhost:5432/atlas',
      }),
    ).toBeInstanceOf(DrizzleBidSigningRepository);
  });
});
