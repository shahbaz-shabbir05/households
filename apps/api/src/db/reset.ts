/**
 * Drops and recreates the public schema, then re-applies migrations.
 * Development only — it refuses to run against a production database.
 */
import { sql } from 'drizzle-orm';
import { config } from '../config/index.js';
import { closeDb, getDb } from './client.js';
import { runMigrations } from './migrate.js';

async function reset(): Promise<void> {
  if (config().NODE_ENV === 'production') {
    throw new Error('db:reset refuses to run in production');
  }

  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  // Drizzle keeps its migration journal in its own schema. Dropping only
  // `public` leaves the journal claiming every migration is applied, so the
  // migrator does nothing and the database comes back empty.
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations();
  console.log('Database reset and migrated.');
}

reset()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error('Reset failed:', error);
    await closeDb();
    process.exit(1);
  });
