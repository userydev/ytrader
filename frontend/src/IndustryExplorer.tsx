import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ExternalLink } from './components';
import { kindNames, NODE_HEIGHT, NODE_WIDTH, relationNames } from './industryPresentation';
import type { Presentation } from './industryPresentation';
import type { IndustryGraph, IndustryRelation } from './types';

export function IndustrySources({ ids, graph, ai }: { ids: string[]; graph: IndustryGraph; ai: boolean }) {
  if (!ids.length) return <p className="ix-attribution">{ai ? 'AI 一般知识 · 未提供逐项依据' : '编辑范围说明 · 未列逐项来源'}</p>;
  return <details className="ix-sources"><summary>{ai ? 'AI 引用的参考资料（不等于核实）' : '查看公共资料依据'} · {ids.length}</summary><ul>{ids.map(id => {
    const source = graph.sources.find(item => item.id === id);
    return <li key={id}>{source ? <><ExternalLink url={source.url}>{source.title}</ExternalLink><p>{source.publisher} · 资料标注核查日：{source.checked_at || '未提供'}</p><p>{source.locator}</p>{source.access === 'indexed_page_text' && <p>采用公开检索返回的官网正文；直接抓取尚不稳定。</p>}</> : <p>来源 {id} 未包含在本版本资料中。</p>}</li>;
  })}</ul></details>;
}

interface ExplorerProps {
  graph: IndustryGraph; presentation: Presentation; ai: boolean; asking: boolean; onPanel: (asking: boolean) => void; questionPanel: ReactNode;
}
export default function IndustryExplorer({ graph, presentation, ai, asking, onPanel, questionPanel }: ExplorerProps) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const uid = useId().replace(/:/g, '');
  const focusHeading = useRef<HTMLHeadingElement>(null);
  const explorer = useRef<HTMLDivElement>(null);
  const mapScroll = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const companies = new Map(graph.companies.map(company => [company.id, company]));
  const view = params.get('industry_view') === 'company' ? 'company' : 'node';
  const companyId = params.get('industry_company') || graph.companies[0]?.id || '';
  const company = companies.get(companyId);
  const marked = new Set(view === 'company' && company ? graph.participations.filter(item => item.company_id === company.id).map(item => item.node_id) : []);
  const relation = graph.relations.find(item => item.id === params.get('industry_relation'));
  const node = relation ? undefined : nodes.get(params.get('industry_node') || '') || graph.nodes[0];
  const returnState = { returnTo: `${location.pathname}${location.search}`, returnLabel: '返回产业探索', returnState: location.state };
  const nodeName = (id: string) => nodes.get(id)?.name || `未包含的环节（${id}）`;
  function update(values: Record<string, string | null>) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values)) { if (value === null) next.delete(key); else next.set(key, value); }
      return next;
    }, { replace: true });
  }
  function inspectNode(id: string) { update({ industry_node: id, industry_relation: null }); showFocus(); }
  function inspectRelation(id: string) { update({ industry_relation: id, industry_node: null }); showFocus(); }
  function chooseCompany(id: string) {
    const participation = graph.participations.find(item => item.company_id === id && nodes.has(item.node_id));
    update({ industry_company: id, industry_view: 'company', industry_node: participation?.node_id || null, industry_relation: null });
    onPanel(false);
    showMap();
  }
  function companyName(id: string) {
    const item = companies.get(id);
    if (!item) return <span>本版本未包含公司信息（{id}）</span>;
    return item.symbol ? <Link to={`/securities/${encodeURIComponent(item.symbol)}`} state={returnState}>{item.name}</Link> : <span>{item.name}</span>;
  }
  function roleList(ids: string[]) {
    const roles = graph.participations.filter(item => ids.includes(item.node_id));
    if (!roles.length) return <p className="ix-empty">本版本未列这个位置的公司，不表示没有参与者。</p>;
    return <ul className="ix-roles">{roles.map((role, index) => <li key={`${role.company_id}:${role.node_id}:${index}`} className={view === 'company' && role.company_id === companyId ? 'is-marked' : ''}>
      <div className="ix-role-company">{companyName(role.company_id)}<button type="button" className="text-button" onClick={() => chooseCompany(role.company_id)}>图上定位</button></div>
      <p>{ids.length > 1 && `${nodeName(role.node_id)}：`}{role.role}</p>
      <p className="ix-attribution">{ai ? 'AI 建议角色 · 未独立核查' : '公共资料中的角色样例'}{companies.get(role.company_id)?.identity_note && ` · ${companies.get(role.company_id)!.identity_note}`}{!companies.get(role.company_id)?.symbol && ' · 无证券档案链接'}</p>
      <IndustrySources ids={role.sources} graph={graph} ai={ai} />
    </li>)}</ul>;
  }
  function relationButton(edge: IndustryRelation) {
    return <button type="button" className="ix-connection-button" onClick={() => inspectRelation(edge.id)} aria-pressed={relation?.id === edge.id}>
      <span>{nodeName(edge.from_id)}</span><span className={`ix-relation-word ${edge.kind}`}>{relationNames[edge.kind]} →</span><span>{nodeName(edge.to_id)}</span>
    </button>;
  }
  function isStacked() { return (explorer.current?.clientWidth || 0) < 1060; }
  function showFocus() {
    onPanel(false);
    window.setTimeout(() => {
      focusHeading.current?.focus({ preventScroll: true });
      if (isStacked()) inspector.current?.scrollIntoView({ block: 'start', inline: 'nearest' });
      else inspector.current?.scrollTo({ top: 0 });
    }, 0);
  }
  function showMap() {
    window.setTimeout(() => {
      const map = mapScroll.current;
      if (!map) return;
      const target = map.querySelector<HTMLButtonElement>('.ix-node.is-selected, .ix-edge-label.is-selected');
      (target || map).focus({ preventScroll: true });
      if (target) map.scrollTo({ left: target.offsetLeft - (map.clientWidth - target.offsetWidth) / 2, top: target.offsetTop - (map.clientHeight - target.offsetHeight) / 2 });
      if (isStacked()) map.scrollIntoView({ block: 'start', inline: 'nearest' });
    }, 0);
  }
  return <div ref={explorer} className={`ix-explorer ${ai ? 'ix-ai' : ''}`}>
    <div className="ix-map-tools">
      <div className="ix-view-switch" role="group" aria-label="图的视角"><button type="button" aria-pressed={view === 'node'} onClick={() => update({ industry_view: null, industry_company: null })}>环节视角</button><button type="button" aria-pressed={view === 'company'} onClick={() => { update({ industry_view: 'company' }); onPanel(false); }}>公司位置</button></div>
      {view === 'company' && <label className="ix-company-select">定位公司<select value={company?.id || ''} onChange={event => chooseCompany(event.target.value)}><option value="" disabled>选择本版本参与者</option>{graph.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <button className="text-button ix-focus-jump" type="button" onClick={showFocus} title="将焦点移到详情区域">{relation ? `关系：${relationNames[relation.kind]}` : `焦点：${node?.name || '未选择'}`} · 详情 ↓</button>
    </div>
    {view === 'company' && <div className="ix-company-context">{company ? <><strong>{companyName(company.id)}</strong><span>高亮 {marked.size} 个参与位置；点环节看具体角色。</span><div className="ix-company-positions">{[...marked].map(id => <button key={id} type="button" className="text-button" onClick={() => inspectNode(id)} disabled={!nodes.has(id)} aria-pressed={node?.id === id}>{nodeName(id)} →</button>)}</div><p>{company.identity_note || '身份范围未另作说明'} · 位置不表示公司间交易或业务权重。</p>{!marked.size && <p>本版本未列该公司的参与位置。</p>}</> : <p>本版本没有可定位的公司；可以继续提问。</p>}</div>}
    <div className="ix-workspace">
      <section className="ix-map-column" aria-label="产业语义关系图">
        <div className="ix-map-heading"><h2>结构与分工</h2><span>{graph.nodes.length} 个环节 · {graph.relations.length} 条关系</span></div>
        <p className="ix-map-note" id={`${uid}-map-help`}>{presentation.note} 点环节或关系标签查看详情。</p>
        <p className="ix-scroll-hint">图内可左右滚动查看更多环节。</p>
        <div ref={mapScroll} className="ix-map-scroll" tabIndex={0} role="region" aria-label="产业关系图，可局部横向和纵向滚动" aria-describedby={`${uid}-map-help`}>
          <div className="ix-canvas" style={{ width: presentation.width, height: presentation.height }}>
            <svg width={presentation.width} height={presentation.height} aria-hidden="true" className="ix-wires">
              <defs>{Object.keys(relationNames).map(kind => <marker key={kind} id={`${uid}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" className={`ix-arrow ${kind}`} /></marker>)}</defs>
              {presentation.edges.map(edge => {
                const data = graph.relations.find(item => item.id === edge.id)!;
                const related = relation?.id === data.id || (!relation && node && (data.from_id === node.id || data.to_id === node.id));
                return <path key={edge.id} d={edge.path} className={`ix-wire ${data.kind} ${related ? 'is-related' : ''}`} markerEnd={`url(#${uid}-${data.kind})`} />;
              })}
            </svg>
            {presentation.captions.map((caption, index) => <span key={index} className="ix-lane-caption" style={{ left: caption.x, top: caption.y }}>{caption.text}</span>)}
            {graph.nodes.map(item => {
              const point = presentation.positions.get(item.id)!;
              const copy = presentation.copy[item.id];
              const selected = node?.id === item.id;
              const adjacent = relation && (relation.from_id === item.id || relation.to_id === item.id);
              return <button key={item.id} type="button" style={{ left: point.x, top: point.y, width: NODE_WIDTH, height: NODE_HEIGHT }} className={`ix-node ${selected ? 'is-selected' : ''} ${adjacent ? 'is-adjacent' : ''} ${view === 'company' && company ? marked.has(item.id) ? 'is-marked' : 'is-unmarked' : ''}`} aria-pressed={selected} aria-label={`${item.name}：${copy?.purpose || item.description}${marked.has(item.id) ? `；${company?.name}参与` : ''}，查看作用、连接和公司`} aria-controls={`${uid}-inspector`} title={`${item.name}：${item.description}`} onClick={() => inspectNode(item.id)}>
                <strong>{copy?.title || item.name}</strong><span>{copy?.purpose || item.description}</span>{marked.has(item.id) && <i className="ix-company-dot" aria-hidden="true" />}
              </button>;
            })}
            {presentation.edges.map(edge => {
              const data = graph.relations.find(item => item.id === edge.id)!;
              return <button key={edge.id} type="button" className={`ix-edge-label ${data.kind} ${relation?.id === data.id ? 'is-selected' : ''}`} style={{ left: edge.label.x, top: edge.label.y }} onClick={() => inspectRelation(data.id)} aria-label={`${nodeName(data.from_id)}，${relationNames[data.kind]}，${nodeName(data.to_id)}，查看关系解释和依据`} aria-pressed={relation?.id === data.id} aria-controls={`${uid}-inspector`} title={data.explanation}>{relationNames[data.kind]}</button>;
            })}
          </div>
        </div>
        {!graph.nodes.length && <p className="ix-empty">本版本没有环节数据，可在继续提问中请求展开结构。</p>}
        <div className="ix-legend" aria-label="关系含义">{Object.entries(relationNames).filter(([kind]) => graph.relations.some(edge => edge.kind === kind)).map(([kind, label]) => <span key={kind} className={kind}><i aria-hidden="true" />{label}</span>)}<span>箭头沿资料中的连接方向</span></div>
        <details className="ix-index"><summary>全部环节与关系入口（{graph.nodes.length} / {graph.relations.length}）</summary><p className="ix-map-note">也可以从这里选择图中的环节与连接。</p><div className="ix-node-index">{graph.nodes.map(item => <button type="button" key={item.id} onClick={() => inspectNode(item.id)} aria-pressed={node?.id === item.id}>{item.name}</button>)}</div><ul className="ix-connection-index">{graph.relations.map(edge => <li key={edge.id}>{relationButton(edge)}</li>)}</ul></details>
      </section>
      <aside ref={inspector} className="ix-inspector" id={`${uid}-inspector`} aria-label="焦点详情与继续提问">
        <div className="ix-panel-switch" role="group" aria-label="详情区域"><button type="button" aria-pressed={!asking} onClick={() => onPanel(false)}>焦点详情</button><button type="button" aria-pressed={asking} onClick={() => onPanel(true)}>继续提问</button></div>
        <div hidden={asking} className="ix-focus-content">
          <button type="button" className="text-button ix-map-return" onClick={showMap}>↑ 返回结构图</button>
          <p className="sr-only" aria-live="polite">{relation ? `已选关系：${nodeName(relation.from_id)} ${relationNames[relation.kind]} ${nodeName(relation.to_id)}` : node ? `已选环节：${node.name}` : '未选择环节'}</p>
          <p className="ix-eyebrow">{relation ? '连接含义' : '当前环节'} · {ai ? 'AI 未核查' : '公共资料参考'}</p>
          <h2 ref={focusHeading} tabIndex={-1}>{relation ? `${nodeName(relation.from_id)} → ${nodeName(relation.to_id)}` : node?.name || '选择图中环节'}</h2>
          {node && <><h3>它做什么</h3><p><span className="ix-kind">{kindNames[node.kind]}</span>{node.description}</p><IndustrySources ids={node.sources} graph={graph} ai={ai} /><h3>与哪些环节相连</h3><ul className="ix-neighbours">{graph.relations.filter(edge => edge.from_id === node.id || edge.to_id === node.id).map(edge => {
            const other = edge.from_id === node.id ? edge.to_id : edge.from_id;
            return <li key={edge.id}>{relationButton(edge)}<button type="button" className="text-button" disabled={!nodes.has(other)} onClick={() => inspectNode(other)}>转到{nodeName(other)} →</button></li>;
          })}</ul>{!graph.relations.some(edge => edge.from_id === node.id || edge.to_id === node.id) && <p className="ix-empty">本版本未列相邻关系；保留为独立环节。</p>}<h3>谁在参与</h3>{roleList([node.id])}</>}
          {relation && <><p className={`ix-relation-kind ${relation.kind}`}>{relationNames[relation.kind]}</p><p>{relation.explanation}</p>{relation.kind === 'precedes' && <p className="ix-caution">流程先后不表示必然推进、成功或获批。</p>}<IndustrySources ids={relation.sources} graph={graph} ai={ai} /><h3>继续探索两端</h3><div className="ix-endpoints">{[...new Set([relation.from_id, relation.to_id])].map(id => <button type="button" key={id} onClick={() => inspectNode(id)} disabled={!nodes.has(id)}>{nodeName(id)} →</button>)}</div><h3>两端的公司角色</h3>{roleList([relation.from_id, relation.to_id])}<p className="ix-attribution">参与同一结构，不证明公司之间存在交易。</p></>}
        </div>
        <div hidden={!asking} className="ix-question-content">{questionPanel}</div>
      </aside>
    </div>
    <section className="ix-reference-drawer" aria-label="按需阅读的解释与资料">
      <details><summary>完整解释、边界与区别</summary><div className="ix-longform"><h2>满足什么需求</h2><p>{graph.industry.demand}</p><h3>本版本边界</h3><p>{graph.industry.boundary}</p><h3>整体机制</h3><p>{graph.explanation.overview}</p>{graph.industry.summary && <p>{graph.industry.summary}</p>}{graph.explanation.steps.map((step, index) => <section key={index}><h3>{step.title}</h3><p>{step.text}</p><div className="ix-text-node-links">{step.node_ids.map(id => <button type="button" className="text-button" key={id} disabled={!nodes.has(id)} onClick={() => inspectNode(id)}>{nodeName(id)} →</button>)}</div><IndustrySources ids={step.sources} graph={graph} ai={ai} /></section>)}<h2>理解时要分清</h2>{graph.explanation.distinctions.map((item, index) => <section key={index}><h3>{item.title}</h3><p>{item.text}</p><IndustrySources ids={item.sources} graph={graph} ai={ai} /></section>)}</div></details>
      <details><summary>覆盖缺口 · {graph.explanation.gaps.length} 项</summary><ul>{graph.explanation.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>{!graph.explanation.gaps.length && <p className="ix-map-note">未列覆盖缺口，不代表已全覆盖。</p>}</details>
      <details><summary>{ai ? 'AI 参考资料与版本（不升级为公共事实）' : '公共来源与编辑版本'}</summary><p className="ix-attribution">{ai ? 'AI 生成的解释、关系与参与角色未经独立核查。引用资料不改变其 AI 属性。' : '公共参考是限定范围的编辑整理，不代表全产业覆盖。'} · 结构版本：{graph.version || '随基础资料'}</p><IndustrySources ids={graph.sources.map(source => source.id)} graph={graph} ai={ai} /></details>
    </section>
  </div>;
}
