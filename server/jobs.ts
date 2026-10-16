import { hash, id, transaction, type Tx, type Pool } from './db.js';
import type { Item } from './ycore.js';
// Gateway policy stays fixed; local task identity versions the reviewed pipeline.
export const PROMPT_VERSION = 'first-loop-v1';
export const TASK_VERSION = 'reader-reviewed-v2';
export type ItemRef = { item_id: string; item_version: number };
export function companyInput(item: Item) {
  return ['company_profile','document'].includes(item.item_type) && Boolean(item.metadata?.reviewed);
}
export async function enqueue(tx: Tx, eventId: string, primary: Item, extras: ItemRef[] = []) {
  const refs: ItemRef[] = [{ item_id: primary.item_id, item_version: primary.version },...extras];
  if (refs.length>6 || new Set(refs.map(r => r.item_id)).size !== refs.length) throw new Error('INVALID_INPUT_SET');
  for (const ref of refs) {
    const row = (await tx.query(`SELECT sv.body FROM source_current sc JOIN source_versions sv ON sv.item_id=sc.item_id AND sv.version=sc.version WHERE sc.item_id=$1 AND sc.version=$2 AND sc.availability='available'`,[ref.item_id,ref.item_version])).rows[0];
    const item = row?.body as Item | undefined;
    if (!item?.content || !item.license_scope.store || !item.license_scope.display || !item.license_scope.model || (ref.item_id!==primary.item_id && !companyInput(item))) throw new Error('INPUT_NOT_PERMITTED');
  }
  // A local version bump may replace a terminal failure, never an unresolved paid boundary.
  const unresolved = (await tx.query(`SELECT j.id FROM jobs j WHERE j.item_id=$1 AND j.item_version=$2
    AND j.status IN ('queued','running','blocked','outcome_unknown')
    AND (SELECT count(*) FROM job_inputs i WHERE i.job_id=j.id)=$4
    AND NOT EXISTS(SELECT 1 FROM job_inputs i WHERE i.job_id=j.id AND NOT EXISTS(
      SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS r(item_id text,item_version integer) WHERE r.item_id=i.item_id AND r.item_version=i.item_version))
    ORDER BY j.created_at LIMIT 1`,[primary.item_id,primary.version,JSON.stringify(refs),refs.length])).rows[0];
  if (unresolved) return unresolved.id as string;
  const fingerprint = hash(`${TASK_VERSION}:${JSON.stringify([...refs].sort((a,b) => a.item_id.localeCompare(b.item_id)))}`);
  const jobId = id('job');
  const inserted = await tx.query(`INSERT INTO jobs(id,event_id,item_id,item_version,input_fingerprint,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(input_fingerprint) DO NOTHING RETURNING id`,[jobId,eventId,primary.item_id,primary.version,fingerprint,`ytrader:${fingerprint}`]);
  const actualId = inserted.rowCount ? jobId : (await tx.query('SELECT id FROM jobs WHERE input_fingerprint=$1',[fingerprint])).rows[0].id;
  for (const ref of refs) await tx.query('INSERT INTO job_inputs(job_id,item_id,item_version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[actualId,ref.item_id,ref.item_version]);
  return actualId as string;
}
export async function queueCompanyAnalysis(pool: Pool, eventId: string, refs: ItemRef[]) {
  if (!refs.length) throw new Error('At least one explicit company evidence ref is required');
  return transaction(pool,async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-sync'))");
    const row = (await tx.query(`SELECT sv.body FROM events e JOIN source_current sc ON sc.item_id=e.item_id JOIN source_versions sv ON sv.item_id=sc.item_id AND sv.version=sc.version WHERE e.id=$1 FOR UPDATE OF e`,[eventId])).rows[0];
    if (!row) throw new Error('EVENT_NOT_FOUND');
    const jobId = await enqueue(tx,eventId,row.body,refs);
    // An explicit richer input set supersedes only an un-dispatched automatic job, never an ambiguous paid step.
    await tx.query("UPDATE jobs j SET status='cancelled',error_code='EXPLICIT_EVIDENCE_SUPERSEDES',fencing_token=fencing_token+1,lease_until=NULL WHERE event_id=$1 AND id<>$2 AND step='prepare' AND status IN ('queued','blocked') AND NOT EXISTS(SELECT 1 FROM job_inputs i WHERE i.job_id=j.id AND i.item_id<>j.item_id)",[eventId,jobId]);
    return jobId;
  });
}
