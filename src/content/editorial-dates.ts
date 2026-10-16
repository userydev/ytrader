import type { EditorialEvent } from './editorial-types';
export function editorialTime(value:string|null) {
  if(!value || !Number.isFinite(Date.parse(value))) return '未知';
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value.replaceAll('-','/')}（时刻未提供）`;
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
}
type DatedEvent=Pick<EditorialEvent,'source_published_at'|'discovered_at'> & {draft?:Pick<EditorialEvent['draft'],'group'>};
export function eventPeriod(event:DatedEvent,now=Date.now()):'recent'|'undated'|'historical' {
  const occurred=event.draft?.group.occurred_on;
  if(occurred && Date.parse(occurred)<now-7*86400000)return 'historical';
  if(!event.source_published_at || Date.parse(event.source_published_at)>now)return 'undated';
  return Date.parse(event.source_published_at)<now-7*86400000?'historical':'recent';
}
export function dateLabel(event:DatedEvent,now=Date.now()) {
  const historical=eventPeriod(event,now)==='historical';
  if(!event.source_published_at)return `${historical?'历史背景 · ':''}发布时间未知 · 发现于 ${editorialTime(event.discovered_at)}`;
  return `${Date.parse(event.source_published_at)>now?'来源日期待核实':historical?'历史背景':'近期报道'} · 发布于 ${editorialTime(event.source_published_at)}`;
}
