import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/**
 * Fail-fast pool contract (see client.spec.ts). pg defaults wait FOREVER for
 * a free connection — when Postgres stalls, every request piles up behind the
 * pool, the HTTP handler never answers, and nginx 504s the operator at 180 s.
 * Bounded waits turn that into a fast 500 the web tier degrades gracefully.
 */
export const POOL_CONFIG = {
  /** 8 parallel dashboard queries per operator view; 20 covers two operators
   *  plus jobs while core+worker stay well under Postgres max_connections=100. */
  max: 20,
  /** Give up on acquiring a pooled connection after 10 s instead of queueing. */
  connectionTimeoutMillis: 10_000,
  /** Server-side kill for runaway statements (migrations run out-of-process). */
  statement_timeout: 30_000,
  /** Recycle idle connections so a burst doesn't hold 20 slots for hours. */
  idleTimeoutMillis: 30_000,
  /** Detect half-dead sockets (observed as "Connection terminated unexpectedly"). */
  keepAlive: true,
} as const;

export function createDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, ...POOL_CONFIG });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

let cached: Db | null = null;

/** Process-wide singleton so every module shares one connection pool. */
export function getDb(databaseUrl: string): Db {
  cached ??= createDb(databaseUrl);
  return cached;
}
