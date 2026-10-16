import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { hash, transaction, type Pool, type Tx } from './db.js';
import { Ycore, UpstreamError, budgetGate, type Item } from './ycore.js';
import { validateAnalysis, validateReview, type Analysis } from './analysis-schema.js';
import { buildModelRequest, buildReviewRequest, dispatchedModelInputs } from './model-request.js';
import type { Config } from './config.js';
type Job = { id: string; event_id: string; item_id: string; item_version: number; input_fingerprint: string; idempotency_key: string; status: string; step: string; invocation_id: string | null; fencing_token: number; request_body: unknown; draft: Analysis | null; review_step: string; review_request_body: unknown; review_invocation_id: string | null; review_result: unknown };
// The original migration runner only knows 001. Apply this forward migration at the
// worker boundary as well, under the same migration lock/checksum discipline.
export async function ensureEditorialSchema(tx: Tx) {
  const sql = await readFile(new URL('../migrations/002_editorial_review.sql',import.meta.url),'utf8');
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-migrations'))");
  const prior = (await tx.query("SELECT checksum FROM schema_migrations WHERE version='002'")).rows[0];
  if (prior && prior.checksum !== hash(sql)) throw new Error('Editorial migration checksum changed');
  if (!prior) { await tx.query(sql); await tx.query("INSERT INTO schema_migrations(version,checksum) VALUES('002',$1)",[hash(sql)]); }
}
async function currentInput(tx: Tx, job: Job): Promise<Item[] | null> {
  const refs = (await tx.query('SELECT item_id,item_version FROM job_inputs WHERE job_id=$1 ORDER BY (item_id=$2) DESC,item_id',[job.id,job.item_id])).rows;
  if (!refs.length) return null;
  const inputs: Item[]=[];
  for (const ref of refs) {
    const row = (await tx.query(`SELECT sv.body FROM source_current sc JOIN source_versions sv ON sv.item_id=sc.item_id AND sv.version=sc.version WHERE sc.item_id=$1 AND sc.version=$2 AND sc.availability='available'`,[ref.item_id,ref.item_version])).rows[0];
    const item = row?.body as Item | undefined;
    if (!item?.license_scope.model || !item.license_scope.display || !item.license_scope.store || !item.content) return null;
    inputs.push({ ...item, content: item.content.slice(0,Math.floor(30000/refs.length)) });
  }
  return inputs;
}
async function claim(pool: Pool, jobId?: string): Promise<Job | null> {
  return transaction(pool, async tx => {
    await ensureEditorialSchema(tx);
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-analysis-worker'))");
    if ((await tx.query('SELECT 1 FROM jobs WHERE lease_until>now() LIMIT 1')).rowCount) return null;
    const result = await tx.query<Job>(`SELECT * FROM jobs WHERE ($1::text IS NULL OR id=$1) AND status IN ('queued','running','blocked','outcome_unknown') AND (lease_until IS NULL OR lease_until<now())
      AND (status<>'outcome_unknown' OR review_invocation_id IS NOT NULL OR (step IN ('poll','dispatched') AND invocation_id IS NOT NULL))
      ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,[jobId ?? null]);
    const job = result.rows[0];
    if (!job) return null;
    // A POST may have been accepted even without a saved receipt. Neither paid step can be resent.
    if ((job.step === 'dispatched' && !job.invocation_id) || (job.review_step === 'dispatched' && !job.review_invocation_id)) {
      await tx.query("UPDATE jobs SET status='outcome_unknown',error_code='PENDING_VERIFICATION',lease_until=NULL,updated_at=now() WHERE id=$1",[job.id]);
      return null;
    }
    return (await tx.query<Job>(`UPDATE jobs SET status='running',lease_until=now()+interval '2 minutes',fencing_token=fencing_token+1,attempts=attempts+1,updated_at=now() WHERE id=$1 RETURNING *`,[job.id])).rows[0];
  });
}
async function update(pool: Pool, job: Job, status: string, code: string | null = null) {
  await pool.query('UPDATE jobs SET status=$3,error_code=$4,lease_until=NULL,updated_at=now() WHERE id=$1 AND fencing_token=$2',[job.id,job.fencing_token,status,code]);
}
async function budgetReady(pool: Pool, ycore: Ycore, config: Config, job: Job) {
  if (!config.modelEnabled || !ycore.configured) { await update(pool,job,'blocked','MODEL_NOT_CONFIGURED'); return false; }
  const budget = await ycore.budget();
  await pool.query(`INSERT INTO service_state(key,value) VALUES('budget',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[budget]);
  const reason = budgetGate(budget);
  if (reason) { await update(pool,job,'blocked',reason); return false; }
  return true;
}
async function saveIntent(pool: Pool, job: Job, body: unknown, review: boolean) {
  return transaction(pool, async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-sync'))");
    await tx.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE',[job.id]);
    if (!await currentInput(tx,job)) return false;
    const sql = review
      ? "UPDATE jobs SET step='review_dispatched',review_step='dispatched',review_request_body=$3,updated_at=now() WHERE id=$1 AND fencing_token=$2 AND status='running' RETURNING id"
      : "UPDATE jobs SET step='dispatched',request_body=$3,updated_at=now() WHERE id=$1 AND fencing_token=$2 AND status='running' RETURNING id";
    return Boolean((await tx.query(sql,[job.id,job.fencing_token,body])).rowCount);
  });
}
export async function analyzeOnce(pool: Pool, ycore: Ycore, config: Config, jobId?: string) {
  const job = await claim(pool,jobId);
  if (!job) return false;
  try {
    const integrity = (await pool.query("SELECT value FROM service_state WHERE key='sync'")).rows[0].value.integrity;
    if (integrity === 'unverified') { await update(pool,job,'blocked','SOURCE_UNVERIFIED'); return true; }
    let input = await transaction(pool,tx => currentInput(tx,job));
    if (!input) { await update(pool,job,'cancelled','SOURCE_CHANGED'); return true; }
    if (!job.invocation_id) {
      if (!await budgetReady(pool,ycore,config,job)) return true;
      const prepared = job.request_body ? { body: job.request_body, inputs: dispatchedModelInputs(job.request_body) } : buildModelRequest(input,config.modelPolicy);
      if (prepared.inputs.length!==input.length || prepared.inputs.some((item,index) => item.item_id!==input![index].item_id || item.version!==input![index].version)) throw new Error('DISPATCH_INPUT_MISMATCH');
      input = prepared.inputs;
      if (!await saveIntent(pool,job,prepared.body,false)) { await update(pool,job,'cancelled','SOURCE_CHANGED'); return true; }
      job.step = 'dispatched'; job.request_body = prepared.body;
      const receipt = await ycore.createInvocation(prepared.body,job.idempotency_key);
      // Save the receipt even if source invalidation fenced off this worker in flight.
      await pool.query('UPDATE jobs SET invocation_id=$2 WHERE id=$1 AND invocation_id IS NULL',[job.id,receipt.invocation_id]);
      const saved = await pool.query("UPDATE jobs SET step='poll',updated_at=now() WHERE id=$1 AND fencing_token=$2 AND status='running' RETURNING id",[job.id,job.fencing_token]);
      if (!saved.rowCount) return true;
      job.invocation_id = receipt.invocation_id; job.step = 'poll';
    } else {
      const sent = dispatchedModelInputs(job.request_body);
      if (sent.length!==input.length || sent.some((item,index) => item.item_id!==input![index].item_id || item.version!==input![index].version)) throw new Error('DISPATCH_INPUT_MISMATCH');
      input = sent;
    }
    if (!job.draft) {
      const invocation = await ycore.invocation(job.invocation_id!);
      if (['queued','dispatched'].includes(invocation.status)) { await update(pool,job,'running'); return true; }
      if (invocation.status === 'unknown') { await update(pool,job,'outcome_unknown','PENDING_VERIFICATION'); return true; }
      if (invocation.status !== 'succeeded') { await update(pool,job,'failed','MODEL_FAILED'); return true; }
      const report = validateAnalysis(invocation.output,input);
      const saved = await transaction(pool,async tx => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-sync'))");
        await tx.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE',[job.id]);
        if (!await currentInput(tx,job)) return false;
        return Boolean((await tx.query("UPDATE jobs SET draft=$3,step='review_prepare',updated_at=now() WHERE id=$1 AND fencing_token=$2 AND status='running' RETURNING id",[job.id,job.fencing_token,report])).rowCount);
      });
      if (!saved) { await update(pool,job,'cancelled','SOURCE_CHANGED'); return true; }
      job.draft = report; job.step = 'review_prepare';
    }
    const report = validateAnalysis(job.draft,input);
    if (!job.review_invocation_id) {
      if (!await budgetReady(pool,ycore,config,job)) return true;
      const body = job.review_request_body ?? buildReviewRequest(input,report,config.modelPolicy);
      if (!await saveIntent(pool,job,body,true)) { await update(pool,job,'cancelled','SOURCE_CHANGED'); return true; }
      job.review_step = 'dispatched'; job.step = 'review_dispatched'; job.review_request_body = body;
      const receipt = await ycore.createInvocation(body,`${job.idempotency_key}:review`);
      await pool.query('UPDATE jobs SET review_invocation_id=$2 WHERE id=$1 AND review_invocation_id IS NULL',[job.id,receipt.invocation_id]);
      const saved = await pool.query("UPDATE jobs SET step='review_poll',review_step='poll',updated_at=now() WHERE id=$1 AND fencing_token=$2 AND status='running' RETURNING id",[job.id,job.fencing_token]);
      if (!saved.rowCount) return true;
      job.review_invocation_id = receipt.invocation_id; job.review_step = 'poll'; job.step = 'review_poll';
    }
    const reviewInputs = dispatchedModelInputs(job.review_request_body);
    if (!isDeepStrictEqual(reviewInputs,input)) throw new Error('REVIEW_INPUT_MISMATCH');
    const invocation = await ycore.invocation(job.review_invocation_id);
    if (['queued','dispatched'].includes(invocation.status)) { await update(pool,job,'running'); return true; }
    if (invocation.status === 'unknown') { await update(pool,job,'outcome_unknown','PENDING_VERIFICATION'); return true; }
    if (invocation.status !== 'succeeded') { await update(pool,job,'failed','REVIEW_FAILED'); return true; }
    const review = validateReview(invocation.output,report);
    await transaction(pool,async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-sync'))");
      const event = (await tx.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[job.event_id])).rows[0];
      const locked = (await tx.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
      if (locked.fencing_token !== job.fencing_token || locked.status !== 'running') return;
      if (!await currentInput(tx,job)) { await tx.query("UPDATE jobs SET status='cancelled',error_code='SOURCE_CHANGED',request_body=NULL,lease_until=NULL WHERE id=$1",[job.id]); return; }
      await tx.query("UPDATE jobs SET review_result=$2,review_step='complete',updated_at=now() WHERE id=$1",[job.id,review]);
      if (review.verdict !== 'pass') {
        await tx.query("UPDATE jobs SET status='failed',step='review_rejected',error_code='CONTENT_REVIEW_FAILED',lease_until=NULL,updated_at=now() WHERE id=$1",[job.id]);
        return;
      }
      // No event mutation before this gate: a rejected richer draft keeps the previous valid version.
      const version = event.current_version+1;
      const published = await tx.query(`INSERT INTO event_versions(event_id,version,item_version,phase,change_kind,change_note,payload,input_fingerprint) VALUES($1,$2,$3,'analysis',$4,$5,$6,$7) ON CONFLICT(event_id,input_fingerprint) DO NOTHING RETURNING version`,[job.event_id,version,job.item_version,event.current_version > 1 ? 'correction' : 'new','已核验本次来源版本，并通过独立事实与机制审核。',report,job.input_fingerprint]);
      if (published.rowCount) {
        await tx.query('UPDATE events SET current_version=$2,substantive_at=now() WHERE id=$1',[job.event_id,version]);
        for (const item of input!) await tx.query('INSERT INTO event_dependencies(event_id,event_version,item_id,item_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[job.event_id,version,item.item_id,item.version]);
      }
      // Exact generation/review requests and draft remain durable until source invalidation erases them.
      await tx.query("UPDATE jobs SET status='succeeded',step='published',error_code=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[job.id]);
    });
  } catch (error) {
    const reviewing = Boolean(job.draft);
    const invocationId = reviewing ? job.review_invocation_id : job.invocation_id;
    const dispatched = reviewing ? job.review_step === 'dispatched' : job.step === 'dispatched';
    if (!invocationId && dispatched && error instanceof UpstreamError && error.definitelyUnaccepted) {
      const limited = error.status===429;
      if (reviewing) await pool.query("UPDATE jobs SET status=$3,step=$4,review_step=$5,error_code=$6,lease_until=NULL,updated_at=now() WHERE id=$1 AND fencing_token=$2",[job.id,job.fencing_token,limited ? 'blocked' : 'failed',limited ? 'review_prepare' : 'review_rejected',limited ? 'prepare' : 'rejected',error.code]);
      else await pool.query('UPDATE jobs SET status=$3,step=$4,error_code=$5,lease_until=NULL,updated_at=now() WHERE id=$1 AND fencing_token=$2',[job.id,job.fencing_token,limited ? 'blocked' : 'failed',limited ? 'prepare' : 'rejected',error.code]);
      return true;
    }
    if (!invocationId && !dispatched && error instanceof UpstreamError) { await update(pool,job,'blocked','UPSTREAM_UNAVAILABLE'); return true; }
    const uncertain = (!invocationId && dispatched) || (Boolean(invocationId) && error instanceof UpstreamError);
    await update(pool,job,uncertain ? 'outcome_unknown' : invocationId || reviewing ? 'failed' : 'blocked',uncertain ? 'PENDING_VERIFICATION' : reviewing ? 'REVIEW_OUTPUT_REJECTED' : invocationId ? 'OUTPUT_REJECTED' : 'UPSTREAM_UNAVAILABLE');
  }
  return true;
}
