import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis, STOP, type Analysis } from '../server/analysis-schema.js';
import type { Item } from '../server/ycore.js';

function fixture(text: string, quotes: string[]) {
  const item: Item = {
    item_id: 'fd6440b9-329d-42eb-b9b6-608703ddb31d', version: 4,
    source: 'Public energy report', source_classification: 'primary', independence_key: 'energy-report',
    title: quotes[0], content: quotes.join('\n'), content_kind: 'full', item_type: 'news', language: 'en',
    published_at: null, first_seen_at: '2026-10-16T00:00:00Z', fetched_at: '2026-10-16T00:00:00Z',
    license_scope: { model: true, display: true, store: true }, availability: 'available'
  };
  const report: Analysis = {
    summary: text, core_claim_id: 'c1', importance: 'notable', importance_reason: '区域电网运行压力值得关注。',
    occurred_at: null, claims: [{ claim_id: 'c1', content_type: 'fact', evidence_state: 'primary', text,
      evidence: quotes.map(quote => ({ item_id: item.item_id, item_version: item.version, locator: 'excerpt', quote })) }],
    paths: [], companies: [], stopping_message: STOP
  };
  return { report, item };
}
function accepts(text: string, quote: string) {
  const { report, item } = fixture(text, [quote]);
  assert.doesNotThrow(() => {
    assert.equal(validateAnalysis(report, [item]).summary, text);
  }, `Expected supported translation: ${text} <- ${quote}`);
}
function rejects(text: string, quotes: string[]) {
  const { report, item } = fixture(text, quotes);
  assert.throws(() => validateAnalysis(report, [item]), /UNSUPPORTED_QUANTITY/);
}

test('saved factual claims support same-value GW and complete English date translations', () => {
  accepts('PJM在2026年7月2日达到162.6吉瓦的峰值，比2026年之前的峰值160.6吉瓦高出1.3%。',
    'PJM peaked at 162.6 gigawatts (GW) on July 2, 2026, 1.3% higher than the pre-2026 peak of 160.6 GW on June 23, 2025.');
  accepts('CAISO在2026年9月9日达到50.0吉瓦，低于其2022年9月6日达到的51.1吉瓦的记录高点。',
    'CAISO reached 50.0 GW on September 9, 2026, below its record high of 51.1 GW reached on September 6, 2022.');
  accepts('日期为2026年1月2日。', 'Date: 2 January 2026.');
  accepts('日期为2026年12月2日。', 'Date: December 2, 2026.');
});

test('explicit MW/GW/kWh aliases preserve values and scales', () => {
  for (const [text, quote] of [
    ['容量为7兆瓦。', 'Capacity: 7 MW.'],
    ['容量为7兆瓦。', 'Capacity: 7 megawatts.'],
    ['容量为2吉瓦。', 'Capacity: 2 GW.'],
    ['用电量为5千瓦时。', 'Energy: 5 kWh.'],
    ['用电量为5千瓦时。', 'Energy: 5 kilowatt-hours.'],
    ['功率为8千瓦。', 'Power: 8 kW.'],
    ['金额为5千元。', '金额为5千元。'],
    ['金额为5美元。', '金额为5美元。']
  ]) accepts(text, quote);
});

test('swapped units, substring numbers, magnitude and currency conversions remain rejected', () => {
  for (const [text, quote] of [
    ['容量为2GW。', 'Capacity: 2000 MW.'],
    ['容量为2吉瓦。', 'Capacity: 2000 MW; another value is 2 MW.'],
    ['容量为5吉瓦和7兆瓦。', 'Capacity: 5 MW and 7 GW.'],
    ['用电量为5千瓦时。', 'Power: 5 kW.'],
    ['用电量为5MWh。', 'Power: 5 MW.'],
    ['容量为5MW。', 'Power: 5 mW.'],
    ['时间为2026年。', 'Capacity: 2026 MW.'],
    ['金额为5元。', '金额为5美元。'],
    ['金额为5美元。', '金额为5元。'],
    ['金额为5元。', '金额为5千元。'],
    ['金额为5千元。', '金额为5元。'],
    ['功率为5千瓦。', 'Power: 5000 W.'],
    ['金额为5USD。', 'Amount: 5 CNY.'],
    ['规模为2亿元。', '规模为20000万元。'],
    ['规模为123。', '规模为1234。']
  ]) rejects(text, [quote]);
});

test('headline, change and impact numbers must pass the same cited-quantity gate', () => {
  const quote = 'PJM peaked at 162.6 GW on July 2, 2026.';
  for (const field of ['headline','change_summary','impact_summary'] as const) {
    const supported = fixture('PJM峰值负荷为162.6吉瓦。',[quote]);
    supported.report[field] = '峰值负荷达到162.6吉瓦。';
    assert.doesNotThrow(() => validateAnalysis(supported.report,[supported.item]));
    supported.report[field] = '峰值负荷达到162.6兆瓦。';
    assert.throws(() => validateAnalysis(supported.report,[supported.item]),/UNSUPPORTED_QUANTITY/);
    supported.report[field] = '负荷比前值增长2%。';
    assert.throws(() => validateAnalysis(supported.report,[supported.item]),/UNSUPPORTED_QUANTITY/);
  }
  const unrelated = fixture('区域负荷创新高。',['Regional load reached a record.']);
  unrelated.item.content += '\nA separate event occurred in 2026.';
  unrelated.report.headline = '区域2026年负荷创新高';
  assert.throws(() => validateAnalysis(unrelated.report,[unrelated.item]),/UNSUPPORTED_QUANTITY/);
});

test('dates need one complete matching date, not scattered numbers or an inferred year', () => {
  rejects('日期为2025年7月2日。', ['Dates: July 2, 2026 and June 23, 2025.']);
  rejects('日期为2026年7月2日。', ['Date: July 2; reference year: 2026.']);
  rejects('日期为2026年7月2日。', ['July 2', '2026']);
  rejects('日期为2026年7月2日。', ['2026年7月，另有2日的数据。']);
  rejects('日期为2026年7月2日。', ['Dates: July 3, 2026 and June 2, 2025.']);
});

test('actual title-only core year stays rejected even with dated body elsewhere; evidence gates stay strict', () => {
  const title = 'PJM, ERCOT, and SWPP all set peak load records this summer';
  const body = 'PJM peaked at 162.6 gigawatts (GW) on July 2, 2026, 1.3% higher than the pre-2026 peak of 160.6 GW on June 23, 2025.';
  const text = 'PJM、ERCOT和SWPP在2026年夏季均创下峰值负荷记录。';
  const { report, item } = fixture(text, [title]);
  item.content += '\n' + body;
  report.claims.push({ claim_id: 'c2', content_type: 'fact', evidence_state: 'primary', text: 'PJM在2026年7月2日达到162.6吉瓦。',
    evidence: [{ item_id: item.item_id, item_version: 4, locator: 'paragraph 2', quote: body }] });
  assert.throws(() => validateAnalysis(report, [item]), /UNSUPPORTED_QUANTITY/);

  const valid = () => fixture('区域负荷创新高。', [title]);
  const wrongRef = valid(); wrongRef.report.claims[0].evidence[0].item_version = 5;
  assert.throws(() => validateAnalysis(wrongRef.report, [wrongRef.item]), /INVALID_CORE_CLAIM/);
  const wrongQuote = valid(); wrongQuote.report.claims[0].evidence[0].quote = 'Fabricated quote';
  assert.throws(() => validateAnalysis(wrongQuote.report, [wrongQuote.item]), /QUOTE_NOT_IN_INPUT/);
  const missingConditions = valid();
  missingConditions.report.paths.push({ name: '电网', mechanism: '需求可能传导。', conditions: [], counterforces: ['需求下降'], direction: 'uncertain', claim_ids: ['c1'] });
  assert.throws(() => validateAnalysis(missingConditions.report, [missingConditions.item]));
});
