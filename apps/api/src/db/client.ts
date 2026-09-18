import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config/index.js';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;
/** A database handle inside a transaction. Services accept either. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

let pool: pg.Pool | null = null;
let db: Database | null = null;

/**
 * Postgres returns `numeric` and `int8` as strings by default to avoid silent
 * precision loss. We keep that for `numeric` (inventory quantities are parsed
 * deliberately) but read `int8` as a number, because every bigint we store is a
 * money amount in minor units, which is far inside Number.MAX_SAFE_INTEGER.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
/** `date` columns are civil dates; hand them back as `YYYY-MM-DD`, never a Date. */
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: config().DATABASE_URL,
    max: config().DATABASE_POOL_MAX,
    // A family app has no long-running queries; failing fast beats hanging.
    statement_timeout: 15_000,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

export function getDb(): Database {
  db ??= drizzle(getPool(), { schema, casing: 'snake_case' });
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}

export { schema };
