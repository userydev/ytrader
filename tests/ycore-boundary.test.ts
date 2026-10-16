import test from 'node:test';
import assert from 'node:assert/strict';
import { itemSchema, budgetSchema, budgetGate, sourceStatusSchema, invocationSchema, withCompanyMapping } from '../server/ycore.js';
import { validateAnalysis } from '../server/analysis-schema.js';
import { buildModelRequest, dispatchedModelInputs, FIXED_PROMPT_BYTE_ALLOWANCE, REQUEST_BYTE_LIMIT } from '../server/model-request.js';
import { isRecentPublication } from '../server/reading.js';
import { coreItem, coreBudget, testItem, testReport } from './helpers.js';
test('core items preserve source classification and group lineage, without fabricated company metadata',() => {
  const raw=coreItem(); const item=itemSchema.parse(raw);
  assert.equal(item.source,'测试来源'); assert.equal(item.item_type,'news'); assert.equal(item.source_classification,'primary');
  assert.equal(item.independence_key,'same-publisher'); assert.equal(item.content_kind,'full'); assert.equal(item.license_scope.model,true);
  assert.equal(item.metadata,undefined);
  const invented=itemSchema.parse({ ...raw, metadata: { company_id: 'SSE.000001', company_name: 'untrusted', reviewed: true } });
  assert.equal(invented.metadata,undefined);
  const document=itemSchema.parse({ ...raw, item_type: 'company_profile' });
  const mapping={ item_id: raw.item_id, item_version: 1, company_id: 'SSE.000001', company_name: '合成测试公司', reviewed: true as const };
  assert.equal(withCompanyMapping(document,mapping).metadata?.company_name,'合成测试公司');
  assert.throws(() => withCompanyMapping(document,{ ...mapping, item_version: 2 }));
  assert.throws(() => withCompanyMapping(item,mapping));
});
test('discovery-only metadata survives but no body/model grant is invented; retractions and current rights prevail',() => {
  const raw=coreItem();
  const metadata=itemSchema.parse({ ...raw, content_kind: 'metadata', source: { ...raw.source,
    rights: { discovery: true, store_fulltext: false, ai_input: true }, current_rights: { discovery: true, store_fulltext: false, ai_input: true } } });
  assert.equal(metadata.title,raw.title); assert.equal(metadata.url,raw.url); assert.equal(metadata.content,null);
  assert.deepEqual(metadata.license_scope,{ store: true, display: true, model: false });
  assert.equal(metadata.content_kind,'none');
  const revoked=itemSchema.parse({ ...raw, source: { ...raw.source, current_rights: { discovery: false, store_fulltext: false, ai_input: false } } });
  assert.equal(revoked.content,null); assert.equal(revoked.title,''); assert.equal(revoked.license_scope.model,false);
  const retracted=itemSchema.parse({ ...raw, availability: 'retracted' });
  assert.equal(retracted.availability,'unavailable'); assert.equal(retracted.license_scope.model,false);
  assert.equal(itemSchema.parse({ ...raw, content_kind: 'tombstone' }).availability,'unavailable');
  assert.equal(itemSchema.parse({ ...raw, content: undefined }).license_scope.model,false);
});
test('primary is based on source classification, while duplicate origin groups never corroborate each other',() => {
  const first=itemSchema.parse(coreItem()); const report=testReport();
  report.claims[0].evidence[0].item_id=first.item_id;
  assert.equal(validateAnalysis(report,[first]).claims[0].evidence_state,'primary');
  const secondary={ ...first, item_type: 'official', source_classification: 'secondary' as const };
  assert.throws(() => validateAnalysis(report,[secondary]));
  const second={ ...first, item_id: 'different-feed-item', source: '另一个订阅源名称' };
  report.claims[0].evidence_state='corroborated'; report.claims[0].evidence.push({ ...report.claims[0].evidence[0], item_id: second.item_id });
  assert.throws(() => validateAnalysis(report,[first,second]));
  assert.equal(validateAnalysis(report,[first,{ ...second, independence_key: 'independent-publisher' }]).claims[0].evidence_state,'corroborated');
});
test('budget enforcement uses exact micro-USD, not rounded decimal dollars or cents',() => {
  const raw=coreBudget(); raw.day.micro_usd.spent=999_999; raw.day.micro_usd.reserved=1;
  assert.equal(budgetGate(budgetSchema.parse(raw)),'BUDGET_EXHAUSTED');
  raw.day.micro_usd.spent=0; raw.day.micro_usd.reserved=0;
  raw.month.micro_usd.spent=9_999_999; raw.month.micro_usd.reserved=1;
  assert.equal(budgetGate(budgetSchema.parse(raw)),'BUDGET_EXHAUSTED');
  raw.month.micro_usd.spent=0; raw.month.micro_usd.reserved=0; raw.day.micro_usd.limit=1_000_001;
  assert.equal(budgetGate(budgetSchema.parse(raw)),'BUDGET_POLICY_UNVERIFIED');
  raw.day.micro_usd.limit=1_000_000; raw.day.micro_usd.reserved=600_000; raw.month.micro_usd.reserved=600_000;
  raw.unknown_reserved_micro_usd=600_000;
  assert.equal(budgetGate(budgetSchema.parse(raw)),null,'unknown reservations are already included, not added again');
  assert.throws(() => budgetSchema.parse({ ...raw, pool_policy: 'unverified' }));
  assert.throws(() => budgetSchema.parse({ ...raw, day: { ...raw.day, micro_usd: { ...raw.day.micro_usd, spent: 0.5 } } }));
});
test('source summary distinguishes unconfigured, failed, partial, stale and healthy without inventing coverage',() => {
  const raw=coreItem();
  const source={ ...raw.source, license_scope: raw.license_scope,
    capabilities: { stream: true, bounded_search: false, document_import: false }, status: 'healthy',
    last_attempt: raw.fetched_at, last_success: raw.fetched_at, error_code: null,
    coverage: { start: null, end: null, completeness: 'observed_only' }, watermark: null, interval_seconds: 300, age_seconds: 0, delay_seconds: 0 };
  assert.equal(sourceStatusSchema.parse({ data: [] }).status,'not_configured');
  assert.equal(sourceStatusSchema.parse({ data: [{ ...source, status: 'disabled' }] }).status,'not_configured');
  assert.equal(sourceStatusSchema.parse({ data: [{ ...source, status: 'never_ingested', last_success: null }] }).status,'unavailable');
  assert.equal(sourceStatusSchema.parse({ data: [{ ...source, status: 'error' }] }).status,'unavailable');
  assert.equal(sourceStatusSchema.parse({ data: [{ ...source, status: 'stale' }] }).status,'stale');
  assert.equal(sourceStatusSchema.parse({ data: [source] }).status,'ok');
  const partial=sourceStatusSchema.parse({ data: [source,{ ...source, id: 'other', status: 'error' }] });
  assert.equal(partial.status,'partial'); assert.match(partial.sources[0].coverage_note,/不代表完整覆盖/);
});
test('billed failures, exceeded bounds and missing successful output are never publishable success',() => {
  for (const status of ['failed_billed','exceeded_bound']) assert.equal(invocationSchema.parse({ status }).status,'failed');
  for (const output of [undefined,'','   ']) assert.equal(invocationSchema.parse({ status: 'succeeded', output }).status,'failed');
  assert.equal(invocationSchema.parse({ status: 'unknown' }).status,'unknown');
  assert.equal(invocationSchema.parse({ status: 'succeeded', output: '{}' }).status,'succeeded');
});
test('wire request bounds include nested UTF8 JSON; restarts validate exactly the dispatched prefixes',() => {
  const item={ ...testItem(), content: '中文正文\\"😀'.repeat(20000) };
  const { body,inputs }=buildModelRequest([item],'gemini-2.5-flash');
  assert.ok(Buffer.byteLength(JSON.stringify(body),'utf8')<=REQUEST_BYTE_LIMIT);
  assert.ok(body.max_input_tokens>=Buffer.byteLength(JSON.stringify(body.messages),'utf8')+FIXED_PROMPT_BYTE_ALLOWANCE+1024);
  assert.equal(body.messages.length,1); assert.equal(body.messages[0].role,'user');
  assert.deepEqual(body.input_item_refs,[{ item_id: item.item_id, version: item.version }]);
  assert.ok(item.content.startsWith(inputs[0].content!)); assert.ok(inputs[0].content!.length<item.content.length);
  assert.deepEqual(dispatchedModelInputs(body),inputs);
  assert.throws(() => buildModelRequest([{ ...item, title: '过大元数据'.repeat(40000), content: '' }],'gemini-2.5-flash'));
});
test('old/unknown/future publication dates cannot become today just because analysis ran now',() => {
  const now=Date.parse('2026-10-16T12:00:00Z');
  assert.equal(isRecentPublication(null,now),false);
  assert.equal(isRecentPublication('2020-01-01T00:00:00Z',now),false);
  assert.equal(isRecentPublication('2026-10-16T13:00:00Z',now),false);
  assert.equal(isRecentPublication('2026-10-16T11:00:00Z',now),true);
});
