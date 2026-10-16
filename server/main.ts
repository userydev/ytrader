import { loadConfig } from './config.js';
import { poolFor } from './db.js';
import { createApp } from './app.js';
const config = loadConfig();
const pool = poolFor(config.databaseUrl);
const app = await createApp(pool,config);
app.addHook('onClose',async () => { await pool.end(); });
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,() => { void app.close(); });
await app.listen({ host: config.host, port: config.port });
