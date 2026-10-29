import { buildApp } from './app.js';
import { config } from './config/index.js';
import { closeDb } from './db/client.js';
import { createJobRunner } from './jobs/index.js';

async function main(): Promise<void> {
  const cfg = config();
  const { app, container } = await buildApp();

  const jobs = cfg.JOBS_ENABLED ? createJobRunner(container, app.log) : null;
  jobs?.start();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    jobs?.stop();
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: cfg.PORT, host: cfg.HOST });
}

main().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
