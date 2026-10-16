import { internalItemSchema, type Item } from '../ycore.js';
import { hash, transaction, type Pool } from '../db.js';
import type { Company, Evidence, News } from '../../src/content/types.js';
import { bodies, replaceNewsRefs, saveMethods, visibleNews } from './store.js';
import { newsSchema } from './schema.js';
// Metadata-only projection. Full text is deliberately never copied and the
// source model flag is neither read as a grant nor modified.
export function projectExisting(item: Item, knownCompanies: Set<string>): News | null {
  if (!item.license_scope.store || !item.license_scope.display || item.availability !== 'available' || !item.title.trim()) return null;
  if (item.url) { try { if (!['http:', 'https:'].includes(new URL(item.url).protocol)) return null; } catch { return null; } }
  const code = item.metadata?.reviewed ? legacyCompanyCode(item.metadata.company_id) : null;
  const evidence: Evidence = { provider: item.source, url: item.url ?? null, title: item.title, observed_at: item.fetched_at,
    as_of: item.published_at, verification: item.source_classification === 'primary' ? 'primary' : 'provider', source_item_id: item.item_id, source_item_version: item.version };
  const candidate = { id: `existing:${hash(item.item_id)}`, title: item.title, summary: null, url: item.url ?? null, source: item.source,
    published_at: item.published_at, observed_at: item.fetched_at, verification: evidence.verification,
    node_ids: [], company_codes: code && knownCompanies.has(code) ? [code] : [], evidence: [evidence] };
  const parsed = newsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
export function legacyCompanyCode(value: string): string | null {
  const match = /^(SSE|SZSE|BSE)\.(\d{6})$/.exec(value);
  return match ? `${match[2]}.${({ SSE: 'SH', SZSE: 'SZ', BSE: 'BJ' } as const)[match[1] as 'SSE' | 'SZSE' | 'BSE']}` : null;
}
export async function syncExisting(pool: Pool) {
  return transaction(pool, async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-content-write'))");
    await saveMethods(tx);
    const known = new Set((await bodies<Company>(tx, 'SELECT body FROM content_companies')).map(c => c.code));
    let after = ''; let imported = 0; let skipped = 0;
    for (;;) {
      const rows = (await tx.query<{ item_id: string; body: unknown }>(`SELECT sc.item_id,sv.body FROM source_current sc
        JOIN source_versions sv ON sv.item_id=sc.item_id AND sv.version=sc.version WHERE sc.item_id>$1 ORDER BY sc.item_id LIMIT 200`, [after])).rows;
      if (!rows.length) break;
      for (const row of rows) {
        const parsed = internalItemSchema.safeParse(row.body);
        if (!parsed.success || parsed.data.item_id !== row.item_id) { skipped++; continue; }
        const news = projectExisting(parsed.data, known);
        if (!news) { skipped++; continue; }
        const changed = await tx.query(`INSERT INTO content_news(id,body,published_at,observed_at,origin,source_item_id,source_item_version)
          VALUES($1,$2::jsonb,$3,$4,'existing',$5,$6) ON CONFLICT(id) DO UPDATE SET body=excluded.body,
          published_at=excluded.published_at,observed_at=excluded.observed_at,source_item_version=excluded.source_item_version,updated_at=now()
          WHERE content_news.origin='existing' AND (content_news.body IS DISTINCT FROM excluded.body OR content_news.source_item_version IS DISTINCT FROM excluded.source_item_version)
          RETURNING id`, [news.id, JSON.stringify(news), news.published_at, news.observed_at, parsed.data.item_id, parsed.data.version]);
        if (changed.rowCount) await replaceNewsRefs(tx, [news]);
        imported++;
      }
      after = rows[rows.length - 1].item_id;
    }
    // Prune only revoked/outdated projections, never bundle content. No source writes.
    const removed = await tx.query(`DELETE FROM content_news n WHERE n.origin='existing' AND NOT ${visibleNews}`);
    await tx.query('DELETE FROM content_mechanisms');
    return { imported, skipped, removed: removed.rowCount ?? 0, summary_policy: 'metadata_only', paid_calls: 0 };
  });
}
