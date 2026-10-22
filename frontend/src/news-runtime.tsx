import { createContext, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { post } from './api';
import { useAction } from './hooks';
import { ErrorBox, JobProgress } from './components';
import type { Job } from './types';

export function newsTime(value: string | null | undefined): string {
  if (!value) return '时间未提供';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间无效';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
export const newsContentLabel = { full: '源提供正文', summary: '来源摘要', title: '仅标题' };

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
