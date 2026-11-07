import { describe, expect, it, vi } from 'vitest';
import { createPortalRepository } from './portal.module';
import {
  DrizzlePortalRepository,
  InMemoryPortalRepository,
} from './portal.repository';

describe('PortalModule persistence policy', () => {
  it('fails closed in production when DATABASE_URL is missing', () => {
    expect(() =>
      createPortalRepository({ nodeEnv: 'production', databaseUrl: undefined }),
    ).toThrow('DATABASE_URL is required for portal reconciliation in production');
  });

  it('allows explicit in-memory storage outside production', () => {
    const warn = vi.fn();
    const repository = createPortalRepository({ nodeEnv: 'test', warn });

    expect(repository).toBeInstanceOf(InMemoryPortalRepository);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('uses PostgreSQL whenever DATABASE_URL is configured', () => {
    const repository = createPortalRepository({
      nodeEnv: 'production',
      databaseUrl: 'postgresql://atlas:atlas@localhost:5432/atlas',
    });

    expect(repository).toBeInstanceOf(DrizzlePortalRepository);
  });
});
