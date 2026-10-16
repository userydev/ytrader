import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, initializeAuth, login, logout, RequestError, session, devSession, storageWarning } from './api';
import type { Digest, Evidence, Event, Page, Status } from './types';
import { isIOS } from './vault';
import { ContentReader } from './content/ContentReader';
import { WorkbenchApp } from './workbench/WorkbenchApp';
function SourceLink({ url }: { url: string }) {
  const [error,setError] = useState('');
  if (!/^https?:\/\//.test(url)) return <span>原文链接不可用</span>;
  return <><a href={url} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (!isIOS) return;
    event.preventDefault();
    void import('@capacitor/browser').then(({ Browser }) => Browser.open({ url, presentationStyle: 'fullscreen' })).catch(() => setError('原文打开失败，请重试。'));
  }}>核验原文 ↗</a>{error && <p role="alert">{error}</p>}</>;
}
const sourceName = (name: string) => name;
const time = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('zh-CN',{ timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '未知';
const statusLabel: Record<string,string> = { ok: '来源更新正常', partial: '部分来源延迟或不可用', stale: '内容水位已陈旧', unavailable: '来源更新失败', not_configured: '来源尚未配置', empty: '本次未发现新增重要事件' };
const analysisLabel: Record<string,string> = { ready: '条件解释已生成', pending: '影响解释待生成', withdrawn: '相关解释已撤回', failed: '影响解释生成失败', model_unavailable: '影响解释暂不可用' };
const explanationText = (event: Event) => event.explanation_status==='ready' && event.impact_coverage==='facts_only' ? '事实已核验 · 影响解释停步' : analysisLabel[event.explanation_status];
const typeLabel: Record<string,string> = { fact: '事实', source_opinion: '来源表述', conditional_inference: '条件推断' };
const evidenceLabel: Record<string,string> = { primary: '原始依据支持', corroborated: '独立报道支持', unverified: '未核实', conflicting: '冲突', refuted: '已被否定' };
const positions = new Map<string,number>();
function useRoute() {
  const [hash,setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const change = () => setHash(window.location.hash || '#/');
    const remember = (event: MouseEvent) => { if ((event.target as Element).closest('a[href^="#/"]')) positions.set(hash,window.scrollY); };
    window.addEventListener('hashchange',change); document.addEventListener('click',remember,true);
    return () => { window.removeEventListener('hashchange',change); document.removeEventListener('click',remember,true); };
  },[hash]);
  let url: URL;
  try { url = new URL(hash.startsWith('#/') ? hash.slice(1) : '/', 'https://reader.invalid'); }
  catch { url = new URL('/invalid', 'https://reader.invalid'); }
  return { hash, url };
}
function useResource<T>(path: string, refresh: number) {
  const [state,setState] = useState<{ key: string; data?: T; error?: Error; loading: boolean }>({ key: path, loading: true });
  useEffect(() => {
    let active = true;
    setState(old => ({ key: path, data: old.key === path ? old.data : undefined, loading: true }));
    api<T>(path).then(data => { if (active) setState({ key: path, data, loading: false }); }, error => {
      if (active) setState(old => ({ key: path, data: old.key === path ? old.data : undefined, error, loading: false }));
    });
    return () => { active=false; };
  },[path,refresh]);
  return state.key === path ? state : { key: path, loading: true, data: undefined, error: undefined };
}
function Problem({ error, retry }: { error?: Error; retry: () => void }) {
  return error ? <div className="notice danger" role="alert"><p>{error.message}</p><button onClick={retry}>重试读取</button></div> : null;
}
function Loading() { return <p className="loading" role="status">正在读取已保存的内容…</p>; }
function FocusAndScroll({ ready, route }: { ready: boolean; route: string }) {
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => { document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }); window.scrollTo(0,positions.get(route) ?? 0); });
    return () => cancelAnimationFrame(frame);
  },[ready,route]);
  return null;
}
export function App() {
  const [online, setOnline] = useState(navigator.onLine);
  const { url } = useRoute();

  useEffect(() => {
    void (async () => {
      await initializeAuth();
      try {
        await session();
      } catch {
        // Silently obtain dev-session for zero-friction access
        try {
          await devSession();
        } catch {
          // Dev-session fallback
        }
      }
    })();
    const expired = () => {
      void devSession().catch(() => {});
    };
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('auth-expired', expired);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('auth-expired', expired);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const isReaderRoute = /^\/(reader|legacy|editorial)(?:\/|$)/.test(url.pathname);

  return (
    <>
      <a
        className="skip"
        href="#content"
        onClick={event => {
          event.preventDefault();
          const target = document.querySelector<HTMLElement>('#content h1') ?? document.querySelector<HTMLElement>('#content');
          target?.focus();
          target?.scrollIntoView({ block: 'start' });
        }}
      >
        跳到正文
      </a>
      {!online && (
        <div className="network" role="alert">
          当前离线。已打开内容仅代表上次核验，无法获知新的更正；重连后请重新读取。
        </div>
      )}
      {isReaderRoute ? (
        <AuthenticatedReader onLogout={async () => { await logout(); }} />
      ) : (
        <WorkbenchApp onLogout={async () => { await logout(); }} />
      )}
    </>
  );
}
function Login({ error, onLogin, onCheck }: { error: string; onLogin: () => void; onCheck: () => void }) {
  const [password,setPassword] = useState(''); const [busy,setBusy] = useState(false); const [failure,setFailure] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFailure('');
    try { await login(password); setPassword(''); onLogin(); } catch (err) { setFailure((err as Error).message); } finally { setBusy(false); }
  }
  return <main id="content" className="login"><p className="brand">ytrader / 阅读</p><h1>看清变化，核验依据。</h1><p className="muted">登录后阅读事件简报，沿来源与公司资料理解经营变化。</p>
    {(failure || error) && <p className="notice danger" role="alert">{failure || error}</p>}
    {storageWarning && <p className="notice">{storageWarning}</p>}
    <form onSubmit={submit}><label htmlFor="password">访问密码</label><input id="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)}/><button className="primary" disabled={busy}>{busy ? '正在验证…' : '登录阅读'}</button></form>
    <button className="text-button" onClick={onCheck}>重新检查已有会话</button></main>;
}
function AuthenticatedReader({ onLogout }: { onLogout: () => Promise<void> }) {
  const { url } = useRoute();
  return /^\/legacy(?:\/|$)/.test(url.pathname) ? <Reader onLogout={onLogout}/> : <ContentReader onLogout={onLogout}/>;
}
function Reader({ onLogout }: { onLogout: () => Promise<void> }) {
  const { hash, url: location } = useRoute();
  const url = new URL(`${location.pathname.replace(/^\/legacy(?=\/|$)/, '') || '/'}${location.search}`, 'https://reader.invalid');
  const [refresh,setRefresh] = useState(0); const [logoutError,setLogoutError] = useState('');
  const status = useResource<Status>('/system/status',refresh);
  const retry = () => setRefresh(n => n+1);
  const match = /^\/events\/([^/]+)$/.exec(url.pathname);
  return <><header><a className="brand" href="#/">ytrader</a><nav aria-label="旧版导航"><a href="#/legacy" aria-current={url.pathname==='/' ? 'page' : undefined}>旧版今日</a><a href="#/legacy/history" aria-current={url.pathname==='/history' ? 'page' : undefined}>历史</a><a href="#/legacy/sources" aria-current={url.pathname==='/sources' ? 'page' : undefined}>来源</a></nav><button className="text-button" onClick={() => { void onLogout().catch(error => setLogoutError(error.message)); }}>退出</button></header>
    {logoutError && <p className="notice danger" role="alert">退出未完成：{logoutError}</p>}
    {storageWarning && <p className="notice storage-warning">{storageWarning}</p>}
    <div className={match ? 'shell article-shell' : 'shell'}><main id="content">
      {match ? <Detail eventId={decodeURIComponent(match[1])} version={url.searchParams.get('version')} route={hash} refresh={refresh} retry={retry}/>
        : url.pathname==='/history' ? <History query={url.searchParams.get('q') ?? ''} route={hash} refresh={refresh} retry={retry}/>
        : url.pathname==='/sources' ? <><FocusAndScroll ready={Boolean(status.data) || Boolean(status.error)} route={hash}/><h1 tabIndex={-1}>来源与更新</h1><p className="caption">最近同步、来源覆盖与后台解释任务</p><button onClick={retry}>重新读取状态</button><Problem error={status.error} retry={retry}/>{status.loading && <Loading/>}{status.data && <SourceStatus status={status.data} detailed/>}</>
        : <Today route={hash} refresh={refresh} retry={retry}/>}
    </main></div></>;
}
function SourceStatus({ status, detailed = false }: { status: Status; detailed?: boolean }) {
  const b = status.budget;
  const exhausted = b && (b.day.spent+b.day.reserved>=b.day.limit || b.month.spent+b.month.reserved>=b.month.limit);
  const pending = status.jobs.filter(j => ['queued','running','outcome_unknown','blocked'].includes(j.status)).reduce((sum,j) => sum+j.count,0);
  return <div className="source-status"><p className={status.status==='ok' ? 'verified' : 'warning'}>{statusLabel[status.status] ?? '来源状态待核验'}</p><dl><dt>最近成功同步</dt><dd>{time(status.last_success_at)}（北京时间）</dd>{status.failure_at && <><dt>最近失败</dt><dd>{time(status.failure_at)}</dd></>}</dl>
    {status.error_code && <p className="caption">同步故障：{({ NOT_CONFIGURED: '来源未配置', CURSOR_EXPIRED: '来源游标已过期，等待水位恢复核对', CONTRACT_MISMATCH: '来源接口返回不符合契约', UPSTREAM_UNCERTAIN: '来源请求未得到确定响应', SYNC_FAILED: '来源同步事务未完成' } as Record<string,string>)[status.error_code] ?? status.error_code}</p>}
    {status.recovery_required && <p className="notice danger">来源水位无法核验，已暂停展示依赖解释，等待恢复核对。</p>}
    {status.backlog && <p className="warning">来源变化仍在同步，覆盖尚未追平。</p>}
    <h3>解释额度</h3><p>{!status.model_enabled ? '自动解释未启用，已有有效结果可读。' : !b ? '额度尚未核验；未确认前不生成分析。' : !b.enabled ? '解释服务未启用。' : b.unit!=='micro_usd' || b.day.limit>1_000_000 || b.month.limit>10_000_000 ? '额度配置超出授权，分析已暂停，等待核验。' : exhausted ? '当前额度已用尽，新分析暂停。' : '分析受统一额度限制，等待后台处理。'}</p>
    <p className="caption">授权上限：每日 $1 / 每月 $10，调试共用。</p>{b && <p className="caption">额度最近核验 {time(b.checked_at)}；不是实时余额。</p>}
    {pending>0 && <p>{pending} 项解释尚未完成；不影响阅读已核验内容。</p>}
    {detailed && <><h2>解释任务</h2>{status.jobs.length ? <ul className="source-list">{status.jobs.map(job => <li key={`${job.status}-${job.error_code}`}><strong>{({ queued: '等待处理', running: '处理中', blocked: '暂停', outcome_unknown: '调用结果待核实，不自动重发', failed: '未能发布', succeeded: '已发布', cancelled: '已失效' } as Record<string,string>)[job.status] ?? job.status} · {job.count} 项</strong>{job.error_code && <p className="caption">{({ CONTENT_REVIEW_FAILED: '独立审核发现事实或机制问题，草稿未发布。', REVIEW_OUTPUT_REJECTED: '审核输出不合格，草稿未发布。', REVIEW_FAILED: '独立审核未完成，草稿未发布。', OUTPUT_REJECTED: '生成内容未通过证据或格式校验。', PENDING_VERIFICATION: '付费调用结果尚未确认，保留原调用，不重新发送。', SOURCE_CHANGED: '来源版本或权限已变化，依赖结果失效。', BUDGET_EXHAUSTED: '已达统一额度，新的解释暂停。' } as Record<string,string>)[job.error_code] ?? job.error_code}</p>}</li>)}</ul> : <p className="caption">尚无解释任务。</p>}<h2>已接入来源</h2>{status.coverage.length ? <ul className="source-list">{status.coverage.map((source,i) => <li key={`${sourceName(source.source)}-${i}`}><strong>{sourceName(source.source)}</strong><p>{statusLabel[source.status] ?? '状态待核验'} · 最近成功 {time(source.last_success_at)}</p>{source.coverage_note && <p>{source.coverage_note}</p>}</li>)}</ul> : <p className="notice">尚无可核验的来源覆盖记录。不能将此视为“没有重要事件”。</p>}</>}
  </div>;
}
function EventList({ items }: { items: Event[] }) {
  return <ol className="event-list">{items.map(event => <li key={`${event.event_id}-${event.version}`}><div className="meta"><span className={['unverified','conflicting'].includes(event.evidence_state) ? 'tag warning' : event.evidence_state==='refuted' ? 'tag danger-text' : 'tag verified'}>{event.evidence_label}</span>{event.importance!=='exclude' && <span>{event.importance==='major' ? '重大' : '关注'}</span>}{event.correction_for_reader ? <strong className="danger-text">有更正</strong> : event.unread ? <span className="new">{event.change_kind==='new' ? '未读' : '有更新'}</span> : <span>已读</span>}</div>
    <h2><a href={`#/legacy/events/${encodeURIComponent(event.event_id)}`}>{event.headline ?? event.summary}</a></h2>{event.change_summary && <p className="change-preview">{event.change_summary}</p>}
    {(event.impact_summary || event.paths[0]) && <p className="impact-preview"><span>意义</span>{event.impact_summary ?? event.paths[0].mechanism}</p>}
    <p className="caption">{event.occurred_at && <>发生 {time(event.occurred_at)} · </>}来源发布 {time(event.source_published_at)} · 核验 {time(event.last_verified_at)}</p></li>)}</ol>;
}
function Today({ route, refresh, retry }: { route: string; refresh: number; retry: () => void }) {
  const state = useResource<Digest>('/digest',refresh); const updates = useResource<{ data: Event[] }>('/updates',refresh);
  const [extra,setExtra] = useState<Event[]>([]); const [more,setMore] = useState<string | null>(null); const [moreError,setMoreError] = useState<Error>(); const [moreBusy,setMoreBusy] = useState(false);
  useEffect(() => { setExtra([]); setMore(state.data?.more_cursor ?? null); },[state.data]);
  async function loadMore() { if (!more) return; setMoreBusy(true); setMoreError(undefined); try { const result = await api<Page>(`/digest/more?cursor=${encodeURIComponent(more)}`); setExtra(old => [...old,...result.data]); setMore(result.next_cursor); } catch (error) { setMoreError(error as Error); } finally { setMoreBusy(false); } }
  const data = state.data;
  const shown = new Set([...(data?.items ?? []),...extra,...(data?.watch_items ?? [])].map(event => event.event_id));
  const corrections = (data?.corrections ?? []).filter(event => !shown.has(event.event_id));
  const updateItems = (updates.data?.data ?? []).filter(event => !shown.has(event.event_id) && !corrections.some(c => c.event_id===event.event_id));
  return <><div className="edition"><div><p className="eyebrow">每日阅读 · 滚动 24 小时</p><h1 tabIndex={-1}>重要变化</h1></div><button className="text-button" onClick={retry}>刷新内容</button></div><FocusAndScroll ready={Boolean(data) || Boolean(state.error)} route={route}/><Problem error={state.error} retry={retry}/>{state.loading && <Loading/>}
    {data && <><p className={`status-line ${!['ok','empty'].includes(data.status) ? 'warning' : ''}`}>{data.status==='empty' ? '来源已同步' : statusLabel[data.status] ?? '来源状态待核验'} · 水位 {time(data.data_cutoff_at)}（北京） <a href="#/legacy/sources">查看来源</a></p>
      {data.items.length ? <EventList items={[...data.items,...extra]}/> : <div className="empty"><h2>{['ok','empty'].includes(data.status) ? '过去 24 小时暂无通过筛选的重要变化' : '当前无法确认是否有新增重要变化'}</h2><p>{data.pending_count>0 ? `另有 ${data.pending_count} 项内容等待证据核验或解释，尚未作为合格大事发布。` : '不以旧闻或低质量内容补足条数。'}</p><a href="#/legacy/history">回看历史内容 →</a></div>}
      {more && <button disabled={moreBusy} onClick={() => { void loadMore(); }}>{moreBusy ? '读取中…' : '更多重要变化'}</button>}<Problem error={moreError} retry={() => { void loadMore(); }}/>
      {data.watch_items.length>0 && <section className="watch"><h2>观察中 · 尚待证实</h2><p>只讨论如果成立的影响，不视作已经发生的事实。</p><EventList items={data.watch_items}/></section>}
      {corrections.length>0 && <section><h2 className="danger-text">更正与撤回</h2><EventList items={corrections}/></section>}
    </>}
    {updates.error && <Problem error={updates.error} retry={retry}/>}{updateItems.length>0 && <section className="updates"><h2>已读内容的新变化</h2><EventList items={updateItems}/></section>}</>;
}
function History({ query, route, refresh, retry }: { query: string; route: string; refresh: number; retry: () => void }) {
  const [input,setInput] = useState(query); const state = useResource<Page>(`/events?q=${encodeURIComponent(query)}`,refresh);
  const [extra,setExtra] = useState<Event[]>([]); const [next,setNext] = useState<string | null>(null); const [failure,setFailure] = useState<Error>(); const [busy,setBusy] = useState(false);
  useEffect(() => { setInput(query); },[query]); useEffect(() => { setExtra([]); setNext(state.data?.next_cursor ?? null); },[state.data]);
  async function more() { if (!next) return; setBusy(true); setFailure(undefined); try { const result = await api<Page>(`/events?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(next)}`); setExtra(old => [...old,...result.data]); setNext(result.next_cursor); } catch (error) { setFailure(error as Error); } finally { setBusy(false); } }
  return <><h1 tabIndex={-1}>历史事件</h1><p className="caption">按来源发布时间回看，保留版本记录。</p><form className="search" onSubmit={e => { e.preventDefault(); window.location.hash=`/legacy/history?q=${encodeURIComponent(input)}`; }}><label htmlFor="search">查找已收录事件</label><div><input id="search" type="search" value={input} maxLength={100} onChange={e => setInput(e.target.value)}/><button>查找</button></div></form><FocusAndScroll ready={Boolean(state.data) || Boolean(state.error)} route={route}/><Problem error={state.error} retry={retry}/>{state.loading && <Loading/>}
    {state.data && (state.data.data.length ? <EventList items={[...state.data.data,...extra]}/> : <p className="empty">没有匹配的已收录事件。此处仅检索本产品已保存内容，不代表全市场无相关变化。</p>)}
    {next && <button disabled={busy} onClick={() => { void more(); }}>{busy ? '读取中…' : '更多历史'}</button>}<Problem error={failure} retry={() => { void more(); }}/></>;
}
function OriginalSources({ event }: { event: Event }) {
  const sources = new Map<string,Evidence>();
  for (const ref of [...event.claims.flatMap(claim => claim.evidence),...event.companies.flatMap(company => company.business_evidence)]) sources.set(`${ref.item_id}:${ref.item_version}`,ref);
  return sources.size ? <ul className="original-sources">{[...sources.entries()].map(([key,source]) => <li key={key}><strong>{source.title || source.source}</strong><p className="caption">{source.source} · 发布 {time(source.published_at)} · 来源第 {source.item_version} 版</p>{source.url ? <SourceLink url={source.url}/> : <p className="caption">原文链接不可用</p>}</li>)}</ul> : <p className="muted">本版本没有可安全展示的原文依据。</p>;
}
function Detail({ eventId, version, route, refresh, retry }: { eventId: string; version: string | null; route: string; refresh: number; retry: () => void }) {
  const state = useResource<Event>(`/events/${encodeURIComponent(eventId)}${version ? `?version=${encodeURIComponent(version)}` : ''}`,refresh);
  const [readError,setReadError] = useState(''); const [versions,setVersions] = useState<{ version: number; change_kind: string; change_note: string; generated_at: string }[]>([]); const [versionError,setVersionError] = useState(''); const [nextBefore,setNextBefore] = useState<number | null>(null);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setReadError(''); setVersions([]); setVersionError(''); setNextBefore(null); },[eventId,version]);
  useEffect(() => { if (!state.data) return; let active=true; void api(`/read-state/${encodeURIComponent(state.data.event_id)}`,'PUT',{ version: state.data.version }).catch(() => { if (active) setReadError('内容已打开，但已读记录未保存；联网后重新读取可重试。'); }); return () => { active=false; }; },[state.data]);
  async function loadVersions(before?: number) {
    const g = generation.current;
    try { const result = await api<{ data: typeof versions; next_before: number | null }>(`/events/${encodeURIComponent(eventId)}/versions${before ? `?before=${before}` : ''}`); if (g!==generation.current) return; setVersions(old => before ? [...old,...result.data] : result.data); setNextBefore(result.next_before); setVersionError(''); } catch { if (g===generation.current) setVersionError('版本记录读取失败，请重试。'); }
  }
  const event = state.data;
  return <article><a className="back" href="#/legacy" onClick={e => { positions.set(route,window.scrollY); if (positions.size>1) { e.preventDefault(); history.back(); } }}>← 返回阅读位置</a><Problem error={state.error} retry={retry}/>{state.loading && <Loading/>}<FocusAndScroll ready={Boolean(event) || Boolean(state.error)} route={route}/>
    {event && <><h1 tabIndex={-1}>{event.headline ?? event.summary}</h1><p className="meta"><span>第 {event.version} 版</span><span className="tag">{event.evidence_label}</span><span>{explanationText(event)}</span></p>
      <p className="caption">发生时间 {time(event.occurred_at)} · 来源发布时间 {time(event.source_published_at)} · 最近核验 {time(event.last_verified_at)}（北京时间）</p>
      {event.version!==event.current_version && <p className="notice">你正在查看历史版本。<a href={`#/legacy/events/${encodeURIComponent(event.event_id)}`}>查看当前第 {event.current_version} 版 →</a></p>}
      {event.correction_notice && <p className={`notice ${event.explanation_status==='ready' ? '' : 'danger'}`} role="status">{event.correction_notice}</p>}
      {readError && <p className="notice" role="status">{readError}</p>}
      <section className="what-changed"><h2>发生了什么</h2>{event.change_summary && <p className="article-lead">{event.change_summary}</p>}{event.claims.length ? event.claims.map(claim => <div key={claim.claim_id} className={`claim ${claim.content_type}`}><p className="meta"><strong>{typeLabel[claim.content_type]}</strong><span>{evidenceLabel[claim.evidence_state]}</span></p><p>{claim.text}</p><details><summary>核验依据（{claim.evidence.length}）</summary>{claim.evidence.map((source,i) => <div className="evidence" key={`${source.item_id}-${i}`}><p className="verified">{sourceName(source.source)} · {source.title || '标题不可用'}</p><p className="caption">发布 {time(source.published_at)} · 获取 {time(source.fetched_at)} · 来源第 {source.item_version} 版</p><p className="caption">位置：{source.support_locator} · {source.content_kind==='full' ? '正文' : source.content_kind==='snippet' ? '仅摘要' : '无正文'}</p>{source.excerpt && <blockquote>{source.excerpt}</blockquote>}{source.url && /^https?:\/\//.test(source.url) ? <SourceLink url={source.url}/> : <p>原文链接不可用</p>}</div>)}</details></div>) : <p className="notice">本版本内容无法安全展示，请以当前版本和可核验原文为准。</p>}</section>
      <section className="why-important"><h2>为什么重要</h2>{event.impact_summary ? <p className="article-lead">{event.impact_summary}</p> : event.paths[0] ? <p>{event.paths[0].mechanism}</p> : <p>现有依据仅支持事实，尚不能核实产业传导。</p>}<details><summary>入选依据与本版核验</summary><p>{event.importance_reason}</p><p className="caption">{event.change_note}</p></details></section>
      <section><h2>影响哪些环节</h2>{event.paths.length ? event.paths.map((path,i) => <div className="conditional" key={i}><h3>{path.name} <span className="caption">{path.direction==='positive' ? '条件下偏正面' : path.direction==='negative' ? '条件下偏负面' : '方向不确定'}</span></h3><p className="meta"><strong>条件推断</strong></p><p>{path.mechanism}</p><details><summary>机制依赖的断言</summary><ul>{event.claims.filter(claim => path.claim_ids.includes(claim.claim_id)).map(claim => <li key={claim.claim_id}>{claim.text}（{evidenceLabel[claim.evidence_state]}；来源见上方依据）</li>)}</ul></details><h4>成立条件</h4><ul>{path.conditions.map((condition,j) => <li key={j}>{condition}</li>)}</ul>{path.counterforces.length>0 && <><h4>有依据的反向因素</h4><ul>{path.counterforces.map((factor,j) => <li key={j}>{factor}</li>)}</ul></>}</div>) : <p className="muted">尚无通过核验的环节解释。</p>}</section><section className="company-exposures"><h2>{event.companies.length ? '公司联系' : '公司证据缺口'}</h2>{event.companies.length>0 && <div>{event.companies.map(company => <div className="conditional" key={company.company_id}><h3>{company.name} <span className="caption">{company.company_id}</span></h3><p className="meta"><strong>条件推断</strong><span>依赖机制：{event.paths[company.mechanism_path]?.name}</span></p><p>{company.conditional_link}</p><h4>成立条件</h4><ul>{company.conditions.map((c,i) => <li key={i}>{c}</li>)}</ul>{company.counterforces.length>0 && <><h4>有依据的反向因素</h4><ul>{company.counterforces.map((c,i) => <li key={i}>{c}</li>)}</ul></>}<details><summary>公司业务依据（不是主题标签）</summary>{company.business_evidence.map((source,i) => <div className="evidence" key={i}><p className="verified">{sourceName(source.source)} · {source.title}</p><p className="caption">发布 {time(source.published_at)} · 来源第 {source.item_version} 版 · {source.support_locator}</p>{source.excerpt && <blockquote>{source.excerpt}</blockquote>}{source.url && /^https?:\/\//.test(source.url) && <SourceLink url={source.url}/>}</div>)}</details></div>)}</div>}<p className="stopping">{event.stopping_message}</p></section>
      <section><h2>原始依据</h2><OriginalSources event={event}/></section>
      <section><h2>版本与更正记录</h2><button onClick={() => { void loadVersions(); }}>查看版本记录</button>{versionError && <p role="alert">{versionError}</p>}<ol className="version-list">{versions.map(v => <li key={v.version}><a href={`#/legacy/events/${encodeURIComponent(event.event_id)}?version=${v.version}`}>第 {v.version} 版</a> · {time(v.generated_at)}<p>{v.change_note}</p></li>)}</ol>{nextBefore && <button onClick={() => { void loadVersions(nextBefore); }}>更早版本</button>}</section>
    </>}</article>;
}
