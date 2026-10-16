import { isDeepStrictEqual } from 'node:util';
import { hash, id, transaction, type Pool, type Tx } from './db.js';
import { Ycore, UpstreamError, type Item, type ChangePage } from './ycore.js';
import { STOP } from './analysis-schema.js';
import { enqueue, companyInput } from './jobs.js';
export function sourcePayload(item: Item) {
  const display = item.license_scope.display && item.license_scope.store && item.availability === 'available';
  return { summary: display ? item.title : '来源内容暂不可用', core_claim_id: 'source-title', importance: 'exclude',
    importance_reason: '尚未完成重要性与证据核验，不作为已核实大事入选。', occurred_at: null,
    claims: display ? [{ claim_id: 'source-title', content_type: 'source_opinion', evidence_state: 'unverified', text: item.title,
      evidence: [{ item_id: item.item_id, item_version: item.version, locator: '来源标题', quote: '' }] }] : [],
    paths: [], companies: [], stopping_message: STOP };
}
function retained(item: Item): Item {
  if (!item.license_scope.store || !item.license_scope.display || item.availability !== 'available') return { ...item, title: '', content: null, content_kind: 'none' };
  return item;
}
export async function importPage(tx: Tx, page: ChangePage, items: Item[], expectedCursor: string | null) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('ytrader-sync'))");
  const state = (await tx.query("SELECT value FROM service_state WHERE key='sync' FOR UPDATE")).rows[0].value;
  if ((state.cursor ?? null) !== expectedCursor) return false;
  if (page.has_more && (!page.next_cursor || page.next_cursor===expectedCursor)) throw new Error('NONADVANCING_CURSOR');
  for (let index=0; index<page.data.length; index++) {
    const change = page.data[index]; let item = items[index];
    if (item.item_id!==change.item_id || item.version!==change.version) throw new Error('ITEM_REF_MISMATCH');
    if (['removed','retracted'].includes(change.change)) item = { ...item, availability: change.change==='removed' ? 'removed' : 'unavailable', content: null };
    item = retained(item);
    const prior = (await tx.query('SELECT sc.version,sc.availability,sv.body FROM source_current sc JOIN source_versions sv ON sv.item_id=sc.item_id AND sv.version=sc.version WHERE sc.item_id=$1 FOR UPDATE OF sc',[item.item_id])).rows[0];
    if (prior && prior.version>item.version) continue;
    if (prior?.version===item.version && isDeepStrictEqual(prior.body,item)) continue;
    // Different content under an immutable ref is quarantined rather than silently legitimised.
    if (prior?.version===item.version && prior.availability==='available' && item.availability==='available' && item.license_scope.store && item.license_scope.display && isDeepStrictEqual(prior.body.license_scope,item.license_scope)) item = retained({ ...item, availability: 'unavailable' });
    const erased = !item.license_scope.store || !item.license_scope.display || item.availability==='removed';
    if (erased) {
      await tx.query(`UPDATE source_versions SET body=(body-'content'-'title') || '{"content":null,"title":"","content_kind":"none"}'::jsonb WHERE item_id=$1`,[item.item_id]);
      await tx.query(`UPDATE event_versions v SET payload=NULL WHERE event_id IN (SELECT id FROM events WHERE item_id=$1) OR EXISTS(SELECT 1 FROM event_dependencies d WHERE d.event_id=v.event_id AND d.event_version=v.version AND d.item_id=$1)`,[item.item_id]);
      await tx.query('UPDATE jobs j SET request_body=NULL WHERE item_id=$1 OR EXISTS(SELECT 1 FROM job_inputs i WHERE i.job_id=j.id AND i.item_id=$1)',[item.item_id]);
    }
    await tx.query('INSERT INTO source_versions(item_id,version,body) VALUES($1,$2,$3) ON CONFLICT(item_id,version) DO UPDATE SET body=EXCLUDED.body',[item.item_id,item.version,item]);
    await tx.query('INSERT INTO source_current(item_id,version,availability) VALUES($1,$2,$3) ON CONFLICT(item_id) DO UPDATE SET version=EXCLUDED.version,availability=EXCLUDED.availability',[item.item_id,item.version,item.availability]);
    // Full explanation is conservatively withdrawn if ANY input changes, including company business evidence.
    const affected = (await tx.query(`SELECT DISTINCT e.id FROM events e JOIN event_dependencies d ON d.event_id=e.id WHERE d.item_id=$1 ORDER BY e.id`,[item.item_id])).rows;
    for (const dependency of affected) {
      const event = (await tx.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[dependency.id])).rows[0];
      await tx.query("UPDATE event_versions SET withdrawn=true WHERE event_id=$1 AND phase='analysis'",[event.id]);
      if (event.item_id!==item.item_id) {
        const primary = (await tx.query('SELECT sv.body FROM source_current sc JOIN source_versions sv ON sv.item_id=sc.item_id AND sv.version=sc.version WHERE sc.item_id=$1',[event.item_id])).rows[0].body as Item;
        const fingerprint = hash(`invalidation:${event.id}:${item.item_id}:${item.version}:${JSON.stringify(item.license_scope)}:${item.availability}`);
        const inserted = await tx.query(`INSERT INTO event_versions(event_id,version,item_version,phase,input_fingerprint,change_kind,change_note,payload) VALUES($1,$2,$3,'source',$4,'correction','公司业务证据已变化，依赖解释已撤回，等待新证据核验。',$5) ON CONFLICT(event_id,input_fingerprint) DO NOTHING RETURNING version`,[event.id,event.current_version+1,primary.version,fingerprint,sourcePayload(primary)]);
        if (inserted.rowCount) await tx.query('UPDATE events SET current_version=$2,substantive_at=now() WHERE id=$1',[event.id,event.current_version+1]);
      }
    }
    await tx.query(`UPDATE jobs j SET status='cancelled',error_code='SOURCE_CHANGED',request_body=NULL,updated_at=now(),fencing_token=fencing_token+1,lease_until=NULL WHERE (item_id=$1 OR EXISTS(SELECT 1 FROM job_inputs i WHERE i.job_id=j.id AND i.item_id=$1)) AND status NOT IN ('succeeded','failed','cancelled')`,[item.item_id]);
    if (companyInput(item) || item.item_type==='company_profile') continue;
    let event = (await tx.query('SELECT * FROM events WHERE item_id=$1 FOR UPDATE',[item.item_id])).rows[0];
    if (!event) event = (await tx.query('INSERT INTO events(id,item_id) VALUES($1,$2) RETURNING *',[id('evt'),item.item_id])).rows[0];
    await tx.query("UPDATE event_versions SET withdrawn=true WHERE event_id=$1 AND phase='analysis'",[event.id]);
    const fingerprint = hash(`source:${item.item_id}:${item.version}:${item.availability}:${JSON.stringify(item.license_scope)}`);
    const inserted = await tx.query(`INSERT INTO event_versions(event_id,version,item_version,phase,input_fingerprint,change_kind,change_note,payload) VALUES($1,$2,$3,'source',$4,$5,$6,$7) ON CONFLICT(event_id,input_fingerprint) DO NOTHING RETURNING version`,[event.id,event.current_version+1,item.version,fingerprint,prior ? 'correction' : 'new',prior ? '来源版本或权限已变化，原解释已撤回，等待重新核验。' : '首次收录，等待核验。',sourcePayload(item)]);
    if (inserted.rowCount) await tx.query('UPDATE events SET current_version=$2,substantive_at=now() WHERE id=$1',[event.id,event.current_version+1]);
    const published = item.published_at ? Date.parse(item.published_at) : NaN;
    const fresh = Number.isFinite(published) && published<=Date.now() && published>=Date.now()-86_400_000;
    if (fresh && item.availability==='available' && item.license_scope.model && item.license_scope.store && item.license_scope.display && item.content && item.content_kind!=='none') await enqueue(tx,event.id,item);
  }
  await tx.query("UPDATE service_state SET value=$1,updated_at=now() WHERE key='sync'",[{ cursor: page.next_cursor ?? expectedCursor, status: 'ok', last_success_at: new Date().toISOString(), integrity: 'verified', has_more: page.has_more }]);
  return true;
}
export async function syncOnce(pool: Pool, ycore: Ycore) {
  const state = (await pool.query("SELECT value FROM service_state WHERE key='sync'")).rows[0].value;
  if (state.integrity==='unverified') throw new Error('SNAPSHOT_RECOVERY_REQUIRED');
  try {
    const [page,coverage] = await Promise.all([ycore.changes(state.cursor ?? null),ycore.sources()]);
    const items: Item[]=[];
    for (const change of page.data) items.push(await ycore.item(change.item_id,change.version));
    await transaction(pool,async tx => {
      if (await importPage(tx,page,items,state.cursor ?? null)) await tx.query("INSERT INTO service_state(key,value) VALUES('coverage',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",[coverage]);
    });
    return page.has_more;
  } catch (error) {
    const code = error instanceof UpstreamError ? error.code : 'SYNC_FAILED';
    await pool.query("UPDATE service_state SET value=value || $1::jsonb,updated_at=now() WHERE key='sync'",[{ status: ycore.configured ? 'unavailable' : 'not_configured', error_code: code, failure_at: new Date().toISOString(), ...(code==='CURSOR_EXPIRED' ? { integrity: 'unverified' } : {}) }]);
    throw error;
  }
}
