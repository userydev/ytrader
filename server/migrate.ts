import { readFile } from 'node:fs/promises';
import { hash, transaction, type Pool } from './db.js';
export async function migrate(pool: Pool) {
  const sql = await readFile(new URL('../migrations/001_first_loop.sql',import.meta.url),'utf8');
  await transaction(pool,async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-migrations'))");
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const prior = (await tx.query("SELECT checksum FROM schema_migrations WHERE version='001'")).rows[0];
    if (prior && prior.checksum !== hash(sql)) throw new Error('Migration checksum changed; use a new forward migration');
    if (!prior) { await tx.query(sql); await tx.query("INSERT INTO schema_migrations(version,checksum) VALUES('001',$1)",[hash(sql)]); }
  });
}
