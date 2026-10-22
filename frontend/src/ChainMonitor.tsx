import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from './hooks';
import './chain-monitor.css';

type Point = { date: string; value: number };
type Metric = {
  id: string; label: string; label_short?: string; display: string; unit: string; period: string;
  value: number | null; kind?: string; series?: Point[]; delta_display?: string;
  change?: { display?: string; type?: string; value?: number } | null;
  scope_short?: string; is_proxy?: boolean; sample_n?: number;
  confidence_interval?: (number | string)[]; five_year_deviation_pct?: number;
  five_year_deviation_approx?: boolean; [key: string]: unknown;
};
type CashEvent = { date: string; label: string; display: string; value: number; unit: string; source?: string };
type Chain = { id: string; name: string; metrics: Metric[]; events?: CashEvent[]; structure?: { status?: string; href?: string; [key: string]: unknown }; [key: string]: unknown };
type Monitor = { as_of: string; chains: Chain[]; sources?: unknown; presentation?: Record<string, Record<string, unknown>>; [key: string]: unknown };
type Selection = { chain: Chain; metric?: Metric; trigger: HTMLElement | null };
const metricIds: Record<string, string[]> = {
  'crude-oil': ['price', 'wti', 'stock', 'shutin', 'crack', 'gasoline', 'diesel', 'basis', 'us-crude-stocks', 'us-gasoline-stocks', 'us-distillate-stocks', 'refinery-utilization', 'refinery-input'].map(id => `oil-${id}`),
  gold: ['real', 'etf', 'cb', 'jewel', 'etf-total', 'etf-flow', 'dollar', 'mine', 'recycle', 'barcoin', 'nem-price', 'nem-aisc', 'nem-spread', 'nem-output', 'nem-fcf', 'price'].map(id => `gold-${id}`),
  'ai-compute': ['capex', 'azure', 'margin', 'rent', 'cash-capex', 'cloud-revenue', 'rpo', 'rpo-12m', 'cfo', 'fcf', 'nvda-dc', 'nvda-margin', 'tsmc-revenue', 'tsmc-hpc'].map(id => `ai-${id}`),
  grid: ['csg', 'order', 'delivery', 'margin', 'order-amount', 'revenue-amount', 'backlog', 'ebitda', 'btb', 'cfo', 'fcf', 'power-use', 'data-power', 'peak'].map(id => `grid-${id}`),
  'innovative-drugs': ['event', 'bd', 'sales', 'cash', 'revenue', 'rd', 'sga', 'gm', 'fcf', 'op', 'cash-balance', 'tevimbra', 'orr', 'dor', 'serious'].map(id => `drug-${id}`),
};
const DetailContext = createContext<(metric?: Metric) => void>(() => {});
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const delta = (metric: Metric) => metric.delta_display || metric.change?.display || '';
function direction(text: string) { const sign = text.match(/[+−-]\s*\d/)?.[0]?.[0]; return sign === '+' ? 'cm-up' : sign ? 'cm-down' : ''; }
function validMonitor(value: unknown): value is Monitor {
  if (!value || typeof value !== 'object') return false;
  const data = value as Monitor;
  return typeof data.as_of === 'string' && Array.isArray(data.chains) && data.chains.length === 5 && Object.entries(metricIds).every(([id, ids]) => {
    const count = ids.length;
    const chain = data.chains.find(item => item?.id === id);
    return chain && typeof chain.name === 'string' && Array.isArray(chain.metrics) && chain.metrics.length === count && new Set(chain.metrics.map(item => item?.id)).size === count && chain.metrics.every(metric =>
      metric && ids.includes(metric.id) && typeof metric.label === 'string' && typeof metric.display === 'string' && typeof metric.unit === 'string' && typeof metric.period === 'string' && (metric.value === null || finite(metric.value)) &&
      ['kind', 'scope_short', 'label_short', 'delta_display'].every(key => metric[key] === undefined || typeof metric[key] === 'string') &&
      (metric.change == null || (typeof metric.change === 'object' && (metric.change.display === undefined || typeof metric.change.display === 'string') && (metric.change.value === undefined || finite(metric.change.value)))) &&
      (metric.confidence_interval === undefined || (Array.isArray(metric.confidence_interval) && metric.confidence_interval.every(item => finite(item) || typeof item === 'string'))) &&
      (metric.series === undefined || (Array.isArray(metric.series) && metric.series.every(point => point && typeof point.date === 'string' && Number.isFinite(Date.parse(point.date)) && finite(point.value))))) &&
      (chain.events === undefined || (Array.isArray(chain.events) && chain.events.every(event => event && typeof event.date === 'string' && typeof event.label === 'string' && typeof event.display === 'string' && typeof event.unit === 'string' && finite(event.value))));
  });
}
function Stat({ metric, hero = false, focus = false, label, primary, showPeriod = true, children }: { metric?: Metric; hero?: boolean; focus?: boolean; label?: string; primary?: { display: string; unit: string }; showPeriod?: boolean; children?: ReactNode }) {
  const open = useContext(DetailContext);
  if (!metric) return <div className="cm-missing">指标未提供</div>;
  const change = delta(metric);
  const originalYoy = metric.change?.type?.startsWith('yoy') ? metric.change.display : undefined;
  const normalize = (text: string) => text.replace(/[\s/·]/g, '').replace(/−/g, '-');
  const extraYoy = originalYoy && change && !/同比|yoy/i.test(change) && normalize(originalYoy) !== normalize(change) ? originalYoy : undefined;
  return <div className={`cm-stat${hero ? ' cm-hero' : ''}${focus ? ' cm-focus' : ''}`} data-metric={metric.id}>
    <button type="button" className="cm-metric-link" onClick={() => open(metric)} aria-label={`${metric.label}，${primary ? `${primary.display}${primary.unit}，` : ''}${metric.display}${metric.unit}，查看口径与来源`}>
      <span className="cm-label">{label || metric.label_short || metric.label}{(metric.kind?.includes('estimate') || metric.is_proxy) && <span className="cm-kind"> · {metric.is_proxy ? '代理' : '估计'}</span>}</span>
      <span className="cm-number">{primary?.display || metric.display}<span className="cm-unit">{primary?.unit || metric.unit}</span></span>
    </button>
    {primary && <span className={`cm-delta ${direction(metric.display)}`}>{metric.display} {metric.unit}</span>}
    {change && <span className={`cm-delta ${direction(change)}`}>{change}</span>}
    {extraYoy && <span className={`cm-delta ${direction(extraYoy)}`}>{extraYoy}</span>}
    {showPeriod && <span className="cm-period">{metric.period}</span>}
    {children}
  </div>;
}
function Group({ title, note, children, className = '' }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return <section className={`cm-group ${className}`}><div className="cm-group-heading"><h4>{title}</h4>{note && <span>{note}</span>}</div>{children}</section>;
}
function Plot({ metrics, large = false, bars = false, strip = false }: { metrics: (Metric | undefined)[]; large?: boolean; bars?: boolean; strip?: boolean }) {
  const host = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(entries => { const measured = entries[0]?.contentRect.width; if (measured && measured > 0) setWidth(Math.max(120, measured)); });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const available = metrics.filter((metric): metric is Metric => Boolean(metric && (metric.series?.length || 0) >= 2));
  if (!available.length) return <figure ref={host} className="cm-plot"><div className="cm-no-history">无可比历史</div></figure>;
  const dates = [...new Set(available.flatMap(metric => metric.series!.map(point => point.date)))].sort();
  const values = available.flatMap(metric => metric.series!.map(point => point.value));
  let low = bars ? Math.min(0, ...values) : Math.min(...values);
  let high = Math.max(...values);
  if (high === low) { low -= 1; high += 1; }
  const left = strip ? 7 : width < 250 ? 33 : 39, right = width - 8, top = 6, bottom = large ? 90 : strip ? 26 : 38;
  const firstTime = Date.parse(dates[0]), lastTime = Date.parse(dates[dates.length - 1]);
  const x = (date: string) => Number.isFinite(firstTime) && lastTime > firstTime ? left + (Date.parse(date) - firstTime) / (lastTime - firstTime) * (right - left) : left + dates.indexOf(date) / Math.max(1, dates.length - 1) * (right - left);
  const y = (value: number) => bottom - (value - low) / (high - low) * (bottom - top);
  const description = available.map(metric => `${metric.label}，${metric.series!.length}点，${metric.unit}`).join('；');
  const sameMonth = dates[0].slice(0, 7) === dates[dates.length - 1].slice(0, 7);
  const dateLabel = (date: string) => width < 300 ? (sameMonth ? date.slice(5) : date.slice(2, 7)) : date;
  return <figure ref={host} className={`cm-plot${large ? ' cm-plot-large' : ''}`}>
    <svg viewBox={`0 0 ${width} ${bottom + (strip ? 18 : 22)}`}  style={{ height: bottom + (strip ? 18 : 22) }} role="img" aria-label={`${description}。共同纵轴 ${number(low)} 至 ${number(high)}；${dates[0]} 至 ${dates[dates.length - 1]}`}>
      <title>{description}</title>
      {(!strip ? [low, high] : [low]).map((value, index) => <g key={index}><line className="cm-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)} />{!strip && <text x={left - 5} y={y(value) + 4} textAnchor="end">{number(value)}</text>}</g>)}
      {available.map((metric, index) => <g key={metric.id} className={index % 2 ? 'cm-series-secondary' : 'cm-series-primary'}>
        {bars ? metric.series!.map(point => <rect key={point.date} x={x(point.date) - 6} y={y(Math.max(0, point.value))} width={12} height={Math.abs(y(point.value) - y(0))}><title>{point.date} · {point.value} {metric.unit}</title></rect>) : <polyline points={metric.series!.map(point => `${x(point.date)},${y(point.value)}`).join(' ')} fill="none" strokeWidth={2.3} vectorEffect="non-scaling-stroke" />}
        {!bars && metric.series!.map((point, i) => <circle key={`${point.date}-${i}`} cx={x(point.date)} cy={y(point.value)} r={metric.series!.length > 10 ? 2 : 3.6}><title>{metric.label} · {point.date} · {point.value} {metric.unit}</title></circle>)}
      </g>)}
      <text x={left} y={bottom + 15}>{dateLabel(dates[0])}</text><text x={right} y={bottom + 15} textAnchor="end">{dateLabel(dates[dates.length - 1])}</text>
    </svg>
    {available.length > 1 && <figcaption>{available.map((metric, index) => <span key={metric.id}><i className={index % 2 ? 'cm-key-secondary' : 'cm-key-primary'} />{metric.label_short || metric.label} · {metric.series!.length}点</span>)}</figcaption>}
  </figure>;
}
function Ring({ metric }: { metric?: Metric }) {
  if (!metric || !finite(metric.value) || metric.value < 0 || metric.value > 100) return null;
  return <svg className="cm-ring" viewBox="0 0 104 104" role="img" aria-label={`${metric.label} ${metric.display}%，完整圆代表100%`}>
    <circle className="cm-ring-track" cx="52" cy="52" r="42" />
    <circle className="cm-ring-value" cx="52" cy="52" r="42" pathLength="100" strokeDasharray={`${metric.value} ${100 - metric.value}`} transform="rotate(-90 52 52)" />
    <text x="52" y="52" textAnchor="middle" className="cm-ring-number">{metric.display}%</text><text x="52" y="68" textAnchor="middle">/ 100%</text>
  </svg>;
}
function Comparison({ metrics, labels, showPeriod = true }: { metrics: (Metric | undefined)[]; labels?: string[]; showPeriod?: boolean }) {
  const items = metrics.filter((item): item is Metric => Boolean(item));
  const sameUnit = new Set(items.map(item => item.unit)).size === 1;
  const max = Math.max(0, ...items.map(item => finite(item.value) ? Math.abs(item.value) : 0));
  return <div className="cm-comparison">{items.map((metric, index) => <div className="cm-bar-row" key={metric.id}><Stat metric={metric} label={labels?.[index]} showPeriod={showPeriod} />{sameUnit && finite(metric.value) && metric.value >= 0 && max > 0 && <div className="cm-bar-track" role="img" aria-label={`零基线，同单位对照：${metric.display} ${metric.unit}`}><span style={{ width: `${metric.value / max * 100}%` }} /></div>}</div>)}{sameUnit && max > 0 && <div className="cm-scale"><span>0</span><span>{number(max)} {items[0].unit}</span></div>}</div>;
}
function Split({ total, parts, label }: { total?: Metric; parts: (Metric | undefined)[]; label: string }) {
  const valid = total && finite(total.value) && total.value > 0 && parts.every(part => part && finite(part.value) && part.value >= 0 && part.unit === total.unit && part.period === total.period) && Math.abs(parts.reduce((sum, part) => sum + part!.value!, 0) - total.value) < 0.01;
  if (!valid) return <div className="cm-no-history">同口径分解数据不足</div>;
  return <div className="cm-split" role="img" aria-label={label}>{parts.map((part, index) => <span key={part!.id} className={index ? 'cm-split-light' : 'cm-split-dark'} style={{ width: `${part!.value! / total!.value! * 100}%` }}><span>{part!.display}</span></span>)}</div>;
}
function Dumbbell({ metric }: { metric?: Metric }) {
  const points = metric?.series;
  if (!metric || !points || points.length < 2) return <div className="cm-no-history">未提供两期可比值</div>;
  const previous = points[points.length - 2], current = points[points.length - 1];
  const low = Math.min(previous.value, current.value), high = Math.max(previous.value, current.value);
  const pad = Math.max((high - low) * .7, .1);
  const x = (value: number) => 48 + (value - low + pad) / (high - low + 2 * pad) * 474;
  return <div className="cm-dumbbell-wrap"><svg className="cm-dumbbell" viewBox="0 0 570 30" preserveAspectRatio="none" role="img" aria-label={`${previous.date} ${previous.value}${metric.unit}，${current.date} ${current.value}${metric.unit}。局部数轴，不是零基线。`}>
    <line x1="48" x2="522" y1="15" y2="15" className="cm-gridline" />
    <line x1={x(previous.value)} x2={x(current.value)} y1="15" y2="15" className="cm-dumbbell-link" />
    {[previous, current].map((point, index) => <circle key={index} cx={x(point.value)} cy="15" r="6" className={index ? 'cm-dot-current' : 'cm-dot-previous'} />)}
  </svg><div className="cm-dumbbell-labels"><span>{previous.date.slice(0, 7)} · {previous.value}%</span><span>{current.date.slice(0, 7)} · {current.value}%</span></div><span className="cm-axis-note">两季 · 局部轴</span></div>;
}
function Inventory({ metrics }: { metrics: Metric[] }) {
  const changes = metrics.map(metric => finite(metric.change?.value) ? metric.change.value : undefined);
  const max = Math.max(0, ...changes.filter(finite).map(Math.abs));
  const maxDeviation = Math.max(1, ...metrics.map(metric => finite(metric.five_year_deviation_pct) ? Math.abs(metric.five_year_deviation_pct) : 0));
  return <><div className="cm-inventories">{metrics.map((metric, i) => <div className="cm-inventory" key={metric.id}>
    <Stat metric={metric} />
    <div className="cm-diverging" role="img" aria-label={`周变 ${delta(metric)}，中线为零，共同轴±${number(max)}百万桶`}>{finite(changes[i]) && max > 0 && <span className={changes[i]! < 0 ? 'cm-down-fill' : 'cm-up-fill'} style={{ left: `${changes[i]! < 0 ? 50 - Math.abs(changes[i]!) / max * 50 : 50}%`, width: `${Math.abs(changes[i]!) / max * 50}%` }} />}</div>
    {finite(metric.five_year_deviation_pct) && <><span className={`cm-deviation ${metric.five_year_deviation_pct < 0 ? 'cm-down' : 'cm-up'}`}>五年偏离 {metric.five_year_deviation_approx ? '≈' : ''}{signed(metric.five_year_deviation_pct)}%</span><StockBullet metric={metric} extent={maxDeviation} /></>}
  </div>)}</div><div className="cm-axis-note">周变轴 ±{number(max)} 百万桶 · 偏离轴 ±{number(maxDeviation)}% · 中线均为0</div></>;
}

function StockBullet({ metric, extent }: { metric: Metric; extent: number }) {
  const deviation = metric.five_year_deviation_pct;
  if (!finite(deviation)) return null;
  return <><div className="cm-stock-bullet" role="img" aria-label={`较五年均值${metric.five_year_deviation_approx ? '约' : ''}${signed(deviation)}%，中线为五年均值；本条端点为±${number(extent)}%`}><span className={deviation < 0 ? 'cm-down-fill' : 'cm-up-fill'} style={{ left: `${deviation < 0 ? 50 - Math.abs(deviation) / extent * 50 : 50}%`, width: `${Math.abs(deviation) / extent * 50}%` }} /><i /></div></>;
}
function presentationValue(data: Monitor, chain: string, key: string) {
  const value = data.presentation?.[chain]?.[key];
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  return typeof item.display === 'string' && typeof item.unit === 'string' ? `${item.display} ${item.unit}` : null;
}
function OilCard({ chain }: { chain: Chain }) {
  const m = (id: string) => chain.metrics.find(metric => metric.id === `oil-${id}`);
  const stocks = ['us-crude-stocks', 'us-gasoline-stocks', 'us-distillate-stocks'].map(m).filter((item): item is Metric => Boolean(item));
  return <>
    <div className="cm-oil-top"><div className="cm-oil-prices"><div className="cm-two"><Stat metric={m('price')} hero focus /><Stat metric={m('wti')} hero /></div><Plot metrics={[m('price'), m('wti')]} large /></div>
      <div className="cm-oil-products"><div className="cm-two"><Stat metric={m('crack')} focus label="美湾3-2-1裂解" /><Stat metric={m('basis')} /></div><Plot metrics={[m('crack')]} /><div className="cm-two"><Stat metric={m('gasoline')} /><Stat metric={m('diesel')} label="美湾ULSD" /></div></div>
    </div>
    <Group title="美国三库存" note="周变 / 五年均值偏离"><Inventory metrics={stocks} /></Group>
    <div className="cm-oil-bottom"><Group title="美国炼厂"><div className="cm-refinery"><Ring metric={m('refinery-utilization')} /><Stat metric={m('refinery-utilization')} label="利用率" /><Stat metric={m('refinery-input')} label="原油吞吐" /></div></Group>
      <Group title="全球 / 中东"><div className="cm-two"><Stat metric={m('stock')} label="全球隐含去库" /><Stat metric={m('shutin')} label="中东停产" /></div></Group></div>
  </>;
}
function GoldCard({ chain, data }: { chain: Chain; data: Monitor }) {
  const m = (id: string) => chain.metrics.find(metric => metric.id === `gold-${id}`);
  const tonnage = presentationValue(data, chain.id, 'jewel_tonnage');
  return <>
    <div className="cm-focus-band cm-etf"><Stat metric={m('etf-flow')} hero focus label="ETF月净流入" /><Stat metric={m('etf')} focus label="ETF月增持" /><Stat metric={m('etf-total')} label="ETF月末存量" /></div>
    <div className="cm-gold-market"><Stat metric={m('price')} label="LBMA PM · 周报非实时" />{['real', 'dollar'].map(id => <div key={id}><Stat metric={m(id)} label={id === 'real' ? '美国10年实际利率' : undefined} /><Plot metrics={[m(id)]} /></div>)}</div>
    <Group title="WGC · 全球实物流量" note="独立分项 · 柱形零基线"><div className="cm-gold-physical">
      {['cb', 'mine', 'recycle', 'barcoin', 'jewel'].map(id => <div className="cm-physical-item" key={id}>
        <Stat metric={m(id)} label={id === 'cb' ? '官方净购金' : undefined}>{id === 'jewel' && tonnage && <span className="cm-supplement">{tonnage}</span>}</Stat>
        {id === 'jewel' ? <PercentChange metric={m(id)} /> : <Plot metrics={[m(id)]} bars strip />}
      </div>)}
    </div></Group>
    <Group title="Newmont · 同季" note="售价 = AISC + 差额（非净利）">
      <div className="cm-three"><Stat metric={m('nem-price')} label="实现售价" /><Stat metric={m('nem-aisc')} label="AISC" /><Stat metric={m('nem-spread')} focus /></div>
      <div className="cm-nem-bottom"><Stat metric={m('nem-output')} label="归属产量" /><Stat metric={m('nem-fcf')} label="自由现金流" /><div><Split total={m('nem-price')} parts={[m('nem-aisc'), m('nem-spread')]} label="同季实现售价 = AISC + 售价减AISC差额，美元/盎司" /><span className="cm-axis-note">深 AISC / 浅 差额</span></div></div>
    </Group>
  </>;
}
function PercentChange({ metric }: { metric?: Metric }) {
  if (!metric || !finite(metric.value)) return null;
  // A percentage-change axis is symmetric, labelled and never treated as a share.
  const extent = Math.max(100, Math.ceil(Math.abs(metric.value) / 100) * 100);
  return <><div className="cm-diverging" role="img" aria-label={`${metric.label} ${metric.display}${metric.unit}，数轴负${extent}%至正${extent}%`}><span className={metric.value < 0 ? 'cm-down-fill' : 'cm-up-fill'} style={{ left: `${metric.value < 0 ? 50 - Math.abs(metric.value) / extent * 50 : 50}%`, width: `${Math.abs(metric.value) / extent * 50}%` }} /></div><div className="cm-scale"><span>−{extent}%</span><span>0</span><span>+{extent}%</span></div></>;
}
function AiCard({ chain, data }: { chain: Chain; data: Monitor }) {
  const m = (id: string) => chain.metrics.find(metric => metric.id === `ai-${id}`);
  const wholeQuote = presentationValue(data, chain.id, 'whole_instance_quote');
  return <>
    <div className="cm-ai-trends">{['cloud-revenue', 'azure', 'margin'].map((id, index) => <div key={id}><Stat metric={m(id)} label={['微软Cloud收入', 'Azure收入同比', 'Cloud毛利率'][index]} hero={index === 0} focus={id !== 'margin'} /><Plot metrics={[m(id)]} /></div>)}</div>
    <Group title="微软 · 现金分解" note="CFO = 现金PP&E + FCF"><div className="cm-ai-cash">
      <div><Stat metric={m('cfo')} label="经营现金流 CFO" hero focus /><Split total={m('cfo')} parts={[m('cash-capex'), m('fcf')]} label="经营现金流 = 现金PP&E + 自由现金流；并非含租赁资本开支" /><div className="cm-two"><Stat metric={m('cash-capex')} /><Stat metric={m('fcf')} label="自由现金流 FCF" focus /></div></div>
      <div className="cm-ai-capex"><Stat metric={m('capex')} label="资本开支 · 含租赁" /><Plot metrics={[m('capex')]} bars /></div>
    </div></Group>
    <div className="cm-ai-contracts"><Group title="微软 · 商业RPO"><div className="cm-rpo"><Stat metric={m('rpo')} label="商业RPO" /><Ring metric={m('rpo-12m')} /><Stat metric={m('rpo-12m')} label="12月确认占比" /></div></Group>
      <Group title="Lambda · 固定SKU报价"><Stat metric={m('rent')} label="8×H100 SXM · 非利用率">{wholeQuote && <span className="cm-supplement">整机 {wholeQuote}</span>}</Stat></Group></div>
    <Group title="独立公司样本" note="非行业合计"><div className="cm-ai-samples">
      <div className="cm-sample"><div className="cm-sample-heading">NVIDIA <span>{m('nvda-dc')?.period}</span></div><div className="cm-two"><Stat metric={m('nvda-dc')} label="数据中心收入" showPeriod={false} /><Stat metric={m('nvda-margin')} label="GAAP毛利率" showPeriod={false} /></div></div>
      <div className="cm-sample"><div className="cm-sample-heading">TSMC <span>{m('tsmc-revenue')?.period}</span></div><div className="cm-two"><Stat metric={m('tsmc-revenue')} label="收入" showPeriod={false} /><Stat metric={m('tsmc-hpc')} label="HPC收入占比" showPeriod={false} /></div></div>
    </div></Group>
  </>;
}
function GridCard({ chain }: { chain: Chain }) {
  const m = (id: string) => chain.metrics.find(metric => metric.id === `grid-${id}`);
  const backlog = m('backlog');
  const acquisition = backlog?.acquisition_contribution_bn;
  return <>
    <div className="cm-focus-band cm-grid-backlog"><Stat metric={backlog} hero focus>{finite(acquisition) && <span className="cm-supplement">含收购贡献 {number(acquisition)} 十亿美元</span>}</Stat><Stat metric={m('btb')} label="订单 / 收入 · 非转化率" /></div>
    <div className="cm-grid-trading"><Group title="GEV · 电气化订单 / 交付" note="零基线"><div className="cm-side-comparison"><Comparison metrics={[m('order-amount'), m('revenue-amount')]} /></div><div className="cm-two cm-subrow"><Stat metric={m('order')} label="订单有机同比" /><Stat metric={m('delivery')} label="收入有机同比" /></div></Group>
      <Group title="GEV · 分部盈利"><div className="cm-grid-profit"><Stat metric={m('margin')} label="EBITDA率" focus /><Stat metric={m('ebitda')} label="EBITDA" /></div><Dumbbell metric={m('margin')} /></Group></div>
    <div className="cm-grid-lower"><Group title="GEV · 全公司现金"><Comparison metrics={[m('cfo'), m('fcf')]} /></Group>
      <Group title="中国 · 用电 / 投资"><div className="cm-grid-domestic"><Stat metric={m('power-use')} label="全社会用电" /><Stat metric={m('data-power')} label="数据服务用电" /><Stat metric={m('peak')} label="全国最高负荷" /><Stat metric={m('csg')} label="南网完成投资" /></div></Group></div>
  </>;
}
function ClinicalInterval({ metric }: { metric?: Metric }) {
  if (!metric || !finite(metric.value)) return null;
  const interval = metric.confidence_interval;
  const valid = interval?.length === 2 && interval.every(finite);
  return <><svg className="cm-ci" viewBox="0 0 300 30" preserveAspectRatio="none" role="img" aria-label={`${metric.label} ${metric.display}%，${valid ? `置信区间 ${interval!.join('–')}%，` : ''}独立样本 n=${metric.sample_n ?? '未提供'}，轴为0至100%`}>
    <line className="cm-ci-track" x1="12" x2="288" y1="15" y2="15" />
    {valid && <line x1={12 + Number(interval![0]) * 2.76} x2={12 + Number(interval![1]) * 2.76} y1="15" y2="15" />}
    <circle cx={12 + metric.value * 2.76} cy="15" r="5" />
  </svg><div className="cm-scale"><span>0</span>{valid && <span>CI {interval!.join('–')}%</span>}<span>100%</span></div></>;
}
function DrugCard({ chain, data }: { chain: Chain; data: Monitor }) {
  const m = (id: string) => chain.metrics.find(metric => metric.id === `drug-${id}`);
  const salesValue = data.presentation?.[chain.id]?.sales_amount;
  const sales = salesValue && typeof salesValue === 'object' ? salesValue as Record<string, unknown> : undefined;
  const primary = sales && typeof sales.display === 'string' && typeof sales.unit === 'string' ? { display: sales.display, unit: sales.unit } : undefined;
  return <div className="cm-drug-layout"><div className="cm-drug-business">
    <div className="cm-focus-band cm-two"><Stat metric={m('sales')} label="BRUKINSA · 全球单品销售" primary={primary} hero focus /><Stat metric={m('cash')} label="BeOne经营现金流" hero focus /></div>
    <Group title="BeOne · 公司财务" note={m('revenue')?.period}><div className="cm-drug-finance">
      <Comparison metrics={[m('revenue'), m('rd'), m('sga'), m('op')]} labels={['总收入', 'GAAP研发', 'GAAP销售 / 管理', 'GAAP经营利润']} showPeriod={false} />
      <div className="cm-finance-side"><Stat metric={m('gm')} label="产品GAAP毛利率" showPeriod={false} /><Stat metric={m('fcf')} label="自由现金流" showPeriod={false} focus /><Stat metric={m('cash-balance')} label="现金 / 等价物 / 受限现金" showPeriod={false} focus /><Stat metric={m('tevimbra')} label="替雷利珠单抗销售" showPeriod={false} /></div>
    </div></Group>
  </div><div className="cm-drug-evidence">
    <Group title="Sonrotoclax · 美国复发/难治MCL"><Stat metric={m('event')} label="FDA加速批准" />
      <div className="cm-clinical"><div><Stat metric={m('orr')} label="ORR · 疗效" focus /><ClinicalInterval metric={m('orr')} /><span className="cm-axis-note">n={m('orr')?.sample_n ?? '未提供'}</span></div>
      <div><Stat metric={m('serious')} label="严重不良反应 · 安全性" /><ClinicalInterval metric={m('serious')} /><span className="cm-axis-note">独立 n={m('serious')?.sample_n ?? '未提供'}</span></div></div>
      <div className="cm-dor-row"><Stat metric={m('dor')} label="中位DOR · 非OS" /><span className="cm-axis-note">CI {m('dor')?.confidence_interval?.join('–') || '未提供'} 月</span></div>
    </Group>
    <Group title="石药 · 许可实际到账"><div className="cm-drug-payments"><Stat metric={m('bd')} label="siRNA首付" />
      {chain.events?.length ? <ol className="cm-events">{chain.events.map((event, index) => <li key={`${event.date}-${index}`}><time>{event.date}</time><span>{event.label} </span><strong>{event.display}</strong><span>{event.unit}</span></li>)}</ol> : <span className="cm-axis-note">到账事件未提供</span>}
    </div></Group>
  </div></div>;
}

const readingNotes: Record<string, string[]> = {
  'crude-oil': ['Brent与WTI使用共同价格轴及实际日期。美湾3-2-1价差是成品油 / WTI代理口径，不是炼厂利润。', '三库存周变与五年偏离分别共用对称零轴；偏离0代表五年均值。全球隐含去库与中东停产属于不同实际时期，不相加。'],
  gold: ['ETF资金流、增持吨数与月末存量口径不同；LBMA PM是周报快照，不是实时金价。', 'WGC各供需分项独立展示，不合并成总饼。历史柱形以0为基线，首末时期标在各带下。', 'Newmont同季售价分解为AISC与售价减AISC差额；该差额不是净利润。'],
  'ai-compute': ['Cloud收入、Azure收入增速与Cloud毛利率各用自己的单位和数轴。无历史不补造趋势。', '现金分解为CFO = 现金PP&E + FCF；含融资租赁的资本开支另列。RPO未来12个月确认占比不是订单转化率。', 'NVIDIA与TSMC是不同报告期的独立公司样本，不是行业合计；Lambda为固定8×H100 SXM报价代理，不是利用率或成交均价。'],
  grid: ['同季订单 / 收入是倍数，不是转化率；报告同比与有机同比分别保留。EBITDA率哑铃使用两季局部轴。', 'GEV整体现金流不是电气化分部现金流。中国负荷、用电量与南网投资按各自单位和时期独立展示，不跨市场组成漏斗。'],
  'innovative-drugs': ['公司收入、费用、经营利润作同单位对照，不构造虚假的利润瀑布。', 'ORR与严重不良反应使用独立疗效 / 安全性样本；CI是披露的置信区间。DOR是缓解持续时间，不是OS。', '两笔许可为实际到账事件，不计算增速。'],
};
const fieldLabels: Record<string, string> = {
  detail: '指标解释', thesis: '核心问题', summary: '链条判断', status_type: '状态类型', en: '英文名称', category: '监控主线', update_method: '更新方式', freshness: '数据时效', verified_on: '核查日期', series_label: '历史观察口径', published: '来源发布日期', locator: '原文定位',
  id: '标识', label: '指标', label_short: '短名称', value: '原始数值', display: '展示值', unit: '单位', period: '实际观察期', kind: '数据类型',
  scope: '范围与口径', scope_short: '范围简记', source: '来源标识', sources: '来源', source_id: '来源标识', source_ids: '来源标识',
  updated_at: '更新时间', update: '更新', as_of: '数据截至', release_date: '披露日期', observed_at: '观察时间', fetched_at: '获取时间',
  change: '原始变化', delta_display: '变化简记', type: '类型', date: '日期', series: '全部历史观察', formula: '计算公式', inputs: '输入指标',
  logic: '传导逻辑', mechanism: '机制', counter: '反向证据', counter_evidence: '反向证据', missing: '缺口', missing_data: '数据缺口',
  note: '说明', notes: '说明', caveat: '限制', caveats: '限制', limitations: '限制', definition: '定义', interpretation: '解释',
  url: '来源链接', href: '入口', title: '标题', name: '名称', publisher: '发布方', structure: '产业链版本', status: '状态', current_release: '已发布版本', draft_package: '草稿包',
  confidence_interval: '置信区间', sample_n: '独立样本量', is_proxy: '是否代理口径', five_year_deviation_pct: '较五年均值偏离（%）',
  five_year_deviation_approx: '五年偏离是否约数', acquisition_contribution_bn: '收购贡献（十亿美元）', events: '实际到账事件', schema: '响应版本',
};
function ApiValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <span>未提供</span>;
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? <a href={value} target="_blank" rel="noreferrer">{value} ↗</a> : <span>{value}</span>;
  if (typeof value === 'number') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ul className="cm-values">{value.map((item, index) => <li key={index}><ApiValue value={item} /></li>)}</ul> : <span>未提供</span>;
  if (typeof value === 'object') return <dl className="cm-fields">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{fieldLabels[key] || key}</dt><dd>{key === 'series' ? <details><summary>原始观察（{Array.isArray(item) ? item.length : 0}）</summary><ApiValue value={item} /></details> : <ApiValue value={item} />}</dd></div>)}</dl>;
  return null;
}
function structureHref(chain: Chain) { const href = chain.structure?.href; return typeof href === 'string' && /^\/chain(?:\?|$)/.test(href) ? href : undefined; }
function MonitorDetails({ selection, data, dismiss, onNavigate, showStructureLink = true }: { selection: Selection; data: Monitor; dismiss: () => void; onNavigate?: (focusId: string) => void; showStructureLink?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const trigger = selection.trigger;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    return () => {
      document.body.style.overflow = overflow;
      if (trigger?.isConnected && !trigger.closest('[hidden]')) trigger.focus({ preventScroll: true });
    };
  }, []);
  const { chain, metric } = selection;
  const chainInfo = Object.fromEntries(Object.entries(chain).filter(([key]) => key !== 'metrics'));
  const metadata = Object.fromEntries(Object.entries(data).filter(([key]) => !['chains', 'sources', 'presentation'].includes(key)));
  const href = showStructureLink ? structureHref(chain) : undefined;
  return createPortal(<dialog ref={dialog} className="cm-dialog" aria-labelledby="cm-detail-title" onClose={() => dismissRef.current()} onCancel={event => { event.preventDefault(); dismissRef.current(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismissRef.current();
  }}>
    <header className="cm-dialog-header"><div><h2 id="cm-detail-title">{chain.name} · {metric?.label || '口径、更新与来源'}</h2><p>{data.as_of}</p></div><button type="button" className="cm-close" autoFocus onClick={() => dismissRef.current()}>关闭 ×</button></header>
    <div className="cm-dialog-body">
      {href && <a href={href} onClick={() => onNavigate?.(`cm-chain-${chain.id}`)}>打开对应{chain.structure?.status === 'draft' ? '草稿' : '产业链'}版本 →</a>}
      <details><summary>图形读法与口径边界</summary><ul className="cm-reading-notes">{readingNotes[chain.id]?.map(note => <li key={note}>{note}</li>)}</ul></details>
      {metric && <section><h3>当前指标 · 原始观察与解释</h3><ApiValue value={metric} /></section>}
      <section><h3>链条说明、范围与更新</h3><ApiValue value={chainInfo} /></section>
      <section><h3>全部 {chain.metrics.length} 项指标</h3>{chain.metrics.map(item => <details key={item.id}><summary>{item.label} · {item.display} {item.unit} · {item.period}</summary><ApiValue value={item} /></details>)}</section>
      {data.presentation?.[chain.id] && <details><summary>补充展示值 · 原始口径</summary><ApiValue value={data.presentation[chain.id]} /></details>}
      <section><h3>完整来源索引</h3><p className="cm-dialog-note">来源标识对应下列 API 原始记录；未披露的信息不作推算。铜 / 橄榄仅表示增减，不代表利好或利空。</p><ApiValue value={data.sources} /></section>
      <details><summary>响应元数据与截至时间</summary><ApiValue value={metadata} /></details>
    </div>
  </dialog>, document.body);
}

// Home is an editorial selection, not a shrunken copy of the 72-metric panel.
const homeMetrics: Record<string, { id: string; label: string; presentation?: string }[]> = {
  'crude-oil': [{ id: 'oil-price', label: 'Brent现货' }, { id: 'oil-crack', label: '美湾3-2-1裂解' }, { id: 'oil-us-crude-stocks', label: '美国商业原油库存' }],
  gold: [{ id: 'gold-price', label: 'LBMA PM · 周报' }, { id: 'gold-etf-flow', label: '全球黄金ETF净流入' }, { id: 'gold-real', label: '美国10年实际利率' }],
  'ai-compute': [{ id: 'ai-capex', label: '微软Capex · 含租赁' }, { id: 'ai-azure', label: '微软Azure收入增速' }, { id: 'ai-margin', label: '微软Cloud毛利率' }],
  grid: [{ id: 'grid-order-amount', label: 'GEV电气化订单' }, { id: 'grid-revenue-amount', label: 'GEV电气化收入' }, { id: 'grid-margin', label: 'GEV电气化EBITDA率' }],
  'innovative-drugs': [{ id: 'drug-sales', label: '百济BRUKINSA销售', presentation: 'sales_amount' }, { id: 'drug-cash', label: '百济经营现金流' }, { id: 'drug-bd', label: '石药siRNA实际首付' }],
};
function CompactMetrics({ chain, data }: { chain: Chain; data: Monitor }) {
  const open = useContext(DetailContext);
  return <div className="cm-compact-metrics">{homeMetrics[chain.id].map(item => {
    const metric = chain.metrics.find(value => value.id === item.id)!;
    const extra = item.presentation ? data.presentation?.[chain.id]?.[item.presentation] : undefined;
    const primary = extra && typeof extra === 'object' ? extra as Record<string, unknown> : undefined;
    const usePrimary = primary?.period === metric.period && typeof primary.display === 'string' && typeof primary.unit === 'string';
    const display = usePrimary ? String(primary!.display) : metric.display;
    const unit = usePrimary ? String(primary!.unit) : metric.unit;
    // Only numerical direction, never the snapshot's qualitative status strings.
    const change = usePrimary ? `${metric.display} ${metric.unit}` : /[+−-]\s*\d/.test(delta(metric)) ? delta(metric) : '';
    return <button type="button" className="cm-compact-metric" key={metric.id} data-metric={metric.id} onClick={() => open(metric)} aria-label={`${item.label}，${display}${unit}，${metric.period}，${change}，查看来源`}>
      <span className="cm-compact-label">{item.label}{metric.is_proxy ? ' · 代理' : ''}</span>
      <span className={`cm-compact-value ${direction(display)}`}>{display}<small>{unit}</small></span>
      <span className="cm-compact-period">{metric.period}</span>
      {change && <span className={`cm-compact-change ${direction(change)}`}>{change}</span>}
    </button>;
  })}</div>;
}
function FullChainFigures({ chain, data }: { chain: Chain; data: Monitor }) {
  return chain.id === 'crude-oil' ? <OilCard chain={chain} /> : chain.id === 'gold' ? <GoldCard chain={chain} data={data} /> : chain.id === 'ai-compute' ? <AiCard chain={chain} data={data} /> : chain.id === 'grid' ? <GridCard chain={chain} /> : <DrugCard chain={chain} data={data} />;
}

export default function ChainMonitor({ hidden = false, chainId, onReady, onNavigate }: { hidden?: boolean; chainId?: string; onReady?: (ready: boolean) => void; onNavigate?: (focusId: string) => void }) {
  const result = useApi<Monitor>('/chain-monitor');
  const [selection, setSelection] = useState<Selection | null>(null);
  function openDetails(chain: Chain, metric?: Metric) {
    setSelection({ chain, metric, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  }
  useEffect(() => { setSelection(null); }, [hidden, chainId]);
  const valid = validMonitor(result.data);
  const unavailable = Boolean(result.error) || (!result.loading && !valid);
  const data = valid ? result.data! : undefined;
  const detail = chainId !== undefined;
  const ids = detail ? Object.keys(metricIds).filter(id => id === chainId) : Object.keys(metricIds);
  useLayoutEffect(() => { if (!result.loading || data || result.error) onReady?.(true); }, [onReady, result.loading, data, result.error]);
  if (!ids.length) return null;
  return <section className={`cm-monitor ${detail ? 'cm-detail' : 'cm-compact'}`} hidden={hidden} aria-labelledby="cm-heading" aria-busy={result.loading}>
    <header className="cm-heading"><div><h2 id="cm-heading">{detail ? `${data?.chains.find(chain => chain.id === chainId)?.name || '产业'}监控` : '产业脉搏'}</h2><p>{detail ? '独立固定快照，非结构版本历史行情；各值按实际期别。' : '五链快照 · 点击数值核对来源'}</p></div><div className="cm-heading-side"><span>{data && !unavailable ? data.as_of : '真实数据 · 无静态替代'}</span><span><b className="cm-up">铜 ＋</b> / <b className="cm-down">橄榄 −</b> · 仅方向</span></div></header>
    {unavailable ? <div className="cm-state" role="alert"><h3>产业监测暂不可用</h3><p>{result.error || '响应缺少完整五链或72项指标，未使用静态数据替代。'}</p><button type="button" className="cm-retry" onClick={result.reload}>重新载入</button></div> : !data ? <div className="cm-state" role="status">正在载入五链指标与原始观察…</div> : <div className="cm-grid">
      {ids.map(id => {
        const chain = data.chains.find(item => item.id === id)!;
        const href = structureHref(chain);
        return <DetailContext.Provider key={chain.id} value={metric => openDetails(chain, metric)}><article className={`cm-card cm-card-${chain.id}`} aria-label={`${chain.name}${detail ? '完整监控' : '关键观察'}`}>
          {!detail && <header className="cm-card-header"><h3>{chain.name}</h3>{href ? <a id={`cm-chain-${chain.id}`} href={href} onClick={() => onNavigate?.(`cm-chain-${chain.id}`)}>详情 →{chain.structure?.status === 'draft' && <span>草稿</span>}</a> : <span className="cm-caption">入口未提供</span>}</header>}
          <div className="cm-card-content">{detail ? <FullChainFigures chain={chain} data={data} /> : <CompactMetrics chain={chain} data={data} />}</div>
          <footer className="cm-card-footer"><span>{detail ? `${chain.metrics.length} 项 · 点击数字核对` : '固定快照 · 非实时'}</span><button type="button" className="cm-detail-button" onClick={() => openDetails(chain)}>{detail ? '口径 / 更新 / 来源 ↗' : '来源 ↗'}</button></footer>
        </article></DetailContext.Provider>;
      })}
    </div>}
    {selection && data && !hidden && (!detail || selection.chain.id === chainId) && <MonitorDetails selection={selection} data={data} dismiss={() => setSelection(null)} onNavigate={onNavigate} showStructureLink={!detail} />}
  </section>;
}
