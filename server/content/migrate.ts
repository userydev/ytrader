import { readFile } from 'node:fs/promises';
import { hash, transaction, type Pool } from '../db.js';
// Content, editorial, chain and strategy domain migrations; the original 001 runner is unchanged.
export async function migrateContent(pool: Pool): Promise<void> {
  if (typeof pool?.connect !== 'function') return;
  for (const [version,file] of [['003','003_content_knowledge.sql'],['004','004_editorial.sql'],['005','005_chain_and_strategies.sql']]) {
  const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
  await transaction(pool, async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-migrations'))");
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const prior = (await tx.query('SELECT checksum FROM schema_migrations WHERE version=$1',[version])).rows[0];
    if (prior && prior.checksum !== hash(sql)) throw new Error('Content migration checksum changed');
    if (!prior) { await tx.query(sql); await tx.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [version,hash(sql)]); }
  });
  }
}
