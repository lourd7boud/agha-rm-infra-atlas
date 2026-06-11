import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function createDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;

let cached: Db | null = null;

/** Process-wide singleton so every module shares one connection pool. */
export function getDb(databaseUrl: string): Db {
  cached ??= createDb(databaseUrl);
  return cached;
}
