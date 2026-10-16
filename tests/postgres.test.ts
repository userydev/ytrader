import test from 'node:test';
import assert from 'node:assert/strict';
import { poolFor, transaction } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { bootstrapUser } from '../server/auth.js';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { importPage } from '../server/sync.js';
import { analyzeOnce, ensureEditorialSchema } from '../server/analyze.js';
import { eventResponse, markRead } from '../server/reading.js';
import { Ycore, UpstreamError, type ChangePage } from '../server/ycore.js';
import { testItem as baseTestItem, testReport, companyItem, companyReport } from './helpers.js';
import { enqueue, queueCompanyAnalysis, TASK_VERSION, PROMPT_VERSION } from '../server/jobs.js';
import { buildModelRequest, buildReviewRequest, dispatchedModelInputs } from '../server/model-request.js';
import { validateAnalysis } from '../server/analysis-schema.js';
const freshPublishedAt = new Date(Date.now()-3600_000).toISOString();
const testItem = (version = 1) => ({ ...baseTestItem(version), published_at: freshPublishedAt });
const url = process.env.TEST_DATABASE_URL;
test('generation and review use bounded output, the same authorised snapshot, and fixed gateway policy',() => {
  const generated=buildModelRequest([testItem()], 'synthetic-policy');
  const draft=validateAnalysis(testReport(),generated.inputs);
  const review=buildReviewRequest(generated.inputs,draft,'synthetic-policy');
  assert.equal(PROMPT_VERSION,'first-loop-v1'); assert.notEqual(TASK_VERSION,PROMPT_VERSION);
  assert.equal(generated.body.max_output_tokens,6000); assert.equal(generated.body.thinking_budget,1024);
  assert.equal(review.max_output_tokens,1800); assert.equal(review.thinking_budget,256);
  assert.equal(review.prompt_version,'first-loop-v1'); assert.deepEqual(review.input_item_refs,generated.body.input_item_refs);
  assert.deepEqual(dispatchedModelInputs(review),dispatchedModelInputs(generated.body));
  assert.ok(Buffer.byteLength(JSON.stringify(review),'utf8')<=64000);
});
test('disposable PostgreSQL: authentication, monotonic reads, replay, withdrawal and uncertain dispatch', { skip: !url },async t => {
  // Explicitly separate from DATABASE_URL. This suite deletes all product data in the named test database.
  assert.match(new URL(url!).pathname,/test/i,'TEST_DATABASE_URL must name a disposable test database');
  const config = loadConfig({ DATABASE_URL: url, WEB_ORIGIN: 'http://127.0.0.1:5173', DEV_INSECURE_LOCALHOST: 'true', MODEL_ENABLED: 'true' });
  const pool = poolFor(url!); await migrate(pool); await transaction(pool,ensureEditorialSchema);
  const app = await createApp(pool,config);
  async function reset() {
    await pool.query('TRUNCATE users,sessions,login_limits,source_versions,source_current,events,event_versions,jobs,read_state,reading_snapshots CASCADE');
    await pool.query("UPDATE service_state SET value='{\"cursor\":null,\"status\":\"ok\",\"integrity\":\"verified\"}' WHERE key='sync'");
    await bootstrapUser(pool,'only a synthetic test password');
  }
  const page = (v: number, next: string): ChangePage => ({ data: [{ item_id: 'synthetic-only', version: v, change: v===1 ? 'created' : 'updated', changed_at: '2026-01-01T00:00:00Z' }], next_cursor: next, has_more: false });
  class FakeYcore extends Ycore {
    calls=0; uncertain=false; reviewUncertain=false; reviewPending=false; reviewRejectStatus=0; rejectStatus=0; budgetCalls=0; exhaustReviewBudget=false; output: unknown=testReport();
    reviewOutput: unknown={ verdict: 'pass', checks: { facts: 'pass', time: 'pass', comparison: 'not_applicable', supply_demand: 'pass', causality: 'pass', companies: 'pass' }, issues: [] };
    reviewIds=new Set<string>(); keys: string[]=[]; requests: unknown[]=[];
    override get configured() { return true; }
    override async budget() { this.budgetCalls++; return { enabled: true, currency: 'USD' as const, unit: 'micro_usd' as const, day: { limit: 1_000_000, spent: this.exhaustReviewBudget && this.budgetCalls>1 ? 1_000_000 : 0, reserved: 0 }, month: { limit: 10_000_000, spent: 0, reserved: 0 }, unknown_reserved: 0 }; }
    override async createInvocation(body: unknown, key: string) {
      this.calls++; this.keys.push(key); this.requests.push(body); const review=key.endsWith(':review');
      const rejected=review ? this.reviewRejectStatus : this.rejectStatus;
      if (rejected) throw new UpstreamError('PROVED_REJECTION',rejected,true);
      if (review ? this.reviewUncertain : this.uncertain) throw new UpstreamError('UPSTREAM_UNCERTAIN');
      const invocation_id=`synthetic-invocation-${this.calls}`;
      if (review) this.reviewIds.add(invocation_id);
      return { invocation_id, status: 'queued' as const };
    }
    override async invocation(id: string) { return this.reviewIds.has(id) && this.reviewPending ? { status: 'queued' as const } : { status: 'succeeded' as const, output: this.reviewIds.has(id) ? this.reviewOutput : this.output }; }
  }
  try {
    await t.test('web cookie, session hash, CSRF and exact Origin',async () => {
      await reset();
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { password: 'only a synthetic test password', client: 'web' } })).statusCode,403);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.webOrigin }, payload: { password: 'only a synthetic test password', client: 'web' } });
      assert.equal(login.statusCode,200);
      const cookies = login.headers['set-cookie']; const cookie = (Array.isArray(cookies) ? cookies[0] : cookies!).split(';')[0];
      assert.match(String(cookies),/HttpOnly/i); assert.match(String(cookies),/SameSite=Lax/i);
      assert.notEqual((await pool.query('SELECT token_hash FROM sessions')).rows[0].token_hash,cookie.split('=')[1]);
      assert.equal((await app.inject({ url: '/api/v1/auth/session', headers: { cookie } })).statusCode,200);
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, origin: config.webOrigin } })).statusCode,403);
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, origin: `${config.webOrigin}.evil`, 'x-csrf-token': login.json().csrf_token } })).statusCode,403);
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, origin: config.webOrigin, 'x-csrf-token': login.json().csrf_token } })).statusCode,204);
      assert.equal((await app.inject({ url: '/api/v1/auth/session', headers: { cookie } })).statusCode,401);
    });
    await t.test('reimport/publish idempotency; correction atomically withdraws historical explanation; reads MAX',async () => {
      await reset(); const fake = new FakeYcore(config);
      await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null));
      const eventId = (await pool.query('SELECT id FROM events')).rows[0].id;
      const userId = (await pool.query('SELECT id FROM users')).rows[0].id;
      assert.equal(await analyzeOnce(pool,fake,config),true);
      assert.equal(fake.calls,2);
      const current = await eventResponse(pool,userId,eventId);
      assert.equal(current.explanation_status,'ready');
      await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],'c1'));
      await analyzeOnce(pool,fake,config); assert.equal(fake.calls,2);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM event_versions')).rows[0].count,2);
      const reads = await Promise.all([markRead(pool,userId,eventId,2),markRead(pool,userId,eventId,1)]);
      assert.equal(Math.max(...reads),2);
      assert.equal((await pool.query('SELECT last_read_version FROM read_state')).rows[0].last_read_version,2);
      await assert.rejects(markRead(pool,userId,eventId,999));
      await transaction(pool,tx => importPage(tx,page(2,'c2'),[testItem(2)],'c1'));
      const old = await eventResponse(pool,userId,eventId,2);
      assert.equal(old.explanation_status,'withdrawn'); assert.deepEqual(old.paths,[]); assert.deepEqual(old.claims,[]);
      assert.equal((await eventResponse(pool,userId,eventId)).correction_for_reader,true);
      assert.equal((await pool.query("SELECT value->>'cursor' AS cursor FROM service_state WHERE key='sync'")).rows[0].cursor,'c2');
    });
    await t.test('explicit company exposure publishes only with business proof and withdraws on correction',async () => {
      await reset(); const fake = new FakeYcore(config);
      await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null));
      await analyzeOnce(pool,fake,config);
      const eventId=(await pool.query('SELECT id FROM events')).rows[0].id;
      const userId=(await pool.query('SELECT id FROM users')).rows[0].id;
      const cp: ChangePage={ data: [{ item_id: 'synthetic-company', version: 1, change: 'created', changed_at: '2026-01-01T00:00:00Z' }], next_cursor: 'c2', has_more: false };
      await transaction(pool,tx => importPage(tx,cp,[companyItem()],'c1'));
      await queueCompanyAnalysis(pool,eventId,[{ item_id: 'synthetic-company', item_version: 1 }]);
      fake.output=companyReport(); await analyzeOnce(pool,fake,config);
      const enriched=await eventResponse(pool,userId,eventId);
      assert.equal(enriched.companies.length,1); assert.equal(enriched.companies[0].business_evidence[0].source,'测试来源');
      cp.data[0].version=2; cp.data[0].change='updated'; cp.next_cursor='c3';
      await transaction(pool,tx => importPage(tx,cp,[companyItem(2)],'c2'));
      const old=await eventResponse(pool,userId,eventId,enriched.version);
      assert.equal(old.explanation_status,'withdrawn'); assert.deepEqual(old.companies,[]);
      assert.equal((await eventResponse(pool,userId,eventId)).change_kind,'correction');
    });
    await t.test('unknown POST receipt is durable and never automatically charged again',async () => {
      await reset(); const fake = new FakeYcore(config); fake.uncertain=true;
      await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null));
      await analyzeOnce(pool,fake,config); await analyzeOnce(pool,fake,config);
      assert.equal(fake.calls,1);
      const job = (await pool.query('SELECT status,step,invocation_id FROM jobs')).rows[0];
      assert.equal(job.status,'outcome_unknown'); assert.equal(job.step,'dispatched'); assert.equal(job.invocation_id,null);
    });
    await t.test('review receipt and draft survive worker iterations without either paid step repeating',async () => {
      await reset(); const fake=new FakeYcore(config); fake.reviewPending=true;
      await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null));
      await analyzeOnce(pool,fake,config);
      const saved=(await pool.query('SELECT * FROM jobs')).rows[0];
      assert.equal(saved.step,'review_poll'); assert.ok(saved.draft); assert.ok(saved.review_invocation_id); assert.ok(saved.review_request_body); assert.ok(saved.request_body);
      assert.equal((await pool.query('SELECT current_version FROM events')).rows[0].current_version,1);
      await analyzeOnce(pool,fake,config); assert.equal(fake.calls,2);
      fake.reviewPending=false;
      await analyzeOnce(pool,fake,config); assert.equal(fake.calls,2);
      const done=(await pool.query('SELECT * FROM jobs')).rows[0];
      assert.equal(done.status,'succeeded'); assert.equal(done.review_result.verdict,'pass');
      assert.equal(fake.keys[1],`${fake.keys[0]}:review`);
    });
    await t.test('a semantic review issue cannot publish a format-valid mechanism',async () => {
      await reset(); const fake=new FakeYcore(config); fake.output=companyReport();
      const cp: ChangePage={ data: [{ item_id: 'synthetic-company', version: 1, change: 'created', changed_at: '2026-01-01T00:00:00Z' }], next_cursor: 'c2', has_more: false };
      await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null));
      // First retain a valid facts-only version.
      fake.output=testReport(); await analyzeOnce(pool,fake,config);
      const eventId=(await pool.query('SELECT id FROM events')).rows[0].id;
      const userId=(await pool.query('SELECT id FROM users')).rows[0].id;
      await transaction(pool,tx => importPage(tx,cp,[companyItem()],'c1'));
      await queueCompanyAnalysis(pool,eventId,[{ item_id: 'synthetic-company', item_version: 1 }]);
      fake.output=companyReport();
      fake.reviewOutput={ verdict: 'issues', checks: { facts: 'pass', time: 'pass', comparison: 'not_applicable', supply_demand: 'issue', causality: 'issue', companies: 'issue' }, issues: [{ area: 'causality', draft_excerpt: '仅用于测试的条件机制', explanation: '业务引文不能核实此事件到公司业务的传导条件。' }] };
      await analyzeOnce(pool,fake,config);
      const current=await eventResponse(pool,userId,eventId);
      assert.equal(current.version,2); assert.equal(current.explanation_status,'ready'); assert.equal(current.companies.length,0);
      const rejected=(await pool.query("SELECT * FROM jobs WHERE error_code='CONTENT_REVIEW_FAILED'")).rows[0];
      assert.ok(rejected.draft); assert.equal(rejected.review_result.verdict,'issues');
      await analyzeOnce(pool,fake,config); assert.equal(fake.calls,4);
    });
    await t.test('unknown review POST is durable, never resent, and blocks local-version replacement',async () => {
      await reset(); const fake=new FakeYcore(config); fake.reviewUncertain=true;
      await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null));
      await analyzeOnce(pool,fake,config); await analyzeOnce(pool,fake,config);
      const job=(await pool.query('SELECT * FROM jobs')).rows[0];
      assert.equal(fake.calls,2); assert.equal(job.status,'outcome_unknown'); assert.equal(job.step,'review_dispatched'); assert.equal(job.review_invocation_id,null); assert.ok(job.draft);
      // Simulate a prior local task identity without clearing its unresolved paid boundary.
      await pool.query("UPDATE jobs SET input_fingerprint='legacy-unknown-test' WHERE id=$1",[job.id]);
      const same=await transaction(pool,tx => enqueue(tx,job.event_id,testItem()));
      assert.equal(same,job.id); assert.equal((await pool.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n,1);
    });
    await t.test('review respects the shared budget and resumes only its saved draft',async () => {
      await reset(); const fake=new FakeYcore(config); fake.exhaustReviewBudget=true;
      await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null));
      await analyzeOnce(pool,fake,config);
      const job=(await pool.query('SELECT * FROM jobs')).rows[0];
      assert.equal(fake.calls,1); assert.ok(job.draft); assert.equal(job.error_code,'BUDGET_EXHAUSTED'); assert.equal(job.review_invocation_id,null);
      fake.exhaustReviewBudget=false; await analyzeOnce(pool,fake,config); assert.equal(fake.calls,2);
      assert.equal((await pool.query('SELECT status FROM jobs')).rows[0].status,'succeeded');
    });
    await t.test('source update while review is pending erases its draft and prevents publication',async () => {
      await reset(); const fake=new FakeYcore(config); fake.reviewPending=true;
      await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null)); await analyzeOnce(pool,fake,config);
      const old=(await pool.query('SELECT * FROM jobs')).rows[0];
      await transaction(pool,tx => importPage(tx,page(2,'c2'),[testItem(2)],'c1'));
      const erased=(await pool.query('SELECT * FROM jobs WHERE id=$1',[old.id])).rows[0];
      assert.equal(erased.status,'cancelled'); assert.equal(erased.draft,null); assert.equal(erased.review_request_body,null); assert.equal(erased.request_body,null); assert.equal(erased.review_invocation_id,old.review_invocation_id);
      await analyzeOnce(pool,fake,config,old.id); assert.equal(fake.calls,2);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM event_versions WHERE phase='analysis'")).rows[0].n,0);
    });
    await t.test('proved review 400/429 never resend generation or confuse a rejected POST with unknown',async () => {
      for (const status of [400,429]) {
        await reset(); const fake=new FakeYcore(config); fake.reviewRejectStatus=status;
        await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null)); await analyzeOnce(pool,fake,config);
        const job=(await pool.query('SELECT * FROM jobs')).rows[0];
        assert.equal(fake.calls,2); assert.ok(job.draft); assert.equal(job.status,status===400 ? 'failed' : 'blocked');
        assert.equal(job.review_step,status===400 ? 'rejected' : 'prepare');
        if (status===429) { fake.reviewRejectStatus=0; await analyzeOnce(pool,fake,config); assert.equal(fake.calls,3); assert.equal(fake.keys[2],fake.keys[1]); }
      }
    });
    await t.test('proved pre-dispatch 400/429 are not recorded as ambiguous paid calls',async () => {
      for (const status of [400,429]) {
        await reset(); const fake=new FakeYcore(config); fake.rejectStatus=status;
        await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null));
        await analyzeOnce(pool,fake,config);
        const job=(await pool.query('SELECT status,step,invocation_id FROM jobs')).rows[0];
        assert.equal(job.status,status===400 ? 'failed' : 'blocked');
        assert.equal(job.step,status===400 ? 'rejected' : 'prepare'); assert.equal(job.invocation_id,null);
      }
    });
    await t.test('old and unknown publication dates stay in history, while corrections to read events remain visible',async () => {
      for (const publishedAt of ['2000-01-01T00:00:00Z',null]) {
        await reset(); const fake=new FakeYcore(config); const item={ ...testItem(), published_at: publishedAt };
        await transaction(pool,tx => importPage(tx,page(1,'c1'),[item],null)); await analyzeOnce(pool,fake,config);
        const eventId=(await pool.query('SELECT id FROM events')).rows[0].id;
        const userId=(await pool.query('SELECT id FROM users')).rows[0].id;
        const logged=await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.webOrigin }, payload: { password: 'only a synthetic test password', client: 'web' } });
        const cookies=logged.headers['set-cookie']; const cookie=(Array.isArray(cookies) ? cookies[0] : cookies!).split(';')[0];
        const digest=(await app.inject({ url: '/api/v1/digest', headers: { cookie } })).json();
        assert.equal(digest.items.length,0); assert.equal(digest.watch_items.length,0);
        const history=(await app.inject({ url: '/api/v1/events', headers: { cookie } })).json();
        assert.equal(history.data[0].event_id,eventId); assert.equal(history.data[0].source_published_at,publishedAt);
        assert.equal(fake.calls,0);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM jobs')).rows[0].n,0);
        await markRead(pool,userId,eventId,1);
        await transaction(pool,tx => importPage(tx,page(2,'c2'),[{ ...testItem(2), published_at: publishedAt }],'c1'));
        const corrected=(await app.inject({ url: '/api/v1/digest', headers: { cookie } })).json();
        assert.equal(corrected.items.length,0); assert.equal(corrected.corrections[0].event_id,eventId);
      }
    });
    await t.test('rights removal erases stored content and history; transaction rollback leaves cursor unchanged',async () => {
      await reset(); await transaction(pool,tx => importPage(tx,page(1,'c1'),[testItem()],null));
      await assert.rejects(transaction(pool,async tx => { await importPage(tx,page(2,'c2'),[testItem(2)],'c1'); throw new Error('injected rollback'); }));
      assert.equal((await pool.query("SELECT value->>'cursor' AS cursor FROM service_state WHERE key='sync'")).rows[0].cursor,'c1');
      const removal = page(2,'c2'); removal.data[0].change='removed';
      await transaction(pool,tx => importPage(tx,removal,[testItem(2)],'c1'));
      const bodies = (await pool.query('SELECT body FROM source_versions')).rows;
      assert.ok(bodies.every(row => !row.body.content && !row.body.title));
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM jobs WHERE status IN ('queued','running')")).rows[0].count,0);
    });
  } finally { await app.close(); await pool.end(); }
});
