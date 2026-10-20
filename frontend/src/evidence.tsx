import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { dateTime } from './api';
import { useApi } from './hooks';
import { ErrorBox, ExternalLink, Loading, MetaLine } from './components';
import type { Article, Evidence } from './types';

type Selection = { id: string; article?: Article };
const EvidenceContext = createContext<(id: string, articles?: Article[]) => void>(() => {});
export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  return <EvidenceContext.Provider value={(id, articles) => setSelection({ id, article: articles?.find(article => article.id === id) })}>
    {children}{selection && <EvidenceDialog key={selection.id} selection={selection} close={() => setSelection(null)} />}
  </EvidenceContext.Provider>;
}
function EvidenceDialog({ selection, close }: { selection: Selection; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const result = useApi<Evidence>(selection.article ? null : `/evidence/${encodeURIComponent(selection.id)}`);
  const article = selection.article;
  const evidence = article ? { id: article.id, title: article.title, excerpt: article.content, url: article.url, published_at: article.published_at, source: article.source } : result.data;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return createPortal(<dialog className="evidence-dialog" ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}>
    <header className="dialog-header"><h2 id={titleId}>证据详情</h2><button type="button" onClick={close} aria-label="关闭证据详情" autoFocus><X size={20} aria-hidden="true" /></button></header>
    <div className="dialog-body">
      <p className="identifier">证据编号：{selection.id}</p>
      {result.loading && <Loading />}
      <ErrorBox message={result.error} retry={result.reload} />
      {evidence && <><h3>{evidence.title}</h3><p className="muted">{evidence.source || '来源未提供'} · 发布：{dateTime(evidence.published_at)}</p>
        {article && <p className="muted">{contentLevel[article.content_level]} · {revisionLabel[article.revision_kind]} · 抓取：{dateTime(article.fetched_at)}（非发布时间）</p>}
        <ExternalLink url={evidence.url}>查看原始来源</ExternalLink>
        <div className="article-content">{evidence.excerpt || '此来源没有提供正文，请查看原始链接。'}</div>
        {article?.content_level !== 'full' && article && <p className="message">当前仅有{contentLevel[article.content_level]}，不能视为完整原文。</p>}
      </>}
      <MetaLine meta={result.meta} />
    </div>
  </dialog>, document.body);
}
export const contentLevel = { full: '全文', summary: '摘要', title: '标题' };
export const revisionLabel = { initial: '首次记录', update: '更新', correction: '纠错' };
export function EvidenceRefs({ ids, articles, emptyLabel = '未附证据，不应作为已证实事实' }: { ids: string[]; articles?: Article[]; emptyLabel?: string }) {
  const open = useContext(EvidenceContext);
  return ids.length ? <span className="evidence-refs">{ids.map((id, index) => <button className="evidence-ref" type="button" key={`${id}-${index}`} onClick={() => open(id, articles)} title={`打开证据 ${id}`}>证据 {index + 1}<span className="sr-only">：{id}</span></button>)}</span> : <span className="no-evidence">{emptyLabel}</span>;
}
export function ArticleList({ articles }: { articles: Article[] }) {
  const open = useContext(EvidenceContext);
  return <ol className="article-list">{articles.map(article => <li key={article.id}>
    <div className="row-between"><span className="muted">{article.source} · {contentLevel[article.content_level]}</span><span className={article.revision_kind === 'correction' ? 'warning-text' : 'muted'}>{revisionLabel[article.revision_kind]}</span></div>
    <button className="text-button article-title" type="button" onClick={() => open(article.id, articles)}>{article.title}</button>
    <p className="muted">发布：{dateTime(article.published_at)}</p>
    {article.content && <p className="excerpt">{article.content.slice(0, 240)}{article.content.length > 240 ? '…' : ''}</p>}
    <ExternalLink url={article.url}>原始来源</ExternalLink>
  </li>)}</ol>;
}
