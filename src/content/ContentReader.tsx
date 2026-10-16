import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, storageWarning } from '../api';
import { isIOS } from '../vault';
import type {
  Change, Company, CompanyDetail, Coverage, Evidence, IndustryDetail, IndustryNode,
  Mechanism, MethodSet, NewsDetail, NewsItem, NewsPage, Overview, Page, Relation, Verification,
} from './types';
import './content.css';
import { EditorialHome, EditorialArticle, EditorialFollowing, EditorialSystem, FollowButton } from './EditorialReader';
import { IndustryChainSection, CompanyStrategyWorkbench, StrategyManagerPage } from './ChainAndStrategyView';

const encode = encodeURIComponent;
const newsHref = (id: string) => `#/news/${encode(id)}`;
const industryHref = (id: string) => `#/industries/${encode(id)}`;
const companyHref = (code: string) => `#/companies/${encode(code)}`;
const verification: Record<Verification, string> = { primary: '原始来源', provider: '供应商资料', unverified: '未核实' };
const variableLabels: Record<Change['variable'], string> = {
  input_cost: '投入成本', selling_price: '销售价格', demand: '需求', capacity: '产能',
  supply: '供给', inventory: '库存', policy: '政策', orders: '订单',
};
const directionLabels: Record<Change['direction'], string> = { up: '上升', down: '下降', changed: '变化' };
const scrollPositions = new Map<string, number>();
const ReaderContext = createContext({ route: '#/', refresh: 0, retry: () => {} });

function timestamp(value: string | null | undefined): string {
  if (!value) return '时间未知';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}（未提供具体时间）`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
function reportPeriod(value: string | null): string {
  if (!value?.trim()) return '报告期未提供';
  if (/\bMRQ\b/i.test(value)) return `${value}（最近季度口径，具体报告期未明确）`;
  if (/\b(TTM|FY|LTM)\b/i.test(value) && !/\d{4}/.test(value)) return `${value}（口径标签，具体报告期未明确）`;
  return value;
}
function safeSource(url: string | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}
function SourceLink({ url, children = '查看原文 ↗' }: { url: string | null; children?: ReactNode }) {
  const [error, setError] = useState('');
  const href = safeSource(url);
  if (!href) return <span className="cr-meta">原文链接不可用</span>;
  return <><a href={href} target="_blank" rel="noopener noreferrer" onClick={event => {
    setError('');
    if (!isIOS) return;
    event.preventDefault();
    void import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: href, presentationStyle: 'fullscreen' }))
      .catch(() => setError('原文打开失败，请再次点击重试。'));
  }}>{children}</a>{error && <span role="alert" className="cr-error cr-source-error">{error}</span>}</>;
}
function EvidenceList({ items, label = '查看依据' }: { items: Evidence[]; label?: string }) {
  if (!items.length) return <p className="cr-meta">暂无可展示依据。</p>;
  return <details className="cr-evidence"><summary>{label}（{items.length}）</summary><ul>{items.map((item, i) =>
    <li key={`${item.source_item_id ?? item.url ?? item.title}-${i}`}>
      <strong>{item.title || '来源未提供标题'}</strong>
      <p className="cr-meta">{item.provider || '来源未知'} · {verification[item.verification] ?? '未核实'}</p>
      <p className="cr-meta">资料时点：{timestamp(item.as_of)} · 收录：{timestamp(item.observed_at)}（北京时间）
        {item.source_item_version != null && <> · 来源版本 {item.source_item_version}</>}</p>
      {item.quote && <blockquote>{item.quote}</blockquote>}
      <SourceLink url={item.url}/>
    </li>)}</ul></details>;
}
function TextList({ items, empty = '尚未提供。' }: { items: string[]; empty?: string }) {
  return items.length ? <ul>{items.map((text, i) => <li key={i}>{text}</li>)}</ul> : <p className="cr-meta">{empty}</p>;
}
function Empty({ children }: { children: ReactNode }) { return <p className="cr-empty">{children}</p>; }
function Missing({ items }: { items: string[] }) {
  return <section><h2>证据缺口</h2><TextList items={items} empty="接口未列出缺项，不代表资料完整。"/></section>;
}

interface ReadState<T> { path: string; data?: T; error?: Error; loading: boolean }
function useRead<T>(path: string, refresh: number): ReadState<T> {
  const [state, setState] = useState<ReadState<T>>({ path, loading: true });
  useEffect(() => {
    let active = true;
    setState(old => ({ path, data: old.path === path ? old.data : undefined, loading: true }));
    void api<T>(`/content${path}`).then(data => {
      if (active) setState({ path, data, loading: false });
    }, (error: unknown) => {
      if (active) setState(old => ({ path, data: old.path === path ? old.data : undefined,
        error: error instanceof Error ? error : new Error('内容暂不可用，请重试。'), loading: false }));
    });
    return () => { active = false; };
  }, [path, refresh]);
  return state.path === path ? state : { path, loading: true };
}
function Read<T>({ path, title, children }: { path: string; title?: string; children: (data: T) => ReactNode }) {
  const { route, refresh, retry } = useContext(ReaderContext);
  const state = useRead<T>(path, refresh);
  const ready = !state.loading && Boolean(state.data || state.error);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#content h1')?.focus({ preventScroll: true });
      window.scrollTo(0, scrollPositions.get(route) ?? 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [route, ready]);
  return <div aria-busy={state.loading}>
    {title && !state.data && <h1 tabIndex={-1}>{title}</h1>}
    {state.loading && <p className="cr-meta" role="status">正在读取已保存内容…</p>}
    {state.error && <div className="cr-notice cr-error" role="alert"><p>{state.error.message}</p>
      {state.data && <p>以下为本页上次读取内容，尚未确认有无更新。</p>}<button onClick={retry}>重试读取</button></div>}
    {state.data && children(state.data)}
  </div>;
}
function queryHref(path: string, values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  return `#${path}${params.size ? `?${params}` : ''}`;
}
function offsetOf(url: URL): number {
  const offset = Number(url.searchParams.get('offset') ?? 0);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}
function Pagination({ url, total, count, limit }: { url: URL; total: number; count: number; limit: number }) {
  const offset = offsetOf(url);
  function href(next: number) {
    const params = new URLSearchParams(url.searchParams);
    if (next) params.set('offset', String(next)); else params.delete('offset');
    return `#${url.pathname}${params.size ? `?${params}` : ''}`;
  }
  return <nav className="cr-pagination" aria-label="列表分页">
    {offset > 0 && <a href={href(Math.max(0, offset - limit))}>← 上一页</a>}
    <span className="cr-meta">{count ? `${offset + 1}–${offset + count} / ${total}` : `共 ${total} 条`}</span>
    {offset + count < total && count > 0 && <a href={href(offset + limit)}>下一页 →</a>}
    {offset > 0 && !count && <a href={href(0)}>返回第一页</a>}
  </nav>;
}
function Search({ initial, label, onSubmit, children }: {
  initial: string; label: string; onSubmit: (query: string) => void; children?: ReactNode;
}) {
  const [query, setQuery] = useState(initial);
  useEffect(() => { setQuery(initial); }, [initial]);
  function submit(event: FormEvent) { event.preventDefault(); onSubmit(query.trim()); }
  return <form className="cr-search" role="search" onSubmit={submit}>
    <label htmlFor="cr-query">{label}</label><div className="cr-search-row">
      <input id="cr-query" type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}/>
      <button type="submit">搜索</button></div>{children}
  </form>;
}
function IndustryLinks({ nodes }: { nodes: IndustryNode[] }) {
  return nodes.length ? <ul className="cr-link-list">{nodes.map(node => <li key={node.id}><a href={industryHref(node.id)}>{node.name}</a></li>)}</ul>
    : <p className="cr-meta">尚无已收录产业关联。</p>;
}
function CompanyList({ companies, compact = false }: { companies: Company[]; compact?: boolean }) {
  return companies.length ? <ul className="cr-company-list">{companies.map(company => <li key={company.code}>
    <a href={companyHref(company.code)}>{company.name}</a> <span className="cr-meta">{company.code}</span>
    {!compact && <p>{company.business || '主营资料尚未提供。'}</p>}
  </li>)}</ul> : <Empty>暂无已收录公司。</Empty>;
}
function verifiedChange(news: NewsItem): boolean {
  const change = news.change;
  return Boolean(change && change.basis.trim() && news.verification !== 'unverified'
    && change.evidence.some(item => item.verification === 'primary' || item.verification === 'provider'));
}
function NewsList({ items }: { items: NewsItem[] }) {
  return items.length ? <ol className="cr-news-list">{items.map(news => <li key={news.id}>
    <h2><a href={newsHref(news.id)}>{news.title}</a></h2>
    {news.summary ? <p className="cr-news-summary">{news.summary}</p> : <p className="cr-meta">暂无获许可摘要，可进入详情核验来源。</p>}
    <p className="cr-meta">{news.source || '来源未知'} · 发布：{timestamp(news.published_at)}（北京时间） · {verification[news.source_status ?? news.verification]}</p>
    <p className="cr-analysis-state">{!verifiedChange(news) ? '待核实触发条件' : news.analysis_status === 'conditional' ? '有条件机制，需核对成立条件' : '变化线索待补证'}
      <span className="cr-meta"> · <SourceLink url={news.url}/></span></p>
  </li>)}</ol> : <Empty>暂无已收录新闻。未收录不等于没有相关变化。</Empty>;
}
function CoverageStatus({ coverage }: { coverage: Coverage }) {
  const run = coverage.latest_run;
  const runLabels: Record<string, string> = {
    ok: '采集成功', success: '采集成功', succeeded: '采集成功', completed: '采集完成',
    partial: '部分完成', failed: '采集失败', error: '采集失败', running: '采集中', pending: '等待采集',
  };
  return <section><h2>收录与来源状态</h2>
    <dl className="cr-facts"><dt>分类及产业节点</dt><dd>{coverage.nodes}</dd><dt>上下游关系</dt><dd>{coverage.production_edges ?? 0}</dd>
      <dt>公司 / 新闻</dt><dd>{coverage.companies} / {coverage.news}</dd>
      <dt>数据观察</dt><dd>{coverage.observations}</dd><dt>内容更新时间</dt><dd>{timestamp(coverage.updated_at)}</dd></dl>
    {run ? <><p>{run.provider} · {runLabels[run.status] ?? `采集状态：${run.status}`}</p>
      <p className="cr-meta">开始：{timestamp(run.started_at)}<br/>结束：{timestamp(run.finished_at)}</p>
      {run.error && <p className="cr-error">{run.error}</p>}</> : <p className="cr-meta">尚无采集记录，无法确认来源新鲜度。</p>}
    <p className="cr-meta">仅代表已收录范围；读取页面不触发采集。</p>
  </section>;
}
function Home() {
  return <><h1 tabIndex={-1}>最新收录新闻</h1><Read<Overview> path="/overview">{data => <div className="cr-columns">
    <div><NewsList items={data.recent_news}/><p className="cr-more"><a href="#/news">检索全部新闻 →</a></p></div>
    <aside aria-label="产业、公司与覆盖"><section><h2>产业入口</h2><IndustryLinks nodes={data.featured_industries}/>
      <a href="#/industries">全部产业 →</a></section><section><h2>已收录公司</h2><CompanyList companies={data.recent_companies} compact/>
      <a href="#/companies">查找公司 →</a></section><CoverageStatus coverage={data.coverage}/></aside>
  </div>}</Read></>;
}
function IndustryFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { refresh } = useContext(ReaderContext);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  const state = useRead<Page<IndustryNode>>(`/industries?limit=60&offset=0&q=${encode(search)}`, refresh + retry);
  return <fieldset className="cr-filter"><legend>按产业筛选新闻</legend>
    <div className="cr-filter-search"><label htmlFor="cr-industry-search">查找产业目录</label>
      <div className="cr-search-row"><input id="cr-industry-search" type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setSearch(query.trim()); } }}/>
        <button type="button" onClick={() => setSearch(query.trim())}>查找产业</button></div></div>
    <label htmlFor="cr-industry">产业</label><select id="cr-industry" value={value} onChange={event => onChange(event.target.value)}>
      <option value="">全部产业</option>
      {value && !state.data?.items.some(node => node.id === value) && <option value={value}>当前产业：{value}</option>}
      {state.data?.items.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
    </select>
    {state.loading && <p className="cr-meta" role="status">读取产业目录…</p>}
    {state.error && <p role="alert">产业目录读取失败。<button type="button" onClick={() => setRetry(n => n + 1)}>重试目录</button></p>}
    {state.data && !state.data.items.length && <p className="cr-meta">没有匹配产业，请换词查询。</p>}
    {state.data && state.data.total > state.data.items.length && <p className="cr-meta">当前显示前 {state.data.items.length} 个目录，请用名称缩小查询。</p>}
  </fieldset>;
}
function NewsIndex({ url }: { url: URL }) {
  const query = url.searchParams.get('q') ?? '';
  const industry = url.searchParams.get('industry') ?? '';
  const company = url.searchParams.get('company') ?? '';
  const offset = offsetOf(url);
  const filters = { q: query, industry, company };
  const path = `/news?${new URLSearchParams({ q: query, ...(industry ? { industry } : {}), ...(company ? { company } : {}), limit: '40', offset: String(offset) })}`;
  return <><h1 tabIndex={-1}>新闻</h1><div className="cr-columns"><div>
    <Search initial={query} label="搜索已收录新闻" onSubmit={q => { window.location.hash = queryHref('/news', { ...filters, q }); }}/>
    {company && <p>公司筛选：<a href={companyHref(company)}>{company}</a> · <a href={queryHref('/news', { q: query, industry })}>清除公司筛选</a></p>}
    {industry && <p className="cr-meta">产业筛选：<a href={industryHref(industry)}>查看当前产业</a></p>}
    {(query || industry || company) && <p className="cr-meta"><a href="#/news">清除全部筛选</a></p>}
    <Read<NewsPage> path={path}>{data => <><p className="cr-meta">{data.total} 条 · 内容更新时间：{timestamp(data.updated_at)}</p>
      <NewsList items={data.items}/><Pagination url={url} total={data.total} count={data.items.length} limit={40}/></>}</Read>
    </div><aside aria-label="新闻产业筛选"><IndustryFilter value={industry} onChange={value => { window.location.hash = queryHref('/news', { ...filters, industry: value }); }}/>
      <section><h2>继续核验</h2><ul className="cr-link-list"><li><a href="#/industries">产业关系</a></li><li><a href="#/companies">公司业务</a></li><li><a href="#/methods">分析方法</a></li></ul></section>
    </aside></div></>;
}
function IndustryIndex({ url }: { url: URL }) {
  const query = url.searchParams.get('q') ?? '';
  const root = url.searchParams.get('root') ?? '';
  const path = `/industries?${new URLSearchParams({ q: query, ...(root ? { root } : {}), limit: '60', offset: String(offsetOf(url)) })}`;
  return <><h1 tabIndex={-1}>产业链</h1><div className="cr-columns"><div>
    <Search initial={query} label="搜索完整产业目录" onSubmit={q => { window.location.hash = queryHref('/industries', { q, root }); }}/>
    {root && <p>目录范围：<a href={industryHref(root)}>{root}</a> · <a href={queryHref('/industries', { q: query })}>清除范围</a></p>}
    <Read<Page<IndustryNode>> path={path}>{data => <><p className="cr-meta">共 {data.total} 个产业；默认展示一级目录或已有资料的环节。</p>
      {data.items.length ? <ul className="cr-directory">{data.items.map(node => <li key={node.id}><h2><a href={industryHref(node.id)}>{node.name}</a></h2>
        {node.aliases.length > 0 && <p className="cr-meta">别名：{node.aliases.join('、')}</p>}</li>)}</ul> : <Empty>没有匹配的已收录产业。可尝试其他名称。</Empty>}
      <Pagination url={url} total={data.total} count={data.items.length} limit={60}/></>}</Read>
    </div><aside aria-label="产业阅读路径"><section><h2>从结构到依据</h2><p>进入环节查看上下游、主营公司和关系出处；分类目录单独列示。</p>
      <ul className="cr-link-list"><li><a href="#/news">检索新闻变化</a></li><li><a href="#/companies">检索公司主营</a></li><li><a href="#/methods">核对传导条件</a></li></ul>
    </section></aside></div></>;
}
function CompanyIndex({ url }: { url: URL }) {
  const query = url.searchParams.get('q') ?? '';
  const path = `/companies?${new URLSearchParams({ q: query, limit: '40', offset: String(offsetOf(url)) })}`;
  return <><h1 tabIndex={-1}>公司</h1><div className="cr-columns"><div>
    <Search initial={query} label="按公司名称或证券代码搜索" onSubmit={q => { window.location.hash = queryHref('/companies', { q }); }}/>
    <Read<Page<Company>> path={path}>{data => <><p className="cr-meta">已匹配 {data.total} 家公司</p><CompanyList companies={data.items}/>
      <Pagination url={url} total={data.total} count={data.items.length} limit={40}/></>}</Read>
    </div><aside aria-label="公司阅读路径"><section><h2>经营资料与关联</h2><p>进入公司查看主营、产品、具体报告期及来源，再核对产业暴露与条件机制。</p>
      <ul className="cr-link-list"><li><a href="#/industries">查找产业环节</a></li><li><a href="#/news">查找新闻来源</a></li><li><a href="#/methods">查看分析框架</a></li></ul>
    </section></aside></div></>;
}

function Frameworks({ methods, variable }: { methods: MethodSet; variable?: Change['variable'] }) {
  const relevant = variable ? methods.methods.filter(method => method.variables.includes(variable)) : methods.methods;
  return <div className="cr-framework"><p className="cr-pending">待核实触发条件</p>
    <p>以下为适用分析框架，不表示新闻已触发该机制。</p>
    <p className="cr-meta">方法版本：{methods.version}</p>
    {relevant.length ? <ul>{relevant.map(method => <li key={method.id}><a href={queryHref('/methods', { method: method.id })}>{method.title}</a>
      {method.conditions.length > 0 && <p className="cr-meta">需先核验：{method.conditions.join('；')}</p>}</li>)}</ul> : <p className="cr-meta">暂无适用框架。</p>}
  </div>;
}
function Mechanisms({ items, methods, variable, pending = false }: {
  items: Mechanism[]; methods: MethodSet; variable?: Change['variable']; pending?: boolean;
}) {
  const labels = { fact: '事实', structure: '产业结构', inference: '条件推断' };
  return <section><h2>机制与成立条件</h2>
    {pending || !items.length ? <Frameworks methods={methods} variable={variable}/> : items.map(item => {
      const method = methods.methods.find(method => method.id === item.method_id);
      return <div className="cr-mechanism" key={item.id}><h3>{method?.title ?? variableLabels[item.variable]} · 条件推断</h3>
        <p className="cr-meta">方法版本 {item.method_version} · {variableLabels[item.variable]}{directionLabels[item.direction]}</p>
        <p className="cr-related"><a href={newsHref(item.news_id)}>关联新闻</a> · <a href={industryHref(item.node_id)}>产业环节</a>
          {item.company_code && <> · <a href={companyHref(item.company_code)}>关联公司 {item.company_code}</a></>}
          {' · '}<a href={queryHref('/methods', { method: item.method_id })}>分析方法</a></p>
        <ol className="cr-steps">{item.steps.map((step, i) => <li key={i} className={`cr-step cr-step-${step.kind}`}>
          <p className="cr-meta"><strong>{labels[step.kind]}</strong></p><p>{step.statement}</p>
          <EvidenceList items={step.evidence} label="这一步的依据"/>
        </li>)}</ol>
        <h4>成立条件</h4><TextList items={item.conditions}/>
        <h4>反向因素</h4><TextList items={item.reverse_factors} empty="反向因素尚未提供，不表示不存在。"/>
        <h4>仍缺哪些证据</h4><TextList items={item.missing_evidence} empty="接口未列出缺项，不代表条件已满足。"/>
      </div>;
    })}
  </section>;
}
function NewsArticle({ id }: { id: string }) {
  return <><p className="cr-breadcrumb"><a href="#/news">← 新闻列表</a></p>
    <Read<NewsDetail> title="新闻详情" path={`/news/${encode(id)}`}>{data => <article>
      <ArticleTitle title={data.news.title}/>
      <p className="cr-meta">{data.news.source || '来源未知'} · {verification[data.news.source_status ?? data.news.verification]}<br/>
        发布时间：{timestamp(data.news.published_at)} · 收录时间：{timestamp(data.news.observed_at)}（北京时间）</p>
      <div className="cr-columns"><div>
        <section className="cr-first-section"><h2>已知事实与来源表述</h2>
          {data.news.summary ? <p className="cr-prose">{data.news.summary}</p> : <Empty>未提供获许可摘要，请核验来源原文。</Empty>}
          {data.news.verification === 'unverified' && <p className="cr-pending">这条来源内容尚未核实，不能当作已确认事实。</p>}
          <SourceLink url={data.news.url}/><EvidenceList items={data.news.evidence} label="新闻来源依据"/>
        </section>
        <section><h2>明确变化</h2>{data.news.change ? <div className="cr-fact">
          <h3>{variableLabels[data.news.change.variable]}{directionLabels[data.news.change.direction]}</h3><p>{data.news.change.basis}</p>
          {!verifiedChange(data.news) && <p className="cr-pending">待核实触发条件：变化记录尚无已核实依据。</p>}
          <a href={industryHref(data.news.change.node_id)}>查看变化所在环节 →</a><EvidenceList items={data.news.change.evidence}/>
        </div> : <p className="cr-pending">待核实触发条件：没有明确的变化记录，标题相关不能作为影响依据。</p>}</section>
        <Mechanisms items={data.mechanisms} methods={data.methods} variable={data.news.change?.variable} pending={!verifiedChange(data.news)}/>
        <Missing items={data.missing_evidence}/>
      </div><aside aria-label="新闻关联"><section><h2>相关产业</h2><IndustryLinks nodes={data.industries}/></section>
        <section><h2>相关公司</h2><p className="cr-meta">实体相关不等于受益或受损。</p><CompanyList companies={data.companies} compact/></section>
        <section><h2>分析依据</h2><a href="#/methods">查看分析方法与数据条件 →</a></section>
      </aside></div>
    </article>}</Read></>;
}
function ArticleTitle({ title }: { title: string }) {
  return <h1 tabIndex={-1}>{title}</h1>;
}
function Relations({ title, items }: { title: string; items: Relation[] }) {
  const edgeLabels = { classification: '分类', input: '投入关系', output: '产出关系', equipment: '设备关系', service: '服务关系' };
  return <div className="cr-relations"><h3>{title}</h3>{items.length ? <ul>{items.map(({ edge, node }) => <li key={edge.id}>
    <a href={industryHref(node.id)}>{node.name}</a> <span className="cr-meta">{edgeLabels[edge.kind]}</span>
    <EvidenceList items={edge.evidence} label="关系依据"/>
  </li>)}</ul> : <p className="cr-meta">暂无已收录关系。</p>}</div>;
}
function IndustryArticle({ id }: { id: string }) {
  return <><p className="cr-breadcrumb"><a href="#/industries">← 产业目录</a></p>
    <Read<IndustryDetail> title="产业详情" path={`/industries/${encode(id)}`}>{data => <article><ArticleTitle title={data.node.name}/>
      {data.node.aliases.length > 0 && <p className="cr-meta">别名：{data.node.aliases.join('、')}</p>}
      <IndustryChainSection industryId={id}/>
      <div className="cr-columns"><div><section className="cr-first-section"><h2>上游 → 本环节 → 下游（原始收录关系）</h2>
        <p className="cr-meta">仅展示已收录的供应侧 → 使用侧关系，不代表公司间供货合同。</p>
        <Relations title="上游" items={data.upstream.filter(relation => relation.edge.kind !== 'classification')}/>
        <div className="cr-current-node"><h3>本环节：{data.node.name}</h3><EvidenceList items={data.node.evidence} label="产业资料依据"/></div>
        <Relations title="下游" items={data.downstream.filter(relation => relation.edge.kind !== 'classification')}/>
      </section><section><h2>主营公司与关联依据</h2>
        {data.companies.length ? <ul className="cr-exposures">{data.companies.map(({ company, exposure }) => <li key={exposure.id}>
          <h3><a href={companyHref(company.code)}>{company.name}</a> <span className="cr-meta">{company.code}</span></h3>
          <p className={exposure.status === 'candidate' ? 'cr-pending' : 'cr-meta'}>{exposure.status === 'business' ? '明确业务匹配' : '概念候选 · 业务关系待核实'} · {exposure.role}</p>
          <p>{company.business || '主营资料尚缺。'}</p><p>关联依据：{exposure.basis || '尚未提供'}</p><EvidenceList items={exposure.evidence}/>
        </li>)}</ul> : <Empty>尚无主营或候选公司资料。</Empty>}
      </section><section><h2>产业新闻</h2><NewsList items={data.news}/><a href={queryHref('/news', { industry: id })}>检索本产业全部新闻 →</a></section>
      <section><h2>数据观察</h2>{data.observations.length ? <ul className="cr-observations">{data.observations.map(item => <li key={item.id}>
        <h3>{item.label}：{item.value} {item.unit}</h3><p className="cr-meta">数据日期：{item.date || '未知'} · {item.source || '来源未知'}</p><EvidenceList items={item.evidence}/>
      </li>)}</ul> : <Empty>暂无可展示数据观察，不补造走势。</Empty>}</section>
      <Mechanisms items={data.mechanisms} methods={data.methods}/>
      </div><aside aria-label="分类与覆盖"><section><h2>分类关系（非上下游）</h2>
        <Relations title="父级目录" items={data.parents.filter(relation => relation.edge.kind === 'classification')}/>
        <Relations title="子级目录" items={data.children.filter(relation => relation.edge.kind === 'classification')}/>
        <a href={queryHref('/industries', { root: id })}>在此目录内检索 →</a></section>
        <section><h2>本环节覆盖</h2><p className="cr-meta">公司 {data.coverage.companies} · 新闻 {data.coverage.news} · 数据观察 {data.coverage.observations}</p>
          {data.coverage.truncated && <p className="cr-pending">本页关联内容为截取结果，请到新闻或公司列表继续检索。</p>}
          <p className="cr-meta">仅反映已收录资料，不代表全产业覆盖。</p></section></aside></div>
    </article>}</Read></>;
}
function CompanyArticle({ code }: { code: string }) {
  return <><p className="cr-breadcrumb"><a href="#/companies">← 公司列表</a> · <a href="#/strategies">策略插件管理</a></p>
    <Read<CompanyDetail> title="公司详情" path={`/companies/${encode(code)}`}>{data => <article><ArticleTitle title={data.company.name}/>
      <p className="cr-meta">{data.company.code} · 资料报告期：{reportPeriod(data.company.report_period)}</p>
      <FollowButton kind="company" target={code}/>
      {new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('from') && <p><a href={`#/events/${encode(new URLSearchParams(window.location.hash.split('?')[1]).get('from') ?? '')}`}>← 返回事件解读与产业链图谱</a></p>}
      <CompanyStrategyWorkbench code={code}/>
      <div className="cr-columns"><div><section className="cr-first-section"><h2>主营业务</h2>
        <p className="cr-prose">{data.company.business || '尚未收录主营业务资料。'}</p><h3>产品</h3>
        <TextList items={data.company.products} empty="尚未收录产品资料。"/><EvidenceList items={data.company.evidence} label="公司资料出处"/>
      </section><section><h2>财务资料</h2>
        <p className="cr-meta">按需核对具体口径与报告期。</p><details className="cr-evidence"><summary>展开已收录财务项（{data.company.financials.length}）</summary>
        {data.company.financials.length ? <dl className="cr-financials">{data.company.financials.map((item, i) => <div key={`${item.label}-${i}`}>
          <dt>{item.label}</dt><dd><strong>{item.value} {item.unit}</strong><p className="cr-meta">本项报告期：{reportPeriod(item.period)}</p>
            <EvidenceList items={item.evidence} label="财务出处"/></dd>
        </div>)}</dl> : <Empty>暂无获依据支持的财务项，不合成财务值。</Empty>}</details>
      </section><section><h2>相关新闻</h2><NewsList items={data.news}/><a href={queryHref('/news', { company: code })}>检索公司全部新闻 →</a></section>
        <Mechanisms items={data.mechanisms} methods={data.methods}/><Missing items={data.missing_evidence}/>
      </div><aside aria-label="公司产业关联"><section><h2>所在产业与业务依据</h2>
        {data.exposures.length ? <ul className="cr-exposures">{data.exposures.map(({ node, exposure }) => <li key={exposure.id}>
          <h3><a href={industryHref(node.id)}>{node.name}</a></h3>
          <p className={exposure.status === 'candidate' ? 'cr-pending' : 'cr-meta'}>{exposure.status === 'business' ? '明确业务匹配' : '概念候选 · 待核实'} · {exposure.role}</p>
          <p>{exposure.basis || '关联依据尚缺。'}</p><EvidenceList items={exposure.evidence}/>
        </li>)}</ul> : <p className="cr-meta">尚无已收录产业关联。</p>}
      </section><section><h2>分析方法</h2><a href="#/methods">查看条件与反向因素 →</a></section></aside></div>
    </article>}</Read></>;
}
function Methods({ url }: { url: URL }) {
  const selected = url.searchParams.get('method');
  return <><h1 tabIndex={-1}>分析方法</h1><Read<MethodSet> path="/methods">{data => {
    const active = data.methods.find(method => method.id === selected);
    const methods = active ? [active] : data.methods;
    return <div className="cr-columns"><div><p className="cr-meta">版本 {data.version} · 仅输出条件性分析</p>
      {selected && <p><a href="#/methods">查看全部方法</a>{!active && ' · 未找到此方法，以下为当前可用框架。'}</p>}
      {methods.length ? methods.map(method => <section className="cr-method" key={method.id}><h2>{method.title}</h2>
        <p>{method.explanation}</p><p className="cr-meta">适用变量：{method.variables.map(variable => variableLabels[variable]).join('、') || '未列明'}</p>
        <h3>成立条件</h3><TextList items={method.conditions}/><h3>反向因素</h3><TextList items={method.reverse_factors}/>
        <h3>所需数据</h3><TextList items={method.required_data}/>
      </section>) : <Empty>尚未提供分析框架。</Empty>}
      {data.disclaimer && <p className="cr-meta cr-method-note">{data.disclaimer}</p>}
    </div><aside aria-label="方法阅读路径"><section><h2>回到资料</h2><ul className="cr-link-list"><li><a href="#/news">从新闻核验触发条件</a></li>
      <li><a href="#/industries">从产业核验传导关系</a></li><li><a href="#/companies">从公司核验业务与财务</a></li></ul></section></aside></div>;
  }}</Read></>;
}
function RouteContent({ url }: { url: URL }) {
  if (url.pathname === '/') return <EditorialHome/>;
  if (url.pathname === '/following') return <EditorialFollowing/>;
  if (url.pathname === '/editorial-status') return <EditorialSystem/>;
  if (url.pathname === '/strategies') return <StrategyManagerPage/>;
  const event = /^\/events\/([^/]+)$/.exec(url.pathname);
  if (event) return <EditorialArticle id={decodeURIComponent(event[1])}/>;
  if (url.pathname === '/news') return <NewsIndex url={url}/>;
  if (url.pathname === '/industries') return <IndustryIndex url={url}/>;
  if (url.pathname === '/companies') return <CompanyIndex url={url}/>;
  if (url.pathname === '/methods') return <Methods url={url}/>;
  const match = /^\/(news|industries|companies)\/([^/]+)$/.exec(url.pathname);
  if (match) {
    let id: string;
    try { id = decodeURIComponent(match[2]); } catch { id = ''; }
    if (id) {
      if (match[1] === 'news') return <NewsArticle id={id}/>;
      if (match[1] === 'industries') return <IndustryArticle id={id}/>;
      return <CompanyArticle code={id}/>;
    }
  }
  return <><h1 tabIndex={-1}>未找到页面</h1><p>这个阅读地址无效。<a href="#/">返回内容首页</a></p></>;
}
export function ContentReader({ onLogout }: { onLogout: () => Promise<void> }) {
  const [route, setRoute] = useState(window.location.hash || '#/');
  const current = useRef(route);
  const [refresh, setRefresh] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const change = () => {
      scrollPositions.set(current.current, window.scrollY);
      current.current = window.location.hash || '#/';
      setRoute(current.current);
    };
    const remember = () => scrollPositions.set(current.current, window.scrollY);
    window.addEventListener('hashchange', change);
    window.addEventListener('pagehide', remember);
    return () => {
      remember();
      history.scrollRestoration = previousRestoration;
      window.removeEventListener('hashchange', change);
      window.removeEventListener('pagehide', remember);
    };
  }, []);
  let url: URL;
  try { url = new URL(route.startsWith('#/') ? route.slice(1) : '/', 'https://reader.invalid'); }
  catch { url = new URL('/invalid', 'https://reader.invalid'); }
  const retry = () => { scrollPositions.set(route, window.scrollY); setRefresh(n => n + 1); };
  async function exit() {
    setLoggingOut(true); setLogoutError('');
    try { await onLogout(); } catch (error) {
      setLogoutError(error instanceof Error ? error.message : '退出未完成，请重试。');
    } finally { setLoggingOut(false); }
  }
  return <div className="content-reader"><header className="cr-header"><a className="brand" href="#/" aria-label="ytrader 内容首页">ytrader</a>
    <nav aria-label="内容导航">{[['/', '简报'], ['/following', '关注'], ['/industries', '产业'], ['/companies', '公司'], ['/strategies', '策略']].map(([path, label]) =>
      <a key={path} href={`#${path}`} aria-current={url.pathname === path || path !== '/' && url.pathname.startsWith(`${path}/`) ? 'page' : undefined}>{label}</a>)}</nav>
    <button className="text-button" disabled={loggingOut} onClick={() => { void exit(); }}>{loggingOut ? '退出中…' : '退出'}</button>
  </header>
    {storageWarning && <p className="cr-notice">{storageWarning}</p>}
    {logoutError && <p role="alert" className="cr-notice cr-error">退出未完成：{logoutError}</p>}
    <ReaderContext.Provider value={{ route, refresh, retry }}><main id="content" className="cr-main" tabIndex={-1}>
      <div className="cr-tools"><a href="#/" aria-current={url.pathname === '/' ? 'page' : undefined}>事件简报</a><button className="text-button" onClick={retry}>重新读取</button></div>
      <RouteContent key={`${url.pathname}${url.search}:${refresh}`} url={url}/>
    </main></ReaderContext.Provider>
    <footer className="cr-footer"><a href="#/news">原始新闻</a> · <a href="#/strategies">个股策略插件</a> · <a href="#/editorial-status">来源与分析状态</a> · <a href="#/methods">研究方法</a></footer>
  </div>;
}
