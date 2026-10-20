import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { api, errorMessage, post } from './api';
import { useApi } from './hooks';
import { ErrorBox, Loading } from './components';
import type { EditorialDetail } from './Editorial';
import type { Job } from './types';
import { safeNewsReturn } from './PanoramaEntry';
import './industry-research.css';

type Entry = { id: string; name: string; source_kind?: string; needs_research?: boolean; source_quality?: string };
type Directory = { items: Entry[]; total: number; ckg_configured: boolean };
type ResearchGraph = { industry: { name: string; summary: string }; nodes: { name: string }[]; origin?: string; source_kind?: string; library_available?: boolean; needs_research?: boolean; research_industry_id?: string };
type SavedResearch = { base: { input_version: string } | null; results: { id: string; kind: string; question: string; stale: boolean; graph: { explanation: { overview: string } } }[]; job: Job | null };
const sourceNames: Record<string, string> = { panorama: '持续资料', atlas: 'Atlas · MIT', pack: '公开证据包', ckg: 'CKG · 2021', public_reference: '公开参考', ai: 'AI 知识整理' };

export default function IndustryResearch() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const selectedName = params.get('name') || '';
  const sourceId = params.get('industry') || params.get('industry_id') || '';
  const researching = Boolean(selectedName || params.get('research'));
  const [text, setText] = useState(params.get('q') || selectedName);
  useEffect(() => { setText(params.get('q') || selectedName); }, [params, selectedName]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState('');
  const directory = useApi<Directory>(`/industry-research/catalog?${new URLSearchParams({ q: params.get('q') || (researching ? selectedName : ''), offset: params.get('offset') || '0' })}`);
  const tracking = useApi<Entry[]>('/industry-research/tracking');
  const jobs = useApi<Job[]>(jobId ? '/jobs' : null, 2500);
  const job = jobs.data?.find(j => j.id === jobId);
  const newsId = params.get('news') || params.get('event') || '';
  const news = useApi<EditorialDetail>(newsId ? `/news/editorial/events/${encodeURIComponent(newsId)}` : null);
  const progressId = params.get('progress');
  const selectedNews = progressId ? news.data?.progresses.find(p => p.id === progressId) : news.data?.current;
  const graph = useApi<ResearchGraph>(researching && sourceId && !sourceId.startsWith('open-') ? `/panorama/${encodeURIComponent(sourceId)}` : null);
  const researchId = graph.data?.research_industry_id || sourceId;
  const canSupplement = Boolean(!graph.data?.needs_research && (graph.data?.library_available || graph.data?.origin === 'ai' || graph.data?.origin === 'public_reference'));
  const hasSource = Boolean(graph.data && !canSupplement);
  const saved = useApi<SavedResearch>(canSupplement ? `/industries/${encodeURIComponent(researchId)}` : null);
  const lookupName = selectedName || text.trim();
  const lookup = useApi<{ existing: Entry | null }>(researching && lookupName ? `/industry-research/resolve?${new URLSearchParams({ name: lookupName, ...(hasSource ? { source_id: sourceId } : {}) })}` : null);
  const [question, setQuestion] = useState('');
  const completed = useRef('');
  function openSaved(id: string, result = '') {
    const preserved = new URLSearchParams(location.search);
    ['research', 'name', 'q', 'industry_id', 'symbol', 'company', 'tab', 'node', 'source_offset', 'selected_company', 'result', 'records'].forEach(key => preserved.delete(key));
    preserved.set('industry', id);
    if (result) preserved.set('result', result);
    window.location.assign(`/chain?${preserved}`);
  }
  useEffect(() => {
    const pending = saved.data?.job;
    if (pending && ['queued', 'running'].includes(pending.status)) { setJobId(pending.id); setBusy(true); }
  }, [saved.data]);
  useEffect(() => {
    if (!job || !['succeeded', 'failed'].includes(job.status) || completed.current === job.id) return;
    completed.current = job.id;
    setBusy(false); setMessage(job.message); setJobId('');
    if (job.status === 'succeeded' && job.target_url) {
      const next = new URL(job.target_url, window.location.origin);
      openSaved(next.searchParams.get('industry_id') || next.searchParams.get('industry') || sourceId,
        job.kind === 'industry_supplement' ? `result-${job.id}` : '');
    }
  }, [job, location.search]);
  function href(entry: Entry) {
    const next = new URLSearchParams(params);
    ['q', 'offset', 'research', 'industry_id', 'symbol', 'tab', 'node', 'result', 'source_offset', 'records'].forEach(key => next.delete(key));
    next.set('industry', entry.id); next.set('name', entry.name);
    return `/chain?${next}`;
  }
  async function toggle(entry: Entry) {
    if (!tracking.data || busy) return;
    const exists = tracking.data.some(i => i.name === entry.name);
    const items = exists ? tracking.data.filter(i => i.name !== entry.name) : [...tracking.data, entry];
    setBusy(true); setMessage('');
    try { await api('/industry-research/tracking', { method: 'PUT', body: JSON.stringify({ items: items.map(i => ({ id: i.id, name: i.name })) }) }); tracking.reload(); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function generate() {
    const name = (selectedName || text).trim();
    if (!name || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await post<Job & { industry_id?: string }>('/industry-research/generate', { name, ...(hasSource && sourceId ? { source_id: sourceId } : {}) });
      if (result.data.industry_id) { openSaved(result.data.industry_id); return; }
      setJobId(result.data.id); setMessage('产业研究已在后台开始，可离开页面；模型结果会独立保存，不覆盖来源资料。');
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  }
  async function supplement() {
    if (!question.trim() || busy || !canSupplement) return;
    setBusy(true); setMessage('');
    try {
      const response = await post<Job>(`/industries/${encodeURIComponent(researchId)}/supplement`, { question: question.trim() });
      setJobId(response.data.id); setMessage('正在研究这个问题；基础资料保留，回答将独立保存。');
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  }
  function search() {
    const next = new URLSearchParams(params);
    ['industry', 'industry_id', 'name', 'research', 'offset', 'symbol', 'tab', 'node', 'result', 'source_offset'].forEach(key => next.delete(key));
    next.set('q', text.trim()); setParams(next);
  }
  function openResearch(name: string) {
    const next = new URLSearchParams(params);
    ['industry', 'industry_id', 'offset', 'symbol', 'tab', 'node', 'result', 'source_offset'].forEach(key => next.delete(key));
    next.set('name', name.trim()); next.set('research', '1'); setParams(next);
  }
  const exact = directory.data?.items.find(i => i.name === (selectedName || text).trim() && !i.id.startsWith('open-'));
  return <div className="open-industry-page">
    <header><div><h1>{researching ? `${selectedName || '开放产业'}研究` : '产业链'}</h1><p>搜索产业或产品，先看已收录资料，也可研究任意产业。</p></div>{newsId && <a href={safeNewsReturn(params.get('return'))}>← 返回新闻</a>}</header>
    {selectedNews && <section className="open-news-context"><h2>{selectedNews.title}</h2><p>{selectedNews.summary}</p><nav aria-label="此新闻相关产业">{[...new Map(selectedNews.industry_links.map(i => [i.industry_id, i])).values()].map(i => <a key={i.industry_id} href={href({ id: i.industry_id, name: i.name })}>{i.name}</a>)}</nav><small>主题关联不等于确定传导；研究中须核对真实环节与发生条件。</small></section>}
    {progressId && news.data && !selectedNews && <p role="status">未找到指定新闻进展，未替换成其他进展。</p>}
    <form className="industry-search" onSubmit={event => { event.preventDefault(); search(); }}><input type="search" aria-label="产业或产品名称" placeholder="搜索产业 / 产品，例如汽车、特种气体" maxLength={100} value={text} onChange={event => setText(event.target.value)} /><button type="submit">搜索资料</button></form>
    <ErrorBox message={directory.error || tracking.error || news.error || saved.error || lookup.error || graph.error} retry={() => { directory.reload(); tracking.reload(); news.reload(); saved.reload(); lookup.reload(); graph.reload(); }} />
    {message && <p role="status" className="industry-operation">{message}{job && ` · ${job.progress}%`}</p>}
    {researching && <section className="open-research-start"><h2>{canSupplement ? '继续研究' : '开展研究'}</h2>
      {graph.data ? <><p>{graph.data.industry.summary}</p><p>已知位置：{graph.data.nodes.slice(0, 12).map(n => n.name).join('、')}</p><a href={(() => { const p = new URLSearchParams(params); p.delete('research'); p.delete('name'); p.set('records', '1'); return `/chain?${p}`; })()}>查看产业解释、位置与公司记录 →</a></> : <p>这个名称可以研究，不受固定产业分类限制。先查目录；资料不足时使用现有 Gemini 产业研究，保留模型身份与资料缺口。</p>}
      {canSupplement ? <>
        <form className="industry-question" onSubmit={event => { event.preventDefault(); void supplement(); }}><label htmlFor="industry-question">想进一步了解什么？</label><textarea id="industry-question" required maxLength={1000} value={question} onChange={event => setQuestion(event.target.value)} placeholder="例如：这些产品怎样衔接，哪些配套可以并行？" /><button type="submit" disabled={busy || !question.trim() || saved.loading}>{busy ? '研究处理中…' : '提交问题并保存回答'}</button></form>
        {saved.data?.results.filter(r => r.kind === 'industry_supplement' && !r.stale).map(result => <article className="saved-industry-answer" key={result.id}><h3>{result.question}</h3><p>{result.graph.explanation.overview}</p><button type="button" className="text-button" onClick={() => openSaved(researchId, result.id)}>阅读完整回答与对应节点 →</button></article>)}
      </> : lookup.data?.existing ? <p><button type="button" onClick={() => openSaved(lookup.data!.existing!.id)}>打开已保存研究：{lookup.data.existing.name} →</button></p> : <>
        {exact && <p><a href={href(exact)}>已有资料：{exact.name} →</a></p>}
        <button type="button" disabled={busy || graph.loading || lookup.loading} onClick={() => void generate()}>{busy ? '研究处理中…' : graph.data ? '结合已有资料生成研究结构' : '生成并保存产业研究'}</button>
      </>}
      <small>AI 知识整理，不冒充来源事实；新回答独立保存，新闻上下文不会迁移到其他新闻。</small>
    </section>}
    {!researching && <section><h2>持续跟踪</h2><div className="industry-tracking">{tracking.data?.map(entry => <div key={entry.name}><a href={href(entry)}>{entry.name}</a><button type="button" aria-label={`取消跟踪${entry.name}`} disabled={busy} onClick={() => void toggle(entry)}>×</button></div>)}</div>{tracking.data?.length === 0 && <p>还没有持续跟踪项，可从下方目录加入。</p>}</section>}
    <section><div className="directory-heading"><h2>已收录资料{directory.data ? ` · ${directory.data.total}` : ''}</h2>{(params.get('q') || text).trim() && <button type="button" className="text-button" onClick={() => openResearch((params.get('q') || text).trim())}>研究“{(params.get('q') || text).trim()}” →</button>}</div>
      {directory.loading && !directory.data && <Loading label="查询本地资料…" />}
      <div className="industry-directory">{directory.data?.items.map(entry => <article key={entry.id}><div><a href={href(entry)}>{entry.name}</a><small>{sourceNames[entry.source_kind || ''] || '来源记录'}{entry.needs_research ? ' · 原始候选资料，进入后整理结构' : ''}</small></div><button type="button" disabled={busy || !tracking.data} onClick={() => void toggle(entry)}>{tracking.data?.some(i => i.name === entry.name) ? '取消跟踪' : '加入跟踪'}</button></article>)}</div>
      {directory.data?.total === 0 && <p>当前来源未收录这个名称。可以直接开展开放研究，不会替换成原油。</p>}
      {directory.data && <nav className="directory-pagination" aria-label="目录分页">{Number(params.get('offset') || 0) > 0 && <button type="button" onClick={() => { const p = new URLSearchParams(params); p.set('offset', String(Math.max(0, Number(p.get('offset') || 0) - 40))); setParams(p); }}>上一页</button>}{Number(params.get('offset') || 0) + 40 < directory.data.total && <button type="button" onClick={() => { const p = new URLSearchParams(params); p.set('offset', String(Number(p.get('offset') || 0) + 40)); setParams(p); }}>下一页</button>}</nav>}
    </section>
    <footer>Atlas（MIT）、公开证据包与已保存产业研究统一查询。{directory.data?.ckg_configured ? '已配置 CKG 历史只读目录，可搜索行业与产品。' : 'CKG 外部目录未配置；包内资料与开放研究仍可用。'}目录不是全库已核实供需链的声明。</footer>
  </div>;
}
