import { Link, useLocation } from 'react-router-dom';
import { query } from './api';
import { useApi } from './hooks';
import { ErrorBox, Loading } from './components';
import { EvidenceRefs } from './evidence';
import type { ChainTopic, ChainTopics } from './types';

export function TopicList({ items, eventId = '' }: { items: ChainTopic[]; eventId?: string }) {
  const location = useLocation();
  return <ul className="topic-list">{items.map(topic => <li key={topic.id}>
    <Link className="topic-entry" to={`/chain${query({ topic_id: topic.id, event_id: eventId })}`} state={{ returnTo: `${location.pathname}${location.search}`, returnLabel: eventId && location.pathname.startsWith('/events') ? '返回新闻阅读' : location.pathname.startsWith('/securities') ? '返回公司档案' : '返回产业主题', returnState: location.state }}>
      <h3>{topic.name}<span aria-hidden="true"> →</span></h3>
      <p>{topic.matched_by.length ? topic.matched_by.slice(0, 2).map(reason => reason.length > 44 ? `${reason.slice(0, 44)}…` : reason).join('；') : topic.description || '查看已收录的产品、环节与公司'}</p>
    </Link>
    {(topic.matched_by.length > 0 || topic.evidence_ids.length > 0) && <details className="topic-evidence"><summary>关联依据</summary>{topic.matched_by.length > 0 && <ul>{topic.matched_by.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}{topic.evidence_ids.length > 0 && <EvidenceRefs ids={topic.evidence_ids} />}</details>}
  </li>)}</ul>;
}
export default function RelatedTopics({ eventId, symbol }: { eventId?: string; symbol?: string }) {
  const result = useApi<ChainTopics>(`/chain/topics${query({ event_id: eventId, symbol })}`);
  return <section id={symbol ? 'company-topics' : undefined} className="related-topics" aria-label="相关产业">
    <h2>相关产业</h2>
    {result.loading && !result.data && <Loading label="正在查找相关产业…" />}
    <ErrorBox message={result.error ? `相关产业暂不可用：${result.error} 当前服务需支持产业主题接口。` : null} retry={result.reload} />
    {result.data && (result.data.items.length ? <><TopicList items={result.data.items} eventId={eventId} /><p className="section-note">关联是理解业务的入口，不代表受益或供应关系。</p></> : <p className="quiet-empty">{eventId ? '这条新闻暂未关联已收录的产业主题，可继续阅读来源。' : '暂无其他产业关联资料。'} <Link to="/chain">浏览产业</Link></p>)}
  </section>;
}
