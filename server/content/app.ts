import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { Pool } from '../db.js';
// Compatibility export for the content server entry; createApp owns registration.
export async function createContentApp(pool: Pool, config: Config) {
  return createApp(pool, config);
}
