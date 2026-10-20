import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useApi } from './hooks';
import { Empty, ErrorBox, ExternalLink, Loading } from './components';
import { NewsUpdate, newsContentLabel, newsTime, useNewsUpdates } from './NewsSources';
import type { Article, Job } from './types';
import { safeNewsReturn } from './PanoramaEntry';
import { errorMessage, post } from './api';
import './editorial.css';

type Evidence = { article_id?: string; quote?: string; trigger?: string; observed_at?: string; position?: number; page_url?: string; edition?: string; url?: string; exclusive_evidence?: string };
export type IndustryLink = { industry_id: string; name: string; variable: string; mechanism: string; condition: string; node_ids: string[]; relation: 'direct' | 'conditional' | 'association'; evidence: Evidence[]; mechanism_reference?: { name: string; url: string } };
type Attribution = { publisher: string; identity: string; origins: { name: string; evidence: string }[]; exclusive: boolean; exclusive_evidence?: string; exclusive_status?: string; original_url?: string; origin_link_status: string };
type Report = Article & { attribution?: Attribution; language?: string; language_basis?: string; supersedes_id?: string; source_published_at?: string | null };
type Reason = { label: string; evidence?: Evidence; basis: string };
type Progress = { id: string; event_id: string; title: string; summary: string; published_at: string | null; first_observed_at: string; publishers: string[]; reasons: Reason[] };
type Story = { id: string; name: string; basis: string; first_observed_at: string; latest_fact_at?: string; phase?: string; stage?: { label: string; quote: string } | null; history_note?: string; progresses?: Progress[] };
type Item = Progress & { news_version?: string; primary_article_id: string; story: Story; channels: string[]; industry_links: IndustryLink[]; articles: Report[]; time_basis: string; observations: Evidence[]; unique_publisher_count: number; origin_count: number; exclusive_claims: Attribution[]; algorithm: { version: string; parts: Record<string, number>; suppression: string[]; excluded: string[] } };
type Feed = { items: Item[]; generated_at: string; state: string; exclusive_available: boolean; collection: { active_job_id: string | null; last_checked: string | null; warnings: string[] }; coverage_note: string };
export type EditorialDetail = { event: { id: string; title: string }; title: string; summary: string; current: Item; progresses: Item[]; articles: Report[]; industry_links: IndustryLink[]; story: Story };
type View = 'read' | 'story' | 'reports';
const views: [View, string][] = [['read', '报道正文'], ['story', '事件进展'], ['reports', '媒体与来源']];
export function TransmissionEvidence({ evidence, reports, onRead }: { evidence: Evidence[]; reports: Article[]; onRead?: (id: string) => void }) {
  return <div className="transmission-evidence"><p className="editorial-muted">来源触发片段 · 来源表述，未经独立核实；不等于机制已发生。</p>{evidence.length === 0 && <p>此历史关联未提供原文片段。</p>}{evidence.map((item, index) => {
    const report = reports.find(article => article.id === item.article_id);
    return <details key={index}><summary>原文触发：{item.trigger || '来源片段'}</summary><p>{report?.title || '稿件标题未收录'}<br />{report?.source || '来源未提供'} · {newsTime(report?.published_at)}{item.observed_at && ` · 观察：${newsTime(item.observed_at)}（非发布时间）`}</p><blockquote>{item.quote || '未提供摘录'}</blockquote>{(item.url || item.page_url || report?.url) && <ExternalLink url={item.url || item.page_url || report?.url}>发布来源原文</ExternalLink>}{onRead && item.article_id && <button type="button" className="text-button" onClick={() => onRead(item.article_id!)}>核对证据稿件 →</button>}</details>;
  })}</div>;
}
function ReasonEvidence({ reason }: { reason: Reason }) {
  const evidence = reason.evidence;
  return <details className="editorial-reason"><summary>{reason.label}</summary>{evidence?.quote && <blockquote>{evidence.quote}</blockquote>}{evidence?.exclusive_evidence && <blockquote>{evidence.exclusive_evidence}</blockquote>}{evidence?.observed_at && <p>观察：{newsTime(evidence.observed_at)} · 主区第 {evidence.position} 条<br />{evidence.edition}</p>}{(evidence?.url || evidence?.page_url) && <ExternalLink url={evidence.url || evidence.page_url || ''}>核对来源</ExternalLink>}{evidence?.article_id && <small>证据稿件：{evidence.article_id}</small>}</details>;
}
function ReportIdentity({ article }: { article: Report }) {
  const origin = article.attribution;
  return <div className="editorial-origin"><p>{origin?.identity === 'attributed_relay' ? '转述/转载身份' : '媒体发布稿 · 原创身份未核实'}{origin?.origins.length ? ` · 原始信息出处：${origin.origins.map(o => o.name).join(' / ')}` : ''}</p>{origin?.origins.map(o => <blockquote key={o.name}>{o.evidence}</blockquote>)}{origin?.exclusive && <p>独家声明：{origin.exclusive_status === 'relayed_claim' ? '二手转述' : '发布方自述，未独立核实'}<q>{origin.exclusive_evidence}</q></p>}{origin?.original_url ? <p><ExternalLink url={origin.original_url}>被引原始出处</ExternalLink> · 未另行获取，链接可达性未核实</p> : origin?.identity === 'attributed_relay' ? <p>原始出处被转述，源未提供可核对原始链接；以下内容来自当前发布媒体，不是一手全文。</p> : null}</div>;
}

// The original panorama is a full document: retain only list UI position across
// that round trip, without making storage availability a reading prerequisite.
type NewsListPosition = { top: number; focusId: string };
const newsListStorageKey = 'ytrader:editorial-list-position';
function restoreNewsList(): NewsListPosition | undefined {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(newsListStorageKey) || 'null');
    if (saved && typeof saved === 'object' && 'top' in saved && typeof saved.top === 'number' && Number.isFinite(saved.top) && saved.top >= 0 && 'focusId' in saved && typeof saved.focusId === 'string') return { top: saved.top, focusId: saved.focusId };
  } catch { /* Storage may be disabled or contain an obsolete value. */ }
  return undefined;
}
let savedNewsList = restoreNewsList();
function persistNewsList() {
  try { if (savedNewsList) sessionStorage.setItem(newsListStorageKey, JSON.stringify(savedNewsList)); }
  catch { /* List restoration is best-effort, never a navigation blocker. */ }
}

export default function EditorialPage() {
  const feed = useApi<Feed>('/news/editorial');
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requestedEvent = params.get('event') || params.get('news') || '';
  const requestedStory = params.get('story') || '';
  const storyResult = useApi<Story>(requestedStory && !requestedEvent ? `/news/editorial/stories/${encodeURIComponent(requestedStory)}` : null);
  const eventId = requestedEvent || (requestedStory ? storyResult.data?.progresses?.[0]?.event_id || '' : feed.data?.items[0]?.event_id || '');
  const detail = useApi<EditorialDetail>(eventId ? `/news/editorial/events/${encodeURIComponent(eventId)}` : null);
  const requestedProgress = params.get('progress');
  const progress = requestedProgress ? detail.data?.progresses.find(p => p.id === requestedProgress) || (detail.data?.current?.id === requestedProgress ? detail.data.current : undefined) : detail.data?.current;
  const current = progress || feed.data?.items.find(i => i.event_id === eventId && (!params.get('progress') || i.id === params.get('progress')));
  const allReports = detail.data?.articles || current?.articles || [];
  const article = allReports.find(a => a.id === params.get('article')) || allReports.find(a => a.id === current?.primary_article_id) || allReports[0];
  const view: View = views.some(([key]) => key === params.get('view')) ? params.get('view') as View : requestedStory && !requestedEvent ? 'story' : 'read';
  const story = detail.data?.story || storyResult.data;

  const updates = useNewsUpdates();
  const [loadedRevision, setLoadedRevision] = useState(updates.revision);
  const [associationJob, setAssociationJob] = useState('');
  const [associationMessage, setAssociationMessage] = useState('');
  const [associationBusy, setAssociationBusy] = useState(false);
  const associationJobs = useApi<Job[]>(associationJob ? '/jobs' : null, 2500);
  const associationState = associationJobs.data?.find(item => item.id === associationJob);
  const handledAssociation = useRef('');
  useEffect(() => {
    if (!associationState || !['succeeded', 'failed'].includes(associationState.status) || handledAssociation.current === associationState.id) return;
    handledAssociation.current = associationState.id;
    setAssociationMessage(associationState.message);
    setAssociationBusy(false);
    setAssociationJob('');
    if (associationState.status === 'succeeded') { feed.reload(); detail.reload(); }
  }, [associationState, feed.reload, detail.reload]);
  const associationSeen = useRef(new Set<string>());
  useEffect(() => {
    if (!requestedEvent || !current || associationBusy) return;
    const key = `${eventId}:${current.id}:${current.news_version || ''}`;
    if (associationSeen.current.has(key)) return;
    associationSeen.current.add(key);
    void updateAssociations(true);
  }, [requestedEvent, eventId, current?.id, current?.news_version, associationBusy]);
  async function updateAssociations(automatic = false) {
    if (!current || associationBusy) return;
    setAssociationBusy(true); setAssociationMessage('');
    try {
      const result = await post<Job | { status: 'cached'; message: string }>(`/news/editorial/events/${encodeURIComponent(eventId)}/associate?progress=${encodeURIComponent(current.id)}${automatic ? '&automatic=true' : ''}`);
      if ('id' in result.data) { setAssociationJob(result.data.id); setAssociationMessage('正在后台补充相关产业，可继续阅读。'); }
      else { setAssociationMessage(result.data.message); setAssociationBusy(false); detail.reload(); feed.reload(); }
    } catch (error) { setAssociationMessage(errorMessage(error)); setAssociationBusy(false); }
  }
  function industryHref(item: Item, link: IndustryLink, fromList = false) {
    const back = new URLSearchParams(params);
    back.set('event', item.event_id); back.set('progress', item.id);
    if (fromList) back.set('panel', 'list');
    return `/chain?${new URLSearchParams({ industry: link.industry_id, name: link.name, news: item.event_id, progress: item.id, return: `/events?${back}` })}`;
  }
  function relatedIndustries(item: Item) {
    return [...new Map(item.industry_links.map(link => [link.industry_id, link])).values()];
  }
  const page = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const railHeading = useRef<HTMLHeadingElement>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  // A default wide-screen preview must not turn the narrow landing page into
  // detail. Explicit URLs (including chain return links) do open detail.
  const detailOpen = params.get('panel') !== 'list' && Boolean(requestedEvent || requestedStory);
  const hasFeed = Boolean(feed.data);
  const previousPresentation = useRef<{ narrow: boolean; detail: boolean; key: string } | null>(null);
  function scrollTop() { return window.scrollY; }
  function scrollTo(top: number) { window.scrollTo({ top, behavior: 'auto' }); }
  function reveal(element: HTMLElement | null) {
    if (element) scrollTo(Math.max(0, scrollTop() + element.getBoundingClientRect().top - 12));
  }
  function select(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    next.delete('panel');
    // Materialize identity only on a user action, never on feed arrival.
    if (!next.get('event') && eventId) next.set('event', eventId);
    if (!next.get('progress') && current?.id) next.set('progress', current.id);
    if (!next.get('view')) next.set('view', view);
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    ['q', 'source', 'period', 'content_level', 'sort', 'tag', 'limit', 'news'].forEach(key => next.delete(key));
    setParams(next, { preventScrollReset: true });
  }
  function openNews(item: Item, nextView: View, trigger: HTMLButtonElement, nextIndustry: string | null = null) {
    savedNewsList = { top: scrollTop(), focusId: trigger.id };
    persistNewsList(); // Also available when an industry link opens a new tab.
    select({ event: item.event_id, story: item.story.id, progress: item.id, article: null, view: nextView, industry: nextIndustry });
  }
  useEffect(() => {
    window.addEventListener('pagehide', persistNewsList);
    return () => { persistNewsList(); window.removeEventListener('pagehide', persistNewsList); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!narrow || detailOpen) return;
    const host = window;
    const remember = () => {
      if (!page.current?.classList.contains('editorial-detail-open')) savedNewsList = { top: scrollTop(), focusId: savedNewsList?.focusId || '' };
    };
    host.addEventListener('scroll', remember, { passive: true });
    return () => host.removeEventListener('scroll', remember);
  }, [narrow, detailOpen]);
  useLayoutEffect(() => {
    // URL/history or responsive pane transitions only: data loading and canvas
    // completion must not reset a reader's scroll or focus on every render.
    if (narrow && !detailOpen && !hasFeed) return;
    const previous = previousPresentation.current;
    previousPresentation.current = { narrow, detail: detailOpen, key: location.key };
    const navigated = !previous || previous.key !== location.key;
    if (detailOpen && (navigated || (narrow && !previous?.narrow))) {
      railHeading.current?.focus({ preventScroll: true });
      reveal(rail.current);
    } else if (!detailOpen && (previous?.detail || (!previous && savedNewsList))) {
      const target = savedNewsList?.focusId ? document.getElementById(savedNewsList.focusId) : null;
      (target && list.current?.contains(target) ? target : listHeading.current)?.focus({ preventScroll: true });
      if (savedNewsList) scrollTo(savedNewsList.top);
      else reveal(list.current);
    }
  }, [narrow, detailOpen, location.key, hasFeed]);
  // A running job (including one initiated elsewhere) only raises a prompt;
  // feed results and the selected reading position are never silently replaced.
  const job = useApi<Job[]>(feed.data?.collection.active_job_id ? '/jobs' : null, 2500);
  const activeJob = job.data?.find(item => item.id === feed.data?.collection.active_job_id);
  const finishedJob = activeJob && ['succeeded', 'failed'].includes(activeJob.status);
  function reload() { feed.reload(); detail.reload(); setLoadedRevision(updates.revision); }
  const awaiting = feed.data?.state === 'collecting' || updates.busy;
  return <div ref={page} className={`news-page editorial-page${detailOpen ? ' editorial-detail-open' : ''}`}>
    <header className="editorial-heading"><div><h1>新闻</h1>{params.get('return') && <a href={safeNewsReturn(params.get('return'))}>← 返回阅读流程</a>}</div><NewsUpdate /></header>
    <ErrorBox message={feed.error} retry={feed.reload} />
    {(updates.revision !== loadedRevision || finishedJob) && <div className="editorial-update" role="status"><span>采集已结束，当前阅读保持不变。</span><button type="button" onClick={reload} disabled={feed.loading}>载入更新</button></div>}
    {feed.loading && !feed.data && <Loading label="正在整理推荐与来源证据…" />}
    <div className="editorial-layout"><section ref={list} className="editorial-feed" aria-label="算法推荐新闻">
      <div className="editorial-section-heading"><h2 ref={listHeading} tabIndex={-1}>值得关注</h2><button type="button" className="text-button" disabled={feed.loading} onClick={reload}>重新载入</button></div>
      {feed.data && <>{feed.data.items.length === 0 && <Empty title={awaiting ? '正在采集公开新闻' : feed.data.state === 'empty' ? '还没有收录新闻' : feed.data.state === 'sources_unavailable' ? '公开来源暂不可用' : '暂没有满足当前时效与证据门槛的推荐'}><p>{awaiting ? '采集完成后点击“载入更新”。' : '可点击“更新新闻”，稍后重新载入。'}</p></Empty>}
      <ol className="editorial-items">{feed.data.items.map((item, index) => <li key={item.id} className={`${index === 0 ? 'editorial-lead ' : ''}${eventId === item.event_id && (!params.get('progress') || params.get('progress') === item.id) ? 'is-selected' : ''}`}>
        <button id={`editorial-headline-${item.id}`} className="editorial-headline" type="button" aria-pressed={eventId === item.event_id} onClick={event => openNews(item, 'read', event.currentTarget)}><h3>{item.title}</h3></button>
        {item.summary && <p className="editorial-summary">{item.summary}</p>}
        <div className="editorial-meta"><span>{item.publishers.join(' / ')}</span><span>{item.published_at ? newsTime(item.published_at) : '首页观察 · 来源发布日期未知'}</span></div>
        {item.industry_links.length > 0 && (
          <nav className="editorial-item-links" aria-label="相关产业">
            {relatedIndustries(item).map((link, i) => (
              <a id={`editorial-industry-${item.id}-${i}`} key={link.industry_id} href={industryHref(item, link, true)} onClick={event => { savedNewsList = { top: scrollTop(), focusId: event.currentTarget.id }; persistNewsList(); }}>{link.name}</a>
            ))}
          </nav>
        )}
      </li>)}</ol>
      <details className="editorial-endnote"><summary>收录说明</summary><p>{feed.data.coverage_note}</p></details></>}
    </section><aside ref={rail} className="editorial-rail" aria-label="所选新闻上下文">
      <button type="button" className="editorial-back" onClick={() => select({ panel: 'list' })}>← 返回新闻列表</button>
      <div className="editorial-section-heading"><h2 ref={railHeading} tabIndex={-1}>阅读报道</h2></div>
      <div className="editorial-context">
        <ErrorBox message={detail.error || storyResult.error} retry={() => { detail.reload(); storyResult.reload(); }} />
        {detail.loading && !detail.data && <Loading label="载入新闻上下文…" />}
        {!eventId && <p className="editorial-muted">请选择新闻，可在此核对报道、先前进展与来源。</p>}
        {requestedProgress && detail.data && !current && <p role="status">未找到指定进展，未以其他进展代替。请选择列表中的新闻。</p>}
        {current && <>{current.story.name !== current.title && <p className="editorial-context-label">{current.story.name}</p>}<h2 className="editorial-context-title">{current.title}</h2>
          <nav className="editorial-item-links" aria-label="相关产业">{relatedIndustries(current).map(link => <a key={link.industry_id} href={industryHref(current, link)}>{link.name}</a>)}</nav>
          <button type="button" className="text-button" disabled={associationBusy} onClick={() => void updateAssociations()}>{associationBusy ? '补充中…' : '更新相关产业'}</button>
          {associationMessage && <p className="editorial-muted" role="status">{associationMessage}</p>}
          <div className="editorial-tabs" role="tablist" aria-label="报道与进展">{views.map(([key, label]) => <button type="button" role="tab" id={`editorial-tab-${key}`} aria-selected={view === key} key={key} onClick={() => select({ view: key })}>{label}</button>)}</div>
          {view === 'read' && <>
            {article && <section><h3>{article.content_level === 'full' ? '来源正文' : article.content_level === 'summary' ? '媒体摘要' : '来源标题'}</h3><p className="editorial-meta">{article.source} · {article.published_at ? newsTime(article.published_at) : '发布时间未提供'}</p>{article.title !== current.title && <h4>{article.title}</h4>}
              <div className="editorial-source-text">{article.content ? article.content.split(/\n+/).filter(Boolean).map((paragraph, i) => <p key={i}>{paragraph}</p>) : <p>此版本没有可核实的正文，可前往发布媒体继续阅读。</p>}</div>
              <ExternalLink url={article.url}>阅读发布媒体原文 ↗</ExternalLink>
              <details className="editorial-source-notes"><summary>来源说明与稿件版本</summary>
                <p className="editorial-meta">{newsContentLabel[article.content_level]} · {article.language || '语言未提供'}{article.language_basis === 'script_heuristic' ? '（文字规则识别）' : ''}<br />采集：{newsTime(article.fetched_at)}（非发布时间）</p>
                <ReportIdentity article={article} />
                <p>{article.content_level === 'full' ? '正文由来源订阅流提供，未另行抓取文章页面。' : article.content_level === 'summary' ? '以上是发布媒体提供的摘要，不是完整原文。' : '只收录标题，未取得可核实的文章正文。'}</p>
                {article.quality_flags?.includes('legacy_media_caption_not_body') && <p>此历史版本的全文标记无法核实，可能来自媒体配图说明；已隐藏内容，原始版本仍保留。</p>}
                {article.quality_flags?.some(flag => ['future_published_at', 'invalid_published_at'].includes(flag)) && <p>{article.quality_flags.includes('future_published_at') ? '来源日期晚于采集时间，未用于排序。' : '来源日期无效，未以采集时间替代。'}{article.source_published_at ? `原始时间：${article.source_published_at}` : ''}</p>}
                {article.supersedes_id && <p>这是同稿修订，旧版本仍在“各媒体报道”中保留。</p>}
              </details>
            </section>}
            <section><details><summary>为何值得关注</summary>{current.reasons.map((reason, i) => <ReasonEvidence key={i} reason={reason} />)}{current.reasons.length === 0 && <p>此历史进展未进入当前推荐。</p>}</details></section>
            {createElement('core-research', { key: eventId, subject: 'event', identity: eventId })}
          </>}
          {view === 'story' && <section><h3>{story?.name || '持续事件'}</h3><p className="editorial-muted">{story?.basis}</p>{story?.stage && <p>最新报道阶段线索：{({ ceasefire: '提及停火', negotiation: '提及谈判', implementation: '提及实施', disruption: '提及中断', revision: '提及更正' } as Record<string, string>)[story.stage.label] || story.stage.label}（标题线索，非独立确认）</p>}<p>最早收录：{newsTime(story?.first_observed_at)}<br />最近事实时间：{newsTime(story?.latest_fact_at)}</p><p className="editorial-boundary">{story?.history_note || '背景联系不代表同一事实或独立验证。'}</p><ol className="editorial-timeline">{story?.progresses?.map(p => <li key={p.id}><time>{p.published_at ? newsTime(p.published_at) : `首次观察 ${newsTime(p.first_observed_at)}（非发布）`}</time><button type="button" onClick={() => select({ event: p.event_id, progress: p.id, article: null, view: 'read', industry: null })}>{p.title}</button><p>{p.summary}</p><small>{p.publishers.join(' / ')}</small></li>)}</ol>{story?.progresses?.length === 1 && <p className="editorial-muted">目前只收录这一个进展，没有可展示的更早历史。</p>}</section>}
          {view === 'reports' && <section><h3>媒体、出处与稿件版本</h3><p className="editorial-boundary">{current.unique_publisher_count} 个发布媒体 · {current.origin_count} 个去重出处线索。转载同一通讯社只计一条出处；未识别转载仍可能存在，多来源不等于事实已证实。</p><ul className="editorial-reports">{allReports.map(report => <li key={report.id}><button type="button" aria-pressed={article?.id === report.id} onClick={() => select({ article: report.id, view: 'read' })}><strong>{report.source}</strong><span>{report.title}</span><small>{report.supersedes_id ? '同稿修订' : '稿件记录'} · {newsContentLabel[report.content_level]} · {newsTime(report.published_at)}</small></button><ReportIdentity article={report} /><ExternalLink url={report.url}>发布媒体链接</ExternalLink><details><summary>版本标识</summary><small>{report.id}<br />{report.merge_reason || '无跨稿合并说明'}</small></details></li>)}</ul></section>}
        </>}
      </div>
    </aside></div>
  </div>;
}

type Diagnostics = { version: string; weights: Record<string, number>; limitations: string[]; latest_run: { id: string; generated_at: string; data: { excluded: { id: string; reasons: string[] }[]; diversity_deferred: { id: string; reason: string }[] } } | null };
export function EditorialDiagnostics() {
  const [open, setOpen] = useState(false);
  const result = useApi<Diagnostics>(open ? '/news/editorial/diagnostics' : null);
  return <section className="news-page editorial-diagnostics"><h2>推荐规则与审计</h2><p>新闻推荐使用规则；产业关联可按需后台补充。不翻译原文、不输出市场影响概率。没有明确来源声明时，独家可以空缺。</p><button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? '收起选题说明' : '查看规则、限制与最近排除记录'}</button>{open && <><ErrorBox message={result.error} retry={result.reload} />{result.loading && <Loading />}{result.data && <><p>算法：{result.data.version}</p><ul>{result.data.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul><details><summary>启发式权重（非概率）</summary><pre>{JSON.stringify(result.data.weights, null, 2)}</pre></details>{result.data.latest_run && <details><summary>最近推荐快照与排除依据 · {newsTime(result.data.latest_run.generated_at)}</summary><p>{result.data.latest_run.id}</p><ul>{result.data.latest_run.data.excluded.slice(0, 100).map(item => <li key={item.id}>{item.id}：{item.reasons.join('；')}</li>)}</ul><p>此处最多显示100条；完整有界快照可通过 diagnostics API 核对。</p></details>}</>}</>}</section>;
}
