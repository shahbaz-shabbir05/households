/**
 * Loads a `.env` file into `process.env` for local development and tests.
 *
 * Uses Node's built-in loader — no dotenv dependency. Values already present in
 * the real environment win, which is what production deployments rely on.
 * Import this before reading config.
 */
import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

export function loadEnvFile(cwd = process.cwd()): void {
  if (loaded) return;
  loaded = true;

  const envName = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  for (const candidate of [path.join(cwd, envName), path.join(cwd, '.env')]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      // A malformed or unreadable .env must not take the process down; config
      // validation will report whatever is actually missing.
    }
    return;
  }
}
