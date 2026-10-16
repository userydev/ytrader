import { z } from 'zod';
import { id, type Pool } from './db.js';
import { ApiError } from './auth.js';
import type { Analysis } from './analysis-schema.js';
import { route, STOP } from './analysis-schema.js';
import type { Item } from './ycore.js';
import type { Config } from './config.js';
import type { FastifyInstance } from 'fastify';
type Ref = { event_id: string; version: number };
const evidenceLabels = { primary: '原始依据支持', corroborated: '独立报道支持', unverified: '未核实', conflicting: '存在冲突', refuted: '已被否定' };
export function isRecentPublication(publishedAt: string | null | undefined, now = Date.now()) {
  if (!publishedAt) return false;
  const timestamp = Date.parse(publishedAt);
  return Number.isFinite(timestamp) && timestamp<=now && timestamp>now-86400000;
}
export async function systemStatus(pool: Pool, config: Config) {
  const records = (await pool.query('SELECT key,value,updated_at FROM service_state')).rows;
  const sync = records.find(r => r.key === 'sync')?.value ?? {};
  const coverage = records.find(r => r.key === 'coverage')?.value;
  const budgetRecord = records.find(r => r.key === 'budget');
  const stale = sync.last_success_at && Date.now()-Date.parse(sync.last_success_at)>15*60*1000;
  const sourceStatus = sync.integrity === 'unverified' ? 'unavailable' : sync.status !== 'ok' ? sync.status : stale ? 'stale' : coverage?.status ?? 'unavailable';
  const counts = (await pool.query('SELECT status,error_code,count(*)::int AS count FROM jobs GROUP BY status,error_code ORDER BY status,error_code')).rows;
  return {
    status: sourceStatus ?? 'not_configured', last_success_at: sync.last_success_at ?? null,
    failure_at: sync.failure_at ?? null, coverage: coverage?.sources ?? [],
    backlog: Boolean(sync.has_more), recovery_required: sync.integrity === 'unverified',
    model_enabled: config.modelEnabled,
    budget: budgetRecord ? { ...budgetRecord.value, checked_at: budgetRecord.updated_at } : null,
    jobs: counts, error_code: sync.error_code ?? null
  };
}
export async function eventResponse(pool: Pool, userId: string, eventId: string, version?: number) {
  const row = (await pool.query(`SELECT e.id,e.item_id,e.current_version,e.created_at AS first_seen_at,e.substantive_at,
    v.version,v.item_version,v.phase,v.payload,v.withdrawn,v.change_kind,v.change_note,v.created_at AS generated_at,
    sc.version AS source_version,sc.availability,sv.body AS source,
    COALESCE(rs.last_read_version,0) AS last_read_version,
    (SELECT value->>'integrity' FROM service_state WHERE key='sync') AS integrity,
    (SELECT status FROM jobs WHERE event_id=e.id AND item_version=sc.version ORDER BY created_at DESC,id DESC LIMIT 1) AS job_status,
    (SELECT error_code FROM jobs WHERE event_id=e.id AND item_version=sc.version ORDER BY created_at DESC,id DESC LIMIT 1) AS job_error,
    NOT EXISTS(SELECT 1 FROM event_dependencies d LEFT JOIN source_current dc ON dc.item_id=d.item_id
      LEFT JOIN source_versions dv ON dv.item_id=dc.item_id AND dv.version=dc.version
      WHERE d.event_id=e.id AND d.event_version=v.version AND (dc.version IS DISTINCT FROM d.item_version OR dc.availability IS DISTINCT FROM 'available' OR dv.body->'license_scope'->>'model' IS DISTINCT FROM 'true' OR dv.body->'license_scope'->>'display' IS DISTINCT FROM 'true' OR dv.body->'license_scope'->>'store' IS DISTINCT FROM 'true')) AS dependencies_valid
    FROM events e JOIN event_versions v ON v.event_id=e.id AND v.version=COALESCE($3::integer,e.current_version)
    JOIN source_current sc ON sc.item_id=e.item_id
    JOIN source_versions sv ON sv.item_id=sc.item_id AND sv.version=sc.version
    LEFT JOIN read_state rs ON rs.event_id=e.id AND rs.user_id=$1 WHERE e.id=$2`, [userId,eventId,version ?? null])).rows[0];
  if (!row) throw new ApiError(404,'NOT_FOUND','未找到事件版本');
  const source = row.source as Item;
  const payload = row.payload as Analysis | null;
  const accessible = source.license_scope.display && source.license_scope.store && row.availability === 'available';
  const active = Boolean(payload && accessible && row.phase === 'analysis' && !row.withdrawn && row.item_version === row.source_version && row.dependencies_valid && row.integrity !== 'unverified');
  const withdrawn = row.phase === 'analysis' && !active;
  const content = accessible && !withdrawn ? payload : null;
  const core = content?.claims.find(c => c.claim_id === content.core_claim_id);
  const refIds = new Set([row.item_id,...(content?.claims ?? []).flatMap(c => c.evidence.map(ref => ref.item_id)),...(active ? payload!.companies.flatMap(c => c.business_evidence.map(ref => ref.item_id)) : [])]);
  const sources = (await pool.query('SELECT body FROM source_versions WHERE item_id=ANY($1::text[])',[[...refIds]])).rows.map(r => r.body as Item);
  function evidenceFor(ref: { item_id: string; item_version: number; locator: string; quote: string }) {
    const item = sources.find(i => i.item_id===ref.item_id && i.version===ref.item_version);
    return { item_id: ref.item_id, item_version: ref.item_version, source: item?.source ?? '不可用', title: item?.title ?? '', url: item?.url ?? null,
      published_at: item?.published_at ?? null, fetched_at: item?.fetched_at ?? null, content_kind: item?.content_kind ?? 'none',
      availability: item?.availability ?? 'unavailable', support_locator: ref.locator, excerpt: item?.license_scope.display && item.license_scope.store ? ref.quote || null : null };
  }
  return {
    event_id: row.id, canonical_id: row.id, version: row.version, current_version: row.current_version,
    core_claim_ref: { claim_id: core?.claim_id ?? 'unavailable', version: row.version }, lifecycle: active && core?.evidence_state === 'refuted' ? 'disproved' : 'ongoing', publication: 'published',
    summary: withdrawn ? '此版本的解释已撤回，请查看当前版本。' : content?.summary ?? '来源内容已移除或暂不可用',
    headline: content?.headline, change_summary: content?.change_summary, impact_summary: active ? payload!.impact_summary : undefined,
    importance: content?.importance ?? 'exclude', importance_reason: content?.importance_reason ?? '当前不可核验。',
    evidence_state: core?.evidence_state ?? 'unverified', evidence_label: evidenceLabels[core?.evidence_state ?? 'unverified'],
    route: active ? route(payload!) : 'excluded', occurred_at: content?.occurred_at ?? null,
    first_seen_at: row.first_seen_at, generated_at: row.generated_at, substantive_at: row.substantive_at,
    source_published_at: sources.find(item => item.item_id===row.item_id && item.version===row.item_version)?.published_at ?? null,
    last_verified_at: source.fetched_at,
    claims: (content?.claims ?? []).map(c => ({ ...c, version: row.version, review_state: 'none', evidence: c.evidence.map(evidenceFor) })),
    paths: active ? payload!.paths : [],
    companies: active ? payload!.companies.map(company => ({ ...company, business_evidence: company.business_evidence.map(evidenceFor) })) : [],
    stopping_message: active ? payload!.stopping_message : STOP,
    explanation_status: active ? 'ready' : withdrawn || row.availability !== 'available' ? 'withdrawn' : row.job_status === 'failed' ? 'failed' : row.job_status === 'blocked' || !row.job_status ? 'model_unavailable' : 'pending',
    change_kind: row.change_kind, change_note: !active && row.job_error==='CONTENT_REVIEW_FAILED' ? '新解释未通过事实与机制审核，未发布；当前仅保留可核对的来源内容。' : row.change_note,
    correction_notice: withdrawn ? '此版本的解释已撤回，请查看当前版本及更正记录。' : row.change_kind === 'correction' ? (active ? '当前解释已更新；此前版本请结合更正记录阅读。' : '来源已变化，新的解释尚未完成核验。') : null,
    unread: row.version > row.last_read_version,
    correction_for_reader: row.last_read_version > 0 && row.version > row.last_read_version && row.change_kind === 'correction',
    impact_coverage: active && payload!.paths.length ? 'explained' : 'facts_only'
  };
}
export async function markRead(pool: Pool, userId: string, eventId: string, version: number) {
  const result = await pool.query(`INSERT INTO read_state(user_id,event_id,last_read_version)
    SELECT $1,e.id,v.version FROM events e JOIN event_versions v ON v.event_id=e.id WHERE e.id=$2 AND v.version=$3
    ON CONFLICT(user_id,event_id) DO UPDATE SET last_read_version=GREATEST(read_state.last_read_version,EXCLUDED.last_read_version),updated_at=now() RETURNING last_read_version`,[userId,eventId,version]);
  if (!result.rowCount) throw new ApiError(422,'VALIDATION_FAILED','不能将不存在的版本标为已读');
  return result.rows[0].last_read_version as number;
}
async function saveSnapshot(pool: Pool, userId: string, kind: string, refs: Ref[], query = '') {
  const snapshotId = id('snap');
  return (await pool.query('INSERT INTO reading_snapshots(id,user_id,kind,query,refs) VALUES($1,$2,$3,$4,$5) RETURNING *',[snapshotId,userId,kind,query,JSON.stringify(refs)])).rows[0];
}
const cursor = (snapshotId: string, offset: number) => Buffer.from(JSON.stringify({ snapshotId, offset })).toString('base64url');
async function loadCursor(pool: Pool, userId: string, value: string, kind: string) {
  let decoded: { snapshotId: string; offset: number };
  try { decoded = z.object({ snapshotId: z.string(), offset: z.number().int().nonnegative().max(10000000) }).parse(JSON.parse(Buffer.from(value,'base64url').toString())); }
  catch { throw new ApiError(410,'CURSOR_INVALID','列表位置已失效，请重新打开'); }
  const snapshot = (await pool.query('SELECT * FROM reading_snapshots WHERE id=$1 AND user_id=$2 AND kind=$3 AND created_at>now()-interval \'24 hours\'',[decoded.snapshotId,userId,kind])).rows[0];
  if (!snapshot || decoded.offset > snapshot.refs.length) throw new ApiError(410,'CURSOR_EXPIRED','列表位置已过期，请重新打开');
  return { snapshot, offset: decoded.offset };
}
async function page(pool: Pool, userId: string, snapshot: any, offset: number, limit: number) {
  const refs = snapshot.refs as Ref[];
  const data = await Promise.all(refs.slice(offset,offset+limit).map(ref => eventResponse(pool,userId,ref.event_id,ref.version)));
  const hasMore = refs.length>offset+limit;
  return { data, has_more: hasMore, next_cursor: hasMore ? cursor(snapshot.id,offset+limit) : null, snapshot_id: snapshot.id };
}
export function installReading(app: FastifyInstance, pool: Pool, config: Config) {
  app.get('/api/v1/system/status', () => systemStatus(pool,config));
  app.get('/api/v1/events/:id', async request => {
    const eventId = z.object({ id: z.string() }).parse(request.params).id;
    const query = z.object({ version: z.coerce.number().int().positive().optional() }).parse(request.query);
    return eventResponse(pool,request.session!.user_id,eventId,query.version);
  });
  app.get('/api/v1/events/:id/versions', async request => {
    const eventId = z.object({ id: z.string() }).parse(request.params).id;
    const { before } = z.object({ before: z.coerce.number().int().positive().optional() }).parse(request.query);
    const data = (await pool.query('SELECT version,change_kind,change_note,created_at AS generated_at,withdrawn FROM event_versions WHERE event_id=$1 AND ($2::integer IS NULL OR version<$2) ORDER BY version DESC LIMIT 21',[eventId,before ?? null])).rows;
    return { data: data.slice(0,20), has_more: data.length>20, next_before: data.length>20 ? data[19].version : null };
  });
  app.put('/api/v1/read-state/:id', async (request,reply) => {
    const eventId = z.object({ id: z.string() }).parse(request.params).id;
    const { version } = z.object({ version: z.number().int().positive() }).parse(request.body);
    await markRead(pool,request.session!.user_id,eventId,version); reply.code(204).send();
  });
  app.get('/api/v1/digest', async request => {
    const user = request.session!.user_id;
    const rows = (await pool.query(`SELECT id AS event_id,current_version AS version FROM events WHERE substantive_at>now()-interval '24 hours' ORDER BY substantive_at DESC,id`)).rows as Ref[];
    const all = await Promise.all(rows.map(ref => eventResponse(pool,user,ref.event_id,ref.version)));
    const eligibilityTime = Date.now();
    const main = all.filter(e => e.route === 'main' && isRecentPublication(e.source_published_at,eligibilityTime)).sort((a,b) => (a.importance === 'major' ? 0 : 1)-(b.importance === 'major' ? 0 : 1) || Date.parse(b.substantive_at)-Date.parse(a.substantive_at) || a.event_id.localeCompare(b.event_id));
    const watch = all.filter(e => e.route === 'watch' && isRecentPublication(e.source_published_at,eligibilityTime)).sort((a,b) => Date.parse(b.substantive_at)-Date.parse(a.substantive_at));
    const snapshot = await saveSnapshot(pool,user,'digest',main.map(e => ({ event_id: e.event_id, version: e.version })));
    const status = await systemStatus(pool,config);
    const now = new Date();
    return { snapshot_id: snapshot.id, version: 1, window_start: new Date(+now-86400000).toISOString(), window_end: now.toISOString(), generated_at: now.toISOString(), data_cutoff_at: status.last_success_at,
      status: status.status === 'ok' && !main.length && !watch.length ? 'empty' : status.status,
      coverage: status.coverage, items: main.slice(0,10), watch_items: watch.slice(0,3), more_cursor: main.length>10 ? cursor(snapshot.id,10) : null,
      corrections: all.filter(e => e.correction_for_reader || (e.route === 'correction' && isRecentPublication(e.source_published_at,eligibilityTime))).slice(0,10), pending_count: all.filter(e => e.explanation_status !== 'ready').length };
  });
  app.get('/api/v1/digest/more', async request => {
    const { cursor: value } = z.object({ cursor: z.string() }).parse(request.query);
    const p = await loadCursor(pool,request.session!.user_id,value,'digest');
    const result = await page(pool,request.session!.user_id,p.snapshot,p.offset,10);
    // Safety overlays can remove withdrawn entries; the frozen order never changes.
    return { ...result, data: result.data.filter(e => e.route === 'main' && isRecentPublication(e.source_published_at,new Date(p.snapshot.created_at).getTime())) };
  });
  app.get('/api/v1/events', async request => {
    const query = z.object({ q: z.string().max(100).default(''), cursor: z.string().optional() }).parse(request.query);
    const user = request.session!.user_id;
    if (query.cursor) { const p = await loadCursor(pool,user,query.cursor,'history'); if (p.snapshot.query !== query.q) throw new ApiError(410,'CURSOR_INVALID'); return page(pool,user,p.snapshot,p.offset,20); }
    const refs = (await pool.query(`SELECT e.id AS event_id,e.current_version AS version FROM events e JOIN event_versions v ON v.event_id=e.id AND v.version=e.current_version WHERE ($1='' OR strpos(concat_ws(' ',v.payload->>'summary',v.payload->>'headline',v.payload->>'change_summary'),$1)>0) ORDER BY e.substantive_at DESC,e.id`,[query.q])).rows;
    return page(pool,user,await saveSnapshot(pool,user,'history',refs,query.q),0,20);
  });
  app.get('/api/v1/updates', async request => {
    const user = request.session!.user_id;
    const refs = (await pool.query(`SELECT e.id AS event_id,e.current_version AS version FROM events e JOIN read_state rs ON rs.event_id=e.id AND rs.user_id=$1 WHERE e.current_version>rs.last_read_version ORDER BY e.substantive_at DESC,e.id`,[user])).rows as Ref[];
    return { data: await Promise.all(refs.map(ref => eventResponse(pool,user,ref.event_id,ref.version))) };
  });
  app.get('/api/v1/digests', async request => ({ data: (await pool.query("SELECT id AS snapshot_id,created_at FROM reading_snapshots WHERE user_id=$1 AND kind='digest' ORDER BY created_at DESC LIMIT 30",[request.session!.user_id])).rows }));
}
