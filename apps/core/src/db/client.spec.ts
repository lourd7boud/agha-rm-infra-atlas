import { describe, expect, it } from 'vitest';
import { POOL_CONFIG } from './client';

/**
 * Regression guard for the 2026-07-02 production 504s: the pool ran with pg
 * defaults (max 10, wait-forever acquisition). When Postgres was CPU-starved,
 * dashboard requests queued on the pool indefinitely, the RSC render hung,
 * and nginx returned 504 after 180 s. These numbers are the fail-fast contract.
 */
describe('POOL_CONFIG', () => {
  it('caps connection acquisition wait so saturated pools fail fast instead of hanging renders', () => {
    expect(POOL_CONFIG.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(POOL_CONFIG.connectionTimeoutMillis).toBeLessThanOrEqual(10_000);
  });

  it('bounds server-side statement time so a runaway query cannot pin a connection', () => {
    expect(POOL_CONFIG.statement_timeout).toBeGreaterThan(0);
    expect(POOL_CONFIG.statement_timeout).toBeLessThanOrEqual(30_000);
  });

  it('sizes the pool for the 8-way dashboard burst without exceeding the Postgres budget', () => {
    // page.tsx fires 8 parallel queries per dashboard view; two concurrent
    // operators need >16. Core + worker together must stay well under
    // Postgres max_connections=100 (Keycloak shares the same instance).
    expect(POOL_CONFIG.max).toBeGreaterThanOrEqual(16);
    expect(POOL_CONFIG.max).toBeLessThanOrEqual(40);
  });

  it('keeps TCP keepalive on so half-dead connections are detected, not reused', () => {
    expect(POOL_CONFIG.keepAlive).toBe(true);
  });
});
