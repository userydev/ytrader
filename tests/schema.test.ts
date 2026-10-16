import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis, validateReview, route, STOP } from '../server/analysis-schema.js';
import { itemSchema, budgetGate, budgetSchema } from '../server/ycore.js';
import { hashPassword, verifyPassword } from '../server/auth.js';
import { loadConfig } from '../server/config.js';
import { testItem, testReport, companyItem, companyReport, coreItem, coreBudget } from './helpers.js';
test('company exposure needs explicit reviewed business evidence and an event mechanism',() => {
  assert.equal(validateAnalysis(companyReport(),[testItem(),companyItem()]).companies.length,1);
  assert.throws(() => validateAnalysis(companyReport(),[testItem()]));
  const unreviewed = companyItem(); unreviewed.metadata!.reviewed=false;
  assert.throws(() => validateAnalysis(companyReport(),[testItem(),unreviewed]));
  const wrong = companyReport(); wrong.companies[0].mechanism_path=9;
  assert.throws(() => validateAnalysis(wrong,[testItem(),companyItem()]));
  const wrongIdentity = companyReport(); wrongIdentity.companies[0].name='另一公司';
  assert.throws(() => validateAnalysis(wrongIdentity,[testItem(),companyItem()]));
});
test('scrypt is salted, verifies, and refuses short bootstrap passwords',async () => {
  const password = 'a sufficiently long test password';
  const one = await hashPassword(password); const two = await hashPassword(password);
  assert.notEqual(one,two); assert.equal(await verifyPassword(password,one),true); assert.equal(await verifyPassword('wrong',one),false);
  await assert.rejects(hashPassword('short'));
});
test('schema rejects fabricated source refs, quotations, missing conditions and unsupported numeric claims',() => {
  assert.equal(route(validateAnalysis(testReport(),[testItem()])),'main');
  const wrongRef = testReport(); wrongRef.claims[0].evidence[0].item_version=2;
  assert.throws(() => validateAnalysis(wrongRef,[testItem()]));
  const wrongQuote = testReport(); wrongQuote.claims[0].evidence[0].quote='不存在的原文';
  assert.throws(() => validateAnalysis(wrongQuote,[testItem()]));
  assert.throws(() => validateAnalysis({ ...testReport(), paths: [{ name: '环节', mechanism: '测试机制', conditions: [], counterforces: ['测试因素'], direction: 'uncertain', claim_ids: ['c1'] }] },[testItem()]));
  const numbers = testReport(); numbers.summary=numbers.claims[0].text='测试规模123';
  assert.throws(() => validateAnalysis(numbers,[testItem()]));
  const rights = testItem(); rights.license_scope.model=false;
  assert.throws(() => validateAnalysis(testReport(),[rights]));
  assert.throws(() => validateAnalysis({ ...testReport(), companies: ['invented'] },[testItem()]));
});
test('reading fields remain optional for old payloads; counterforces need not be invented',() => {
  const old = validateAnalysis(testReport(),[testItem()]);
  assert.equal(old.headline,undefined);
  const report = { ...testReport(), headline: '测试事项发布', change_summary: '测试机构发布测试事项', impact_summary: '目前仅核实发布事实。', paths: [{ name: '测试环节', mechanism: '若业务条件成立则可能影响测试环节。', conditions: ['业务条件成立'], counterforces: [], direction: 'uncertain', claim_ids: ['c1'] }] };
  assert.equal(validateAnalysis(report,[testItem()]).paths[0].counterforces.length,0);
});
test('independent review must explicitly clear every applicable gate',() => {
  const pass = { verdict: 'pass', checks: { facts: 'pass', time: 'pass', comparison: 'not_applicable', supply_demand: 'pass', causality: 'pass', companies: 'pass' }, issues: [] };
  assert.equal(validateReview(pass).verdict,'pass');
  assert.throws(() => validateReview({ ...pass, checks: { ...pass.checks, facts: 'not_applicable' } }));
  assert.throws(() => validateReview({ ...pass, checks: { ...pass.checks, causality: 'issue' } }));
  assert.throws(() => validateReview({ ...pass, checks: { ...pass.checks, causality: 'not_applicable' } },validateAnalysis(companyReport(),[testItem(),companyItem()])));
  const issues = [{ area: 'causality', draft_excerpt: '库存下降证明需求激增', explanation: '流量及供给因素尚未排除，不能由库存单独推出需求变化。' }];
  assert.equal(validateReview({ verdict: 'issues', checks: { ...pass.checks, causality: 'issue' }, issues }).verdict,'issues');
  assert.throws(() => validateReview({ ...pass, issues }));
});
test('core evidence, not another claim, controls conservative routing',() => {
  const report = testReport(); report.claims[0].evidence_state='unverified'; report.importance='major';
  assert.equal(route(validateAnalysis(report,[testItem()])),'watch');
  report.claims[0].evidence_state='refuted'; assert.equal(route(validateAnalysis(report,[testItem()])),'correction');
  report.claims[0].evidence_state='corroborated'; assert.throws(() => validateAnalysis(report,[testItem()]));
});
test('both budget thresholds and secure-by-default configuration fail closed',() => {
  const b = budgetSchema.parse(coreBudget()); b.month.spent=9_900_000; b.month.reserved=100_000; b.unknown_reserved=100_000;
  assert.equal(budgetGate(b),'BUDGET_EXHAUSTED'); b.month.spent=0; b.day.spent=1_000_000;
  assert.equal(budgetGate(b),'BUDGET_EXHAUSTED'); b.day.limit=1_000_001;
  assert.equal(budgetGate(b),'BUDGET_POLICY_UNVERIFIED');
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://unused', WEB_ORIGIN: 'http://127.0.0.1:5173' }));
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://unused', DEV_INSECURE_LOCALHOST: 'true', API_HOST: '0.0.0.0' }));
  const missingCurrent=coreItem();
  assert.equal(itemSchema.parse({ ...missingCurrent, source: { ...missingCurrent.source, current_rights: undefined } }).license_scope.model,false);
});
