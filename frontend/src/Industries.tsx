import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { dateTime, post, query } from './api';
import { useAction, useApi } from './hooks';
import { ContextReturn, Empty, ErrorBox, ExternalLink, JobProgress, Loading, PageHeader, SearchForm } from './components';
import { TransmissionEvidence } from './Editorial';
import type { EditorialDetail } from './Editorial';
import IndustryStructure from './IndustryStructure.tsx';
import type { IndustryDetail, IndustryList, Job } from './types';
import './industry-explorer.css';

export default function IndustriesPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get('industry_id') || '';
  const search = params.get('q') || '';
  return <div className="full-page industry-reading ix-page">
    {!id && <PageHeader title="产业" description="从结构与分工出发，探索环节、关系和公司位置。"><Link to="/jobs">后台任务与结果</Link></PageHeader>}
    <ContextReturn />
    {id ? <IndustryReader key={id} id={id} /> : <>
      <SearchForm key={search} initial={search} label="查找产业" placeholder="搜索产业，如 AI算力、原油、创新药" onSearch={q => setParams(q ? { q } : {})} />
      <IndustryDirectory search={search} />
      <NewIndustry key={search} initial={search} />
    </>}
    <nav className="industry-library-links" aria-label="其他产业资料"><Link to="/chain?legacy=1">旧主题、行业目录与数据包</Link><Link to="/settings#model">模型设置</Link></nav>
  </div>;
}

function IndustryDirectory({ search }: { search: string }) {
  const result = useApi<IndustryList>(`/industries${query({ q: search })}`);
  return <section aria-label="已收录产业">
    <h2>已收录产业</h2><p className="section-note">公共参考无需调用模型即可探索；AI 初稿与公共资料分开标识。</p>
    {result.loading && !result.data && <Loading />}<ErrorBox message={result.error} retry={result.reload} />
    <ul className="industry-directory-list">{result.data?.items.map(item => <li key={item.id}>
      <Link to={`/chain${query({ industry_id: item.id })}`}><h3>{item.name} →</h3><p>{item.demand}</p></Link>
      <p>{item.summary}</p><span className="source-attribution">{item.origin === 'ai' ? 'AI 知识初稿 · 未核查' : '公共资料参考 · 编辑整理'}</span>
    </li>)}</ul>
    {result.data?.items.length === 0 && <p className="quiet-empty">尚未收录这个名称，可以在下方主动生成 AI 产业初稿。</p>}
  </section>;
}

function NewIndustry({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const action = useAction();
  const navigate = useNavigate();
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      const response = await post<Job>('/industries/generate', { name: name.trim() });
      if (response.data.target_url) navigate(response.data.target_url);
    });
  }
  return <section className="industry-new"><h2>还没有这个产业？</h2><p>按名称生成环节、关系和公司角色的结构化 AI 初稿。仅显式提交调用模型，生成内容不冒充已核实公共资料。</p>
    <form onSubmit={submit}><label htmlFor="new-industry">产业名称</label><div className="industry-name-input"><input id="new-industry" value={name} onChange={event => setName(event.target.value)} maxLength={100} required placeholder="例如：低空经济" /><button type="submit" disabled={action.busy || !name.trim()}>{action.busy ? '正在提交…' : '生成 AI 初稿'}</button></div></form>
    <ErrorBox message={action.error} />
  </section>;
}

function IndustryReader({ id }: { id: string }) {
  const result = useApi<IndustryDetail>(`/industries/${encodeURIComponent(id)}`, 4000);
  const [params, setParams] = useSearchParams();
  const eventId = params.get('event') || '';
  const requestedProgress = params.get('progress') || '';
  const news = useApi<EditorialDetail>(eventId ? `/news/editorial/events/${encodeURIComponent(eventId)}` : null);
  const newsProgress = news.data?.progresses.find(item => item.id === requestedProgress) || news.data?.current;
  const newsLinks = newsProgress?.industry_links.filter(link => link.industry_id === id) || [];
  const [submitted, setSubmitted] = useState<Job | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const action = useAction();
  const base = result.data?.base;
  const serverJob = result.data?.job;
  const job = submitted && (!serverJob || submitted.updated_at > serverJob.updated_at) ? submitted : serverJob;
  const active = job?.status === 'queued' || job?.status === 'running';
  const supplements = result.data?.results.filter(item => item.kind === 'industry_supplement') || [];
  const selected = params.get('industry_version') || 'base';
  const supplement = supplements.find(item => item.id === selected);
  const graph = supplement?.graph || base;
  // Validate against the displayed version, not just base. Never mutate graph
  // or feed overlay data into the generation/fingerprint contract.
  const nodeNames = new Map((graph?.nodes || []).map(node => [node.id, node.name] as const));
  const relatedIds = [...new Set(newsLinks.flatMap(link => link.node_ids))];
  const highlightNodeIds = eventId ? relatedIds.filter(nodeId => nodeNames.has(nodeId)) : [];
  const missingNodeIds = relatedIds.filter(nodeId => !nodeNames.has(nodeId));
  const returnToNews = `/events${query({ event: eventId, progress: newsProgress?.id || requestedProgress, view: 'industry', industry: id })}`;
  function closeOverlay() {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('event'); next.delete('progress');
      return next;
    }, { replace: true, preventScrollReset: true, state: { returnTo: returnToNews, returnLabel: '返回新闻' } });
  }
  const ai = Boolean(supplement) || graph?.origin === 'ai';
  function selectVersion(value: string) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value === 'base') next.delete('industry_version'); else next.set('industry_version', value);
      for (const key of ['industry_node', 'industry_relation', 'industry_group', 'industry_company', 'industry_view']) next.delete(key);
      return next;
    }, { replace: true });
  }
  function openQuestions(text?: string) {
    if (text !== undefined) setQuestion(text);
    setAsking(true);
    window.setTimeout(() => { questionInput.current?.focus({ preventScroll: true }); questionInput.current?.scrollIntoView({ block: 'nearest' }); }, 0);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(async () => {
      const response = await post<Job>(`/industries/${encodeURIComponent(id)}/supplement`, { question: question.trim() });
      setSubmitted(response.data); result.reload();
    });
  }
  const progress = job && <JobProgress key={job.id} job={job} onFinish={finished => { setSubmitted(finished); result.reload(); }} />;
  const questionPanel = <section className="ix-ask" aria-label="AI 补充与历史">
    <h2>继续理解这个产业</h2><p>围绕「{base?.industry.name || graph?.industry.name}」继续提问。补充结果独立保存，不改写已有资料。</p>
    {progress}
    {graph && <details className="ix-question-suggestions"><summary>问题建议 · {graph.explanation.questions.length} 条</summary><div>{graph.explanation.questions.map(text => <button key={text} type="button" className="text-button" onClick={() => openQuestions(text)}>{text}</button>)}</div></details>}
    <form onSubmit={submit}><label htmlFor="industry-question">你想补充什么？</label><textarea ref={questionInput} id="industry-question" rows={4} maxLength={1000} required value={question} onChange={event => setQuestion(event.target.value)} placeholder="例如：哪些环节形成主要分支？配套分别支撑什么对象？" /><button type="submit" disabled={action.busy || !question.trim()}>{action.busy ? '正在提交…' : active ? '提交另一条补充' : '生成 AI 补充'}</button><p className="ix-attribution">AI 生成的关系与公司角色仍需核查。</p></form><ErrorBox message={action.error} />
    <details className="ix-history"><summary>已保存的补充 · {supplements.length} 份</summary>{supplements.length ? <ul>{supplements.map(item => <li key={item.id}><button type="button" className="text-button" onClick={() => { selectVersion(item.id); setAsking(false); }} aria-pressed={supplement?.id === item.id}>{item.question}</button><p>{item.model} · {dateTime(item.created_at)}{item.stale && ' · 基础资料已更新'}</p></li>)}</ul> : <p>尚无已保存补充。生成完成后可从版本选择中打开。</p>}<Link to="/jobs">所有后台任务与结果 →</Link></details>
  </section>;
  return <div className="ix-detail">
    <nav className="ix-toolbar" aria-label="产业工作区工具">
      <Link to="/chain">← 产业目录</Link>
      {base && <label className="ix-version-select">版本<select value={supplement?.id || 'base'} onChange={event => selectVersion(event.target.value)}><option value="base">{base.origin === 'ai' ? 'AI 产业初稿 · 未核查' : '公共参考 · 编辑整理'}</option>{supplements.map(item => <option key={item.id} value={item.id}>AI 补充：{item.question} · {dateTime(item.created_at)}{item.stale ? ' · 陈旧' : ''}</option>)}</select></label>}
      {graph && <button type="button" onClick={() => openQuestions()} aria-expanded={asking}>继续提问{active ? ' · 任务运行中' : job?.status === 'failed' ? ' · 任务失败' : ''}</button>}
      <Link to="/jobs">后台任务</Link>
    </nav>
    {result.loading && !result.data && <Loading label="正在读取产业…" />}<ErrorBox message={result.error} retry={result.reload} />
    {eventId && <section className="industry-news-overlay" aria-label="新闻传导叠加">
      <header><h2>新闻传导叠加</h2><div><Link to={returnToNews}>← 返回新闻</Link><button type="button" onClick={closeOverlay}>隐藏新闻叠加</button></div></header>
      <p className="section-note">仅标出当前画布已收录的关联环节；规则假设不是已核实事实，不改变产业结构、关系或版本。</p>
      {news.loading && !news.data && <Loading label="正在读取新闻关联…" />}
      {news.error && <><p>该新闻未关联本产业或已不可读；产业仍可独立阅读。</p><ErrorBox message={news.error} retry={news.reload} /></>}
      {newsProgress && <h3>{newsProgress.title}</h3>}
      {news.data && newsLinks.length === 0 && <p>该新闻未关联本产业或已不可读。</p>}
      {newsLinks.map((link, index) => <article key={index}><h3>{link.name} · {link.relation === 'direct' ? '直接变量关联' : '条件传导'}</h3><dl><dt>变化变量</dt><dd>{link.variable}</dd><dt>传导机制（规则判断）</dt><dd>{link.mechanism}</dd><dt>成立条件</dt><dd>{link.condition}</dd></dl><TransmissionEvidence evidence={link.evidence} reports={news.data?.articles || newsProgress?.articles || []} />{link.mechanism_reference && <p className="section-note">机制框架参考（非本次新闻证据）：<ExternalLink url={link.mechanism_reference.url}>{link.mechanism_reference.name}</ExternalLink></p>}</article>)}
      {newsLinks.length > 0 && (graph ? <><p>当前画布关联环节：{highlightNodeIds.map(nodeId => nodeNames.get(nodeId)).join('、') || '未定位到已收录环节'}</p>{missingNodeIds.length > 0 && <p className="section-note">未在当前画布定位：{missingNodeIds.length} 个（未收录：{missingNodeIds.join('、')}）</p>}</> : <p>当前没有可读画布，关联解释与来源仍保留。</p>)}
    </section>}
    {graph ? <>
      <header className="ix-industry-header"><h1>{graph.industry.name}</h1><p className="ix-version-meta">{supplement ? 'AI 补充 · 关系与公司角色未经独立核查' : ai ? 'AI 知识初稿 · 未核查、非全覆盖' : '公共资料参考 · 编辑选取范围'}{supplement && <span>问题：{supplement.question}</span>}{ai ? <span>模型：{supplement?.model || graph.model || '未标注'} · {dateTime(supplement?.created_at || graph.created_at)}{supplement && ` · ${supplement.ai_mode === 'ycore' ? 'ycore 模型' : '本地配置模型'} · 基础版本 ${supplement.input_version || '未标注'}`}</span> : <span>版本 {graph.version || '随基础资料'}</span>}</p></header>
      {selected !== 'base' && !supplement && <p className="message warning">所选 AI 版本暂不可用，当前展示基础版本；可重试读取或选择其他版本。</p>}
      {supplement?.stale && <p className="message warning">基础资料已经更新；这份 AI 补充基于旧版，仍可探索，请重新提问更新。</p>}
      {job && !asking && (active || job.status === 'failed') && <button type="button" className={`ix-job-hint ${job.status === 'failed' ? 'ix-job-failed' : ''}`} onClick={() => setAsking(true)}>{active ? 'AI 任务在后台运行，打开查看进度 →' : '最近任务失败，打开查看原因与重试入口 →'}</button>}
      <IndustryStructure key={supplement?.id || `base:${graph.version || id}`} graph={graph} ai={ai} asking={asking} onPanel={setAsking} questionPanel={questionPanel} highlightNodeIds={highlightNodeIds} />
    </> : <>{progress}{result.data && <Empty title={active ? `正在生成${job?.subject_label || '产业初稿'}` : '尚无有效产业初稿'}><p>{active ? '任务在后台运行，可离开后从任务页返回。' : '失败没有写入不完整结构。返回目录后可用相同名称重新生成。'}</p><Link to="/jobs">查看后台任务</Link><Link to="/chain">返回目录重新生成</Link></Empty>}</>}
  </div>;
}

export function RelatedIndustries({ symbol }: { symbol: string }) {
  const result = useApi<IndustryList>(`/securities/${encodeURIComponent(symbol)}/industries`);
  const location = useLocation();
  return <section className="related-industries" aria-label="已收录的产业位置"><h2>已收录的产业位置</h2><ErrorBox message={result.error} retry={result.reload} />{result.loading && !result.data && <Loading />}
    <ul className="topic-list">{result.data?.items.map(item => <li key={item.id}><Link className="topic-entry" to={`/chain${query({ industry_id: item.id })}`} state={{ returnTo: `${location.pathname}${location.search}`, returnLabel: '返回公司档案', returnState: location.state }}><h3>{item.name} →</h3></Link><ul>{item.roles.map((role, index) => <li key={index}>{role.node}：{role.role}{role.origin === 'ai' && ' · AI 建议'}</li>)}</ul></li>)}</ul>
    {result.data?.items.length === 0 && <p className="quiet-empty">尚未收录这个公司的产业角色。<Link to="/chain">浏览产业</Link></p>}
  </section>;
}
