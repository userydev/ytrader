import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, RefreshCw, Search } from 'lucide-react';
import { dateTime, post, safeUrl } from './api';
import { useAction, useApi } from './hooks';
import type { Job, Meta } from './types';

export function ExternalLink({ url, children }: { url: string | null | undefined; children: ReactNode }) {
  const href = safeUrl(url);
  return href ? <a className="external-link" href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={13} aria-hidden="true" /><span className="sr-only">（新窗口）</span></a> : <span className="muted">{children}（无有效来源链接）</span>;
}
export function MetaLine({ meta }: { meta?: Meta }) {
  if (!meta) return null;
  return <div className="provenance">
    <span>来源：{meta.source || '未提供'} · 数据时间：{dateTime(meta.as_of)}</span>
    {meta.completeness !== 'complete' && <strong className="warning-text">{meta.completeness === 'partial' ? '数据不完整' : '数据不可用'}</strong>}
    {meta.warnings.length > 0 && <ul className="warnings">{meta.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
  </div>;
}
export function ErrorBox({ message, retry }: { message: string | null; retry?: () => void }) {
  if (!message) return null;
  return <div className="message error" role="alert"><p>{message}</p>{retry && <button type="button" onClick={retry}>重试</button>}</div>;
}
export function Notice({ message }: { message: string | null }) { return message ? <p className="message success" role="status">{message}</p> : null; }
export function Loading({ label = '正在读取数据…' }: { label?: string }) { return <p className="loading" role="status"><RefreshCw size={15} aria-hidden="true" />{label}</p>; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <div>{children}</div>}</div>;
}
export function SearchForm({ initial = '', placeholder, label, onSearch }: { initial?: string; placeholder: string; label: string; onSearch: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  const id = useId();
  function submit(event: FormEvent) { event.preventDefault(); onSearch(value.trim()); }
  return <form className="search-form" role="search" onSubmit={submit}>
    <label className="sr-only" htmlFor={id}>{label}</label>
    <input id={id} type="search" value={value} onChange={event => setValue(event.target.value)} placeholder={placeholder} />
    <button type="submit" aria-label={label}><Search size={17} aria-hidden="true" /><span className="sr-only">搜索</span></button>
  </form>;
}
export function SyncButton({ kind, children = '同步数据', onDone }: { kind: 'news' | 'securities' | 'all'; children?: ReactNode; onDone?: () => void }) {
  const action = useAction();
  const [job, setJob] = useState<Job | null>(null);
  const active = job?.status === 'queued' || job?.status === 'running';
  return <div className="sync-action">
    <button type="button" disabled={action.busy || active} onClick={() => void action.run(async () => {
      const response = await post<Job>('/sync', { kind });
      setJob(response.data);
    })}><RefreshCw size={15} aria-hidden="true" />{action.busy ? '正在提交…' : active ? '同步进行中…' : children}</button>
    <ErrorBox message={action.error} />{job && <JobProgress job={job} onFinish={finished => { setJob(finished); onDone?.(); }} />}
  </div>;
}
export function JobProgress({ job, onFinish }: { job: Job; onFinish?: (job: Job) => void }) {
  const active = job.status === 'queued' || job.status === 'running';
  const result = useApi<Job[]>(active ? '/jobs' : null, 3000);
  const current = result.data?.find(item => item.id === job.id) || job;
  const finished = current.status === 'succeeded' || current.status === 'failed';
  const notified = useRef('');
  const callback = useRef(onFinish); callback.current = onFinish;
  useEffect(() => {
    if (finished && notified.current !== current.id) { notified.current = current.id; callback.current?.(current); }
  }, [finished, current]);
  return <div className={`job-progress ${current.status === 'failed' ? 'job-failed' : ''}`} role="status"><div><Status value={current.status} /> <span>{current.message || (finished ? current.status === 'failed' ? '任务失败，请检查配置与来源。' : '任务已完成。' : '任务正在服务端执行…')}</span></div>{!finished && <><progress max="100" value={Math.min(100, Math.max(0, current.progress))} aria-label="任务进度" /><span> {current.progress}%</span></>}<ErrorBox message={result.error} retry={result.reload} /></div>;
}
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="header-actions">{children}</div>}</header>;
}
export function ContextReturn() {
  const location = useLocation();
  const state = location.state as { returnTo?: unknown; returnLabel?: unknown; returnState?: unknown } | null;
  if (typeof state?.returnTo !== 'string' || !/^\/(events|securities|chain)(\/|\?|$)/.test(state.returnTo)) return null;
  return <Link className="back-link context-return" to={state.returnTo} state={state.returnState}><ArrowLeft size={16} aria-hidden="true" />{typeof state.returnLabel === 'string' ? state.returnLabel : '返回上一研究路径'}</Link>;
}
export function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    complete: '已分析', stale: '分析已陈旧', pending: '待分析', not_analyzed: '未分析', unanalyzed: '未分析', none: '未分析',
    unavailable: '不可用', unconfigured: '未配置', disabled: '已停用', enabled: '已启用', ok: '正常',
    queued: '排队中', running: '进行中', succeeded: '已完成', failed: '失败', listed: '上市', delisted: '退市', unknown: '未知',
    active: '正常', partial: '不完整', error: '异常', idle: '待运行', ready: '就绪', not_configured: '未配置',
    analyzing: '分析中', cached: '缓存报价', delayed: '延迟报价', closed: '收盘报价', live: '源报价',
  };
  return <span className={`status status-${['failed', 'error', 'stale', 'unavailable', 'partial'].includes(value) ? 'warning' : ['complete', 'succeeded', 'ok', 'listed'].includes(value) ? 'ok' : 'neutral'}`}>{labels[value] || value || '未提供'}</span>;
}
