import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { isIOS } from '../vault';
import type { EditorialCitation, EditorialDetail, EditorialEvent, EditorialFeed, EditorialFollow, EditorialSource, EditorialStatement, EditorialStatus } from './editorial-types';
import './editorial.css';
import { editorialTime as time, dateLabel, eventPeriod } from './editorial-dates';
import { EventChainSection } from './ChainAndStrategyView';
const enc=encodeURIComponent;
const eventHref=(id:string)=>`#/events/${enc(id)}`;
const companyHref=(code:string,event:string)=>`#/companies/${enc(code)}?from=${enc(event)}`;
function Resource<T>({path,children}:{path:string;children:(data:T)=>ReactNode}) {
  const [state,setState]=useState<{data?:T;error?:string;loading:boolean}>({loading:true});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;setState({loading:true});void api<T>(`/content/editorial${path}`).then(data=>{if(active)setState({data,loading:false});},error=>{if(active)setState({error:error.message ?? '读取失败',loading:false});});return()=>{active=false;};},[path,retry]);
  useEffect(()=>{if(state.loading)return;const frame=requestAnimationFrame(()=>{document.querySelector<HTMLElement>('#content h1')?.focus({preventScroll:true});});return()=>cancelAnimationFrame(frame);},[state.loading]);
  return <>{state.loading && <p role="status" className="cr-meta">正在读取事件与证据…</p>}{state.error && <div role="alert" className="cr-notice cr-error"><p>{state.error}</p><button onClick={()=>setRetry(n=>n+1)}>重试</button></div>}{state.data && children(state.data)}</>;
}
export function FollowButton({kind,target,initial,onChange}:{kind:'event'|'company';target:string;initial?:boolean;onChange?:()=>void}) {
  const [following,setFollowing]=useState(initial ?? false);const [busy,setBusy]=useState(initial===undefined);const [error,setError]=useState('');
  useEffect(()=>{
    if(initial!==undefined) {setFollowing(initial);setBusy(false);return;}
    let active=true;
    void api<{items:EditorialFollow[]}>('/content/editorial/follows').then(data=>{if(active){setFollowing(data.items.some(f=>f.kind===kind && f.target===target));setBusy(false);}},()=>{if(active){setBusy(false);setError('关注状态未能读取，请重试。');}});
    return()=>{active=false;};
  },[kind,target,initial]);
  async function toggle(){setBusy(true);setError('');try{await api('/content/editorial/follows','PUT',{kind,target,following:!following});setFollowing(!following);onChange?.();}catch{setError('未能保存关注，请联网重试。');}finally{setBusy(false);}}
  return <span className="ed-follow"><button aria-pressed={following} disabled={busy} onClick={()=>void toggle()}>{busy?'保存/读取中…':following?'已关注 · 取消':'关注'+(kind==='event'?'事件':'公司')}</button>{error && <span role="alert" className="cr-error">{error}</span>}</span>;
}
function OriginalLink({url}:{url:string|null}) {
  const [error,setError]=useState('');
  if(!url || !/^https?:\/\//i.test(url))return <span>原文链接未提供</span>;
  try { const parsed=new URL(url);if(parsed.username || parsed.password)return <span>原文链接不可用</span>; }catch{return <span>原文链接不可用</span>;}
  return <><a href={url} target="_blank" rel="noopener noreferrer" onClick={e=>{if(!isIOS)return;e.preventDefault();void import('@capacitor/browser').then(({Browser})=>Browser.open({url,presentationStyle:'fullscreen'})).catch(()=>setError('原文打开失败，请重试。'));}}>原始链接 ↗</a>{error && <span role="alert">{error}</span>}</>;
}
function Citations({citations,sources}:{citations:EditorialCitation[];sources:EditorialSource[]}) {
  return <details className="cr-evidence"><summary>展开原文依据（{citations.length}）</summary><ul>{citations.map((c,i)=>{const s=sources.find(s=>s.key===c.source);return <li key={`${c.source}-${i}`}>{s ? <><strong>{s.title}</strong><p className="cr-meta">{s.provider} · {s.primary?'原始来源':'供应商/转述材料'} · 来源第{s.item_version}版<br/>来源发布 {time(s.published_at)} · 首次发现 {time(s.discovered_at)}</p><blockquote>{c.quote}</blockquote><OriginalLink url={s.url}/><p className="cr-meta">不可变引用：{s.item_id}@{s.item_version}</p></>:<p>本条依据暂不可用。</p>}</li>;})}</ul></details>;
}
function Statement({value,sources}:{value:EditorialStatement;sources:EditorialSource[]}) {return <><p>{value.text}</p><Citations citations={value.citations} sources={sources}/></>;}
const gateLabel:Record<string,string>={MODEL_DISABLED:'自动分析尚未启用，已完成内容仍可阅读。',MODEL_POLICY_UNSUPPORTED:'分析服务配置待核验，暂不生成新文章。',MODEL_NOT_CONFIGURED:'模型服务未配置；分析等待中。',BUDGET_EXHAUSTED:'新的分析暂停，已完成内容仍可阅读。',BUDGET_POLICY_UNVERIFIED:'额度政策未核验，新的分析暂停。',BUDGET_UNAVAILABLE:'额度暂不可核验，新的分析暂停。'};
function BriefStatus({status}:{status:EditorialStatus}) {
  const waiting=status.jobs.filter(j=>['queued','sending','inflight','unknown'].includes(j.status)).reduce((n,j)=>n+j.count,0);
  return <div className="ed-status"><p className="cr-meta">{status.sync.status==='ok'?'来源快照已同步':status.sync.status==='partial'?'来源仅部分同步':status.sync.status==='source_error'?'来源暂不可用，无法确认有无新变化':'来源尚待同步'}{status.sync.last_success_at && ` · 最近成功 ${time(status.sync.last_success_at)}`} · <a href="#/editorial-status">来源与分析状态</a></p>{status.model.gate && <p className="cr-pending">{gateLabel[status.model.gate] ?? '分析暂缓，等待核验。'}</p>}{waiting>0 && <p className="cr-meta">{waiting} 项{status.model.gate?'待分析':'正在分析'}。</p>}</div>;
}
function EventList({items}:{items:EditorialEvent[]}) {
  return <ol className="ed-list">{items.map(e=><li key={e.id}><p className="cr-meta">{e.draft.priority==='important'?'重点变化':'观察中'} · {dateLabel(e)}{e.version>1 && ` · 第${e.version}版`}{e.unread && <span className="ed-new"> · {e.version>1?'有新证据':'未读'}</span>}</p><h2><a href={eventHref(e.id)}>{e.draft.headline}</a></h2><p className="ed-change">{e.draft.change.text}</p><p className="ed-why"><span>为什么重要　</span>{e.draft.why.text}</p>{e.version>1 && <p className="cr-meta">本版变化：{e.draft.revision_summary}</p>}<div className="ed-row"><a href={eventHref(e.id)}>阅读全文与依据 →</a><FollowButton kind="event" target={e.id} initial={e.followed}/></div></li>)}</ol>;
}
function Feed({following=false}:{following?:boolean}) {
  const [offset,setOffset]=useState(0);
  return <Resource<EditorialFeed> path={`/feed?following=${following}&offset=${offset}`}>{data=>{
    const recent=data.items.filter(e=>eventPeriod(e)==='recent');
    const undated=data.items.filter(e=>eventPeriod(e)==='undated');
    const old=data.items.filter(e=>eventPeriod(e)==='historical');
    return <><BriefStatus status={data.status}/>{!data.items.length && <div className="ed-empty"><h2>{following?'关注范围内暂无可读事件':'暂无已完成的事件解读'}</h2><p>{following?'关注事件或公司后，相关已发布文章会集中在这里。':'新内容准备好后会显示在这里，也可以先回看已收录的新闻。'}</p><a href={following?'#/':'#/news'}>{following?'返回简报，选择关注 →':'回查已收录的原始新闻 →'}</a></div>}
      {data.unavailable_count>0 && <p className="cr-notice">{data.unavailable_count} 篇文章的来源暂时不可用，恢复后可继续阅读。</p>}
      {recent.length>0 && <><h2 className="ed-section-title">近期变化</h2><EventList items={recent}/></>}
      {undated.length>0 && <section><h2>新发现 · 发布时间待核实</h2><p className="cr-meta">发现时间不代表事件发生时间。片段内的明确日期仅在详情单独列示。</p><EventList items={undated}/></section>}
      {old.length>0 && <section><h2>历史背景 · 不作今日新事件</h2><EventList items={old}/></section>}
      <div className="ed-row">{offset>0 && <button onClick={()=>setOffset(Math.max(0,offset-12))}>上一页</button>}{data.has_more && <button onClick={()=>setOffset(data.next_offset ?? offset+12)}>更多解读</button>}</div></>;
  }}</Resource>;
}
export function EditorialHome(){return <div className="ed-reading"><p className="cr-meta">ytrader / 事件简报</p><h1 tabIndex={-1}>看清变化，读懂影响。</h1><p className="ed-deck">从来源里的一个变化出发，辨认真实业务联系，以及下一步需要的证据。</p><Feed/></div>;}
export function EditorialFollowing(){const [refresh,setRefresh]=useState(0);return <div className="ed-reading"><h1 tabIndex={-1}>我的关注</h1><p>事件的新证据，以及关注公司相关的经营变化。</p><Resource<{items:EditorialFollow[]}> key={refresh} path="/follows">{data=><details className="cr-evidence"><summary>管理关注（{data.items.length}）</summary><ul>{data.items.map(f=><li key={`${f.kind}:${f.target}`}><a href={f.kind==='event'?eventHref(f.target):`#/companies/${enc(f.target)}`}>{f.name}</a> <FollowButton kind={f.kind} target={f.target} initial onChange={()=>setRefresh(n=>n+1)}/></li>)}</ul></details>}</Resource><Feed key={`feed-${refresh}`} following/></div>;}
function ReadReceipt({event}:{event:EditorialEvent}) {
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;void api(`/content/editorial/events/${enc(event.id)}/read`,'PUT',{version:event.version}).catch(()=>{if(active)setError('已读记录未保存；联网后重新读取可重试。');});return()=>{active=false;};},[event.id,event.version]);
  return error?<p role="status" className="cr-pending">{error}</p>:null;
}
export function EditorialArticle({id}:{id:string}) {
  return <div className="ed-reading"><p><a href="#/">← 返回事件简报</a> · <a href="#/following">我的关注</a> · <a href="#/strategies">策略与指标库</a></p><Resource<EditorialDetail> path={`/events/${enc(id)}`}>{({event:e,history})=><article className="ed-article"><h1 tabIndex={-1}>{e.draft.headline}</h1><p className="cr-meta">{dateLabel(e)}（北京时间）<br/>事件发生日期：{e.draft.group.occurred_on ?? '未能核实'} · 编辑第{e.version}版 · 生成于 {time(e.published_at)}</p><FollowButton kind="event" target={e.id} initial={e.followed}/><ReadReceipt event={e}/>
    <section><h2>来源报道</h2><div className="ed-fact"><Statement value={e.draft.change} sources={e.sources}/></div>{e.draft.facts.map((f,i)=><div className="ed-fact-detail" key={i}><Statement value={f} sources={e.sources}/></div>)}</section>
    <EventChainSection eventId={e.id}/>
    <section><h2>条件分析</h2><div className="ed-inference"><Statement value={e.draft.why} sources={e.sources}/></div><ol className="ed-transmission">{e.draft.transmission.map((t,i)=><li key={i}><h3>{t.stage}</h3><Statement value={t.mechanism} sources={e.sources}/></li>)}</ol></section>
    <section><h2>公司影响</h2>{!e.draft.companies.length && <p>{e.draft.missing_evidence[0] ?? '暂缺相关公司的具体业务与敞口资料，本次只讨论产业影响。'}</p>}{e.draft.companies.map(c=><div className="ed-company" key={c.code}><h3><a href={companyHref(c.code,e.id)}>{c.name} <span className="cr-meta">{c.code}</span> · 个股策略分析与资料 →</a></h3><FollowButton kind="company" target={c.code}/><h4>业务联系</h4><Statement value={c.business} sources={e.sources}/><div className="ed-inference"><p className="cr-meta">影响条件</p><p>{c.impact}</p><h4>反向作用</h4><p>{c.counterforce}</p><h4>仍未知的经营暴露</h4><p>{c.unknown_exposure}</p></div></div>)}</section>
    <section><h2>后续信号</h2><ol>{e.draft.next_signals.map((s,i)=><li key={i}><h3>{s.signal}</h3><p>{s.interpretation}</p><Citations citations={s.citations} sources={e.sources}/></li>)}</ol></section>
    <section><h2>反向情景与缺口</h2><p>{e.draft.countercase}</p>{e.draft.missing_evidence.length>0 && <><h3>当前证据缺口</h3><ul>{e.draft.missing_evidence.map((m,i)=><li key={i}>{m}</li>)}</ul></>}</section>
    <details className="cr-evidence"><summary>为何关注 · 更新记录</summary><p>{e.draft.priority_reason}</p><ol>{history.map(v=><li key={v.version}>第{v.version}版 · {time(v.published_at)}<p>{v.summary}</p></li>)}</ol></details>
    <details className="cr-evidence"><summary>全部来源（含合并报道，{e.sources.length}）</summary><ul>{e.sources.map(s=><li key={s.key}><strong>{s.title}</strong><p className="cr-meta">{s.provider} · 发布 {time(s.published_at)} · 来源第{s.item_version}版</p><OriginalLink url={s.url}/></li>)}</ul></details>
  </article>}</Resource></div>;
}
export function EditorialSystem(){return <div className="ed-reading"><h1 tabIndex={-1}>来源与分析状态</h1><Resource<EditorialStatus> path="/status">{s=><><BriefStatus status={s}/><p>AI 仅通过 ycore 网关生成。统一硬限额为每日 $1、每月 $10；未知调用预留保留，不自动重发不确定请求。</p><h2>持久任务</h2><ul>{s.jobs.map((j,i)=><li key={i}>{({queued:'等待生成',sending:'正在提交',inflight:'等待网关结果',unknown:'结果未知，保留原调用',published:'已发布',excluded:'不入选',rejected:'输出未通过格式或逐字引文校验',failed:'调用失败'} as Record<string,string>)[j.status] ?? j.status}：{j.count}{j.error_code && <span className="cr-meta"> · {j.error_code}</span>}</li>)}</ul><p className="cr-meta">报价、引文和结构检查不等于完整语义验证。来源摘要中的宣传与业绩主张仍须回到原始披露核验。</p><h2>来源覆盖</h2>{s.sync.coverage?.length?<ul>{s.sync.coverage.map((v,i)=>{const r=v && typeof v==='object'?v as Record<string,unknown>:{};return <li key={i}>{String(r.source ?? r.name ?? r.provider ?? '来源')} · {String(r.status ?? '状态未知')}</li>;})}</ul>:<p>暂无来源覆盖记录，不代表没有重要事件。</p>}</>}</Resource></div>;}
