import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage, post, safeUrl } from './api';
import { useApi } from './hooks';
import { ErrorBox, Loading } from './components';
import type { Job } from './types';
import { safeNewsReturn } from './navigation';
import './industry-research.css';

type RecordValue = Record<string, unknown>;
type Package = { industry: RecordValue; nodes: RecordValue[]; memberships: RecordValue[]; views: RecordValue[]; relations: RecordValue[]; companies: RecordValue[]; securities: RecordValue[]; participations: RecordValue[]; sources: RecordValue[]; evidence: RecordValue[]; releases: RecordValue[]; example_only?: boolean; [key: string]: unknown };
type Issue = { path: string; message: string };
type Report = { valid: boolean; publishable: boolean; errors: Issue[]; blockers: Issue[]; counts: Record<string, number>; release_ids?: string[]; release_checks?: Record<string, { publishable: boolean; blockers: Issue[] }>; preview?: Package };
type Publication = { release_id: string; package_id: string; published_at: string; parent_release_id: string | null; change_summary: string };
type Candidate = { candidate_id: string; job_id: string; question: string; model: string | null; generated_at: string | null; status: string; input_versions: RecordValue; proposed_changes: RecordValue[] };
type Chain = { candidates: Candidate[]; industry_id: string; name: string; scope: string; gaps: string[]; legacy_available: boolean; status: string; current_release: string | null; drafts: { package_id: string; saved_at: string; release_ids: string[]; example_only: boolean }[]; publications: Publication[]; activations: { release_id: string; activated_at: string; action: string }[] };
type Saved = { package_id: string; industry_id: string; saved_at: string; package: Package };
const statusNames: Record<string, string> = { not_maintained: '待按新格式维护', draft: '有草稿 · 未发布', published: '已发布' };
const relationNames: Record<string, string> = { input_to: '投入于', produces: '产出', part_of: '组成部分→整体', supports: '支撑', used_for: '用于', precedes: '流程先于' };
function show(value: unknown): string { return value == null ? '未知' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value); }
function array(value: unknown): RecordValue[] { return Array.isArray(value) ? value as RecordValue[] : []; }
function refs(value: unknown): string { return array(value).map(r => `${show(r.evidence_id)} @${show(r.revision)} · ${show(r.stance)}`).join('；') || '未提供证据引用'; }

function PackagePreview({ value }: { value: Package }) {
  const nodeName = (id: unknown) => show(value.nodes.find(n => n.node_id === id)?.name || id);
  const companyName = (id: unknown) => show(value.companies.find(c => c.company_id === id)?.name || id);
  return <div className="curated-preview">
    <section><h2>范围与缺口</h2><p>{show(value.industry.boundary)}</p><p>需求：{show(value.industry.need)}</p><ul>{(Array.isArray(value.industry.gaps) ? value.industry.gaps : []).map((gap, i) => <li key={i}>{show(gap)}</li>)}</ul>{value.example_only && <p role="status">格式样本 · 仅检查与预览，不可正式发布</p>}</section>
    <section><h2>链内组织与主分支</h2>{value.views.length === 0 && <p>尚未定义阅读视图。</p>}{value.views.map((view, i) => <article key={i}><h3>{show(view.view_id)} · 修订 {show(view.revision)}</h3>{array(view.groups).map((group, j) => <p key={j}><strong>{show(group.name)}</strong>　{(Array.isArray(group.node_ids) ? group.node_ids : []).map(nodeName).join(' / ')}</p>)}<p className="curated-muted">主关系：{show(view.relation_ids)} · 阅读顺序：{show(view.reading_order)}</p></article>)}</section>
    <section><h2>节点与成员归属 · {value.nodes.length}</h2>{value.nodes.map((node, i) => <details key={i}><summary>{show(node.name)} · {show(node.kind)} · {show(node.review_status)}</summary><p>{show(node.description)}</p><p>{show(node.node_id)} @{show(node.revision)} · 来源 {show(node.origin)}</p>{value.memberships.filter(m => m.node_id === node.node_id).map((m, j) => <p key={j}>本链归属 @{show(m.revision)}：{show(m.context_note)}</p>)}<p>{refs(node.evidence_refs)}</p><p>核查：{show(node.reviewed_by)} · {show(node.reviewed_at)}</p></details>)}</section>
    <section><h2>结构关系 · {value.relations.length}</h2>{value.relations.length === 0 && <p>尚无结构关系，不自动补边。</p>}{value.relations.map((r, i) => <details key={i}><summary>{nodeName(r.from_node_id)} → {nodeName(r.to_node_id)} · {relationNames[show(r.kind)] || show(r.kind)}</summary><p>{show(r.statement)}</p><p>适用范围：{show(r.applicability)}</p><p>{show(r.relation_id)} @{show(r.revision)} · {show(r.review_status)} · {show(r.origin)}</p><p>{refs(r.evidence_refs)}</p></details>)}</section>
    <section><h2>公司主体、证券与业务角色</h2><p className="curated-muted">公司不是证券；无明确映射不生成证券链接。同链不等于供货或受益。</p>{value.companies.map((c, i) => <article key={i}><h3>{show(c.name)}</h3><p>{show(c.company_id)} @{show(c.revision)}</p><p>证券：{value.securities.filter(s => s.company_id === c.company_id).map(s => show(s.symbol)).join(' / ') || '无已提供的证券映射'}</p></article>)}{value.participations.map((p, i) => <details key={i}><summary>{companyName(p.company_id)} · {nodeName(p.node_id)} · {show(p.role)}</summary><p>业务范围：{show(p.scope)}</p><p>{show(p.participation_id)} @{show(p.revision)} · {show(p.review_status)} · {show(p.origin)}</p><p>{refs(p.evidence_refs)}</p></details>)}</section>
    <section><h2>来源与原文证据</h2>{value.sources.map((s, i) => <details key={i}><summary>{show(s.publisher)} · {show(s.title)} · {show(s.access)}</summary><p>{show(s.source_id)} · 版本 {show(s.source_version)}</p><p>发布：{show(s.published_at)} · 取得：{show(s.retrieved_at)}</p>{safeUrl(typeof s.url === 'string' ? s.url : '') ? <a href={safeUrl(String(s.url))} target="_blank" rel="noopener noreferrer">核对来源原文</a> : <p>本地文档：{show(s.local_document_id)}</p>}{value.evidence.filter(e => e.source_id === s.source_id && e.source_version === s.source_version).map((e, j) => <blockquote key={j}><p>{show(e.excerpt)}</p><small>{show(e.evidence_id)} @{show(e.revision)} · {show(e.locator)}</small></blockquote>)}</details>)}</section>
    <section><h2>包内待发布快照</h2>{value.releases.map((r, i) => <details key={i}><summary>{show(r.release_id)} · {show(r.status)}</summary><p>{show(r.change_summary)}</p><p>上版：{show(r.parent_release_id)}</p><p>固定 {array(r.record_refs).length} 条记录、{array(r.source_refs).length} 个来源版本；导入的发布标签不会自动生效。</p></details>)}</section>
  </div>;
}

export default function IndustryResearch() {
  const [params] = useSearchParams();
  const iid = params.get('industry') || params.get('industry_id') || '';
  const catalog = useApi<{ items: Chain[]; version: string }>('/curated-chains');
  const known = catalog.data?.items.some(i => i.industry_id === iid);
  const detail = useApi<Chain>(iid && known ? `/curated-chains/${encodeURIComponent(iid)}` : null);
  const chain = detail.data?.industry_id === iid ? detail.data : undefined;
  const base = `/curated-chains/${encodeURIComponent(iid)}`;
  const [input, setInput] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [release, setRelease] = useState('');
  const [question, setQuestion] = useState('');
  const [candidateJob, setCandidateJob] = useState('');
  const jobs = useApi<Job[]>(candidateJob ? '/jobs' : null, 2500);
  const candidate = jobs.data?.find(j => j.id === candidateJob);
  const file = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const loadedChain = useRef('');
  function href(id: string, maintain = false, draftPackage = '') { const p = new URLSearchParams(params); p.set('industry', id); ['industry_id', 'name', 'research', 'result', 'published_release', 'draft_package', 'node', 'company', 'symbol', 'selected_company', 'tab', 'records', 'source_offset'].forEach(k => p.delete(k)); if (maintain) p.set('maintain', '1'); else p.delete('maintain'); if (draftPackage) p.set('draft_package', draftPackage); return `/chain?${p}`; }
  async function loadPackage(pid: string) {
    const seq = ++request.current;
    setBusy(true); setMessage(''); setSaved(null); setReport(null);
    try {
      const response = await api<Saved>(`${base}/packages/${encodeURIComponent(pid)}`);
      if (seq !== request.current) return;
      setSaved(response.data); setInput(JSON.stringify(response.data.package, null, 2));
      const checked = await post<Report>(`${base}/validate`, response.data.package);
      if (seq !== request.current) return;
      setReport(checked.data); setRelease(checked.data.release_ids?.[0] || '');
    } catch (error) { if (seq === request.current) setMessage(errorMessage(error)); }
    finally { if (seq === request.current) setBusy(false); }
  }
  useEffect(() => {
    ++request.current; loadedChain.current = ''; setInput(''); setSaved(null); setReport(null); setMessage(''); setRelease(''); setBusy(false); setCandidateJob('');
  }, [iid]);
  // Initial maintenance read is read-only; no example or AI request is loaded.
  useEffect(() => {
    if (!chain || chain.industry_id !== iid || loadedChain.current === iid) return;
    loadedChain.current = iid;
    const current = chain.publications.find(p => p.release_id === chain.current_release);
    const pid = current?.package_id || chain.drafts[chain.drafts.length - 1]?.package_id;
    if (pid) void loadPackage(pid);
  }, [chain, iid]);
  const candidateHandled = useRef('');
  useEffect(() => {
    if (candidate && ['succeeded', 'failed'].includes(candidate.status) && candidateHandled.current !== candidate.id) {
      candidateHandled.current = candidate.id; setMessage(candidate.message); detail.reload();
    }
  }, [candidate, detail.reload]);
  function change(value: string) { ++request.current; setInput(value); setReport(null); setSaved(null); setRelease(''); setMessage(''); }
  async function check(save = false) {
    const seq = ++request.current;
    setBusy(true); setMessage('');
    try {
      let value: unknown;
      try { value = JSON.parse(input); } catch { throw new Error('JSON解析失败：请核对引号、逗号与完整的顶层对象。'); }
      const checked = await post<Report>(`${base}/validate`, value);
      if (seq !== request.current) return;
      setReport(checked.data); setRelease(checked.data.release_ids?.[0] || '');
      if (save && checked.data.valid) {
        const response = await post<Saved>(`${base}/drafts`, value);
        if (seq !== request.current) return;
        setSaved(response.data);
        setMessage('完整包已保存为不可变草稿；尚未发布，也未代为审核。'); detail.reload(); catalog.reload();
      } else setMessage(checked.data.valid ? '结构检查通过，请核对可读预览和发布阻断项。' : '检查未通过，请按字段路径修正。');
    } catch (error) { if (seq === request.current) setMessage(errorMessage(error)); }
    finally { if (seq === request.current) setBusy(false); }
  }
  async function publish() {
    if (!saved || !release || !window.confirm(`明确发布 ${release} 并切换现用版本？\n此操作不会把draft改为reviewed，不会更改来源身份。`)) return;
    setBusy(true);
    try { await post(`${base}/publish`, { package_id: saved.package_id, release_id: release }); setMessage('已发布并切换现用版本；历史包保持不变。'); detail.reload(); catalog.reload(); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function activate(rid: string) {
    if (!window.confirm(`切换现用指针到 ${rid}？历史内容不会改写。`)) return;
    setBusy(true);
    try { await post(`${base}/activate`, { release_id: rid }); setMessage('现用指针已切换。'); detail.reload(); catalog.reload(); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  function download() {
    if (!saved) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved.package, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${iid}-${saved.package_id.slice(0, 12)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function supplement() {
    if (!chain || !question.trim()) return;
    setBusy(true); setMessage('');
    try {
      const result = await post<Job>(`${base}/candidates`, { question: question.trim(), package_id: saved?.package_id || null });
      setCandidateJob(result.data.id); setMessage('已明确请求AI补充；结果独立保存为候选，不写入此草稿或发布包。');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="open-industry-page curated-page">
    <header><div><h1>{iid ? `${chain?.name || params.get('name') || iid} · 数据维护` : '产业链'}</h1><p>{iid ? '核对结构、主体与原文证据，再决定是否发布。' : '先维护明确的产业范围；现有资料与新版发布分开。'}</p></div><a href={iid ? '/chain' : safeNewsReturn(params.get('return'))}>{iid ? '← 维护清单' : '← 返回阅读流程'}</a></header>
    <ErrorBox message={catalog.error || detail.error} retry={() => { catalog.reload(); detail.reload(); }} />
    {catalog.loading && !catalog.data && <Loading label="读取维护清单…" />}
    {!iid && catalog.data && <section><h2>当前维护清单</h2><div className="curated-list">{catalog.data.items.map(item => <article key={item.industry_id}><div className="curated-row"><h3>{item.name}</h3><span>{statusNames[item.status] || item.status}</span></div><p>{item.scope}</p><p className="curated-muted">{item.current_release ? `现用：${item.current_release}` : item.drafts.length ? '已保存研究草稿 · 未发布 · 待核查' : '现有资料可读，新版数据待维护。'}</p><p>缺口：{item.gaps.join('；')}</p><nav>{item.drafts.length > 0 && <a href={href(item.industry_id, false, item.drafts[item.drafts.length - 1].package_id)}>查看结构研究稿 →</a>}<a href={href(item.industry_id)}>{item.current_release ? '阅读现用发布 →' : '阅读现有资料 →'}</a><a href={href(item.industry_id, true)}>维护数据 / 导入 →</a></nav></article>)}</div></section>}
    {iid && catalog.data && !known && <section><h2>尚未纳入固定维护清单</h2><p>此具体产业身份可以与新闻关联，不强配到五条链；尚无新版维护图，不自动补图。</p><a href={`/industry/index.html?${new URLSearchParams(params)}`}>尝试阅读已有资料 →</a></section>}
    {chain && <>
      <section><h2>当前状态</h2><p>{statusNames[chain.status]} · 现用版本：{chain.current_release || '尚未发布'}</p><p>{chain.scope}</p><nav>{chain.drafts.length > 0 && <a href={href(iid, false, chain.drafts[chain.drafts.length - 1].package_id)}>查看结构研究稿（未发布） →</a>}<a href={href(iid)}>阅读{chain.current_release ? '现用v0.2版本' : '现有资料（非v0.2发布）'} →</a>{chain.current_release && <a href={`${href(iid)}&result=base`}>复查原有资料 →</a>}</nav></section>
      <section><h2>保存包与历史发布</h2>{chain.drafts.length === 0 && <p>尚未导入新版数据包。可在下方导入研究资料并检查。</p>}
        <label>选择已保存完整包 <select value={saved?.package_id || ''} disabled={busy} onChange={e => { if (e.target.value) void loadPackage(e.target.value); }}><option value="">选择包…</option>{chain.drafts.map(d => <option key={d.package_id} value={d.package_id}>{d.saved_at} · {d.release_ids.join(' / ') || '研究草稿'}{d.example_only ? ' · 格式样本' : ''}</option>)}</select></label>
        {saved?.industry_id === iid && <p><a href={href(iid, false, saved.package_id)}>查看所选包的结构研究稿 →</a> · 未发布 / 待核查 · 包 {saved.package_id.slice(0, 12)}</p>}
        {chain.publications.map(p => <article key={p.release_id}><h3>{p.release_id}{chain.current_release === p.release_id ? ' · 现用' : ''}</h3><p>{p.change_summary} · 发布 {p.published_at}</p><p>上版：{p.parent_release_id || '初版'}</p><nav><button disabled={busy} onClick={() => void loadPackage(p.package_id)}>查看原包与证据</button><a href={`${href(iid)}&published_release=${encodeURIComponent(p.release_id)}`}>阅读此历史结构 →</a><button disabled={busy || p.release_id === chain.current_release} onClick={() => void activate(p.release_id)}>切换到此历史版本</button></nav></article>)}
        {chain.activations.length > 0 && <details><summary>指针切换记录 · {chain.activations.length}</summary>{chain.activations.map((a, i) => <p key={i}>{a.activated_at} · {a.action} → {a.release_id}</p>)}</details>}
      </section>
      <section><h2>导入与检查</h2><p>粘贴或导入完整v0.2包。保存草稿不等于审核；只有满足发布条件后明确发布，阅读页才切换。</p>
        <input ref={file} type="file" accept=".json,application/json" disabled={busy} aria-label="导入完整JSON包" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 4000000) { setMessage('文件超过4MB，请拆分扩展资料。'); return; } change(await f.text()); }} />
        <details open={!saved}><summary>粘贴 / 修订JSON</summary><textarea className="curated-json" aria-label="v0.2完整JSON包" value={input} disabled={busy} onChange={e => change(e.target.value)} spellCheck={false} placeholder="在此粘贴外部研究交付的完整JSON包，不会自动导入示例。" /></details>
        <nav><button disabled={busy || !input.trim()} onClick={() => void check()}>检查并预览</button><button disabled={busy || !input.trim()} onClick={() => void check(true)}>检查并保存草稿</button><button disabled={busy || !saved} onClick={download}>下载已保存完整包</button></nav>
        {report && <div className="curated-report" role="status"><h3>{report.valid ? '结构检查通过' : '需修正输入'}</h3>{report.errors.map((e, i) => <p key={i}><strong>{e.path}</strong>：{e.message}</p>)}{report.blockers.length > 0 && <><h3>可保存草稿，但不能发布</h3>{report.blockers.map((e, i) => <p key={i}>{e.path}：{e.message}</p>)}</>}{report.valid && <p>{Object.entries(report.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}</div>}
        {saved && <div className="curated-publish"><label>选择发布快照 <select value={release} disabled={busy} onChange={e => setRelease(e.target.value)}>{report?.release_ids?.map(r => <option key={r} value={r}>{r}</option>)}</select></label><button disabled={busy || !(report?.release_checks?.[release]?.publishable ?? report?.publishable) || !release} onClick={() => void publish()}>发布此版本</button><p className="curated-muted">检查字段不等于语义核实。待采集来源、未审核事实与格式样本会阻止发布；原始来源身份保留。</p></div>}
      </section>
      {message && <p className="industry-operation" role="status">{message}</p>}
      {report?.preview && <PackagePreview value={report.preview} />}
      <section><h2>AI补充建议</h2><p>不会自动写入维护包，不自动采纳、审核或发布。请在候选中核对来源后另行整理新修订包。</p><textarea aria-label="AI补充问题" value={question} maxLength={1000} onChange={e => setQuestion(e.target.value)} placeholder="例如：当前结构缺少哪些配套环节？请保留证据缺口。" /><button disabled={busy || !question.trim() || Boolean(candidateJob && !['succeeded', 'failed'].includes(candidate?.status || ''))} onClick={() => void supplement()}>请求补充候选</button>{candidate && <p role="status">{candidate.message}</p>}{chain.candidates?.map(c => <details key={c.candidate_id}><summary>{c.question} · {c.status === 'candidate' ? 'AI候选，未采纳' : '请求已记录'}</summary><p>{c.model || '尚无模型输出'} · {c.generated_at || '尚未生成'} · 输入版本：{show(c.input_versions)}</p>{c.proposed_changes.map((change, i) => <article key={i}><h3>{show(change.op)} · {show(change.target_ref)}</h3><p>{show(change.payload)}</p><p>{refs(change.evidence_refs)}</p></article>)}</details>)}</section>
    </>}
  </div>;
}
