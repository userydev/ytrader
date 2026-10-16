import { id, transaction, type Pool } from '../db.js';
import { budgetGate, UpstreamError, type Ycore } from '../ycore.js';
import type { Config } from '../config.js';
import type { EditorialDraft, EditorialInput, EditorialSource } from '../../src/content/editorial-types.js';
import { parseBundle } from './schema.js';
import { bodies, importBundle } from './store.js';
import type { News } from '../../src/content/types.js';
import { buildInput, eligibleNews, permitted } from './editorial-input.js';
import { groupKey, inputFingerprint, modelRequest, sameEvent, validateDraft, type PreviousEditorial } from './editorial-schema.js';
export type EditorialCore = Pick<Ycore,'contentSnapshot'|'item'|'budget'|'createInvocation'|'invocation'>;
interface Job { id: string; fingerprint: string; input: EditorialInput; request_body: unknown; primary_refs: string[]; status: string; invocation_id: string | null; attempts: number }
export async function saveState(pool: Pool, key: string, body: unknown) {
  await pool.query('INSERT INTO content_editorial_state(key,body) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET body=content_editorial_state.body || excluded.body,updated_at=now()', [key,JSON.stringify(body)]);
}
async function stateJob(pool: Pool, job: Job, status: string, error: string | null=null, invocation?: string) {
  await pool.query('UPDATE content_editorial_jobs SET status=$2,error_code=$3,invocation_id=COALESCE($4,invocation_id),updated_at=now() WHERE id=$1', [job.id,status,error,invocation ?? job.invocation_id ?? null]);
}
export async function validateCurrent(core: Pick<Ycore,'item'>, sources: EditorialSource[], requireModel = true) {
  for (const source of sources) {
    const item=await core.item(source.item_id,source.item_version);
    const allowed = requireModel ? permitted(item) : item.availability==='available' && item.license_scope.store && item.license_scope.display;
    if (item.item_id!==source.item_id || item.version!==source.item_version || !allowed || !item.content?.includes(source.text)) throw new Error('SOURCE_UNAVAILABLE');
  }
}
async function publish(pool: Pool, core: EditorialCore, job: Job, output: unknown) {
  let draft: EditorialDraft;
  try {
    const parsed = typeof output==='string' ? JSON.parse(output) : output;
    // Exclusions may be returned compactly; nothing from them is published.
    if (parsed && typeof parsed==='object' && parsed.eligible === false && typeof parsed.exclusion_reason==='string' && parsed.exclusion_reason.trim()) {
      await stateJob(pool,job,'excluded','NOT_FINANCIAL_OR_NOT_ACTIONABLE'); return;
    }
    draft=validateDraft(parsed,job.input);
  } catch { await stateJob(pool,job,'rejected','OUTPUT_QUOTE_OR_STRUCTURE_REJECTED'); return; }
  try { await validateCurrent(core,job.input.sources); }
  catch { await stateJob(pool,job,'inflight','SOURCE_RECHECK_PENDING'); return; }
  await transaction(pool,async tx => {
    const lock=(await tx.query('SELECT status FROM content_editorial_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
    if (lock.status==='published') return;
    const recent=(await tx.query<{ id:string; version:number; body:EditorialDraft; sources:EditorialSource[]; primary_refs:string[] }>(`SELECT e.id,v.version,v.body,v.sources,v.primary_refs FROM content_editorial_events e
      JOIN content_editorial_versions v ON v.event_id=e.id AND v.version=e.current_version
      WHERE e.group_key=$1 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v.primary_refs) r WHERE split_part(r.value,'@',1)=ANY($2::text[]))
      ORDER BY e.updated_at DESC LIMIT 30`,[groupKey(draft),job.primary_refs.map(r=>r.slice(0,r.lastIndexOf('@')))])).rows;
    const prior=recent.find(p=>sameEvent(p.body,draft,p.primary_refs,job.primary_refs));
    const eventId=prior?.id ?? id('ed');
    const version=(prior?.version ?? 0)+1;
    // Preserve every prior source and historical exact quote in revision history. Current
    // article includes prior provenance too; source access is checked again on reads.
    const sources=[...new Map([...(prior?.sources ?? []),...job.input.sources].map(s=>[s.key,s])).values()];
    const refs=[...new Set([...(prior?.primary_refs ?? []),...job.primary_refs])];
    if (!prior) await tx.query('INSERT INTO content_editorial_events(id,group_key,group_body) VALUES($1,$2,$3::jsonb)',[eventId,groupKey(draft),JSON.stringify(draft.group)]);
    await tx.query('INSERT INTO content_editorial_versions(event_id,version,job_id,body,sources,primary_refs) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)',[eventId,version,job.id,JSON.stringify(draft),JSON.stringify(sources),JSON.stringify(refs)]);
    await tx.query('UPDATE content_editorial_events SET current_version=$2,updated_at=now() WHERE id=$1',[eventId,version]);
    await tx.query("UPDATE content_editorial_jobs SET status='published',error_code=NULL,request_body=NULL,updated_at=now() WHERE id=$1",[job.id]);
  });
}
async function receipt(pool: Pool, core: EditorialCore, job: Job, response: Awaited<ReturnType<Ycore['invocation']>>) {
  if (response.invocation_id) { job.invocation_id=response.invocation_id; await stateJob(pool,job,'inflight',null,response.invocation_id); }
  if (response.status==='succeeded') return publish(pool,core,job,response.output);
  if (response.status==='failed' || response.status==='rejected') return stateJob(pool,job,response.status,response.error_class ?? 'GATEWAY_TERMINAL');
  return stateJob(pool,job,response.status==='unknown' ? 'unknown' : 'inflight',response.status==='unknown' ? 'PENDING_VERIFICATION' : null);
}
export async function editorialOnce(pool: Pool, core: EditorialCore, config: Pick<Config,'modelEnabled'|'modelPolicy'>, maxNew = 3) {
  const connection=await pool.connect();
  let locked=false;
  const result={ synced:false, polled:0, enqueued:0, dispatched:0, blocked_sources:0, busy:false };
  try {
    locked=Boolean((await connection.query("SELECT pg_try_advisory_lock(hashtext('ytrader-editorial-cycle')) locked")).rows[0].locked);
    if (!locked) { result.busy=true; return result; }
    // A process death after dispatch is NOT a pre-dispatch failure. Never re-send it.
    await pool.query("UPDATE content_editorial_jobs SET status=CASE WHEN invocation_id IS NULL THEN 'unknown' ELSE 'inflight' END,error_code='PENDING_VERIFICATION' WHERE status='sending'");
    const inflight=(await pool.query<Job>("SELECT * FROM content_editorial_jobs WHERE status IN ('inflight','unknown') AND invocation_id IS NOT NULL ORDER BY updated_at LIMIT 12")).rows;
    for (const job of inflight) {
      try { await receipt(pool,core,job,await core.invocation(job.invocation_id!)); result.polled++; }
      catch { await stateJob(pool,job,'unknown','POLL_UNAVAILABLE'); }
    }
    if (!config.modelEnabled) await saveState(pool,'model',{enabled:false,gate:'MODEL_DISABLED',checked_at:new Date().toISOString()});
    let bundle;
    try {
      const snapshot=await core.contentSnapshot();
      bundle=parseBundle(snapshot.bundle);
      await importBundle(pool,bundle);
      if (/^(failed|failure|error|unavailable)$/i.test(bundle.source_run.status)) throw new Error('SOURCE_RUN_FAILED');
      await saveState(pool,'sync',{ status:bundle.source_run.status==='partial' ? 'partial' : 'ok',last_success_at:new Date().toISOString(),coverage:snapshot.coverage });
      result.synced=true;
    } catch {
      await saveState(pool,'sync',{ status:'source_error',failure_at:new Date().toISOString(),error_code:'SNAPSHOT_UNAVAILABLE' });
      return result;
    }
    // Reuse the importer's exact company/active-industry relevance linking. Core
    // news need not arrive with handcrafted Change objects or company mappings.
    const linked=await bodies<News>(pool,'SELECT body FROM content_news WHERE id=ANY($1::text[])',[bundle.news.map(n=>n.id)]);
    const links=new Map(linked.map(n=>[n.id,n]));
    // Business relevance is app-owned. The core snapshot provides the permitted
    // canonical company/graph evidence; local reviewed mappings select context.
    const companyCodes=new Set(bundle.companies.map(c=>c.code)), nodeIds=new Set(bundle.nodes.map(n=>n.id));
    bundle.exposures=(await bodies<(typeof bundle.exposures)[number]>(pool,"SELECT body FROM content_exposures WHERE body->>'status'='business' ORDER BY id"))
      .filter(e=>companyCodes.has(e.company_code) && nodeIds.has(e.node_id));
    const candidates=bundle.news.map(n=>({...n,company_codes:links.get(n.id)?.company_codes ?? n.company_codes,node_ids:links.get(n.id)?.node_ids ?? n.node_ids})).filter(eligibleNews).sort((a,b)=> {
      // Current known publications first, then newly discovered undated items, old
      // publications last. An observed timestamp never changes a known old date.
      const rank=(n:typeof a)=>!n.published_at ? 1 : Date.parse(n.published_at)>=Date.now()-7*86400000 && Date.parse(n.published_at)<=Date.now() ? 0 : 2;
      return rank(a)-rank(b) || Date.parse(b.published_at ?? b.observed_at)-Date.parse(a.published_at ?? a.observed_at) || a.id.localeCompare(b.id);
    });
    const cache=new Map();
    // Bounded discovery scan, independent of model enablement. Source import always runs.
    for (const news of candidates.slice(0,80)) {
      const input=await buildInput(bundle,news,core,cache);
      if (!input) { result.blocked_sources++; continue; }
      const fingerprint=inputFingerprint(input);
      const inserted=await pool.query(`INSERT INTO content_editorial_jobs(id,fingerprint,primary_refs,input) VALUES($1,$2,$3::jsonb,$4::jsonb)
        ON CONFLICT(fingerprint) DO NOTHING RETURNING id`,[id('edjob'),fingerprint,JSON.stringify(input.news_keys),JSON.stringify(input)]);
      result.enqueued+=inserted.rowCount ?? 0;
    }
    const blocked = !config.modelEnabled ? 'MODEL_DISABLED' : config.modelPolicy!=='gemini-2.5-flash' ? 'MODEL_POLICY_UNSUPPORTED' : null;
    let gate: string | null=blocked;
    if (!gate) { try { gate=budgetGate(await core.budget()); } catch { gate='BUDGET_UNAVAILABLE'; } }
    await saveState(pool,'model',{ enabled:config.modelEnabled,gate,checked_at:new Date().toISOString() });
    if (gate) return result;
    // Queue order follows financial/source selection above, not random identifiers.
    const jobs=(await pool.query<Job>("SELECT * FROM content_editorial_jobs WHERE status='queued' AND retry_at<=now() ORDER BY created_at,id LIMIT $1",[Math.max(0,Math.min(3,maxNew))])).rows;
    for (const job of jobs) {
      try {
        const budget=await core.budget(); const reason=budgetGate(budget);
        if (reason) { await saveState(pool,'model',{ enabled:true,gate:reason,checked_at:new Date().toISOString() }); break; }
        await validateCurrent(core,job.input.sources);
      } catch { await stateJob(pool,job,'queued','SOURCE_OR_BUDGET_RECHECK_PENDING'); continue; }
      const previous:PreviousEditorial[]=[];
      if (!job.request_body) {
        const prior=(await pool.query<{body:EditorialDraft;sources:EditorialSource[]}>(`SELECT v.body,v.sources FROM content_editorial_events e JOIN content_editorial_versions v ON v.event_id=e.id AND v.version=e.current_version
          WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(v.sources) s WHERE s->>'item_id'=ANY($1::text[])) ORDER BY e.updated_at DESC LIMIT 2`,[job.input.sources.map(s=>s.item_id)])).rows;
        for (const p of prior) {
          try { await validateCurrent(core,p.sources); previous.push({group:p.body.group,change:p.body.change.text,revision:p.body.revision_summary,source_refs:p.sources.map(s=>({item_id:s.item_id,item_version:s.item_version}))}); } catch { /* do not send unpermitted historical context */ }
        }
      }
      let body:unknown;
      try {body=job.request_body ?? modelRequest(job.input,config.modelPolicy,previous);}
      catch(error) {await stateJob(pool,job,'failed',error instanceof Error && ['EDITORIAL_INPUT_TOO_LARGE','MODEL_POLICY_UNSUPPORTED','SOURCE_REF_INVALID'].includes(error.message)?error.message:'REQUEST_BUILD_FAILED');continue;}
      // A saved pre-dispatch retry may include prior editorial context. Recheck
      // every referenced historical version as well as the current input.
      const requestRefs=(body as {input_item_refs?:{item_id:string;version:number}[]}).input_item_refs;
      if(!requestRefs?.length) {await stateJob(pool,job,'failed','REQUEST_SCHEMA_STALE');continue;}
      let refsAllowed=true;
      for (const ref of requestRefs) {
        try { const item=await core.item(ref.item_id,ref.version); if(item.item_id!==ref.item_id || item.version!==ref.version || !permitted(item)) refsAllowed=false; }
        catch {refsAllowed=false;}
        if(!refsAllowed)break;
      }
      if(!refsAllowed) {await stateJob(pool,job,'queued','SOURCE_RECHECK_PENDING');continue;}
      // This commit precedes the network request; request identity is never regenerated.
      const claimed=await pool.query("UPDATE content_editorial_jobs SET status='sending',request_body=$2::jsonb,attempts=attempts+1,updated_at=now() WHERE id=$1 AND status='queued' RETURNING id",[job.id,JSON.stringify(body)]);
      if(!claimed.rowCount)continue;
      try {
        const response=await core.createInvocation(body,`editorial:${job.fingerprint}`);
        result.dispatched++;
        await receipt(pool,core,job,response);
      } catch (error) {
        if (error instanceof UpstreamError && error.definitelyUnaccepted && error.code==='UPSTREAM_RATE_LIMITED' && job.attempts<2) {
          await pool.query("UPDATE content_editorial_jobs SET status='queued',error_code=$2,retry_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1",[job.id,error.code]);
        } else await stateJob(pool,job,error instanceof UpstreamError && error.definitelyUnaccepted ? 'failed' : 'unknown',error instanceof UpstreamError ? error.code : 'PENDING_VERIFICATION');
      }
    }
    return result;
  } finally {
    if (locked) await connection.query("SELECT pg_advisory_unlock(hashtext('ytrader-editorial-cycle'))");
    connection.release();
  }
}
