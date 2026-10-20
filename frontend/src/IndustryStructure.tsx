import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ExternalLink } from './components';
import { organizationNotes, prepareStructure, relationNames } from './industryStructure';
import type { GroupConnection } from './industryStructure';
import type { IndustryGraph, IndustryGroup, IndustryRelation } from './types';
import './industry-structure.css';

function Sources({ ids, graph, ai }: { ids: string[]; graph: IndustryGraph; ai: boolean }) {
  return ids.length ? <details className="is-sources"><summary>{ai ? '引用参考（不等于核实）' : '资料依据'} · {ids.length}</summary><ul>{ids.map(id => {
    const source = graph.sources.find(item => item.id === id);
    return <li key={id}>{source ? <><ExternalLink url={source.url}>{source.title}</ExternalLink><p>{source.publisher} · 资料标注核查日 {source.checked_at || '未提供'}</p><p>{source.locator}</p>{source.access === 'indexed_page_text' && <p>采用公开检索返回正文，直接抓取尚不稳定。</p>}</> : `本版本未包含来源 ${id}`}</li>;
  })}</ul></details> : <p className="is-meta">{ai ? 'AI 一般知识 · 未提供逐项依据' : '编辑范围说明 · 未列逐项来源'}</p>;
}

type Wire = { link: GroupConnection; path: string; x: number; y: number; label: string };
interface Props { graph: IndustryGraph; ai: boolean; asking: boolean; onPanel: (asking: boolean) => void; questionPanel: ReactNode; highlightNodeIds?: string[] }
export default function IndustryStructure({ graph, ai, asking, onPanel, questionPanel, highlightNodeIds = [] }: Props) {
  const data = useMemo(() => prepareStructure(graph), [graph]);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const uid = `structure-${useId().replace(/:/g, '')}`;
  const focus = useRef<HTMLHeadingElement>(null), inspector = useRef<HTMLElement>(null);
  const map = useRef<HTMLDivElement>(null), elements = useRef(new Map<string, HTMLElement>());
  const [columns, setColumns] = useState(3);
  const [geometry, setGeometry] = useState<{ width: number; height: number; wires: Wire[] }>({ width: 0, height: 0, wires: [] });
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const highlighted = new Set(highlightNodeIds.filter(id => nodes.has(id)));
  const companies = new Map(graph.companies.map(company => [company.id, company]));
  const edge = graph.relations.find(item => item.id === params.get('industry_relation'));
  const node = edge ? undefined : nodes.get(params.get('industry_node') || '');
  const selectedGroup = !edge && !node ? data.byId.get(params.get('industry_group') || '') : undefined;
  const companyId = params.get('industry_company') || '';
  const marked = new Set(graph.participations.filter(role => role.company_id === companyId).map(role => role.node_id));
  const nodeName = (id: string) => nodes.get(id)?.name || id;
  const returnState = { returnTo: `${location.pathname}${location.search}`, returnLabel: '返回产业结构', returnState: location.state };
  const level = new Map(data.rows.flatMap((row, i) => row.core.map(group => [group.id, i] as const)));
  const drawable = (link: GroupConnection) => level.has(link.from) && level.has(link.to)
    && level.get(link.to) === level.get(link.from)! + 1
    && Math.floor(level.get(link.from)! / columns) === Math.floor(level.get(link.to)! / columns);
  const bands: (typeof data.rows)[] = [];
  for (let i = 0; i < data.rows.length; i += columns) bands.push(data.rows.slice(i, i + columns));
  const linkLabel = (link: GroupConnection) => [...new Set(link.edges.map(relation => relationNames[relation.kind]))].join('/');

  useLayoutEffect(() => {
    const root = map.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const count = box.width >= 620 ? 3 : box.width >= 420 ? 2 : 1;
      if (count !== columns) { setColumns(count); return; }
      const wires: Wire[] = [];
      const visible = data.connections.filter(drawable);
      const top = (id: string) => elements.current.get(id)?.getBoundingClientRect().top || 0;
      for (const link of visible) {
        const a = elements.current.get(link.from)?.getBoundingClientRect();
        const b = elements.current.get(link.to)?.getBoundingClientRect();
        if (!a || !b) continue;
        const outgoing = visible.filter(other => other.from === link.from).sort((x, y) => top(x.to) - top(y.to));
        const incoming = visible.filter(other => other.to === link.to).sort((x, y) => top(x.from) - top(y.from));
        const start = { x: a.right - box.left, y: a.top - box.top + a.height * (outgoing.indexOf(link) + 1) / (outgoing.length + 1) };
        const end = { x: b.left - box.left, y: b.top - box.top + b.height * (incoming.indexOf(link) + 1) / (incoming.length + 1) };
        const middle = (start.x + end.x) / 2;
        // All geometry comes from actual modules. Parallel targets fan out in the gap.
        wires.push({ link, path: `M ${start.x} ${start.y} C ${middle} ${start.y}, ${middle} ${end.y}, ${end.x - 3} ${end.y}`,
          x: middle, y: end.y + (start.y - end.y) * 0.16, label: new Set(link.edges.map(relation => relation.kind)).size > 1 ? '多种关系' : linkLabel(link) });
      }
      const next = { width: box.width, height: box.height, wires };
      setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    elements.current.forEach(element => observer.observe(element));
    window.addEventListener('resize', schedule);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); };
  }, [data, columns]);

  function inspect(id: string, kind: 'node' | 'relation' | 'group' = 'node') {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const key of ['industry_relation', 'industry_node', 'industry_group']) next.delete(key);
      next.set(`industry_${kind}`, id);
      return next;
    }, { replace: true });
    onPanel(false);
    window.setTimeout(() => { focus.current?.focus({ preventScroll: true }); inspector.current?.scrollIntoView({ block: 'start' }); }, 0);
  }
  function chooseCompany(id: string) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const key of ['industry_relation', 'industry_node', 'industry_group', 'industry_view']) next.delete(key);
      if (id) {
        next.set('industry_company', id);
        const role = graph.participations.find(item => item.company_id === id);
        if (role) next.set('industry_node', role.node_id);
      } else next.delete('industry_company');
      return next;
    }, { replace: true });
    onPanel(false);
  }
  function companyName(id: string) {
    const company = companies.get(id);
    return company?.symbol ? <Link to={`/securities/${encodeURIComponent(company.symbol)}`} state={returnState}>{company.name}</Link> : <span>{company?.name || id}</span>;
  }
  function edgeDetail(relation: IndustryRelation) {
    return <li key={relation.id}><button type="button" className="is-edge-button" onClick={() => inspect(relation.id, 'relation')} aria-pressed={edge?.id === relation.id}><span>{nodeName(relation.from_id)}</span><b>{relationNames[relation.kind]} →</b><span>{nodeName(relation.to_id)}</span></button><p>{relation.explanation}</p></li>;
  }
  function compactLink(link: GroupConnection, group: IndustryGroup) {
    const outgoing = link.from === group.id;
    const other = data.byId.get(outgoing ? link.to : link.from)!;
    return <button type="button" key={`${link.from}:${link.to}`} className="is-port" onClick={() => inspect(link.edges[0].id, 'relation')} title={`${data.byId.get(link.from)!.title} → ${data.byId.get(link.to)!.title}：${linkLabel(link)}`}>
      <span>{outgoing ? '→' : '←'} {other.title}</span><b>{linkLabel(link)}</b>
    </button>;
  }
  function groupCard(group: IndustryGroup) {
    const touched = data.connections.filter(link => link.from === group.id || link.to === group.id);
    const ports = touched.filter(link => !drawable(link));
    const selected = selectedGroup?.id === group.id || (node && group.node_ids.includes(node.id));
    const short = group.purpose.length > 50 ? `${group.purpose.slice(0, 50)}…` : group.purpose;
    return <article ref={element => { if (element) elements.current.set(group.id, element); else elements.current.delete(group.id); }} id={`${uid}-${group.id}`} className={`is-module is-${group.role} ${selected ? 'is-selected' : ''}${group.node_ids.some(id => highlighted.has(id)) ? ' is-news-module' : ''}`} title={group.node_ids.some(id => highlighted.has(id)) ? `新闻关联环节（规则假设）：${group.node_ids.filter(id => highlighted.has(id)).map(nodeName).join('、')}` : undefined} key={group.id}>
      <button type="button" className="is-module-title" onClick={() => inspect(group.id, 'group')} aria-pressed={Boolean(selected)}>{group.title}</button>
      <p className="is-purpose" title={group.purpose}>{short}</p>
      <div className="is-node-chips">{group.node_ids.slice(0, 2).map(id => <button key={id} type="button" className={`${marked.has(id) ? 'is-marked' : ''}${highlighted.has(id) ? ' is-news-node' : ''}`} title={highlighted.has(id) ? '新闻关联环节（规则假设）' : undefined} onClick={() => inspect(id)}>{nodeName(id)}</button>)}{group.node_ids.length > 2 && <button type="button" className={group.node_ids.slice(2).some(id => highlighted.has(id)) ? 'is-news-node' : undefined} onClick={() => inspect(group.id, 'group')}>+{group.node_ids.length - 2} 环节</button>}</div>
      {marked.size > 0 && group.node_ids.some(id => marked.has(id)) && <span className="is-company-dot">公司参与此组</span>}
      {ports.length > 0 && <div className="is-ports" aria-label="跨层、循环或配套的真实连接">{ports.map(link => compactLink(link, group))}</div>}
      {!touched.length && <span className="is-meta">无组外关系</span>}
    </article>;
  }
  const focusedIds = edge ? [edge.from_id, edge.to_id] : node ? [node.id] : selectedGroup?.node_ids || [];
  const roles = graph.participations.filter(role => focusedIds.includes(role.node_id));
  const neighboring = selectedGroup ? graph.relations.filter(relation => selectedGroup.node_ids.includes(relation.from_id) || selectedGroup.node_ids.includes(relation.to_id))
    : node ? graph.relations.filter(relation => relation.from_id === node.id || relation.to_id === node.id) : [];
  const parallelEdges = edge ? graph.relations.filter(relation => relation.id !== edge.id && data.owner.get(relation.from_id) === data.owner.get(edge.from_id) && data.owner.get(relation.to_id) === data.owner.get(edge.to_id)) : [];
  return <div className="is-reading">
    <section id={`${uid}-top`} className="is-intro" aria-label="产业解释主旨"><p className="is-thesis">{data.structure.thesis}</p><p><strong>需求：</strong>{graph.industry.demand}</p>
      {data.compatibility ? <p className="message warning">{graph.structure_notice || '历史兼容组织：按已有关系归组，未通过新生成结构检查；保留循环与孤立节点，可继续提问重新组织。'}</p> : <p className="is-meta">{organizationNotes[data.structure.organization]} 分组属于{ai ? 'AI 归纳，未核查' : '编辑组织'}，不是新增事实。</p>}
    </section>
    <section className="is-diagram" aria-label="产业主干、分支及配套关系图">
      <div className="is-map-heading"><h2>整体结构</h2><span>{data.groups.length} 组 · {graph.nodes.length} 环节</span></div>
      <p className="is-meta">箭头保留真实关系类型（虚线为支撑）；配套、跨行及循环用双端连接标记。排列不制造先后或交易。点模块看环节与公司。</p>
      <div className="is-map" ref={map}>
        <svg className="is-wires" width={geometry.width} height={geometry.height} aria-label="主干方向与关系类型">
          <defs><marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 1 L 9 5 L 0 9 z" fill="currentColor" /></marker></defs>
          {geometry.wires.map(wire => <g key={`${wire.link.from}:${wire.link.to}`} className={`is-wire ${wire.link.primary ? 'is-primary' : ''} ${wire.link.edges.every(relation => relation.kind === 'supports') ? 'is-support-wire' : ''}`} role="button" tabIndex={0} aria-label={`${data.byId.get(wire.link.from)!.title} ${wire.label} ${data.byId.get(wire.link.to)!.title}，查看真实关系`} onClick={() => inspect(wire.link.edges[0].id, 'relation')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(wire.link.edges[0].id, 'relation'); } }}>
            <path d={wire.path} markerEnd={`url(#${uid}-arrow)`} /><rect x={wire.x - Math.max(22, wire.label.length * 6.7 + 5)} y={wire.y - 12} width={Math.max(44, wire.label.length * 13.4 + 10)} height={24} rx={3} /><text x={wire.x} y={wire.y + 5} textAnchor="middle">{wire.label}</text>
          </g>)}
        </svg>
        {bands.map((band, i) => <div className="is-band" key={i}>
          <div className="is-core-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{band.map(row => <div className="is-rank" key={row.rank}>{row.core.map(groupCard)}</div>)}</div>
        </div>)}
        {data.rows.some(row => row.support.length > 0) && <aside className="is-support-rail" aria-label="配套层，与对应主干的双端标记注明全部真实对象"><span className="is-rail-label">配套 / 服务 · 与主干中的同名标记对应，可跨阶段挂接</span><div>{data.rows.flatMap(row => row.support).map(groupCard)}</div></aside>}
      </div>
      {graph.companies.length > 0 && <label className="is-company-picker">定位参与公司<select value={companies.has(companyId) ? companyId : ''} onChange={event => chooseCompany(event.target.value)}><option value="">全部位置</option>{graph.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
    </section>
    <section className="is-inspector" ref={inspector} aria-label="环节、关系与继续提问">
      <div className="is-panel-tabs"><button type="button" aria-pressed={!asking} onClick={() => onPanel(false)}>结构详情</button><button type="button" aria-pressed={asking} onClick={() => onPanel(true)}>继续提问 / 历史</button><a href={`#${uid}-top`}>返回全貌 ↑</a></div>
      <div hidden={asking}>
        <h2 ref={focus} tabIndex={-1}>{edge ? `${nodeName(edge.from_id)} → ${nodeName(edge.to_id)}` : node?.name || selectedGroup?.title || '点选上方模块、环节或关系'}</h2>
        {selectedGroup && <><p>{selectedGroup.purpose}</p><h3>组内环节</h3><ul className="is-group-nodes">{selectedGroup.node_ids.map(id => <li key={id}><button type="button" className={highlighted.has(id) ? 'is-news-node' : undefined} onClick={() => inspect(id)}>{nodeName(id)} →</button><p>{nodes.get(id)!.description}</p></li>)}</ul></>}
        {node && <><p>{node.description}</p><Sources ids={node.sources} graph={graph} ai={ai} /></>}
        {(node || selectedGroup) && <><h3>真实关系与解释</h3><ul className="is-relations">{neighboring.map(edgeDetail)}</ul>{!neighboring.length && <p>本版本未列相邻关系，保留为独立环节。</p>}</>}
        {edge && <><p><strong>{relationNames[edge.kind]}</strong> · {edge.explanation}</p>{edge.kind === 'precedes' && <p className="is-caution">流程先后不保证推进、成功或批准。</p>}<Sources ids={edge.sources} graph={graph} ai={ai} /><div className="is-endpoints">{[edge.from_id, edge.to_id].map(id => <button type="button" key={id} onClick={() => inspect(id)}>{nodeName(id)} →</button>)}</div>{parallelEdges.length > 0 && <><h3>这两组之间的其他真实关系</h3><ul className="is-relations">{parallelEdges.map(edgeDetail)}</ul></>}</>}
        {focusedIds.length > 0 && <><h3>具体节点上的公司角色</h3>{roles.length ? <ul className="is-roles">{roles.map((role, i) => <li key={`${role.company_id}:${role.node_id}:${i}`}><h4>{companyName(role.company_id)}</h4><p><strong>{nodeName(role.node_id)}</strong>：{role.role}</p><p className="is-meta">{ai ? 'AI 建议角色 · 未独立核查' : '公共资料角色样例'} · {companies.get(role.company_id)?.identity_note}{!companies.get(role.company_id)?.symbol && ' · 未匹配 A 股代码'}</p><Sources ids={role.sources} graph={graph} ai={ai} /></li>)}</ul> : <p>本版本未列该位置的公司，不代表没有参与者。</p>}</>}
      </div>
      <div hidden={!asking}>{questionPanel}</div>
    </section>
    <section className="is-reference" aria-label="解释、范围与来源">
      <details><summary>范围、解释与关键区别</summary><h3>解释边界</h3><p>{graph.industry.boundary}</p><p>{graph.explanation.overview}</p>{graph.explanation.steps.map((step, i) => <section key={i}><h3>{step.title}</h3><p>{step.text}</p><div className="is-endpoints">{step.node_ids.map(id => <button type="button" key={id} onClick={() => inspect(id)}>{nodeName(id)}</button>)}</div><Sources ids={step.sources} graph={graph} ai={ai} /></section>)}{graph.explanation.distinctions.map((item, i) => <section key={i}><h3>{item.title}</h3><p>{item.text}</p><Sources ids={item.sources} graph={graph} ai={ai} /></section>)}</details>
      <details><summary>覆盖缺口 · {graph.explanation.gaps.length}</summary><ul>{graph.explanation.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>
      <details><summary>{ai ? 'AI 参考资料与版本' : '公共来源与编辑版本'}</summary><p>{ai ? 'AI 解释、关系与角色未独立核查，引用不升级为公共事实。' : '公共参考是限定范围的编辑整理，不代表全产业覆盖。'} · 版本 {graph.version || '随基础资料'}</p><Sources ids={graph.sources.map(source => source.id)} graph={graph} ai={ai} /></details>
    </section>
  </div>;
}
