import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { dateTime, post, query } from './api';
import { useAction, useApi } from './hooks';
import { ContextReturn, Empty, ErrorBox, ExternalLink, JobProgress, Loading, SearchForm, Status } from './components';
import { EvidenceRefs, revisionLabel } from './evidence';
import RelatedTopics from './Topics';
import { NewsMetaLine, NewsUpdate, SourceHealth, newsContentLabel, newsQualityLabels, newsTime, since, useNewsUpdates } from './NewsSources';
import type { Analysis, Article, EventDetail, Job, NewsOverview, ResearchEvent, Source } from './types';

type Filters = { q: string; source: string; period: string; content_level: string; sort: string; tag: string; limit: number };
const periodLabels: Record<string, string> = { all: '全部时间', '24h': '近 24 小时', '7d': '近 7 天' };
const levelLabels: Record<string, string> = { all: '全部内容', full: '源提供正文', summary: '来源摘要', title: '仅标题' };
function filtersFrom(params: URLSearchParams): Filters {
  const oneOf = (key: string, values: string[], fallback: string) => values.includes(params.get(key) || '') ? params.get(key)! : fallback;
  const rawLimit = Number(params.get('limit') || 50);
  return { q: (params.get('q') || '').trim(), source: params.get('source') || '', period: oneOf('period', ['all', '24h', '7d'], 'all'), content_level: oneOf('content_level', ['all', 'full', 'summary', 'title'], 'all'), sort: oneOf('sort', ['latest', 'hot'], 'latest'), tag: params.get('tag') || '', limit: Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 50 };
}
function filterQuery(filters: Filters) { return query(filters); }
const listPositions = new Map<string, number>();
function publishedAt(event: ResearchEvent) { return event.latest_published_at !== undefined ? event.latest_published_at : event.published_at; }
function timeWarning(value: string | null | undefined, flags: string[] = []) {
  if (!value) {
    if (flags.includes('invalid_published_at')) return '来源发布时间无效，未以抓取时间替代。';
    if (flags.includes('future_published_at')) return '来源提供了晚于当前时间的发布日期，待核实。';
    return '来源未提供有效发布时间，未以抓取时间替代。';
  }
  if (!Number.isFinite(Date.parse(value))) return '来源发布时间无效，待核实。';
  if (Date.parse(value) > Date.now() + 5 * 60000 || (flags.includes('future_published_at') && !flags.includes('publication_repaired'))) return '来源发布时间晚于当前时间，待核实。';
  return null;
}
function mergeExplanation(reason: string | null | undefined) {
  if (reason === 'same_source_identity_restoration') return '来源发布了时间更新的恢复稿，正文恢复为较早内容。中间版本仍然保留，可逐项核对。';
  if (reason === 'same_source_identity_revision') return '同一来源中身份一致的稿件发生了更新，保留为同一稿件的不同版本，而不是新增媒体。';
  if (reason === 'same_subject_time_and_nonconflicting_facts') return '稿件主体一致，发布时间处于同一时间窗，且事实未发现冲突，因此归入同一新闻。各来源的稿件仍分别保留。';
  return '仅在来源内容足够一致时保守聚合。此条未提供更具体的合并依据，可逐一核对原始来源。';
}
export default function EventsPage() {
  const { id } = useParams();
  return id ? <EventReading key={id} id={id} /> : <NewsHome />;
}
function NewsHome() {
  const [params, setParams] = useSearchParams();
  const filters = filtersFrom(params);
  const suffix = filterQuery(filters);
  const result = useApi<ResearchEvent[]>(`/events${suffix}`);
  const combination = query({ ...filters, limit: undefined });
  const previous = useRef<{ combination: string; limit: number; events: ResearchEvent[] } | null>(null);
  const events = result.data ?? (previous.current?.combination === combination && filters.limit > previous.current.limit ? previous.current.events : undefined);
  useEffect(() => { if (result.data) previous.current = { combination, limit: filters.limit, events: result.data }; }, [result.data, combination, filters.limit]);
  // v1 返回数组而无 has_more；有界前瞻只判断下一条，不改变当前列表或 URL 容量。
  const more = useApi<ResearchEvent[]>(result.data?.length === filters.limit && filters.limit < 500 ? `/events${filterQuery({ ...filters, limit: filters.limit + 1 })}` : null);
  const overview = useApi<NewsOverview>('/news/overview');
  const sources = useApi<Source[]>('/sources');
  const updates = useNewsUpdates();
  const initialRevision = useRef(updates.revision);
  const [loadedRevision, setLoadedRevision] = useState(updates.revision);
  const restored = useRef('');
  useEffect(() => {
    if (params.toString() !== suffix.slice(1)) setParams(new URLSearchParams(suffix), { replace: true });
  }, [params, suffix, setParams]);
  useEffect(() => {
    if (updates.revision !== initialRevision.current) { overview.reload(); sources.reload(); initialRevision.current = updates.revision; }
  }, [updates.revision, overview.reload, sources.reload]);
  useEffect(() => {
    if (!result.data || restored.current === suffix) return;
    restored.current = suffix;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: listPositions.get(suffix) || 0, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [result.data, suffix]);
  useEffect(() => {
    let position = listPositions.get(suffix) || 0;
    const remember = () => { position = window.scrollY; };
    window.addEventListener('scroll', remember, { passive: true });
    return () => { window.removeEventListener('scroll', remember); listPositions.set(suffix, position); };
  }, [suffix]);
  function change(patch: Partial<Filters>) {
    const next = { ...filters, ...patch, limit: patch.limit ?? 50 };
    if (patch.limit === undefined) listPositions.delete(filterQuery(next));
    else listPositions.set(filterQuery(next), window.scrollY);
    setParams(new URLSearchParams(filterQuery(next)));
  }
  function reloadList() { result.reload(); more.reload(); setLoadedRevision(updates.revision); }
  const active = [filters.q && { key: 'q', label: `搜索：${filters.q}` }, filters.source && { key: 'source', label: `来源：${filters.source}` }, filters.period !== 'all' && { key: 'period', label: periodLabels[filters.period] }, filters.content_level !== 'all' && { key: 'content_level', label: levelLabels[filters.content_level] }, filters.tag && { key: 'tag', label: `主题：${filters.tag}` }].filter((value): value is { key: string; label: string } => Boolean(value));
  const clear = () => change({ q: '', source: '', period: 'all', content_level: 'all', tag: '' });
  const sourceNames = [...new Set([...(sources.data || []).map(source => source.name), ...(filters.source ? [filters.source] : [])])];
  const needsMoreCheck = result.data?.length === filters.limit && filters.limit < 500;
  const canLoad = more.data ? more.data.length > filters.limit : Boolean(more.error && needsMoreCheck);
  return <div className="news-page news-home">
    <header className="news-page-heading"><div><div className="news-heading-line"><h1>新闻雷达</h1><span className="news-heading-status">{sources.data ? `${sources.data.filter(source => source.enabled).length} / ${sources.data.length} 个来源启用` : '来源状态待载入'}<span>最近检查：{overview.data ? since(overview.data.last_checked) : '尚无记录'}</span></span></div><p>读新闻，核对来源，再看产业联系。</p></div><NewsUpdate /></header>
    {overview.data && <p className="news-stats">当前库：{overview.data.event_count} 条新闻 · {overview.data.article_count} 条稿件记录 · {overview.data.source_count} 个来源 · {overview.data.duplicate_count} 次重复识别 · {overview.data.revision_count} 次修订</p>}
    {overview.data?.warnings?.filter(warning => !warning.startsWith('统计口径：') && !warning.startsWith('hot/score')).length ? <ul className="news-overview-notes" aria-label="来源异常">{overview.data.warnings.filter(warning => !warning.startsWith('统计口径：') && !warning.startsWith('hot/score')).map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
    <div className="news-home-grid"><section className="news-feed" aria-label="新闻列表与筛选">
      <div className="news-tools"><div className="news-search-row"><SearchForm key={filters.q} initial={filters.q} label="搜索新闻" placeholder="搜索标题或正文" onSearch={q => change({ q })} /><div className="news-sort" role="group" aria-label="新闻排序"><button type="button" aria-pressed={filters.sort === 'latest'} onClick={() => change({ sort: 'latest' })}>最新</button><button type="button" aria-pressed={filters.sort === 'hot'} onClick={() => change({ sort: 'hot' })}>热点</button></div></div>
        <div className="news-filters"><label>来源<select value={filters.source} onChange={event => change({ source: event.target.value })}><option value="">全部来源</option>{sourceNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>时间<select value={filters.period} onChange={event => change({ period: event.target.value })}>{Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>内容<select value={filters.content_level} onChange={event => change({ content_level: event.target.value })}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        {active.length > 0 && <div className="news-active-filters" aria-label="活动筛选">{active.map(item => <button key={item.key} type="button" aria-label={`移除${item.label}`} onClick={() => change({ [item.key]: item.key === 'period' || item.key === 'content_level' ? 'all' : '' })}>{item.label}<span aria-hidden="true"> ×</span></button>)}<button className="text-button" type="button" onClick={clear}>清空筛选</button></div>}
      </div>
      {filters.sort === 'hot' && <p className="news-sort-note">热点按已接入来源内的规则评分排序，不代表全网热搜或阅读量。筛选条件仍取交集。</p>}
      {updates.revision !== loadedRevision && <div className="news-reload-prompt" role="status"><span>本次更新已结束。列表未自动变动，可载入当前库中的最新结果。</span><button type="button" disabled={result.loading} onClick={reloadList}>载入更新</button></div>}
      <div className="news-feed-caption"><span>{result.loading ? '正在读取…' : events ? `已显示 ${events.length} 条${active.length ? '匹配新闻' : '新闻'}` : '新闻'}<span className="news-caption-time"> · 北京时间</span></span><button type="button" className="text-button" disabled={result.loading} onClick={reloadList}>重新载入</button></div>
      <ErrorBox message={result.error} retry={result.reload} />{result.loading && !events && <Loading label="正在读取新闻…" />}
      {events?.length === 0 && <Empty title={active.length ? '没有符合组合条件的新闻' : '还没有收录新闻'}><p>{active.length ? '搜索、来源、时间、内容与主题同时生效。可移除部分条件后重试。' : '先检查已启用的新闻源，再点击“更新新闻”。阅读新闻不需要模型。'}</p>{active.length ? <button type="button" onClick={clear}>清空筛选</button> : <Link to={`/sources${suffix}`}>检查新闻源</Link>}</Empty>}
      <ol className="news-items">{events?.map(event => { const date = publishedAt(event); const warning = timeWarning(date, event.quality_flags); const sourceCount = event.source_count ?? new Set(event.source_names).size; return <li key={event.id}>
        <Link className="news-item-link" to={`/events/${encodeURIComponent(event.id)}${suffix}`} onClick={() => listPositions.set(suffix, window.scrollY)}><h2>{event.title || '来源未提供标题'}</h2>{event.summary && normalizeText(event.summary) !== normalizeText(event.title) && <p className="news-item-summary">{event.summary}</p>}<div className="news-item-meta"><span>{event.source_names.join(' / ') || '来源未提供'}</span><time dateTime={date && Number.isFinite(Date.parse(date)) ? date : undefined}>{date ? newsTime(date) : '发布时间未提供'}</time>{sourceCount > 1 && <span>{sourceCount} 个来源</span>}<span>{event.article_count} 条稿件记录</span></div>{warning && <p className="news-time-warning">{warning}</p>}</Link>
      </li>; })}</ol>
      {events && events.length > 0 && <div className="news-pagination">{!result.data ? <p className="news-muted" role="status">{result.error ? '未能载入更多新闻，已保留先前的结果。' : '正在载入更多新闻…'}</p> : needsMoreCheck && !more.data && !more.error ? <span className="news-muted" role="status">正在确认后续新闻…</span> : canLoad && filters.limit < 500 ? <button type="button" disabled={result.loading} onClick={() => change({ limit: Math.min(500, filters.limit + 50) })}>{result.loading ? '正在载入…' : '再看 50 条'}</button> : <p className="news-muted">{filters.limit >= 500 && result.data.length >= 500 ? '已达到单次 500 条上限，可缩小筛选范围继续查找。' : '已显示当前条件下的全部新闻。'}</p>}{more.error && needsMoreCheck && <p className="news-muted">暂未确认是否还有后续新闻，可尝试继续加载。</p>}</div>}
      <NewsMetaLine meta={result.meta} />
    </section><aside className="news-rail" aria-label="新闻概览">
      <section><h2 className="news-section-title">主题分布</h2><p className="news-muted">当前库的收录主题，点击筛选。</p>{overview.loading && !overview.data && <Loading label="读取主题…" />}<ErrorBox message={overview.error} retry={overview.reload} />{overview.data && (overview.data.topics.length ? <ul className="news-topics">{overview.data.topics.map(topic => <li key={topic.name}><button type="button" aria-pressed={filters.tag === topic.name} onClick={() => change({ tag: filters.tag === topic.name ? '' : topic.name })}><span>{topic.name}</span><span>{topic.count}</span></button></li>)}</ul> : <p className="news-muted">尚无已收录主题。</p>)}</section>
      <section><div className="news-section-title news-row"><h2>新闻来源</h2><Link to={`/sources${suffix}`}>管理</Link></div>{sources.loading && !sources.data && <Loading label="读取来源…" />}<ErrorBox message={sources.error} retry={sources.reload} /><ul className="news-rail-sources">{sources.data?.map(source => <li key={source.id}><h3>{source.name}</h3><SourceHealth source={source} compact /></li>)}</ul>{sources.data?.length === 0 && <p className="news-muted">尚无新闻源。<Link to={`/sources${suffix}`}>添加来源</Link></p>}</section>
      <section><h2 className="news-section-title">收录说明</h2><p>同一来源的同一稿件重复抓取不重复新增；标题或正文变化保留为修订。多个来源仅在有足够一致信息时归入同一新闻。</p><p>稿件记录数包含历史版本，不等于独立媒体数。覆盖范围限于已接入来源，时间以来源发布为准。</p><Link className="news-rail-link" to={`/sources${suffix}`}>查看覆盖与采集状态 →</Link></section>
    </aside></div>
  </div>;
}
function normalizeText(value: string | null | undefined) { return (value || '').replace(/\s+/g, '').replace(/[，。！？、；：,.!?;:]/g, ''); }
function latestArticles(articles: Article[]) {
  const time = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  return [...articles].sort((left, right) => time(right.fetched_at) - time(left.fetched_at) || time(right.published_at) - time(left.published_at));
}
function sameArticle(left: Article, right: Article) {
  const source = left.source || left.source_id;
  if (!source || source !== (right.source || right.source_id)) return false;
  const sameExternalId = Boolean(left.external_id && right.external_id && left.external_id === right.external_id);
  const leftUrl = left.canonical_url || left.url;
  const rightUrl = right.canonical_url || right.url;
  return sameExternalId || Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
}
function EventReading({ id }: { id: string }) {
  const result = useApi<EventDetail>(`/events/${encodeURIComponent(id)}`);
  const [params] = useSearchParams();
  const location = useLocation();
  const suffix = filterQuery(filtersFrom(params));
  const [selectedId, setSelectedId] = useState('');
  const [researchOpen, setResearchOpen] = useState(params.get('section') === 'analysis' || params.get('research') === '1');
  const [analysisJob, setAnalysisJob] = useState<Job | null>(null);
  const action = useAction();
  const updates = useNewsUpdates();
  const [loadedRevision, setLoadedRevision] = useState(updates.revision);
  const heading = useRef<HTMLHeadingElement>(null);
  const detail = result.data;
  const sortedArticles = latestArticles(detail?.articles || []);
  const primary = sortedArticles.find(article => article.id === detail?.primary_article_id) || sortedArticles[0];
  const article = sortedArticles.find(item => item.id === selectedId) || primary;
  const groups = new Map<string, Article[]>();
  for (const item of sortedArticles) {
    const group = [...groups.values()].find(versions => versions.some(previous => sameArticle(previous, item)));
    if (group) group.push(item); else groups.set(item.id, [item]);
  }
  const sources = new Set(sortedArticles.map(item => item.source || item.source_id).filter(Boolean));
  const sourceCount = detail?.event.source_count ?? (sources.size || new Set(detail?.event.source_names || []).size);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [id]);
  useEffect(() => { if (detail) heading.current?.focus({ preventScroll: true }); }, [detail?.event.id]);
  const analyzing = analysisJob?.status === 'queued' || analysisJob?.status === 'running' || Boolean(detail && ['queued', 'running', 'analyzing'].includes(detail.event.analysis_status));
  const title = article?.title || detail?.event.title || '来源未提供标题';
  const date = article ? article.published_at : detail ? publishedAt(detail.event) : null;
  const qualityFlags = (article ? article.quality_flags : detail?.event.quality_flags) || [];
  const quality = timeWarning(date, qualityFlags);
  const text = article?.content?.trim() || '';
  const paragraphs = text.split(/\n\s*\n|\n/).map(paragraph => paragraph.trim()).filter(paragraph => paragraph && normalizeText(paragraph) !== normalizeText(title));
  const summary = detail?.event.summary?.trim() || '';
  const showEventSummary = !article && summary && normalizeText(summary) !== normalizeText(title);
  useEffect(() => { if (detail) document.title = `${title} · ytrader 新闻`; }, [detail, title]);
  return <div className="news-page news-detail-page"><div className="news-reading-nav"><Link className="news-back" to={`/events${suffix}`}>← 返回新闻列表</Link><ContextReturn /><NewsUpdate /></div>
    {updates.revision !== loadedRevision && <div className="news-reload-prompt" role="status"><span>更新已结束，当前阅读保持不变。可重新载入最新来源与修订。</span><button type="button" disabled={result.loading} onClick={() => { setSelectedId(''); result.reload(); setLoadedRevision(updates.revision); }}>载入最新版本</button></div>}
    {result.loading && !detail && <Loading label="正在读取新闻内容…" />}<ErrorBox message={result.error} retry={result.reload} />
    {detail && <div className="news-detail-grid"><article className="news-article"><header className="news-article-heading"><p className="news-article-kicker">{article?.source || detail.event.source_names.join(' / ') || '来源未提供'}<span> · </span>{article ? newsContentLabel[article.content_level] : '已收录摘要'}{article && article.id === primary?.id ? ' · 当前主版本' : article ? ' · 所选来源 / 版本' : ''}</p><h1 ref={heading} tabIndex={-1}>{title}</h1><div className="news-article-meta"><time dateTime={date && Number.isFinite(Date.parse(date)) ? date : undefined}>发布：{date ? newsTime(date) : '来源未提供'}</time><span>北京时间</span>{article && <span>采集：{newsTime(article.fetched_at)}（非发布时间）</span>}</div>{article && <div className="news-article-header-origin"><ExternalLink url={article.url}>阅读原始来源</ExternalLink></div>}</header>
      {quality && <p className="news-quality-note">{quality}</p>}
      {qualityFlags.includes('publication_repaired') && <p className="news-reading-boundary">发布时间已修正，当前显示修正后的记录；可通过原始来源核对。</p>}
      {article && article.content_level !== 'full' && <p className="news-reading-boundary">{article.content_level === 'summary' ? '以下为来源提供的摘要，并非完整原文。' : '此来源仅提供标题，未收录正文。'}<ExternalLink url={article.url}>前往原文</ExternalLink></p>}
      <div className="news-article-body">{article ? paragraphs.length > 0 && article.content_level !== 'title' ? paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="news-muted">{article.content_level === 'title' ? '可通过原始来源继续阅读。' : '该版本未提供额外正文，请查看原始来源。'}</p> : showEventSummary ? <><p className="news-muted">已收录摘要 · 非全文</p><p>{summary}</p></> : <p className="news-muted">尚无可阅读的稿件正文。可检查新闻源后更新，或选择其他版本。</p>}</div>
      {article && <div className="news-article-origin"><ExternalLink url={article.url}>阅读原始来源</ExternalLink><span>{newsContentLabel[article.content_level]} · {revisionLabel[article.revision_kind] || '稿件记录'}</span></div>}
      <details className="news-secondary-section"><summary>相关产业</summary><RelatedTopics eventId={id} /></details>
      <details className="news-secondary-section optional-research" open={researchOpen} onToggle={event => setResearchOpen(event.currentTarget.open)}><summary>可选：事件研究</summary><p className="section-note">仅在主动请求后调用已保存的模型；新闻阅读无需模型。研究覆盖事件资料，不只当前所选版本。</p><div className="research-actions"><button type="button" disabled={action.busy || analyzing} onClick={() => void action.run(async () => { const response = await post<Job>(`/events/${encodeURIComponent(id)}/analyze`); setAnalysisJob(response.data); result.reload(); })}>{action.busy ? '正在提交…' : analyzing ? '正在研究…' : detail.analysis ? '重新研究事件' : '研究这条事件'}</button><Link to="/settings#model">模型设置</Link></div><ErrorBox message={action.error} />{analysisJob && <JobProgress job={analysisJob} onFinish={job => { setAnalysisJob(job); result.reload(); }} />}{!analysisJob && analyzing && <p className="message" role="status">事件研究正在进行。<Link to="/jobs">查看进度</Link><button type="button" onClick={result.reload}>载入研究结果</button></p>}{detail.event.analysis_status === 'failed' && <p className="message error">事件研究未完成，新闻仍可阅读。<Link to="/jobs">查看失败原因</Link></p>}<AnalysisView analysis={detail.analysis} articles={detail.articles} /></details>
      <details className="news-secondary-section"><summary>收录信息</summary><p className="news-muted">事件更新：{newsTime(detail.event.updated_at)}</p>{qualityFlags.length > 0 && <ul className="news-data-notes">{qualityFlags.map(flag => <li key={flag}>{newsQualityLabels[flag] || '其他质量标记'}</li>)}</ul>}<NewsMetaLine meta={result.meta} /></details>
    </article><aside className="news-rail news-reading-rail" aria-label="来源与修订"><section><h2 className="news-section-title">来源与修订</h2><p className="news-muted">{sourceCount ? `${sourceCount} 个来源` : '来源未明确'} · {detail.articles.length} 条稿件记录。每组为同一来源的同一稿件；修订不是新增媒体。选择后左侧内容同步切换。</p>{article && article.id !== primary?.id && <button type="button" className="text-button news-primary-return" onClick={() => setSelectedId(primary?.id || '')}>回到当前主版本</button>}
      {groups.size === 0 && <p className="news-muted">尚未附原始稿件。</p>}
      <ul className="news-version-groups">{[...groups].map(([key, versions]) => <li key={key}><h3>{versions[0].source || '来源未提供'}</h3><p className="news-muted">{versions.length === 1 ? '1 条稿件记录' : `同一稿件 · ${versions.length} 个版本`}</p><ol>{versions.map((version, index) => <li key={version.id}><button type="button" className="news-version" aria-pressed={article?.id === version.id} onClick={() => setSelectedId(version.id)}><span>{revisionLabel[version.revision_kind] || '稿件记录'}{index === 0 ? ' · 最新记录' : ' · 历史记录'}{version.id === primary?.id ? ' · 主版本' : ''}</span><strong>{version.title}</strong><span>发布：{newsTime(version.published_at)}</span><span>采集：{newsTime(version.fetched_at)}</span></button></li>)}</ol></li>)}</ul></section>
      {detail.articles.length > 1 && <section><h2 className="news-section-title">{groups.size === 1 ? '稿件更新说明' : '报道合并说明'}</h2><p>{groups.size === 1 ? mergeExplanation(article?.merge_reason || 'same_source_identity_revision') : mergeExplanation('same_subject_time_and_nonconflicting_facts')}</p><p className="news-muted">不同来源保留各自稿件；同源修订保留历史。可选择版本核对差异。</p></section>}<section><h2 className="news-section-title">继续阅读</h2><Link to={`/events${suffix}`}>回到当前筛选列表 →</Link><Link className="news-rail-link" to={`/sources${location.search}`}>查看新闻源状态 →</Link></section>
    </aside></div>}
  </div>;
}
const analysisSections: [keyof Analysis['sections'], string, string][] = [
  ['facts', '事实', '可由来源直接核对的已知事实'], ['links', '产业联系', '关系类别与传导机制，不混同分类与供应'],
  ['companies', '相关公司', '公司关联及其证据基础'], ['conditions', '成立条件', '路径成立所需的前提与约束'],
  ['counter_evidence', '反证', '可能削弱或否定判断的证据'], ['unknowns', '未知项', '证据缺口与待核实事项'],
];
export function AnalysisView({ analysis, articles = [] }: { analysis: Analysis | null; articles?: Article[] }) {
  if (!analysis) return <p className="quiet-empty">尚无研究结果。可先阅读资料，需要时再请求模型研究。</p>;
  return <section aria-label="六类证据分析">
    <div className="row-between"><h2>研究结果</h2><Status value={analysis.status} /></div>
    {analysis.status === 'stale' && <p className="message warning">资料已更新，以下研究基于旧证据。请重新研究并核对新增来源。</p>}
    <details className="analysis-provenance"><summary>模型与生成信息</summary><p className="muted">模型：{analysis.model} · 生成：{dateTime(analysis.created_at)} · 证据版本：{analysis.evidence_version}</p></details>
    {analysis.warnings.length > 0 && <ul className="warnings">{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    {analysisSections.map(([key, title, description], index) => <section className="analysis-section" key={key}><h3><span className="section-number">{String(index + 1).padStart(2, '0')}</span>{title}</h3><p className="section-note">{description}</p>
      {analysis.sections[key].length ? <ul className="claim-list">{analysis.sections[key].map((claim, claimIndex) => <li key={claimIndex}><p>{claim.text}</p><EvidenceRefs ids={claim.evidence_ids} articles={articles} /></li>)}</ul> : <p className="muted">本次研究未提供此项，不代表不存在相关风险或未知。</p>}
    </section>)}<p className="section-note">研究辅助，不构成投资建议。</p>
  </section>;
}
