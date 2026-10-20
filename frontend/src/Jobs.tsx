import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dateTime } from './api';
import { useApi } from './hooks';
import { Empty, ErrorBox, Loading, MetaLine, PageHeader, Status, SyncButton } from './components';
import type { Job } from './types';

const kinds: Record<string, string> = { news: '新闻更新', securities: '证券资料更新', all: '新闻与证券更新', analysis: '事件研究', analyze: '事件研究', company_analyze: '公司研究', industry_generate: 'AI 产业初稿', industry_supplement: 'AI 产业补充' };
function ResultLink({ job }: { job: Job }) {
  const target = job.target_url && /^\/(events|securities|chain)(\/|\?|$)/.test(job.target_url) ? job.target_url : null;
  return target ? <Link to={target}>{job.subject_label ? `查看${job.subject_label}` : '查看研究结果'}</Link> : null;
}
function JobState({ job }: { job: Job }) {
  const active = job.status === 'queued' || job.status === 'running';
  return <article className={`update-state ${job.status === 'failed' ? 'update-failed' : ''}`}><div className="row-between"><h3>{job.subject_label || kinds[job.kind] || '数据处理'}</h3><Status value={job.status} /></div><p>{job.message || (active ? '正在服务端处理，离开页面不会中断。' : '处理已结束。')}</p>{active && <div><progress max="100" value={Math.min(100, Math.max(0, job.progress))} aria-label="处理进度" /><span className="muted"> {job.progress}%</span></div>}<ResultLink job={job} />{job.status === 'failed' && <Link to="/settings#data">检查来源与配置</Link>}<p className="muted">更新：{dateTime(job.updated_at)}</p></article>;
}
export default function JobsPage() {
  const result = useApi<Job[]>('/jobs', 3000);
  const [kind, setKind] = useState<'news' | 'securities' | 'all'>('all');
  const [status, setStatus] = useState('');
  const sorted = result.data?.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const active = sorted?.filter(job => job.status === 'queued' || job.status === 'running') || [];
  const completed = sorted?.filter(job => job.status !== 'queued' && job.status !== 'running');
  const history = sorted?.filter(job => !status || job.status === status);
  return <div className="full-page updates-page"><PageHeader title="任务与数据更新" description="查看产业解释、研究与数据更新的进度，并返回已保存的结果。"><Link to="/settings#data">返回设置</Link></PageHeader>
    <section className="job-controls"><h2>更新阅读与公司数据</h2><div className="filter-row"><label htmlFor="sync-kind">更新内容</label><select id="sync-kind" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="all">新闻与证券资料</option><option value="news">仅新闻</option><option value="securities">仅证券资料</option></select><SyncButton kind={kind} onDone={result.reload}>开始更新</SyncButton></div><p className="section-note">更新数据不等于 AI 研究。产业补充在产业页主动发起；其他研究在新闻或公司页发起，或由已保存的自动分析设置触发。</p><div className="data-management-links"><Link to="/settings#sources">管理新闻来源</Link><Link to="/chain#packages">管理产业主题</Link><Link to="/settings#model">模型与自动同步设置</Link></div></section>
    {result.loading && !result.data && <Loading label="正在读取更新进度…" />}<ErrorBox message={result.error} retry={result.reload} />
    {active.length > 0 && <section className="current-updates"><h2>正在处理</h2>{active.map(job => <JobState key={job.id} job={job} />)}</section>}
    {active.length === 0 && completed?.[0] && <section className="current-updates"><h2>最近一次处理</h2><JobState job={completed[0]} /></section>}
    {result.data?.length === 0 && <Empty title="还没有更新记录"><p>选择上方内容开始更新，新闻与公司资料就会陆续出现在阅读页面。</p><Link to="/settings#sources">检查新闻来源</Link></Empty>}
    <details className="progressive-section update-history"><summary>更新与研究历史{sorted?.length ? `（${sorted.length}）` : ''}</summary><div className="table-toolbar"><button type="button" onClick={result.reload} disabled={result.loading}>刷新记录</button><label>状态 <select value={status} onChange={event => setStatus(event.target.value)}><option value="">全部</option><option value="queued">排队中</option><option value="running">进行中</option><option value="succeeded">已完成</option><option value="failed">失败</option></select></label></div>
      {history?.length === 0 && <p className="quiet-empty">此状态暂无记录。</p>}
      {history && history.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label="更新与研究历史表"><table className="jobs-table"><caption className="sr-only">历史状态与处理消息</caption><thead><tr><th scope="col">内容</th><th scope="col">状态</th><th scope="col">处理消息</th><th scope="col">时间</th></tr></thead><tbody>{history.map(job => <tr key={job.id}><th scope="row">{kinds[job.kind] || '数据处理'}{job.subject_label && <p>{job.subject_label}</p>}<ResultLink job={job} /></th><td><Status value={job.status} /></td><td><p>{job.message || '尚未提供处理消息'}</p><progress max="100" value={Math.min(100, Math.max(0, job.progress))} aria-label="历史处理进度" /><span className="muted"> {job.progress}%</span>{job.status === 'failed' && <p><Link to="/settings">检查配置与来源</Link></p>}</td><td className="muted"><p>开始：{dateTime(job.created_at)}</p><p>更新：{dateTime(job.updated_at)}</p></td></tr>)}</tbody></table></div>}<MetaLine meta={result.meta} />
    </details>
  </div>;
}
