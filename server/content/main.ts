import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { poolFor } from '../db.js';
import { createContentApp } from './app.js';
import { migrateContent } from './migrate.js';
export async function startContentServer() {
  const config = loadConfig();
  const pool = poolFor(config.databaseUrl);
  try {
    await migrateContent(pool);
    const app = await createContentApp(pool, config);
    app.addHook('onClose', async () => { await pool.end(); });
    await app.listen({ host: config.host, port: config.port });
    return app;
  } catch {
    await pool.end();
    throw new Error('Content API startup failed; check host configuration and migrations');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startContentServer().catch(() => { console.error('Content API startup failed'); process.exitCode = 1; });
}
