import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api, post, safeUrl } from './api';
import { useAction, useApi } from './hooks';
import { Empty, ErrorBox, ExternalLink, JobProgress, Loading } from './components';
import type { Job, Meta, NewsCounts, Source } from './types';

export function newsTime(value: string | null | undefined): string {
  if (!value) return '时间未提供';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间无效';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
export function since(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '尚无记录';
  const minutes = Math.floor((Date.now() - Date.parse(value)) / 60000);
  if (minutes < -5) return '记录时间晚于当前时间';
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
export const newsContentLabel = { full: '源提供正文', summary: '来源摘要', title: '仅标题' };
export const newsQualityLabels: Record<string, string> = {
  missing_published_at: '来源未提供发布时间',
  invalid_published_at: '来源发布时间无效',
  future_published_at: '来源发布时间晚于当前时间，待核实',
  summary_only: '仅有来源摘要，非完整原文',
  title_only: '仅有标题，未收录正文',
  publication_repaired: '发布时间已修正，可核对原文',
};
export function NewsMetaLine({ meta }: { meta?: Meta }) {
  if (!meta) return null;
  return <div className="provenance"><span>数据来源：{meta.source || '未提供'} · 数据时间：{newsTime(meta.as_of)}（北京时间）</span>{meta.completeness !== 'complete' && <strong className="warning-text">{meta.completeness === 'partial' ? '数据不完整' : '数据不可用'}</strong>}{meta.warnings?.length > 0 && <ul className="news-data-notes">{meta.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</div>;
}

interface NewsUpdateState {
  job: Job | null; busy: boolean; error: string | null; revision: number;
  start: () => void; finish: (job: Job) => void;
}
const NewsUpdateContext = createContext<NewsUpdateState | null>(null);
export function NewsUpdateProvider({ children }: { children: ReactNode }) {
  const action = useAction();
  const [job, setJob] = useState<Job | null>(null);
  const [revision, setRevision] = useState(0);
  const finished = useRef(new Set<string>());
  const active = job?.status === 'queued' || job?.status === 'running';
  function finish(value: Job) {
    setJob(value);
    if (finished.current.has(value.id)) return;
    finished.current.add(value.id);
    setRevision(current => current + 1);
  }
  function start() {
    if (active) return;
    void action.run(async () => { setJob((await post<Job>('/sync', { kind: 'news' })).data); });
  }
  return <NewsUpdateContext.Provider value={{ job, busy: action.busy || active, error: action.error, revision, start, finish }}>{children}</NewsUpdateContext.Provider>;
}
export function useNewsUpdates() {
  const context = useContext(NewsUpdateContext);
  if (!context) throw new Error('新闻更新上下文未就绪');
  return context;
}
export function NewsUpdate() {
  const update = useNewsUpdates();
  return <div className="news-update">
    <button type="button" className="news-primary" disabled={update.busy} onClick={update.start}><RefreshCw size={15} aria-hidden="true" />{update.busy ? '正在更新…' : '更新新闻'}</button>
    <ErrorBox message={update.error} />
    {update.job && <JobProgress job={update.job} onFinish={update.finish} />}
  </div>;
}
function isUnconnectedPaid(source: Source) {
  return source.paid && (!source.capabilities?.length || ['unavailable', 'unconfigured', 'not_configured', 'unsupported', 'not_connected', 'not_integrated'].includes(source.status) || (!source.last_success && !['ok', 'ready', 'active', 'enabled', 'succeeded', 'connected'].includes(source.status)));
}
export function SourceHealth({ source, compact = false }: { source: Source; compact?: boolean }) {
  const hasError = Boolean(source.last_error) || ['failed', 'error', 'unavailable', 'partial'].includes(source.status);
  return <div className={`news-source-health ${hasError ? 'has-error' : ''}`}>
    <p>{!source.enabled ? '已暂停' : isUnconnectedPaid(source) ? '付费源未接入' : '已启用'}<span aria-hidden="true"> · </span>{hasError ? '最近检查未成功' : !source.last_success ? '暂未采集' : '已有成功采集记录'}</p>
    <p title={newsTime(source.last_checked)}>最近检查：{since(source.last_checked)}</p>
    {hasError && <p className="news-error-text">{source.last_error || '来源暂不可用，请稍后重试。'}{compact ? '' : ' 已收录的内容仍然保留。'}</p>}
    {!hasError && source.not_modified && <p>最近检查内容未变化，沿用已收录内容。</p>}
  </div>;
}
const countFields: [keyof NewsCounts, string][] = [['received', '收到'], ['added', '新增'], ['duplicates', '重复'], ['rejected', '拒收'], ['revisions', '修订']];
function Counts({ counts }: { counts: NewsCounts | null | undefined }) {
  return <dl className="news-counts">{countFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{typeof counts?.[key] === 'number' ? counts[key] : '—'}</dd></div>)}</dl>;
}
function SourceDiagnostics({ source }: { source: Source }) {
  const qualityCounts = Object.entries(source.article_quality_counts || {});
  return <details className="news-source-diagnostics"><summary>检查与质量详情</summary>
    <dl className="news-source-dates"><div><dt>失败次数</dt><dd>{source.failure_count ?? '—'}</dd></div><div><dt>最近 HTTP 状态</dt><dd>{source.http_status ?? '—'}</dd></div>{source.error_code && <div><dt>错误代码</dt><dd>{source.error_code}</dd></div>}</dl>
    {source.quality_flags?.length ? <ul className="news-data-notes">{source.quality_flags.map(flag => <li key={flag}>{newsQualityLabels[flag] || '其他质量标记'}</li>)}</ul> : null}
    {qualityCounts.length > 0 && <><p className="news-muted">稿件质量标记计数（各项可能重叠）</p><dl className="news-quality-counts">{qualityCounts.map(([flag, count]) => <div key={flag}><dt>{newsQualityLabels[flag] || '其他质量标记'}</dt><dd>{count}</dd></div>)}</dl></>}
  </details>;
}

// Accept only the news route, never an arbitrary external return URL.
function newsReturn(state: unknown): string {
  const target = state && typeof state === 'object' && 'returnTo' in state ? state.returnTo : null;
  if (typeof target !== 'string' || !/^\/events(?:\?|$)/.test(target) || /[\\\u0000-\u0020]/.test(target)) return '/events';
  const parsed = new URL(target, window.location.origin);
  return parsed.origin === window.location.origin && parsed.pathname === '/events' ? `${parsed.pathname}${parsed.search}` : '/events';
}
export default function NewsSourcesPage({ embedded = false }: { embedded?: boolean }) {
  const sources = useApi<Source[]>('/sources', 30000);
  const updates = useNewsUpdates();
  const action = useAction();
  const rssAction = useAction();
  const [actionSource, setActionSource] = useState('');
  const [rssNotice, setRssNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const location = useLocation();
  useEffect(() => { if (updates.revision) sources.reload(); }, [updates.revision, sources.reload]);
  return <div className={`news-page news-sources-page${embedded ? ' news-sources-embedded' : ''}`}>
    <Link className="news-back" to={newsReturn(location.state)}>← 返回新闻</Link>
    <header className="news-page-heading"><div>{embedded ? <h2>新闻来源</h2> : <h1>新闻来源</h1>}<p>管理接入与采集状态，不改变已经收录的新闻。</p></div><NewsUpdate /></header>
    <section className="news-coverage" aria-labelledby="coverage-heading"><h2 id="coverage-heading" className="news-section-title">覆盖与边界</h2><p>新闻雷达仅覆盖已接入且启用的来源，不代表全网新闻。源提供正文、来源摘要与仅标题分别标注，不用摘要冒充全文。暂停只停止后续采集，不删除历史数据；未接入的付费来源不可启用。</p><p className="news-muted">所有时间均为北京时间。最近检查不等于最近成功，源最新发布也不等于抓取时间。失败时保留旧内容。</p></section>
    <section aria-labelledby="sources-heading"><div className="news-section-title news-row"><h2 id="sources-heading">已配置来源{sources.data ? ` · ${sources.data.length}` : ''}</h2><button type="button" className="text-button" disabled={sources.loading} onClick={sources.reload}>重新载入状态</button></div>
      {sources.loading && <Loading label="正在读取来源状态…" />}<ErrorBox message={sources.error} retry={sources.reload} />
      {sources.data?.length === 0 && <Empty title="尚未配置新闻源"><p>可在下方添加 RSS 来源，再更新新闻。新来源需要通过服务端安全校验。</p></Empty>}
      <ul className="news-managed-sources">{sources.data?.map(source => {
        const paidUnavailable = isUnconnectedPaid(source);
        const declarationOnly = source.capabilities.includes('declaration_only') || `${source.id} ${source.name}`.toLowerCase().includes('ifind');
        return <li key={source.id}>
          <div className="news-source-title"><div><h3>{source.name}</h3><p className="news-muted">{newsContentLabel[source.content_level] || '内容级别未提供'}{source.paid ? ' · 付费来源' : ''}</p></div><button type="button" role="switch" aria-checked={source.enabled} aria-busy={action.busy && actionSource === source.id} aria-label={`${source.enabled ? '暂停' : '启用'}${source.name}`} disabled={action.busy || declarationOnly || (paidUnavailable && !source.enabled)} onClick={() => void action.run(async () => {
            setActionSource(source.id); setNotice(null);
            await api<Source>(`/sources/${encodeURIComponent(source.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !source.enabled }) });
            setNotice(`${source.name}已${source.enabled ? '暂停，历史新闻仍可阅读' : '启用，下次更新时开始采集'}。`); sources.reload();
          })}>{action.busy && actionSource === source.id ? '正在保存…' : declarationOnly ? '仅能力声明 · 不可启用' : paidUnavailable && !source.enabled ? '付费源未接入' : source.enabled ? '已启用 · 暂停' : '已暂停 · 启用'}</button></div>
          {actionSource === source.id && <><ErrorBox message={action.error} />{notice && <p className="news-notice" role="status">{notice}</p>}</>}
          <p className="news-source-coverage">{source.coverage || '来源未提供覆盖范围说明。'}</p>
          <div className="news-source-details"><div><SourceHealth source={source} /><dl className="news-source-dates"><div><dt>最近检查</dt><dd>{source.last_checked ? newsTime(source.last_checked) : '尚未检查'}</dd></div><div><dt>最近成功</dt><dd>{source.last_success ? newsTime(source.last_success) : '暂未采集'}</dd></div><div><dt>源最新发布</dt><dd>{source.latest_published_at ? newsTime(source.latest_published_at) : '尚无有效发布时间'}</dd></div>{source.next_retry_at && <div><dt>最早可再次采集</dt><dd>{newsTime(source.next_retry_at)}</dd></div>}</dl>{source.next_retry_at && <p className="news-muted">此时间为采集冷却或失败退避的最早放行时间，不代表届时会自动执行。</p>}<ExternalLink url={source.url}>查看来源地址</ExternalLink><SourceDiagnostics source={source} /></div>
          <div className="news-source-metrics"><h4>本次 · 最近一次采集</h4><Counts counts={source.statistics} /><h4>累计 · 该来源</h4><Counts counts={source.total_statistics} /><p className="news-muted">— 表示暂无可用统计。重复为同一稿件重抓，修订为同一稿件内容变更，不是新增媒体。</p></div></div>
        </li>;
      })}</ul><NewsMetaLine meta={sources.meta} />
    </section>
    <section className="news-add-source" aria-labelledby="rss-heading"><h2 className="news-section-title" id="rss-heading">添加 RSS 来源</h2><p className="news-muted">仅添加公开的 RSS / Atom 订阅地址。服务端会校验地址与内容；保存成功不代表已经采集成功。</p><form onSubmit={event => { event.preventDefault(); void rssAction.run(async () => {
      setRssNotice(null); if (!safeUrl(url.trim())) throw new Error('RSS URL 必须是 HTTP(S) 地址，不能包含账号或密钥。'); await post<Source>('/sources', { name: name.trim(), url: url.trim() }); setName(''); setUrl(''); sources.reload(); setRssNotice('来源已保存。点击“更新新闻”开始采集，结果将在来源状态中显示。');
    }); }}><div className="news-rss-fields"><label>来源名称<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="便于辨认的来源名称" /></label><label>RSS / Atom 地址<input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label><button type="submit" disabled={rssAction.busy || !name.trim() || !url.trim()}>{rssAction.busy ? '正在保存…' : '添加来源'}</button></div></form><ErrorBox message={rssAction.error} />{rssNotice && <p className="news-notice" role="status">{rssNotice}</p>}</section>
  </div>;
}
