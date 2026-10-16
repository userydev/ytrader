import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Company, ContentBundle, Evidence, Exposure, IndustryEdge, News } from '../src/content-types.js';
import type { Item } from '../server/ycore.js';
import { parseBundle, parseBundleJSON, MAX_BUNDLE_BYTES } from '../server/content/schema.js';
import { explainNews, METHODS, missingForNews } from '../server/content/methods.js';
import { buildBriefing, parseReferenceIds } from '../server/content/briefing.js';
import { projectExisting } from '../server/content/existing.js';
import { importBundle } from '../server/content/store.js';
import { migrateContent } from '../server/content/migrate.js';
import { createContentApp } from '../server/content/app.js';
import type { Pool } from '../server/db.js';
import { linkNews } from '../server/content/linking.js';
const now = '2026-10-16T08:00:00Z';
const evidence: Evidence = { provider: 'provider-test', url: 'https://example.com/disclosure', title: '明确来源', observed_at: now, as_of: null, verification: 'provider' };
const news: News = { id: 'n1', title: '原材料涨价，某公司有望受益（标题不是依据）', summary: null, url: 'https://example.com/news', source: 'provider-test',
  published_at: null, observed_at: now, verification: 'provider', node_ids: ['ifind:buyer'], company_codes: [], evidence: [evidence] };
const edge: IndustryEdge = { id: 'e1', from_id: 'ifind:seller', to_id: 'ifind:buyer', kind: 'input', evidence: [evidence] };
const company: Company = { code: '000001.SZ', name: '测试公司', business: '生产明确原料', products: ['原料'], report_period: null, financials: [], evidence: [evidence] };
const exposure: Exposure = { id: 'x1', company_code: company.code, node_id: 'ifind:seller', role: '销售方', basis: '有出处的主营匹配', evidence: [evidence], status: 'candidate' };
const triggered: News = { ...news, change: { variable: 'input_cost', direction: 'up', node_id: 'ifind:buyer', basis: '投入品成本同比上升，口径待进一步核实', evidence: [evidence] } };
const context = { edges: [edge], exposures: [exposure], companies: [company] };
function bundle(): ContentBundle { return { schema_version: 1, observed_at: now, source_run: { id: 'run1', provider: 'provider-test', status: 'success', started_at: now, finished_at: now },
  nodes: [{ id: 'ifind:buyer', name: '使用侧', aliases: [], root_ids: [], evidence: [evidence] }, { id: 'ifind:seller', name: '供应侧', aliases: [], root_ids: [], evidence: [evidence] }],
  edges: [edge], companies: [company], exposures: [exposure], news: [triggered], observations: [] }; }

test('schema rejects duplicates, oversized input, fabricated business basis and dangling change references', () => {
  assert.equal(parseBundle(bundle()).schema_version, 1);
  const b = bundle(); b.nodes.push(b.nodes[0]); assert.throws(() => parseBundle(b));
  assert.throws(() => parseBundleJSON(' '.repeat(MAX_BUNDLE_BYTES + 1)));
  assert.throws(() => parseBundle({ ...bundle(), exposures: [{ ...exposure, status: 'business', basis: '', evidence: [] }] }));
  assert.throws(() => parseBundle({ ...bundle(), news: [{ ...triggered, node_ids: [] }] }));
  assert.throws(() => parseBundle({ ...bundle(), observations: [{ id: 'o', node_id: 'ifind:buyer', label: '库存', date: '2026-02-30', value: '1', unit: '吨', source: 'test', evidence: [] }] }));
});
test('headlines, unverified changes and classification do not produce transmission; candidates never become beneficiaries', () => {
  assert.deepEqual(explainNews(news, context), []);
  assert.match(missingForNews(news).join(' '), /待核实触发条件/);
  assert.deepEqual(explainNews({ ...triggered, change: { ...triggered.change!, evidence: [{ ...evidence, verification: 'unverified' }] } }, context), []);
  assert.deepEqual(explainNews({ ...triggered, verification: 'unverified' }, context), []);
  const classified = explainNews(triggered, { ...context, edges: [{ ...edge, kind: 'classification' }] });
  assert.equal(classified.length, 1); assert.equal(classified[0].node_id, 'ifind:buyer');
  const results = explainNews(triggered, context);
  assert.equal(results.length, 2); assert(results.every(m => m.company_code === null));
  assert(results.every(m => m.status === 'conditional' && m.method_version === METHODS.version));
});
test('verified structure keeps fact/structure/inference and company financial gaps separate', () => {
  const results = explainNews(triggered, { ...context, exposures: [{ ...exposure, status: 'business' }] });
  const companyResult = results.find(m => m.company_code === company.code)!;
  assert(companyResult); assert(companyResult.steps.some(s => s.kind === 'fact' && s.evidence.length));
  assert(companyResult.steps.some(s => s.kind === 'structure' && s.edge_id === edge.id));
  assert(companyResult.steps.some(s => s.kind === 'structure' && s.exposure_id === exposure.id));
  assert(companyResult.steps.filter(s => s.kind === 'inference').every(s => !s.evidence.length));
  assert.match(companyResult.missing_evidence.join(' '), /缺少有出处的公司财务/);
  assert.deepEqual(results, explainNews(triggered, { ...context, exposures: [{ ...exposure, status: 'business' }] }));
});
test('inventory and policy do not imply demand or a cross-industry directional benefit', () => {
  for (const variable of ['inventory','policy'] as const) {
    const results = explainNews({ ...triggered, change: { ...triggered.change!, variable } }, context);
    assert.equal(results.length, 1); assert.equal(results[0].node_id, 'ifind:buyer');
    assert.equal(results[0].variable, variable); assert(results[0].conditions.length > 0);
  }
});
test('adapted briefing maps company/source references, never substitutes collection time or mere presence for freshness', () => {
  const refs = parseReferenceIds('ticker:000001.sz,not-a-reference,ticker:600000.SH');
  assert(refs.has('000001.SZ'));
  const unknown = buildBriefing([{ ...news, company_codes: [company.code] }], [company], refs, 6, new Date(now));
  assert.equal(unknown.dataFreshness.state, 'unknown'); assert.equal(unknown.data.items[0].occurredAt, null);
  assert.equal(unknown.data.items[0].source.publishedAt, null);
  assert.equal(unknown.data.items[0].referenceObjects[0].displayName, company.name);
  const old = buildBriefing([{ ...news, published_at: '2020-01-01T00:00:00Z' }], [], new Set(), 6, new Date(now));
  assert.equal(old.dataFreshness.state, 'stale');
  const future = buildBriefing([{ ...news, published_at: '2027-01-01T00:00:00Z' }], [], new Set(), 6, new Date(now));
  assert.equal(future.dataFreshness.state, 'unknown');
});
test('existing projection respects display/store rights, reviewed references and null publication without touching model rights', () => {
  const item: Item = { item_id: 's1', version: 1, source: 'provider-test', title: '有显示许可的标题', url: news.url, published_at: null,
    first_seen_at: now, fetched_at: now, content: '不应复制的正文', content_kind: 'full', item_type: 'document', language: 'zh',
    metadata: { company_id: 'SZSE.000001', company_name: company.name, reviewed: true }, license_scope: { store: true, display: true, model: false }, availability: 'available' };
  const before = JSON.stringify(item); const projected = projectExisting(item, new Set([company.code]))!;
  assert.equal(projected.summary, null); assert.equal(projected.published_at, null);
  assert.deepEqual(projected.company_codes, [company.code]); assert.equal(JSON.stringify(item), before);
  assert.equal(projectExisting({ ...item, license_scope: { ...item.license_scope, display: false } }, new Set()), null);
  assert.equal(projectExisting({ ...item, availability: 'removed' }, new Set()), null);
  assert.deepEqual(projectExisting({ ...item, metadata: { ...item.metadata!, reviewed: false } }, new Set([company.code]))!.company_codes, []);
});

test('exact entity linking adds relevance only and reuses saved exposures/mappings without generic directory guessing', () => {
  const normalized: News = { ...news, id: 'unlinked', title: '测试公司披露明确金属业务', summary: null, node_ids: [], company_codes: [] };
  const linked = linkNews([normalized], {
    companies: [{ code: company.code, name: company.name }],
    nodes: [{ id: 'ifind:buyer', name: '明确金属', aliases: [] }, { id: 'ifind:generic', name: '业务', aliases: ['公司'] }],
    exposures: [{ company_code: company.code, node_id: 'ifind:seller' }], saved_news: []
  })[0];
  assert.deepEqual(linked.company_codes, [company.code]);
  assert.deepEqual(linked.node_ids, ['ifind:buyer','ifind:seller']);
  assert.equal(linked.change, undefined); assert.deepEqual(normalized.node_ids, []);
  assert.equal(exposure.status, 'candidate');
  const refreshed = linkNews([{ ...normalized, title: '来源的无关联更新' }], { companies: [], nodes: [], exposures: [], saved_news: [linked] })[0];
  assert.deepEqual(refreshed.node_ids, linked.node_ids); assert.deepEqual(refreshed.company_codes, linked.company_codes);
  assert.equal(linkNews([{ ...normalized, title: '000001.SZ 发布报告' }], { companies: [company], nodes: [], exposures: [], saved_news: [] })[0].company_codes[0], company.code);
});

test('runnable content app registers all contract GETs behind existing login', async () => {
  const pool = { query: async () => { throw new Error('Unexpected database access before login'); } } as unknown as Pool;
  const app = await createContentApp(pool, { databaseUrl: 'postgresql://unused', host: '127.0.0.1', port: 3001,
    webOrigin: 'http://127.0.0.1:5173', nativeOrigin: 'capacitor://localhost', secureCookie: false,
    ycoreUrl: undefined, ycoreToken: undefined, modelEnabled: false, modelPolicy: 'disabled' });
  try {
    for (const path of ['overview','news','news/:id','industries','industries/:id','companies','companies/:code','methods']) {
      assert(app.hasRoute({ method: 'GET', url: `/api/v1/content/${path}` }));
    }
    const response = await app.inject({ method: 'GET', url: '/api/v1/content/overview' });
    assert.equal(response.statusCode, 401);
  } finally { await app.close(); }
});

// Optional host-owned PostgreSQL check. Dedicated schema only; no test is run by this worker.
test('postgres: import is idempotent, parameterized, atomic; failed source run preserves facts', { skip: !process.env.CONTENT_TEST_DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.CONTENT_TEST_DATABASE_URL, max: 1 });
  const schema = `content_test_${randomUUID().replaceAll('-', '')}`;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await migrateContent(pool);
    const b = bundle(); b.news[0].title = "标题'); DROP TABLE content_nodes; --";
    await importBundle(pool, b); await importBundle(pool, b);
    assert.equal((await pool.query('SELECT count(*)::int n FROM content_news')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM content_exposures')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM content_news_nodes')).rows[0].n, 1);
    const snapshot = (await pool.query('SELECT updated_at FROM content_news')).rows[0].updated_at.toISOString();
    await importBundle(pool, b);
    assert.equal((await pool.query('SELECT updated_at FROM content_news')).rows[0].updated_at.toISOString(), snapshot);
    const invalid = bundle(); invalid.companies.push({ ...company, code: '600000.SH' }); invalid.edges[0] = { ...edge, to_id: 'ifind:missing' };
    await assert.rejects(importBundle(pool, invalid), /DANGLING_REFERENCE/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM content_companies')).rows[0].n, 1);
    const empty = bundle(); empty.nodes = []; empty.edges = []; empty.companies = []; empty.exposures = []; empty.news = [];
    empty.source_run = { ...empty.source_run, id: 'failed', status: 'failed', error: 'provider unavailable' };
    await importBundle(pool, empty);
    const failedReplacement = bundle(); failedReplacement.source_run = { ...empty.source_run, id: 'failed-replacement' };
    failedReplacement.companies[0] = { ...company, business: '', financials: [], evidence: [] };
    await importBundle(pool, failedReplacement);
    assert.equal((await pool.query('SELECT count(*)::int n FROM content_news')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT body FROM content_companies WHERE code=$1', [company.code])).rows[0].body.business, company.business);
    const taxonomy = bundle(); taxonomy.companies = []; taxonomy.edges = []; taxonomy.exposures = []; taxonomy.news = [];
    taxonomy.nodes = [{ id: 'ifind:root', name: '一级目录', aliases: [], root_ids: [], evidence: [] },
      { id: 'ifind:buyer', name: '使用侧', aliases: ['明确使用别名'], root_ids: ['ifind:root'], evidence: [evidence] }];
    await importBundle(pool, taxonomy);
    const thin = { ...taxonomy, nodes: [{ ...taxonomy.nodes[1], aliases: [], root_ids: [], evidence: [] }] };
    await importBundle(pool, thin);
    const savedNode = (await pool.query("SELECT body FROM content_nodes WHERE id='ifind:buyer'")).rows[0].body;
    assert.deepEqual(savedNode.root_ids, ['ifind:root']); assert.deepEqual(savedNode.aliases, ['明确使用别名']);
    assert.equal((await pool.query("SELECT count(*)::int n FROM content_node_roots WHERE node_id='ifind:buyer'")).rows[0].n, 1);
    const unlinked = { ...taxonomy, nodes: [], news: [{ ...news, id: 'n2', title: '测试公司：明确使用别名的最新资料', node_ids: [], company_codes: [] }] };
    await importBundle(pool, unlinked);
    const linked = (await pool.query("SELECT body FROM content_news WHERE id='n2'")).rows[0].body;
    assert.deepEqual(linked.company_codes, [company.code]); assert(linked.node_ids.includes('ifind:seller')); assert(linked.node_ids.includes('ifind:buyer'));
    assert.equal(linked.change, undefined);
    await importBundle(pool, { ...unlinked, news: [{ ...unlinked.news[0], title: '来源无关联更新' }] });
    assert.deepEqual((await pool.query("SELECT body FROM content_news WHERE id='n2'")).rows[0].body.node_ids, linked.node_ids);
  } finally {
    await pool.query('SET search_path TO public');
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
