import { dateTime } from './api';
import { useApi } from './hooks';
import { ErrorBox, ExternalLink, Loading } from './components';
import { EvidenceRefs } from './evidence';
import './fundamentals.css';

type State = 'ok' | 'stale' | 'unavailable';
type Period = {
  period_end: string; period_type: 'Q1' | 'H1' | 'Q3' | 'FY'; currency: string | null;
  revenue: number | null; net_profit_parent: number | null; operating_cash_flow: number | null;
  total_liabilities: number | null; total_assets: number | null;
  revenue_yoy_pct: number | null; net_profit_parent_yoy_pct: number | null;
  gross_margin_pct: number | null; debt_to_asset_pct: number | null;
  debt_to_asset_basis: 'source' | 'computed' | null;
  net_profit_excluding_nonrecurring?: number | null; net_profit_excluding_nonrecurring_yoy_pct?: number | null;
  roe_weighted_pct?: number | null; basic_eps?: number | null;
  monetary_funds?: number | null; accounts_receivable?: number | null; inventories?: number | null;
};
type Composition = {
  period_end: string; basis: 'product' | 'region'; currency?: string | null;
  items: { name: string; revenue: number | null; share_ratio: number | null; gross_margin_ratio: number | null }[];
};
type TableKey = 'indicators' | 'balance' | 'cashflow' | 'composition';
type Fundamentals = {
  symbol: string; status: State; source: string; source_url: string; fetched_at: string | null;
  periods: Period[]; composition: Composition | null; warnings: string[]; evidence_ids: string[];
  tables: Record<TableKey, { status: State; fetched_at: string | null; source_urls?: string[] }>;
};
const tableNames: Record<TableKey, string> = { indicators: '财务指标', balance: '资产负债', cashflow: '现金流', composition: '收入构成' };
const states: Record<State, string> = { ok: '已获取', stale: '过期 / 部分缺失', unavailable: '未收录' };
const periodNames = { Q1: '一季报', H1: '半年报', Q3: '三季报', FY: '年报' };
const currencies: Record<string, string> = { CNY: '人民币', USD: '美元', HKD: '港元', EUR: '欧元', JPY: '日元' };
const valid = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
function money(value: number | null, currency: string | null) {
  if (!valid(value)) return <span className="fund-missing" title="来源未提供可核对值">—</span>;
  return <span title={`${value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })} ${currency || '币种未提供'}`}>{(value / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</span>;
}
function percent(value: number | null, ratio = false) {
  if (!valid(value)) return <span className="fund-missing" title="来源未提供可核对值">—</span>;
  const display = ratio ? value * 100 : value;
  if (!Number.isFinite(display)) return <span className="fund-missing">—</span>;
  return <span title={`来源值 ${value}${ratio ? '（小数比率）' : ' %'}`}>{display.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%</span>;
}
const metrics: { key: keyof Period; label: string; pct?: boolean; yoy?: boolean; eps?: boolean }[] = [
  { key: 'revenue', label: '营业收入' },
  { key: 'revenue_yoy_pct', label: '营业收入同比', pct: true, yoy: true },
  { key: 'net_profit_parent', label: '归母净利润' },
  { key: 'net_profit_parent_yoy_pct', label: '归母净利润同比', pct: true, yoy: true },
  { key: 'net_profit_excluding_nonrecurring', label: '扣非归母净利润' },
  { key: 'net_profit_excluding_nonrecurring_yoy_pct', label: '扣非归母净利润同比', pct: true, yoy: true },
  { key: 'roe_weighted_pct', label: '加权ROE', pct: true },
  { key: 'basic_eps', label: '基本每股收益（原币/股）', eps: true },
  { key: 'gross_margin_pct', label: '毛利率', pct: true },
  { key: 'operating_cash_flow', label: '经营现金流净额' },
  { key: 'total_liabilities', label: '负债总额' },
  { key: 'total_assets', label: '资产总额' },
  { key: 'monetary_funds', label: '货币资金（不等同可用现金或现金等价物）' },
  { key: 'accounts_receivable', label: '应收账款' },
  { key: 'inventories', label: '存货' },
  { key: 'debt_to_asset_pct', label: '资产负债率', pct: true },
];

export default function CompanyFundamentals({ symbol }: { symbol: string }) {
  const result = useApi<Fundamentals>(`/securities/${encodeURIComponent(symbol)}/fundamentals`);
  const data = result.data?.symbol === symbol ? result.data : undefined;
  const periods = data?.periods || [];
  return <section id="company-fundamentals" className="company-fundamentals company-section">
    <h2>公司整体基本面</h2>
    <p className="section-note">公司合并口径，不代表任何单一业务或产业环节。收入、利润和现金流为年初至报告期末累计；资产、负债和资产负债率为期末值。</p>
    {result.loading && !data && <Loading label="正在获取公司基本面，其他内容可继续阅读…" />}
    <ErrorBox message={result.error} retry={result.reload} />
    {data && <>
      <p className={`fund-state fund-state-${data.status}`}>{data.status === 'unavailable' ? '未收录：获取失败或暂无可核对数据。' : data.status === 'stale' ? '部分数据过期或未取得；以下保留最近可用数据。' : '已取得公开来源数据。'} {data.fetched_at && <span>获取：{dateTime(data.fetched_at)}</span>}</p>
      {data.status === 'unavailable' && data.warnings.length > 0 && <p className="quiet-empty">{data.warnings[0].replace(/^(indicators|balance|cashflow|composition)：/, name => `${tableNames[name.slice(0, -1) as TableKey]}：`)}</p>}
      {periods.length > 0 && <>
        <h3>增长、盈利、现金流与负债</h3>
        <p className="section-note">金额单位：亿（各列标注币种，人民币为亿元）；同比与比率：%。— 表示未提供，不等于 0；悬停金额可看来源原值。同比为来源披露值，未自行计算。</p>
        <div className="fund-table-scroll" tabIndex={0} role="region" aria-label="公司整体报告期指标表">
          <table className="fund-table"><caption className="sr-only">公司合并口径财务指标：流量为年初至报告期末累计，存量为期末值</caption><thead><tr><th scope="col">指标 / 单位</th>{periods.map(p => <th scope="col" key={p.period_end}>{p.period_end}<br /><span>{periodNames[p.period_type]} · {currencies[p.currency || ''] || p.currency || '币种未提供'}</span></th>)}</tr></thead>
            <tbody>{metrics.map(metric => <tr key={metric.key}><th scope="row">{metric.label}{metric.yoy && <small>来源同比</small>}</th>{periods.map(p => {
              const value = p[metric.key] as number | null;
              return <td key={p.period_end}>{metric.pct ? percent(value) : metric.eps ? valid(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 3 }) : '—' : money(value, p.currency)}{metric.key === 'debt_to_asset_pct' && valid(value) && <small>{p.debt_to_asset_basis === 'computed' ? '负债 ÷ 资产（计算值）' : '来源值'}</small>}</td>;
            })}</tr>)}</tbody></table>
        </div>
        <AnnualTrends periods={periods} />
      </>}
      {data.composition ? <RevenueComposition composition={data.composition} periods={periods} /> : <p className="quiet-empty">收入构成：暂无可核对的产品或地区数据。</p>}
      <details className="fund-sources"><summary>来源、报告期与数据完整性</summary>
        <p><ExternalLink url={data.source_url}>{data.source}</ExternalLink></p>
        <p className="section-note">公开数据源表述，未经独立核验，不代表授权再分发。各分表独立获取，缺失不会用其他报告期替代。</p>
        <ul>{(Object.keys(tableNames) as TableKey[]).map(key => <li key={key}><strong>{tableNames[key]}</strong> · {states[data.tables[key].status]} · 获取：{dateTime(data.tables[key].fetched_at)}{data.tables[key].source_urls?.map((url, index) => <span key={url}> · <ExternalLink url={url}>来源{index + 1}</ExternalLink></span>)}</li>)}</ul>
        {data.warnings.length > 0 && <ul className="warnings">{data.warnings.map((warning, index) => <li key={index}>{warning.replace(/^(indicators|balance|cashflow|composition)：/, name => `${tableNames[name.slice(0, -1) as TableKey]}：`)}</li>)}</ul>}
        <EvidenceRefs ids={data.evidence_ids} />
      </details>
    </>}
  </section>;
}

function AnnualTrends({ periods }: { periods: Period[] }) {
  // No Q1/H1/Q3 points, no cross-currency joins, and null values never become 0.
  const annual = periods.filter(p => p.period_type === 'FY' && p.period_end.endsWith('-12-31'));
  const currencyList = [...new Set(annual.map(p => p.currency))];
  return <div className="fund-trends"><h3>年报趋势</h3><p className="section-note">仅比较全年累计报告，按币种分组；金额单位：亿原币（人民币为亿元）。负值在零线下方，缺失不画柱。原值可在上表核对。</p>
    {annual.length === 0 ? <p className="quiet-empty">暂无来源可得的年报，不使用季报替代。</p> : currencyList.map(currency => {
      const group = annual.filter(p => p.currency === currency).sort((a, b) => a.period_end.localeCompare(b.period_end));
      return <div className="fund-chart-pair" key={currency || 'unknown'}>{(['revenue', 'net_profit_parent'] as const).map(key => <AnnualBars key={key} periods={group} field={key} title={`${key === 'revenue' ? '营业收入' : '归母净利润'} · ${currencies[currency || ''] || currency || '币种未提供'}`} />)}</div>;
    })}
  </div>;
}
function AnnualBars({ periods, field, title }: { periods: Period[]; field: 'revenue' | 'net_profit_parent'; title: string }) {
  const values = periods.map(p => p[field]).filter(valid).map(v => v / 1e8);
  if (values.length === 0) return <div><h4>{title}</h4><p className="quiet-empty">来源未提供</p></div>;
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const range = high - low || 1;
  const y = (v: number) => 24 + (high - v) / range * 132;
  const baseline = y(0);
  const width = Math.max(360, periods.length * 66 + 58);
  const step = (width - 58) / periods.length;
  return <figure className={`fund-chart fund-chart-${field}`}><figcaption>{title}</figcaption><div className="fund-chart-scroll"><svg viewBox={`0 0 ${width} 202`} style={{ minWidth: width }} role="img" aria-label={`${title}，全年累计，亿原币。数值见报告期表。`}>
    <line x1="46" y1={baseline} x2={width - 8} y2={baseline} className="fund-zero" />
    <text x="4" y={baseline + 4} className="fund-tick">0</text>
    {periods.map((p, index) => {
      const value = p[field];
      const x = 50 + index * step;
      const valueY = valid(value) ? y(value / 1e8) : baseline;
      return <g key={p.period_end}><text x={x + 18} y="190" textAnchor="middle">{p.period_end.slice(0, 4)}</text>
        {valid(value) ? <><rect x={x} y={Math.min(valueY, baseline)} width="36" height={Math.max(value === 0 ? 1 : 0, Math.abs(valueY - baseline))} className={value < 0 ? 'fund-negative' : ''}><title>{p.period_end}：{value.toLocaleString('zh-CN')} {p.currency}</title></rect><text x={x + 18} y={value >= 0 ? valueY - 6 : valueY + 13} textAnchor="middle">{(value / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}</text></> : <text x={x + 18} y={baseline - 8} textAnchor="middle">—</text>}
      </g>;
    })}
  </svg></div></figure>;
}
function RevenueComposition({ composition, periods }: { composition: Composition; periods: Period[] }) {
  const currency = composition.currency || periods.find(p => p.period_end === composition.period_end)?.currency || null;
  return <div className="fund-composition"><h3>收入构成</h3><p className="section-note">{composition.period_end} · 按{composition.basis === 'product' ? '产品 / 业务' : '地区'}分类 · 金额：亿（{currencies[currency || ''] || currency || '币种未提供'}）。仅展示这一报告期的一种分类，不与其他分类加总。</p>
    <div className="fund-table-scroll" tabIndex={0} role="region" aria-label="收入构成表"><table className="fund-table"><thead><tr><th scope="col">{composition.basis === 'product' ? '产品 / 业务' : '地区'}</th><th scope="col">收入（亿）</th><th scope="col">收入占比</th><th scope="col">毛利率</th></tr></thead><tbody>{composition.items.map((item, index) => <tr key={`${item.name}-${index}`}><th scope="row">{item.name}</th><td>{money(item.revenue, currency)}</td><td>{percent(item.share_ratio, true)}</td><td>{percent(item.gross_margin_ratio, true)}</td></tr>)}</tbody></table></div>
  </div>;
}
