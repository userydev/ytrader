import { open } from 'node:fs/promises';
import type { ContentBundle } from '../../src/content/types.js';
import { pathToFileURL } from 'node:url';
import { poolFor } from '../db.js';
import { migrateContent } from './migrate.js';
import { parseBundleJSON, MAX_BUNDLE_BYTES } from './schema.js';
import { analyzeContent, coverage, importBundle } from './store.js';
import { syncExisting } from './existing.js';
export async function main(args = process.argv.slice(2)) {
  const [command, path] = args;
  if (!['import', 'sync-existing', 'status', 'analyze', 'migrate'].includes(command ?? '') || (command === 'import' ? args.length !== 2 : args.length !== 1)) {
    throw new Error('Usage: tsx server/content/cli.ts import PATH | sync-existing | status | analyze | migrate');
  }
  let bundle: ContentBundle | undefined;
  if (command === 'import') {
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) throw new Error('CONTENT_BUNDLE_TOO_LARGE_OR_NOT_FILE');
      // Read at most limit+1 even if the file grows after stat.
      const buffer = Buffer.alloc(MAX_BUNDLE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_BUNDLE_BYTES) throw new Error('CONTENT_BUNDLE_TOO_LARGE');
      bundle = parseBundleJSON(buffer.subarray(0, length).toString('utf8'));
    } finally { await file.close(); }
  }
  // Uses the host's existing database configuration, no credential files loaded.
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = poolFor(url);
  try {
    await migrateContent(pool);
    if (command === 'import') return await importBundle(pool, bundle);
    if (command === 'sync-existing') return await syncExisting(pool);
    if (command === 'analyze') return await analyzeContent(pool);
    if (command === 'status') return await coverage(pool);
    return { migration: '004', status: 'applied' };
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(value => console.log(JSON.stringify(value))).catch(() => {
    // Never echo input, database URLs, SQL errors, or provider payloads.
    console.error('Content command failed. Check command, bundle validation/references, migrations and database configuration.');
    process.exitCode = 1;
  });
}
