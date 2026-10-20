// Pure API boundary / presentation adapter. No local financial snapshots are used.
export const TABLE_NAMES = { indicators: '财务指标', balance: '资产负债', cashflow: '现金流', composition: '收入构成' };
export const STATE_NAMES = { ok: '已获取', stale: '过期 / 部分缺失', unavailable: '不可用' };
const CURRENCIES = { CNY: '人民币', USD: '美元', HKD: '港元', EUR: '欧元', JPY: '日元', GBP: '英镑', AUD: '澳元', CAD: '加元', CHF: '瑞士法郎', SGD: '新加坡元' };
const PERIODS = { '03-31': 'Q1', '06-30': 'H1', '09-30': 'Q3', '12-31': 'FY' };
const PERIOD_NAMES = { Q1: '一季报', H1: '半年报', Q3: '三季报', FY: '年报' };
const MONEY_FIELDS = ['revenue', 'net_profit_parent', 'operating_cash_flow', 'total_liabilities', 'total_assets', 'net_profit_excluding_nonrecurring', 'monetary_funds', 'accounts_receivable', 'inventories'];
const PCT_FIELDS = ['revenue_yoy_pct', 'net_profit_parent_yoy_pct', 'gross_margin_pct', 'debt_to_asset_pct', 'net_profit_excluding_nonrecurring_yoy_pct', 'roe_weighted_pct'];
export const supportedSymbol = value => typeof value === 'string' && /^(SH|SZ|BJ):\d{6}$/.test(value);
export const finite = value => typeof value === 'number' && Number.isFinite(value);
const number = value => finite(value) ? value : null;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const currency = value => typeof value === 'string' && Object.hasOwn(CURRENCIES, value) ? value : null;
export const currencyName = value => currency(value) ? CURRENCIES[value] : '币种未提供';
export const moneyUnit = value => value === 'CNY' ? '亿元（人民币）' : currency(value) ? `亿原币（${currencyName(value)} ${value}）` : '亿原币（币种未提供）';
export function reportDate(value) {
  return typeof value === 'string' && /^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value) && PERIODS[value.slice(5)] ? value : null;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = value.slice(0, 10), parsed = new Date(value);
  const calendar = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === date ? value : null;
}
export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function periodLabel(period) {
  return period ? `${period.period_end.slice(0, 4)} ${period.period_type} · ${PERIOD_NAMES[period.period_type]} · 截至 ${period.period_end}` : '暂无可核对报告期';
}
export function adaptFundamentals(envelope, symbol) {
  const raw = envelope?.data;
  if (!supportedSymbol(symbol) || !record(raw) || raw.symbol !== symbol) throw new Error('基本面响应身份不一致，已拒收。');
  if (typeof raw.status !== 'string' || !Object.hasOwn(STATE_NAMES, raw.status) || !Array.isArray(raw.periods)) throw new Error('基本面数据格式无效。');
  const warnings = [...(Array.isArray(raw.warnings) ? raw.warnings : []), ...(Array.isArray(envelope.meta?.warnings) ? envelope.meta.warnings : [])].map(text).filter(Boolean);
  const warn = message => { if (!warnings.includes(message)) warnings.push(message); };
  const checkedNumber = value => {
    if (value !== null && value !== undefined && !finite(value)) warn('部分数值无效，已作为缺失处理；空缺不代表零。');
    return number(value);
  };
  const seen = new Set();
  const periods = raw.periods.flatMap(row => {
    if (!record(row) || !reportDate(row.period_end) || PERIODS[row.period_end.slice(5)] !== row.period_type) {
      warn('存在无效报告期，已排除；不以其他报告期补齐字段。'); return [];
    }
    if (seen.has(row.period_end)) throw new Error('基本面报告期重复，无法确认口径，已拒收。');
    seen.add(row.period_end);
    const unit = currency(row.currency);
    if (!unit) warn('部分报告期币种缺失或无效，金额不展示，不跨币种比较。');
    const result = { period_end: row.period_end, period_type: row.period_type, currency: unit };
    for (const key of MONEY_FIELDS) result[key] = unit ? checkedNumber(row[key]) : null;
    for (const key of PCT_FIELDS) result[key] = checkedNumber(row[key]);
    // EPS is original currency per share, not an amount to divide by 1e8.
    result.basic_eps = unit ? checkedNumber(row.basic_eps) : null;
    result.debt_to_asset_basis = ['source', 'computed'].includes(row.debt_to_asset_basis) ? row.debt_to_asset_basis : null;
    if (result.debt_to_asset_basis === 'computed') {
      const ratio = result.total_assets > 0 && finite(result.total_liabilities) ? result.total_liabilities / result.total_assets * 100 : null;
      result.debt_to_asset_pct = number(ratio);
      if (!finite(ratio)) warn('计算资产负债率缺少同报告期正资产分母，已显示缺失。');
    }
    return [result];
  }).sort((a, b) => b.period_end.localeCompare(a.period_end));
  let composition = null;
  if (raw.composition != null) {
    const row = raw.composition;
    if (record(row) && reportDate(row.period_end) && ['product', 'region'].includes(row.basis) && Array.isArray(row.items)) {
      let unit = currency(row.currency);
      if (row.currency == null) {
        unit = periods.find(p => p.period_end === row.period_end)?.currency || null;
        if (unit) warn('收入构成币种未单列，沿用同报告期指标币种。');
      }
      const matching = periods.find(p => p.period_end === row.period_end);
      if (unit && matching?.currency && unit !== matching.currency) {
        warn('收入构成与同报告期指标币种冲突，金额已拒收；占比仍独立标注来源口径。'); unit = null;
      }
      if (!unit) warn('收入构成币种未核实，金额不展示；占比仍沿用来源。');
      composition = { period_end: row.period_end, currency: unit, basis: row.basis, items: row.items.flatMap(item => {
        if (!record(item) || !text(item.name)) return [];
        const scale = value => { const result = checkedNumber(value); return result === null ? null : number(result * 100); };
        return [{ name: text(item.name), revenue: unit ? checkedNumber(item.revenue) : null, share: scale(item.share_ratio), gross_margin: scale(item.gross_margin_ratio) }];
      }) };
    } else warn('收入构成报告期或分类口径无效，已排除，不使用旧快照替代。');
  }
  const tables = Object.fromEntries(Object.keys(TABLE_NAMES).map(key => {
    const table = record(raw.tables?.[key]) ? raw.tables[key] : {};
    return [key, { status: Object.hasOwn(STATE_NAMES, table.status) ? table.status : 'unavailable', fetched_at: timestamp(table.fetched_at), source_urls: (Array.isArray(table.source_urls) ? table.source_urls : []).map(safeSourceUrl).filter(Boolean) }];
  }));
  if (raw.status === 'unavailable' && (periods.length || composition)) warn('来源标记不可用；以下仅为来源保留数据，不代表本次已成功更新。');
  const partial = warnings.length > 0 || Object.values(tables).some(t => t.status !== 'ok') || !composition?.items.length || periods.some(p => [...MONEY_FIELDS, ...PCT_FIELDS].some(key => p[key] === null));
  return { symbol, status: raw.status, partial, source: text(raw.source) || '来源未提供', source_url: safeSourceUrl(raw.source_url), fetched_at: timestamp(raw.fetched_at), periods, composition, tables, warnings: [...new Set(warnings)] };
}

// These models preserve the original metric slots; absent fields stay absent.
export function presentFundamentals(data) {
  const latest = data?.periods[0] || null;
  const unit = moneyUnit(latest?.currency);
  const m = (key, label, field, group, definition, pct = false, yoy = null) => ({
    key, label, group, definition,
    value: latest && finite(latest[field]) ? latest[field] / (pct ? 1 : 1e8) : null,
    unit: pct ? '%' : unit,
    change: latest && yoy && finite(latest[yoy]) ? `来源同比 ${latest[yoy].toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%` : null,
    raw: latest?.[field], currency: latest?.currency
  });
  const absent = (key, label, group, definition, metricUnit = '') => ({ key, label, group, definition: `${definition}；此财务源未提供，未以旧快照填补。`, value: null, unit: metricUnit });
  const ratio = (key, label, numerator, denominator, group, scale, metricUnit, definition) => {
    const value = latest && finite(latest[numerator]) && finite(latest[denominator]) && latest[denominator] > 0 ? number(latest[numerator] / latest[denominator] * scale) : null;
    return { key, label, group, value, unit: metricUnit, derived: true, definition: `计算值：${definition}；仅用同币种同报告期年初累计字段，分母须为正，否则显示缺失。` };
  };
  const metrics = [
    m('revenue', '营业收入', 'revenue', 'growth', '公司合并口径，年初至报告期末累计，非单季、非TTM。', false, 'revenue_yoy_pct'),
    m('net_profit', '归母净利润', 'net_profit_parent', 'growth', '归属于母公司股东的净利润，年初累计，非单季、非TTM。', false, 'net_profit_parent_yoy_pct'),
    m('core_profit', '扣非归母净利润', 'net_profit_excluding_nonrecurring', 'growth', '扣除非经常性损益后的归母净利润，合并口径年初累计。', false, 'net_profit_excluding_nonrecurring_yoy_pct'),
    m('gross_margin', '毛利率', 'gross_margin_pct', 'profitability', '来源披露的累计报告期毛利率，已为百分单位；不另套税口径。', true),
    ratio('attributable_margin', '归母利润率', 'net_profit_parent', 'revenue', 'profitability', 100, '%', '归母净利润 ÷ 营业收入 × 100%，不等同合并净利率'),
    m('roe', '加权ROE', 'roe_weighted_pct', 'profitability', '来源披露的加权平均净资产收益率，已为百分值，不再乘100。', true),
    { key: 'eps', label: '基本每股收益', group: 'profitability', definition: '来源披露的本报告期基本每股收益，原币/股，非TTM，不除以1亿。', value: number(latest?.basic_eps), raw: latest?.basic_eps, currency: latest?.currency, unit: `${latest?.currency ? currencyName(latest.currency) : '原币'}/股` },
    m('operating_cashflow', '经营现金流', 'operating_cash_flow', 'cash', '公司合并经营活动现金流量净额，年初累计；缺失不补零。'),
    ratio('cash_profit', '经营现金流/归母净利', 'operating_cash_flow', 'net_profit_parent', 'cash', 1, '倍', '经营现金流净额 ÷ 归母净利润，两者存在少数股东口径差异，不单独据此判断盈利质量'),
    ratio('cash_margin', '经营现金流/营收', 'operating_cash_flow', 'revenue', 'cash', 100, '%', '经营现金流净额 ÷ 营业收入 × 100%'),
    m('cash', '货币资金', 'monetary_funds', 'balance', '期末货币资金，不等同可用现金或现金等价物。'),
    m('assets', '总资产', 'total_assets', 'balance', '本报告期末合并资产总额，非累计发生额。'),
    m('liabilities', '总负债', 'total_liabilities', 'balance', '本报告期末合并负债总额，非累计发生额。'),
    m('debt_ratio', '资产负债率', 'debt_to_asset_pct', 'balance', latest?.debt_to_asset_basis === 'computed' ? '计算值：同报告期负债总额 ÷ 正资产总额 × 100%，期末值。' : `期末值；${latest?.debt_to_asset_basis === 'source' ? '来源披露' : '来源未注明推导口径'}，已为百分单位。`, true),
    m('receivables', '应收账款', 'accounts_receivable', 'balance', '同报告期末应收账款账面价值。'),
    m('inventory', '存货', 'inventories', 'balance', '同报告期末存货账面价值。'),
    absent('rd', '研发投入', 'investment', '费用化及资本化研发投入', unit),
    absent('rd_ratio', '研发投入/营收', 'investment', '研发投入占营业收入比例', '%')
  ];
  const annual = data?.periods.filter(p => p.period_type === 'FY' && p.currency) || [];
  const trendCurrency = latest?.currency || annual[0]?.currency || null;
  const selected = annual.filter(p => p.currency === trendCurrency).slice(0, 3).reverse();
  const trend = {
    years: selected.map(p => p.period_end.slice(0, 4)), periods: selected, currency: trendCurrency,
    ...Object.fromEntries([['revenue', 'revenue'], ['net_profit', 'net_profit_parent'], ['operating_cashflow', 'operating_cash_flow']].map(([key, field]) => [key, selected.map(p => finite(p[field]) ? p[field] / 1e8 : null)])),
    note: `仅取最近三个同币种 FY 全年累计年报，实际取得 ${selected.length} 年${selected.length < 3 ? '（不足三年，不以季报替代）' : ''}。不跨报告期拼字段；空缺不等于零。`
  };
  return { latest, metrics, trend, segments: data?.composition || null };
}

// Fetch/cache is separate from adaptation. Errors are cached until explicit retry;
// renders never start an endless retry loop, and each symbol has one in-flight job.
export function createFundamentalsClient(onChange, fetcher = (...args) => fetch(...args)) {
  const cache = new Map();
  function peek(symbol) { return cache.get(symbol) || { status: supportedSymbol(symbol) ? 'idle' : 'unsupported', data: null, error: '' }; }
  function load(symbol, retry = false) {
    if (!supportedSymbol(symbol)) return Promise.resolve(peek(symbol));
    const existing = cache.get(symbol);
    if (existing?.promise) return existing.promise;
    if (existing && !retry) return Promise.resolve(existing);
    const entry = { status: 'loading', data: existing?.data || null, error: '', promise: null };
    cache.set(symbol, entry);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    entry.promise = Promise.resolve().then(async () => {
      try {
        const response = await fetcher(`/api/v1/securities/${encodeURIComponent(symbol)}/fundamentals`, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) {
          const message = response.status === 404 ? '此证券暂无基本面记录。' : [401, 403].includes(response.status) ? '基本面数据服务身份验证失败或无访问权限。' : response.status >= 500 ? '基本面数据服务 / ycore 暂不可用。' : `基本面数据服务请求失败（HTTP ${response.status}）。`;
          throw new Error(message);
        }
        const payload = await response.json();
        entry.data = adaptFundamentals(payload, symbol);
        entry.status = 'ready';
      } catch (error) {
        entry.status = 'error';
        entry.error = error?.name === 'AbortError' ? '基本面数据服务 / ycore 请求超时，请重试。' : error instanceof SyntaxError ? '基本面数据服务返回的数据格式无效。' : error instanceof TypeError ? '基本面数据服务 / ycore 暂不可用或响应无效，请重试。' : error?.message || '基本面数据服务 / ycore 暂不可用。';
      } finally {
        clearTimeout(timer); entry.promise = null;
      }
      if (cache.get(symbol) === entry) onChange(symbol);
      return entry;
    });
    return entry.promise;
  }
  return { peek, load };
}
