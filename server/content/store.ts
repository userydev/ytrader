import { hash, transaction, type Pool, type Tx } from '../db.js';
import type { Company, ContentBundle, IndustryEdge, IndustryNode, Exposure, News, NewsItem, Observation, SourceRun, Coverage, Mechanism } from '../../src/content/types.js';
import { parseBundle } from './schema.js';
import { METHODS, explainNews, verifiedChange, type MechanismContext } from './methods.js';
import { enrichNews } from './linking.js';
export type Db = Pick<Pool, 'query'>;
export async function bodies<T>(db: Db, sql: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query<{ body: T }>(sql, values)).rows.map(r => r.body);
}
export async function saveMethods(tx: Db) {
  const fingerprint = hash(JSON.stringify(METHODS));
  await tx.query('INSERT INTO content_methods(version,fingerprint,body) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING', [METHODS.version, fingerprint, JSON.stringify(METHODS)]);
  const saved = (await tx.query('SELECT fingerprint FROM content_methods WHERE version=$1', [METHODS.version])).rows[0];
  if (saved.fingerprint !== fingerprint) throw new Error('CONTENT_METHOD_VERSION_CONFLICT');
}
// Identifiers and expressions below are private constants, never user-controlled.
async function upsert(tx: Tx, table: string, key: string, rows: unknown[], observed: string, extras: Record<string, string> = {}, bodySQL = 'excluded.body'): Promise<Set<string>> {
  if (!rows.length) return new Set();
  const columns = Object.keys(extras);
  const sql = `INSERT INTO ${table}(${key},body,observed_at${columns.map(c => `,${c}`).join('')})
    SELECT x->>'${key}',x,$2::timestamptz${Object.values(extras).map(e => `,${e}`).join('')} FROM jsonb_array_elements($1::jsonb) x WHERE true
    ON CONFLICT(${key}) DO UPDATE SET body=${bodySQL},observed_at=excluded.observed_at,
    updated_at=CASE WHEN ${table}.body IS DISTINCT FROM (${bodySQL}) THEN now() ELSE ${table}.updated_at END
    ${columns.map(c => `,${c}=excluded.${c}`).join('')}
    WHERE ${table}.observed_at<=excluded.observed_at RETURNING ${key} AS id`;
  return new Set((await tx.query<{ id: string }>(sql, [JSON.stringify(rows), observed])).rows.map(r => r.id));
}
async function assertReferences(tx: Tx, bundle: ContentBundle) {
  const nodes = new Set<string>(); const companies = new Set<string>();
  for (const n of bundle.nodes) for (const r of n.root_ids) nodes.add(r);
  for (const e of bundle.edges) { nodes.add(e.from_id); nodes.add(e.to_id); }
  for (const e of bundle.exposures) { nodes.add(e.node_id); companies.add(e.company_code); }
  for (const n of bundle.news) { n.node_ids.forEach(id => nodes.add(id)); n.company_codes.forEach(id => companies.add(id)); }
  for (const o of bundle.observations) nodes.add(o.node_id);
  const knownNodes = new Set([...bundle.nodes.map(n => n.id), ...(await tx.query<{ id: string }>('SELECT id FROM content_nodes WHERE id=ANY($1::text[])', [[...nodes]])).rows.map(r => r.id)]);
  const knownCompanies = new Set([...bundle.companies.map(c => c.code), ...(await tx.query<{ code: string }>('SELECT code FROM content_companies WHERE code=ANY($1::text[])', [[...companies]])).rows.map(r => r.code)]);
  if ([...nodes].some(id => !knownNodes.has(id)) || [...companies].some(id => !knownCompanies.has(id))) throw new Error('CONTENT_DANGLING_REFERENCE');
  if (bundle.edges.some(e => e.from_id === e.to_id)) throw new Error('CONTENT_SELF_EDGE');
}
export async function importBundle(pool: Pool, input: unknown) {
  const bundle = parseBundle(input);
  return transaction(pool, async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-content-write'))");
    return importInTransaction(tx, bundle);
  });
}
async function saveRun(tx: Tx, bundle: ContentBundle) {
  await tx.query(`INSERT INTO content_runs(provider,id,body,observed_at) VALUES($1,$2,$3::jsonb,$4)
    ON CONFLICT(provider,id) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at,
    imported_at=CASE WHEN content_runs.body IS DISTINCT FROM excluded.body THEN now() ELSE content_runs.imported_at END
    WHERE content_runs.observed_at<=excluded.observed_at`, [bundle.source_run.provider, bundle.source_run.id, JSON.stringify(bundle.source_run), bundle.observed_at]);
}
async function importInTransaction(tx: Tx, bundle: ContentBundle) {
  await saveMethods(tx);
  // A failed source may contain half-built/empty replacement records. Persist its
  // status, not its attempted facts. Partial-success bundles can still carry data.
  if (/^(failed|failure|error|unavailable)$/i.test(bundle.source_run.status)) {
    await saveRun(tx, bundle);
    return { source_run: bundle.source_run, skipped_due_to_failure: true, accepted: { nodes: 0, news: 0 } };
  }
  await assertReferences(tx, bundle);
  const at = bundle.observed_at;
  const nodeMerge = `excluded.body || jsonb_build_object(
    'root_ids',CASE WHEN jsonb_array_length(excluded.body->'root_ids')=0 THEN content_nodes.body->'root_ids' ELSE excluded.body->'root_ids' END,
    'aliases',CASE WHEN jsonb_array_length(excluded.body->'aliases')=0 THEN content_nodes.body->'aliases' ELSE excluded.body->'aliases' END,
    'evidence',CASE WHEN jsonb_array_length(excluded.body->'evidence')=0 THEN content_nodes.body->'evidence' ELSE excluded.body->'evidence' END)`;
  const nodeIds = await upsert(tx, 'content_nodes', 'id', bundle.nodes, at, {}, nodeMerge);
  await upsert(tx, 'content_companies', 'code', bundle.companies, at);
  await upsert(tx, 'content_edges', 'id', bundle.edges, at, { from_id: "x->>'from_id'", to_id: "x->>'to_id'", kind: "x->>'kind'" });
  await upsert(tx, 'content_exposures', 'id', bundle.exposures, at, { company_code: "x->>'company_code'", node_id: "x->>'node_id'", status: "x->>'status'" });
  // Reserved IDs prevent a bundle from overriding a rights-gated legacy projection.
  if (bundle.news.some(n => n.id.startsWith('existing:'))) throw new Error('CONTENT_RESERVED_NEWS_ID');
  const linkedNews = await enrichNews(tx, bundle.news);
  const newsIds = await upsert(tx, 'content_news', 'id', linkedNews, at, { published_at: "(x->>'published_at')::timestamptz" });
  await upsert(tx, 'content_observations', 'id', bundle.observations, at, { node_id: "x->>'node_id'", date: "(x->>'date')::date" });
  await tx.query('DELETE FROM content_node_roots WHERE node_id=ANY($1::text[])', [[...nodeIds]]);
  const savedNodes = await bodies<IndustryNode>(tx, 'SELECT body FROM content_nodes WHERE id=ANY($1::text[])', [[...nodeIds]]);
  const roots = savedNodes.flatMap(n => n.root_ids.map(root => ({ node: n.id, root })));
  await tx.query("INSERT INTO content_node_roots SELECT x->>'node',x->>'root' FROM jsonb_array_elements($1::jsonb) x WHERE true ON CONFLICT DO NOTHING", [JSON.stringify(roots)]);
  await replaceNewsRefs(tx, linkedNews.filter(n => newsIds.has(n.id)));
  await saveRun(tx, bundle);
  // Derived cache is disposable, facts are never cleared by a failed/empty run.
  if (bundle.nodes.length + bundle.edges.length + bundle.companies.length + bundle.exposures.length + bundle.news.length > 0) await tx.query('DELETE FROM content_mechanisms');
  return { source_run: bundle.source_run, accepted: { nodes: nodeIds.size, news: newsIds.size }, submitted: { nodes: bundle.nodes.length, edges: bundle.edges.length, companies: bundle.companies.length, exposures: bundle.exposures.length, news: bundle.news.length, observations: bundle.observations.length } };
}
export async function replaceNewsRefs(tx: Tx, items: News[]) {
  const ids = items.map(n => n.id);
  await tx.query('DELETE FROM content_news_nodes WHERE news_id=ANY($1::text[])', [ids]);
  await tx.query('DELETE FROM content_news_companies WHERE news_id=ANY($1::text[])', [ids]);
  await tx.query("INSERT INTO content_news_nodes SELECT x->>'news',x->>'node' FROM jsonb_array_elements($1::jsonb) x WHERE true ON CONFLICT DO NOTHING", [JSON.stringify(items.flatMap(n => n.node_ids.map(node => ({ news: n.id, node }))))]);
  await tx.query("INSERT INTO content_news_companies SELECT x->>'news',x->>'company' FROM jsonb_array_elements($1::jsonb) x WHERE true ON CONFLICT DO NOTHING", [JSON.stringify(items.flatMap(n => n.company_codes.map(company => ({ news: n.id, company }))))]);
}
// This condition is used on EVERY read, including counts and analysis. Revocation is
// effective immediately even if sync-existing has not run since the rights changed.
export const visibleNews = `(n.origin='bundle' OR EXISTS (
  SELECT 1 FROM source_current sc JOIN source_versions sv ON sv.item_id=sc.item_id AND sv.version=sc.version
  WHERE sc.item_id=n.source_item_id AND sc.version=n.source_item_version AND sc.availability='available'
    AND sv.body->>'availability'='available' AND sv.body->'license_scope'->>'display'='true'
    AND sv.body->'license_scope'->>'store'='true' AND length(trim(sv.body->>'title'))>0
))`;
export const newsItem = (n: News): NewsItem => ({ ...n, source_status: n.verification, analysis_status: verifiedChange(n) ? 'conditional' : n.change ? 'pending_evidence' : 'no_explicit_change' });
export async function contextFor(db: Db, news: News[]): Promise<MechanismContext> {
  const ids = [...new Set(news.flatMap(n => n.change ? [n.change.node_id] : []))];
  const edges = await bodies<IndustryEdge>(db, "SELECT body FROM content_edges WHERE kind<>'classification' AND (from_id=ANY($1::text[]) OR to_id=ANY($1::text[])) ORDER BY id", [ids]);
  const nodes = [...new Set([...ids, ...edges.flatMap(e => [e.from_id, e.to_id])])];
  const exposures = await bodies<Exposure>(db, "SELECT body FROM content_exposures WHERE node_id=ANY($1::text[]) AND status='business' ORDER BY id", [nodes]);
  const companies = await bodies<Company>(db, 'SELECT body FROM content_companies WHERE code=ANY($1::text[]) ORDER BY code', [[...new Set(exposures.map(e => e.company_code))]]);
  return { edges, exposures, companies };
}
export async function mechanismsFor(db: Db, news: News[]): Promise<Mechanism[]> {
  const context = await contextFor(db, news);
  return news.flatMap(n => explainNews(n, context));
}
export async function coverage(db: Db): Promise<Coverage> {
  const counts = (await db.query(`SELECT (SELECT count(*)::int FROM content_nodes) nodes,
    (SELECT count(*)::int FROM content_edges) edges,
    (SELECT count(*)::int FROM content_edges WHERE kind<>'classification') production_edges,(SELECT count(*)::int FROM content_companies) companies,
    (SELECT count(*)::int FROM content_news n WHERE ${visibleNews}) news,
    (SELECT count(*)::int FROM content_observations) observations,
    (SELECT max(observed_at) FROM content_runs) updated_at`)).rows[0];
  const latest = await bodies<SourceRun>(db, "SELECT body FROM content_runs ORDER BY GREATEST((body->>'started_at')::timestamptz,COALESCE((body->>'finished_at')::timestamptz,(body->>'started_at')::timestamptz)) DESC,provider,id LIMIT 1");
  return { ...counts, updated_at: counts.updated_at?.toISOString() ?? null, latest_run: latest[0] ?? null, completeness: 'observed_only' };
}
export async function analyzeContent(pool: Pool) {
  return transaction(pool, async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-content-write'))");
    await saveMethods(tx);
    await tx.query('DELETE FROM content_mechanisms');
    let after = ''; let newsCount = 0; let mechanismCount = 0;
    for (;;) {
      const items = await bodies<News>(tx, `SELECT n.body FROM content_news n WHERE ${visibleNews} AND n.id>$1 ORDER BY n.id LIMIT 100`, [after]);
      if (!items.length) break;
      const mechanisms = await mechanismsFor(tx, items);
      await tx.query(`INSERT INTO content_mechanisms(id,news_id,method_version,body)
        SELECT x->>'id',x->>'news_id',x->>'method_version',x FROM jsonb_array_elements($1::jsonb) x WHERE true ON CONFLICT DO NOTHING`, [JSON.stringify(mechanisms)]);
      newsCount += items.length; mechanismCount += mechanisms.length; after = items[items.length - 1].id;
    }
    return { method_version: METHODS.version, news: newsCount, mechanisms: mechanismCount, paid_calls: 0 };
  });
}
export type { Company, IndustryNode, Exposure, News, Observation };
