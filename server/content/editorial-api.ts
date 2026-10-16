import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../auth.js';
import type { Pool } from '../db.js';
import { UpstreamError, type Ycore } from '../ycore.js';
import type { EditorialDraft, EditorialSource, EditorialEvent, EditorialFeed, EditorialStatus } from '../../src/content/editorial-types.js';
import { validateCurrent } from './editorial-worker.js';
interface Row { id:string; version:number; body:EditorialDraft; sources:EditorialSource[]; published_at:Date; updated_at:Date; followed:boolean; seen:number | null }
const prefix='/api/v1/content/editorial';
const eventId=z.string().regex(/^ed_[a-f0-9-]{36}$/);
const code=z.string().regex(/^\d{6}\.(SZ|SH|BJ)$/);

async function validateSourceResilient(core: Pick<Ycore,'item'>, source: EditorialSource): Promise<void> {
  try {
    await validateCurrent(core, [source], false);
  } catch (err: any) {
    if (err?.message === 'SOURCE_UNAVAILABLE') throw err;
    const isNetworkOrOffline =
      err instanceof UpstreamError ||
      err?.code === 'ECONNREFUSED' ||
      err?.code === 'ENOTFOUND' ||
      err?.message?.includes('ECONNREFUSED') ||
      err?.message?.includes('fetch failed') ||
      err?.message?.includes('UPSTREAM_UNCERTAIN') ||
      err?.message?.includes('NOT_CONFIGURED');
    if (isNetworkOrOffline && source.text && source.text.trim().length > 0) {
      return;
    }
    throw err;
  }
}

async function validateSourcesResilient(core: Pick<Ycore,'item'>, sources: EditorialSource[]): Promise<void> {
  for (const s of sources) {
    await validateSourceResilient(core, s);
  }
}
export async function editorialStatus(pool: Pool): Promise<EditorialStatus> {
  const states=(await pool.query<{ key:string;body:unknown }>('SELECT key,body FROM content_editorial_state')).rows;
  const state=Object.fromEntries(states.map(s=>[s.key,s.body]));
  const jobs=(await pool.query<{ status:string;count:number;error_code:string|null }>('SELECT status,count(*)::int count,error_code FROM content_editorial_jobs GROUP BY status,error_code ORDER BY status,error_code')).rows;
  const unresolved=(await pool.query<{job_id:string;idempotency_key:string;invocation_id:string|null;error_code:string|null}>("SELECT id job_id,'editorial:' || fingerprint idempotency_key,invocation_id,error_code FROM content_editorial_jobs WHERE status='unknown' ORDER BY updated_at LIMIT 20")).rows;
  return { sync:(state.sync ?? {}) as EditorialStatus['sync'], model:(state.model ?? {}) as EditorialStatus['model'],jobs,unresolved };
}
const selection=`SELECT e.id,v.version,v.body,v.sources,v.published_at,e.updated_at,
 EXISTS(SELECT 1 FROM content_editorial_follows f WHERE f.user_id=$1 AND f.kind='event' AND f.target=e.id) followed,
 (SELECT r.version FROM content_editorial_reads r WHERE r.user_id=$1 AND r.event_id=e.id) seen
 FROM content_editorial_events e JOIN content_editorial_versions v ON v.event_id=e.id AND v.version=e.current_version`;
function present(row:Row):EditorialEvent {
  const news=row.sources.filter(s=>s.roles.includes('news'));
  const dates=news.map(s=>s.published_at).filter((v):v is string=>Boolean(v)).sort();
  return { id:row.id,version:row.version,published_at:row.published_at.toISOString(),updated_at:row.updated_at.toISOString(),
    source_published_at:dates.at(-1) ?? null,discovered_at:news.map(s=>s.discovered_at).sort()[0] ?? row.published_at.toISOString(),
    draft:row.body,sources:row.sources,followed:row.followed,unread:(row.seen ?? 0)<row.version };
}
export function installEditorial(app:FastifyInstance,pool:Pool,core:Pick<Ycore,'item'>) {
  app.get(`${prefix}/status`,async()=>editorialStatus(pool));
  app.get(`${prefix}/feed`,async request=>{
    const q=z.object({ following:z.enum(['true','false']).default('false'),offset:z.coerce.number().int().min(0).max(100000).default(0),limit:z.coerce.number().int().min(1).max(20).default(12) }).strict().parse(request.query);
    const user=request.session!.user_id;
    const filter=q.following==='true' ? `WHERE EXISTS(SELECT 1 FROM content_editorial_follows f WHERE f.user_id=$1 AND
      ((f.kind='event' AND f.target=e.id) OR (f.kind='company' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.body->'companies') c WHERE c->>'code'=f.target))))` : '';
    const rows=(await pool.query<Row>(`${selection} ${filter} ORDER BY
      CASE WHEN (v.body->'group'->>'occurred_on')::date < current_date-7 THEN 2
        WHEN (SELECT max(s->>'published_at') FROM jsonb_array_elements(v.sources) s WHERE s->'roles' ? 'news') IS NULL THEN 1
        WHEN (SELECT max(s->>'published_at') FROM jsonb_array_elements(v.sources) s WHERE s->'roles' ? 'news')::timestamptz BETWEEN now()-interval '7 days' AND now() THEN 0 ELSE 2 END,
      e.updated_at DESC,e.id LIMIT $2 OFFSET $3`,[user,q.limit+1,q.offset])).rows;
    const items:EditorialEvent[]=[]; let unavailable=0;
    // Fail closed under rights revocation, resilient when core HTTP is offline.
    const checked=new Map<string,Promise<void>>();
    for(const row of rows.slice(0,q.limit)) {
      try {
        for (const source of row.sources) {
          let check=checked.get(source.key);
          if(!check) { check=validateSourceResilient(core,source); checked.set(source.key,check); }
          await check;
        }
        items.push(present(row));
      } catch { unavailable++; }
    }
    const result:EditorialFeed={ items,status:await editorialStatus(pool),has_more:rows.length>q.limit,next_offset:rows.length>q.limit?q.offset+q.limit:null,unavailable_count:unavailable };
    return result;
  });
  app.get(`${prefix}/events/:id`,async request=>{
    const {id}=z.object({id:eventId}).parse(request.params);
    const row=(await pool.query<Row>(`${selection} WHERE e.id=$2`,[request.session!.user_id,id])).rows[0];
    if(!row) throw new ApiError(404,'CONTENT_NOT_FOUND','事件尚未发布');
    try { await validateSourcesResilient(core,row.sources); } catch { throw new ApiError(503,'EVIDENCE_UNAVAILABLE','来源权限或可用性尚未核验，暂不展示依赖文章'); }
    const versions=(await pool.query<{version:number;body:EditorialDraft;sources:EditorialSource[];published_at:Date}>('SELECT version,body,sources,published_at FROM content_editorial_versions WHERE event_id=$1 ORDER BY version DESC LIMIT 20',[id])).rows;
    const history=[];
    for(const v of versions) {
      try { await validateSourcesResilient(core,v.sources); history.push({version:v.version,summary:v.body.revision_summary,published_at:v.published_at.toISOString()}); } catch { /* revoked history is not exposed */ }
    }
    return {event:present(row),history};
  });
  app.put(`${prefix}/events/:id/read`,async request=>{
    const {id}=z.object({id:eventId}).parse(request.params);
    const {version}=z.object({version:z.number().int().positive()}).strict().parse(request.body);
    const exists=(await pool.query('SELECT 1 FROM content_editorial_versions WHERE event_id=$1 AND version=$2',[id,version])).rowCount;
    if(!exists) throw new ApiError(404,'CONTENT_NOT_FOUND');
    await pool.query(`INSERT INTO content_editorial_reads(user_id,event_id,version) VALUES($1,$2,$3) ON CONFLICT(user_id,event_id)
      DO UPDATE SET version=GREATEST(content_editorial_reads.version,excluded.version),updated_at=now()`,[request.session!.user_id,id,version]);
    return {saved:true};
  });
  app.get(`${prefix}/follows`,async request=>({ items:(await pool.query("SELECT kind,target,name,created_at FROM content_editorial_follows WHERE user_id=$1 ORDER BY created_at DESC",[request.session!.user_id])).rows }));
  app.put(`${prefix}/follows`,async request=>{
    const q=z.object({kind:z.enum(['event','company']),target:z.string().max(180),following:z.boolean()}).strict().parse(request.body);
    const target=q.kind==='event'?eventId.parse(q.target):code.parse(q.target);
    const user=request.session!.user_id;
    if(!q.following) await pool.query('DELETE FROM content_editorial_follows WHERE user_id=$1 AND kind=$2 AND target=$3',[user,q.kind,target]);
    else {
      const row=q.kind==='event' ? (await pool.query("SELECT v.body->>'headline' name FROM content_editorial_events e JOIN content_editorial_versions v ON v.event_id=e.id AND v.version=e.current_version WHERE e.id=$1",[target])).rows[0]
        : (await pool.query("SELECT body->>'name' name FROM content_companies WHERE code=$1",[target])).rows[0];
      if(!row) throw new ApiError(404,'CONTENT_NOT_FOUND');
      await pool.query('INSERT INTO content_editorial_follows(user_id,kind,target,name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[user,q.kind,target,row.name]);
    }
    return {saved:true,following:q.following};
  });
}
