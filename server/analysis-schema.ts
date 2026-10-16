import { z } from 'zod';
import type { Item } from './ycore.js';
import { reviewAreas } from './output-schema.js';
export const evidenceSchema = z.object({ item_id: z.string(), item_version: z.number().int().positive(), locator: z.string().min(1).max(300), quote: z.string().min(1).max(1500) }).strict();
export const claimSchema = z.object({ claim_id: z.string().min(1).max(80), content_type: z.enum(['fact','source_opinion','conditional_inference']),
  evidence_state: z.enum(['primary','corroborated','unverified','conflicting','refuted']), text: z.string().min(1).max(1800),
  evidence: z.array(evidenceSchema).min(1).max(10) }).strict();
export const companySchema = z.object({
  company_id: z.string().regex(/^(SSE|SZSE|BSE)\.\d{6}$/), name: z.string().min(1).max(100),
  business_evidence: z.array(evidenceSchema).min(1).max(8), mechanism_path: z.number().int().nonnegative(),
  conditional_link: z.string().min(1).max(1400), conditions: z.array(z.string().min(1).max(600)).min(1).max(5),
  counterforces: z.array(z.string().min(1).max(600)).max(5)
}).strict();
export const analysisSchema = z.object({
  summary: z.string().min(1).max(300),
  headline: z.string().min(1).max(60).optional(), change_summary: z.string().min(1).max(300).optional(),
  impact_summary: z.string().min(1).max(360).optional(),
  core_claim_id: z.string(), importance: z.enum(['major','notable','exclude']),
  importance_reason: z.string().min(1).max(600), occurred_at: z.string().datetime().nullable(),
  claims: z.array(claimSchema).min(1).max(12),
  paths: z.array(z.object({ name: z.string().min(1).max(100), mechanism: z.string().min(1).max(1600),
    conditions: z.array(z.string().min(1).max(600)).min(1).max(5), counterforces: z.array(z.string().min(1).max(600)).max(5),
    direction: z.enum(['positive','negative','uncertain']), claim_ids: z.array(z.string()).min(1).max(12) }).strict()).max(8),
  companies: z.array(companySchema).max(5).default([]),
  stopping_message: z.string().min(1).max(800)
}).strict();
export type Analysis = z.infer<typeof analysisSchema>;
export const STOP = '到此为止：缺少经过核验的公司业务暴露及其与本事件连接的证据；不推测公司落点。';
// Lexical aliases only: preserve values and magnitude words, never calculate or convert currencies.
const evidenceNumber = String.raw`\d+(?:[.,]\d+)*`;
const unitAliases = new Map([
  ['GW','吉瓦'], ['gigawatt','吉瓦'], ['gigawatts','吉瓦'],
  ['MW','兆瓦'], ['megawatt','兆瓦'], ['megawatts','兆瓦'],
  ['kW','千瓦'], ['kilowatt','千瓦'], ['kilowatts','千瓦'],
  ['kWh','千瓦时'], ['kilowatt-hour','千瓦时'], ['kilowatt-hours','千瓦时'],
  ['kilowatt hour','千瓦时'], ['kilowatt hours','千瓦时'], ['％','%']
]);
// Prefer a complete unit before an optional magnitude: 千瓦 is a unit, but 千元 retains 千.
// Unknown English units remain literal tokens, not bare numbers (e.g. MWh is not MW).
const evidenceQuantity = new RegExp(`(${evidenceNumber})(?:\\s*(万亿|亿|万|千|百))??\\s*(千瓦时|兆瓦时|吉瓦时|平方米|立方米|人民币|美元|兆瓦|吉瓦|千瓦|瓦时|公里|小时|元|%|％|吨|瓦|人|家|辆|台|件|年|月|日|天|kilowatt[ -]hours?(?![A-Za-z-])|[A-Za-z]+(?:-[A-Za-z]+)*)`, 'g');
const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const englishDate = new RegExp(`(?<![A-Za-z\\d])(${monthNames.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)`, 'gi');
const englishDayFirstDate = new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${monthNames.join('|')})\\s+(\\d{4})(?!\\d)`, 'gi');
function evidenceNumbers(text: string, source = false): Set<string> {
  const tokens = new Set<string>();
  function date(year: string, month: string, day: string) {
    // Date padding is lexical formatting; decimal precision and magnitude words stay untouched.
    const m = month.replace(/^0/, ''), d = day.replace(/^0/, '');
    if (!/^(?:[1-9]|1[0-2])$/.test(m) || !/^(?:[1-9]|[12]\d|3[01])$/.test(d)) {
      tokens.add('unsupported-date');
    } else {
      tokens.add(`date:${year}-${m}-${d}`);
      if (source) { tokens.add(`year:${year}`); tokens.add(`number:${year}`); }
    }
    return ' ';
  }
  const monthNumber = (month: string) => String(monthNames.findIndex(name => name.toLowerCase() === month.toLowerCase()) + 1);
  // Consume whole dates first: a date cannot be assembled from unrelated numbers or quotations.
  let rest = text.replace(/(?<!\d)(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g, (_, y, m, d) => date(y, m, d))
    .replace(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (_, y, m, d) => date(y, m, d))
    .replace(englishDate, (_, m: string, d, y) => date(y, monthNumber(m), d))
    .replace(englishDayFirstDate, (_, d, m: string, y) => date(y, monthNumber(m), d));
  rest = rest.replace(evidenceQuantity, (_, value: string, magnitude: string | undefined, unit: string) => {
    tokens.add(unit === '年' && !magnitude && /^\d{4}$/.test(value)
      ? `year:${value}` : `quantity:${value}:${magnitude ?? ''}:${unitAliases.get(unit) ?? unit}`);
    if (source) tokens.add(`number:${value}`);
    return ' ';
  });
  for (const value of rest.match(new RegExp(evidenceNumber, 'g')) ?? []) {
    tokens.add(`number:${value}`);
    if (source && /^\d{4}$/.test(value)) tokens.add(`year:${value}`);
  }
  return tokens;
}
function numbersSupported(text: string, quotes: string[]) {
  const supported = new Set(quotes.flatMap(quote => [...evidenceNumbers(quote, true)]));
  for (const token of evidenceNumbers(text)) {
    if (token === 'unsupported-date' || !supported.has(token)) throw new Error('UNSUPPORTED_QUANTITY');
  }
}
export function validateAnalysis(output: unknown, inputs: Item[]): Analysis {
  const report = analysisSchema.parse(typeof output === 'string' ? JSON.parse(output) : output);
  const ids = new Set(report.claims.map(c => c.claim_id));
  if (ids.size !== report.claims.length) throw new Error('DUPLICATE_CLAIM');
  const core = report.claims.find(c => c.claim_id === report.core_claim_id);
  if (!core || core.text !== report.summary || core.content_type === 'conditional_inference' || !core.evidence.some(ref => ref.item_id === inputs[0]?.item_id && ref.item_version === inputs[0]?.version)) throw new Error('INVALID_CORE_CLAIM');
  if (report.occurred_at && !core.evidence.some(ref => ref.quote.includes(report.occurred_at!))) throw new Error('UNSUPPORTED_OCCURRENCE_TIME');
  for (const claim of report.claims) {
    const sources = new Set<string>();
    for (const ref of claim.evidence) {
      const item = inputs.find(i => i.item_id === ref.item_id && i.version === ref.item_version);
      if (!item || !item.license_scope.model || !item.license_scope.display || !item.license_scope.store || item.availability !== 'available') throw new Error('INVALID_SOURCE_REF');
      if (!item.content?.includes(ref.quote)) throw new Error('QUOTE_NOT_IN_INPUT');
      sources.add(item.independence_key ?? 'unattributed-origin');
      if (claim.evidence_state === 'primary' && item.source_classification!=='primary') throw new Error('NOT_PRIMARY');
    }
    if (['corroborated','conflicting'].includes(claim.evidence_state) && sources.size < 2) throw new Error('NOT_INDEPENDENT');
    // Values, units and complete dates must be supported by cited passages, not other input text.
    numbersSupported(claim.text,claim.evidence.map(ref => ref.quote));
  }
  for (const path of report.paths) {
    if (path.claim_ids.some(c => !ids.has(c))) throw new Error('INVALID_DEPENDENCY');
    const quotes=report.claims.filter(c => path.claim_ids.includes(c.claim_id)).flatMap(c => c.evidence.map(ref => ref.quote));
    numbersSupported([path.mechanism,...path.conditions,...path.counterforces].join(' '),quotes);
  }
  const coreQuotes = core.evidence.map(ref => ref.quote);
  // Reading copy is not an escape hatch around the numeric/quotation gate.
  for (const text of [report.headline,report.change_summary]) if (text) numbersSupported(text,coreQuotes);
  if (report.impact_summary) numbersSupported(report.impact_summary,report.claims.flatMap(c => c.evidence.map(ref => ref.quote)));
  numbersSupported(report.importance_reason,report.claims.flatMap(c => c.evidence.map(ref => ref.quote)));
  const companyIds = new Set<string>();
  for (const company of report.companies) {
    if (companyIds.has(company.company_id) || !report.paths[company.mechanism_path]) throw new Error('INVALID_COMPANY_MECHANISM');
    companyIds.add(company.company_id);
    const path = report.paths[company.mechanism_path];
    if (!path.claim_ids.some(cid => report.claims.find(c => c.claim_id === cid)?.evidence.some(ref => ref.item_id === inputs[0]?.item_id))) throw new Error('NO_EVENT_MECHANISM');
    for (const ref of company.business_evidence) {
      const item = inputs.find(i => i.item_id === ref.item_id && i.version === ref.item_version);
      if (!item || !['company_profile','document'].includes(item.item_type) || !item.metadata?.reviewed || item.metadata.company_id !== company.company_id || item.metadata.company_name !== company.name || !item.license_scope.model || !item.license_scope.store || !item.license_scope.display || item.availability !== 'available' || !item.content?.includes(ref.quote)) throw new Error('INVALID_COMPANY_EXPOSURE');
    }
    numbersSupported([company.conditional_link,...company.conditions,...company.counterforces].join(' '),company.business_evidence.map(ref => ref.quote));
  }
  if (/买入|卖出|目标价|涨停|跌停|稳赚|股价必|buy\s+stock|price\s+target/i.test(JSON.stringify(report))) throw new Error('PROHIBITED_ADVICE');
  // Only explicit curated company evidence may cross the industry stopping boundary.
  return { ...report, stopping_message: report.companies.length ? '以上仅为有业务出处的条件性暴露，不代表盈利或股价结论；其他公司证据不足，不作扩展。' : STOP };
}
const reviewCheck = z.enum(['pass','issue','not_applicable']);
export const reviewSchema = z.object({
  verdict: z.enum(['pass','issues']),
  checks: z.object({ facts: reviewCheck, time: reviewCheck, comparison: reviewCheck, supply_demand: reviewCheck, causality: reviewCheck, companies: reviewCheck }).strict(),
  issues: z.array(z.object({ area: z.enum(reviewAreas), draft_excerpt: z.string().min(1).max(300), explanation: z.string().min(1).max(600) }).strict()).max(6)
}).strict();
export function validateReview(output: unknown, draft?: Analysis) {
  const review = reviewSchema.parse(typeof output === 'string' ? JSON.parse(output) : output);
  if (review.verdict === 'pass' && (review.issues.length || Object.values(review.checks).includes('issue') || review.checks.facts !== 'pass' || review.checks.time !== 'pass')) throw new Error('INCONSISTENT_REVIEW');
  if (review.verdict === 'pass' && draft && (((draft.paths.length || draft.impact_summary) && (review.checks.supply_demand !== 'pass' || review.checks.causality !== 'pass')) || (draft.companies.length && review.checks.companies !== 'pass'))) throw new Error('INCOMPLETE_REVIEW');
  if (review.verdict === 'issues' && (!review.issues.length || !Object.values(review.checks).includes('issue'))) throw new Error('INCONSISTENT_REVIEW');
  return review;
}
export function route(report: Analysis): 'main' | 'watch' | 'excluded' | 'correction' {
  const core = report.claims.find(c => c.claim_id === report.core_claim_id)!;
  if (core.evidence_state === 'refuted') return 'correction';
  if (report.importance === 'exclude') return 'excluded';
  if (['primary','corroborated'].includes(core.evidence_state)) return 'main';
  return report.importance === 'major' ? 'watch' : 'excluded';
}
export const outputContract = {
  summary: '必须与核心断言text逐字相同，最多300字',
  headline: '简短中文标题，建议12至28字，最多60字；只概括核心事实，不塞机构英文全名或解释',
  change_summary: '发生了什么变化，核心事实及可核实的比较基期；没有基期不补造，最多300字',
  impact_summary: '为什么值得读：具体影响哪个对象与产业约束；事实与条件推断分开，不复述入选理由，最多360字',
  core_claim_id: 'claims中ID', importance: 'major | notable | exclude',
  importance_reason: '影响规模/持续性/紧迫性及证据，不以热度或公司数量为理由', occurred_at: 'ISO UTC时间或null；不可用抓取时间代替',
  claims: [{ claim_id: '稳定的本地ID', content_type: 'fact | source_opinion | conditional_inference', evidence_state: 'primary | corroborated | unverified | conflicting | refuted', text: '中文断言', evidence: [{ item_id: '输入ID', item_version: 1, locator: '段落或具体位置', quote: '输入正文的逐字连续引文' }] }],
  paths: [{ name: '产业环节，不是公司', mechanism: '条件性传导机制，不预测价格', conditions: ['成立条件'], counterforces: ['有依据且作用于同一对象的反向因素；没有则空数组'], direction: 'positive | negative | uncertain', claim_ids: ['依赖的断言ID'] }],
  companies: [{ company_id: 'SSE/SZSE/BSE.六位代码，仅取输入metadata', name: '与已审核metadata.company_name一致', business_evidence: [{ item_id: '显式公司输入ID', item_version: 1, locator: '业务依据位置', quote: '逐字业务引文' }], mechanism_path: 0, conditional_link: '将上述环节机制与业务暴露连接的条件推断，不是主题/名单关联', conditions: ['连接成立条件'], counterforces: ['有依据的公司级反向因素；没有则空数组'] }],
  stopping_message: STOP
};
