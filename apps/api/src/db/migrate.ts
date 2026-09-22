/**
 * Applies pending migrations. Run as a release step *before* the new version
 * starts serving (docs/14).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from './client.js';

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder });
}

// Only run when invoked directly, so tests can import `runMigrations`.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied.');
      return closeDb();
    })
    .catch(async (error) => {
      console.error('Migration failed:', error);
      await closeDb();
      process.exit(1);
    });
}
