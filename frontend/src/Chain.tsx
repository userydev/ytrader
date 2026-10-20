import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { dateTime, post, query, safeUrl } from './api';
import { useAction, useApi } from './hooks';
import { ContextReturn, Empty, ErrorBox, ExternalLink, Loading, MetaLine, Notice, PageHeader, SearchForm, SyncButton } from './components';
import { EvidenceRefs } from './evidence';
import { TopicList } from './Topics';
import IndustriesPage from './Industries';
import { PathList, relationLabel } from './paths';
import type { AvailableChainPackage, Chain, ChainDirectory, ChainNode, ChainPackage, ChainTopics, Edge } from './types';

const nodeKinds: Record<ChainNode['kind'], string> = { industry: '行业', product: '产品', segment: '环节', company: '公司' };
export default function ChainPage() {
  const [params] = useSearchParams();
  const legacy = params.get('legacy') === '1' || params.has('topic_id') || params.has('node_id') || params.has('event_id') || params.has('symbol') || window.location.hash === '#packages';
  return legacy && !params.has('industry_id') ? <LegacyChainPage /> : <IndustriesPage />;
}
function LegacyChainPage() {
  const [params, setParams] = useSearchParams();
  const topicId = params.get('topic_id') || '';
  const eventId = params.get('event_id') || '';
  const symbol = params.get('symbol') || '';
  const nodeId = params.get('node_id') || '';
  const search = params.get('q') || '';
  const scoped = Boolean(topicId || nodeId || symbol);
  const topics = useApi<ChainTopics>(`/chain/topics${query({ event_id: eventId, symbol })}`);
  const directory = useApi<ChainDirectory>(`/chain/directory${query({ q: search })}`);
  const result = useApi<Chain>(scoped ? `/chain${query(topicId ? { topic_id: topicId } : nodeId ? { node_id: nodeId } : { symbol })}` : null);
  const [packagesOpen, setPackagesOpen] = useState(() => window.location.hash === '#packages');
  const selectedTopic = topics.data?.items.find(topic => topic.id === topicId);
  const location = useLocation();
  const context = location.state as { returnTo?: unknown } | null;
  const hasContext = typeof context?.returnTo === 'string' && /^\/(events|securities|chain)(\/|\?|$)/.test(context.returnTo);
  function reload() { topics.reload(); directory.reload(); result.reload(); }
  const filteredTopics = topics.data?.items.filter(topic => !search || `${topic.name} ${topic.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="full-page chain-page">
    <PageHeader title="旧产业主题" description="保留已安装主题、新闻线索和历史产业路径。"><Link to="/chain">阅读新产业解释</Link><Link to="/settings#data">管理产业数据</Link></PageHeader>
    <ContextReturn />
    {eventId && !hasContext && <div className="scope-line"><span>来自新闻的产业线索</span><Link to={`/events/${encodeURIComponent(eventId)}`}>返回新闻阅读</Link></div>}
    {symbol && !hasContext && <div className="scope-line"><Link to={`/securities/${encodeURIComponent(symbol)}`}>返回公司档案</Link></div>}
    {scoped ? <>
      <div className="local-heading"><div><h2>{selectedTopic?.name || (nodeId ? directory.data?.items.find(node => node.id === nodeId)?.label || '行业中的公司' : '相关产业结构')}</h2>{selectedTopic?.description && <p>{selectedTopic.description}</p>}</div><Link to={`/chain${query({ legacy: '1', event_id: eventId })}`} state={location.state}>浏览其他主题</Link></div>
      {result.loading && !result.data && <Loading label="正在读取产业结构…" />}<ErrorBox message={result.error} retry={result.reload} />
      {result.data && (result.data.nodes.length ? <IndustryStructure key={`${topicId}:${nodeId}:${symbol}`} chain={result.data} /> : <Empty title="此范围暂未收录产业关系"><p>这不代表没有业务联系。可浏览其他主题，或在数据管理中补充有来源的产业包。</p><Link to="/settings#data">管理产业数据</Link></Empty>)}
      {result.data && <details className="progressive-section"><summary>路径、范围与数据说明</summary><PathList paths={result.data.paths} chain={result.data} />{result.data.gaps.length > 0 && <ul className="warnings">{result.data.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}<MetaLine meta={result.meta} /></details>}
    </> : <section className="topic-directory" aria-label="产业主题">
      <h2>{eventId ? '新闻相关产业' : '产业主题'}</h2><p className="section-note">选择一个主题，了解其中的业务环节与公司。</p>
      <SearchForm key={search} initial={search} label="搜索产业主题" placeholder="搜索主题名称或简介" onSearch={q => setParams({ ...(q ? { q } : {}), ...(eventId ? { event_id: eventId } : {}) })} />
      {topics.loading && !topics.data && <Loading label="正在读取产业主题…" />}<ErrorBox message={topics.error ? `产业主题暂不可用：${topics.error} 请确认服务支持主题接口。` : null} retry={topics.reload} />
      {filteredTopics && (filteredTopics.length ? <TopicList items={filteredTopics} eventId={eventId} /> : <Empty title={search ? '没有匹配的主题' : eventId ? '这条新闻暂未关联产业主题' : '尚未安装产业主题'}><p>{eventId ? '可继续阅读新闻，或浏览其他已收录主题。' : '安装有来源的产业包后，这里将显示可浏览的主题。'}</p>{search && <button type="button" onClick={() => setParams(eventId ? { event_id: eventId } : {})}>清空搜索</button>}{eventId && <Link to="/chain">浏览全部主题</Link>}<Link to="/settings#data">产业数据管理</Link><button type="button" onClick={() => setPackagesOpen(true)}>浏览可安装产业包</button></Empty>)}
    </section>}
    <details className="progressive-section industry-secondary"><summary>按行业查公司</summary><p className="section-note">证券主表中的行业分类，不表示上下游或供货。</p><ErrorBox message={directory.error} retry={directory.reload} />{directory.loading && !directory.data && <Loading />}
      {directory.data && <ul className="source-list">{directory.data.items.filter(node => node.kind === 'industry').map(node => <li className="industry-row" key={node.id}><div><h3>{node.label}</h3><p>{node.company_count} 家公司</p></div><Link to={`/chain${query({ node_id: node.id, event_id: eventId })}`} state={location.state}>查看公司</Link></li>)}</ul>}
      {directory.data && !directory.data.items.some(node => node.kind === 'industry') && <p className="quiet-empty">暂无行业分类。<Link to="/settings#data">更新证券资料</Link></p>}
    </details>
    <details id="packages" className="package-section" open={packagesOpen} onToggle={event => setPackagesOpen(event.currentTarget.open)}><summary>产业数据管理 · 安装与导入</summary><PackageCatalog onDone={reload} /><details className="advanced-import"><summary>高级：导入有来源的 JSON</summary><ChainImport onDone={reload} /></details></details>
  </div>;
}
function IndustryStructure({ chain }: { chain: Chain }) {
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const inspector = useRef<HTMLElement>(null);
  useEffect(() => { if (selectedNode || selectedEdge) { inspector.current?.scrollIntoView({ block: 'nearest' }); inspector.current?.focus({ preventScroll: true }); } }, [selectedNode, selectedEdge]);
  const location = useLocation();
  const products = chain.nodes.filter(node => node.kind === 'product' || node.kind === 'segment');
  const companies = chain.nodes.filter(node => node.kind === 'company');
  const nodeMap = new Map(chain.nodes.map(node => [node.id, node]));
  const upstream = chain.edges.filter(edge => edge.relation === 'upstream' || edge.relation === 'disclosed_supply');
  const inspected = selectedEdge ? chain.edges.find(edge => edge.id === selectedEdge) : undefined;
  const returnState = { returnTo: `${location.pathname}${location.search}`, returnLabel: '返回产业结构', returnState: location.state };
  function companyLink(node: ChainNode) { return node.symbol ? <Link to={`/securities/${encodeURIComponent(node.symbol)}`} state={returnState}>{node.label}</Link> : <span>{node.label}</span>; }
  return <>
    <p className="structure-legend">业务归类用浅色连线，不代表供货；带箭头的实线为上游 / 已披露供应，虚线箭头为推断。点击关系可查证据，公司可直接打开档案。</p>
    <RoleGraph chain={chain} inspectEdge={id => { setSelectedEdge(id); setSelectedNode(null); }} inspectNode={id => { setSelectedNode(id); setSelectedEdge(null); }} />
    {(inspected || selectedNode) && <section className="graph-inspector" ref={inspector} tabIndex={-1} aria-live="polite"><div className="row-between"><h3>{inspected ? '关系依据' : nodeMap.get(selectedNode!)?.label || '业务依据'}</h3><button type="button" className="text-button" onClick={() => { setSelectedEdge(null); setSelectedNode(null); }}>收起</button></div>
      {inspected ? <EdgeEvidence edge={inspected} nodes={nodeMap} /> : <><p className="section-note">与此业务相连的已收录关系</p>{chain.edges.filter(edge => edge.from_id === selectedNode || edge.to_id === selectedNode).map(edge => <EdgeEvidence key={edge.id} edge={edge} nodes={nodeMap} />)}</>}
    </section>}
    {upstream.length > 0 && <section className="upstream-flow"><h2>关键上下游</h2><ul>{upstream.map(edge => <li key={edge.id}><span>{nodeMap.get(edge.from_id)?.label || '未提供名称'}</span><span className="flow-arrow"><small>{edge.relation === 'upstream' ? '产业上游' : '已披露供应'}</small><span aria-hidden="true">⟶</span></span><span>{nodeMap.get(edge.to_id)?.label || '未提供名称'}</span><details><summary>依据</summary><EdgeEvidence edge={edge} nodes={nodeMap} /></details></li>)}</ul></section>}
    <div className="industry-groups"><section><h2>产品与环节</h2>{products.length ? <ul className="business-list">{products.map(node => <li key={node.id}><button type="button" className="text-button" onClick={() => { setSelectedNode(node.id); setSelectedEdge(null); }}>{node.label}</button><span className="muted">{nodeKinds[node.kind]}</span></li>)}</ul> : <p className="quiet-empty">此范围仅收录行业分类，尚无产品或环节资料。</p>}</section>
      <section><h2>相关公司</h2>{companies.length ? <ul className="structure-companies">{companies.map(node => {
        const relatedBusiness = chain.edges.filter(edge => edge.from_id === node.id || edge.to_id === node.id).map(edge => nodeMap.get(edge.from_id === node.id ? edge.to_id : edge.from_id)).filter((item): item is ChainNode => Boolean(item && item.kind !== 'company'));
        const names = [...new Set(relatedBusiness.map(item => item.label))];
        return <li key={node.id}><h3>{companyLink(node)}</h3>{names.length > 0 && <p>{names.join(' · ')}</p>}{!node.symbol && <span className="muted">未收录证券档案</span>}</li>;
      })}</ul> : <p className="quiet-empty">暂未收录相关公司。<Link to="/settings#data">管理产业数据</Link></p>}</section></div>
    <details className="progressive-section"><summary>完整关系与证据</summary><RelationTable chain={chain} /></details>
  </>;
}
function activate(event: KeyboardEvent<SVGGElement>, action: () => void) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } }
function RoleGraph({ chain, inspectEdge, inspectNode }: { chain: Chain; inspectEdge: (id: string) => void; inspectNode: (id: string) => void }) {
  const markerId = useId().replace(/:/g, '');
  const navigate = useNavigate();
  const location = useLocation();
  // Roles determine lanes. Only real upstream edges determine the product flow; classification never does.
  const business = chain.nodes.filter(node => node.kind !== 'company');
  const ranks = new Map(business.map(node => [node.id, 0]));
  const productIds = new Set(business.map(node => node.id));
  const flowEdges = chain.edges.filter(edge => edge.relation === 'upstream' && productIds.has(edge.from_id) && productIds.has(edge.to_id));
  for (let pass = 0; pass < 2; pass++) for (const edge of flowEdges) ranks.set(edge.to_id, Math.min(2, Math.max(ranks.get(edge.to_id) || 0, (ranks.get(edge.from_id) || 0) + 1)));
  const lanes: ChainNode[][] = [[], [], [], []];
  business.forEach(node => lanes[ranks.get(node.id) || 0].push(node));
  chain.nodes.filter(node => node.kind === 'company').slice(0, 16).forEach(node => lanes[3].push(node));
  const visibleLanes = lanes.map((nodes, role) => ({ nodes, role })).filter(lane => lane.nodes.length > 0);
  const positions = new Map<string, { x: number; y: number }>();
  visibleLanes.forEach(({ nodes }, lane) => nodes.forEach((node, row) => positions.set(node.id, { x: 24 + lane * 250, y: 56 + row * 87 })));
  const width = Math.max(270, visibleLanes.length * 250 + 20);
  const height = Math.max(235, ...visibleLanes.map(lane => lane.nodes.length * 87 + 65));
  const laneNames = [flowEdges.length ? '产品 / 上游起点' : '产品、环节与行业', '下游环节', '后续环节', '相关公司'];
  return <section className="graph-section" aria-label="按产业角色排布的结构图">{visibleLanes.length > 1 && <p className="graph-scroll-hint">左右滑动查看结构图，完整公司名单见下方。</p>}<div className="graph-scroll" tabIndex={0} role="region" aria-label="产业结构图，可横向滚动；下方有完整文字列表"><svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="group" aria-labelledby={`${markerId}-title`}>
    <title id={`${markerId}-title`}>产品环节按上下游排布，公司单独成组。业务分类不是供货。</title><defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#216a5d" /></marker></defs>
    {visibleLanes.map(({ role }, lane) => <text key={role} x={24 + lane * 250} y="27" className="graph-column-label">{laneNames[role]}</text>)}
    {chain.edges.map(edge => {
      const from = positions.get(edge.from_id), to = positions.get(edge.to_id);
      if (!from || !to) return null;
      const classification = edge.relation === 'classification';
      const sameLane = from.x === to.x;
      const x1 = from.x + (sameLane ? 100 : from.x < to.x ? 200 : 0), y1 = from.y + (sameLane ? 57 : 29);
      const x2 = to.x + (sameLane ? 100 : from.x < to.x ? 0 : 200), y2 = to.y + (sameLane ? 0 : 29);
      const d = sameLane ? `M ${x1} ${y1} C ${x1 + 115} ${y1 + 15}, ${x2 + 115} ${y2 - 15}, ${x2} ${y2}` : `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
      const action = () => inspectEdge(edge.id);
      return <g key={edge.id} className="graph-interactive" role="button" tabIndex={0} aria-label={`${chain.nodes.find(node => node.id === edge.from_id)?.label || '节点'} 到 ${chain.nodes.find(node => node.id === edge.to_id)?.label || '节点'}，${relationLabel[edge.relation]}，查看依据`} onClick={action} onKeyDown={event => activate(event, action)}><path d={d} className="graph-relation-hit" /><path d={d} className={`graph-edge role-edge ${edge.relation}`} markerEnd={classification ? undefined : `url(#${markerId})`} /></g>;
    })}
    {lanes.flat().map(node => {
      const point = positions.get(node.id)!;
      const action = () => node.symbol ? navigate(`/securities/${encodeURIComponent(node.symbol)}`, { state: { returnTo: `${location.pathname}${location.search}`, returnLabel: '返回产业结构', returnState: location.state } }) : inspectNode(node.id);
      return <g key={node.id} className="graph-interactive" role={node.symbol ? 'link' : 'button'} tabIndex={0} aria-label={`${node.label}，${node.symbol ? '打开公司档案' : '查看业务依据'}`} onClick={action} onKeyDown={event => activate(event, action)}><title>{node.label}</title><rect x={point.x} y={point.y} width="200" height="57" rx="3" className={`graph-node ${node.kind === 'company' ? 'company' : ''}`} /><text x={point.x + 12} y={point.y + 24} className="graph-node-label">{node.label.length > 13 ? `${node.label.slice(0, 13)}…` : node.label}</text><text x={point.x + 12} y={point.y + 44} className="graph-column-label">{node.symbol ? '公司档案 →' : nodeKinds[node.kind]}</text></g>;
    })}
  </svg></div>{chain.nodes.filter(node => node.kind === 'company').length > 16 && <p className="section-note">图中先展示 16 家公司，完整名单见下方“相关公司”。</p>}</section>;
}
function EdgeEvidence({ edge, nodes }: { edge: Edge; nodes: Map<string, ChainNode> }) {
  return <div className="edge-evidence"><p>{nodes.get(edge.from_id)?.label || '未提供名称'} → {nodes.get(edge.to_id)?.label || '未提供名称'} · {relationLabel[edge.relation]}</p><EvidenceRefs ids={edge.evidence_ids} /><ExternalLink url={edge.source_url}>关系来源</ExternalLink><details><summary>时间与置信信息</summary><p className="muted">{dateTime(edge.as_of)} · 置信度 {edge.confidence ?? '未提供'}（非收益概率）</p></details></div>;
}
function RelationTable({ chain }: { chain: Chain }) {
  const nodes = new Map(chain.nodes.map(node => [node.id, node]));
  return chain.edges.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="完整产业关系表"><table className="relation-table"><caption className="sr-only">关系类别与来源</caption><thead><tr><th scope="col">关系</th><th scope="col">类别</th><th scope="col">证据与来源</th></tr></thead><tbody>{chain.edges.map(edge => <tr key={edge.id}><th scope="row">{nodes.get(edge.from_id)?.label || '未提供名称'} → {nodes.get(edge.to_id)?.label || '未提供名称'}</th><td>{relationLabel[edge.relation]}</td><td><EvidenceRefs ids={edge.evidence_ids} /><p><ExternalLink url={edge.source_url}>关系来源</ExternalLink></p><details><summary>数据时间与置信度</summary><p className="muted">{dateTime(edge.as_of)} · {edge.confidence ?? '未提供'}（非收益概率）</p></details></td></tr>)}</tbody></table></div> : <p className="quiet-empty">暂未收录关系，不能据此推断供应。</p>;
}
function PackageCatalog({ onDone }: { onDone: () => void }) {
  const result = useApi<AvailableChainPackage[]>('/chain/packages');
  const action = useAction();
  const [installing, setInstalling] = useState('');
  return <section className="package-catalog" aria-label="可安装产业包"><p className="section-note">使用服务提供的有来源资料。安装不会调用模型，也不代表实时市场全貌。</p>
    {result.loading && !result.data && <Loading label="正在读取可用产业包…" />}<ErrorBox message={result.error} retry={result.reload} />
    {result.data?.length === 0 && <Empty title="暂时没有可安装产业包"><Link to="/settings#data">数据管理</Link><SyncButton kind="securities" onDone={onDone}>更新证券分类</SyncButton></Empty>}
    <ul className="package-list">{result.data?.map(pkg => <li key={pkg.id}><h3>{pkg.name}</h3><p>{pkg.description || '安装后查看具体关系与证据。'}</p><details><summary>版本与资料来源</summary><p className="muted">v{pkg.version} · {pkg.node_count} 个节点 · {pkg.edge_count} 条关系</p><div className="package-sources">{pkg.source_urls.map((url, index) => <ExternalLink key={index} url={url}>{safeUrl(url) ? new URL(url).hostname : '来源链接'}</ExternalLink>)}{!pkg.source_urls.length && <span>未提供来源链接，须逐项核对证据。</span>}</div></details><button type="button" disabled={pkg.installed || action.busy} onClick={() => void action.run(async () => {
      setInstalling(pkg.id);
      try { const response = await post<{ id: string; installed: boolean }>(`/chain/packages/${encodeURIComponent(pkg.id)}/install`); if (!response.data.installed) throw new Error('安装尚未完成，请刷新后重试。'); action.setNotice(`“${pkg.name}”已安装，可从产业主题进入。`); result.reload(); onDone(); } finally { setInstalling(''); }
    })}>{pkg.installed ? '已安装' : installing === pkg.id ? '正在安装…' : '安装主题'}</button></li>)}</ul><ErrorBox message={action.error} /><Notice message={action.notice} /><MetaLine meta={result.meta} />
  </section>;
}
function validatePackage(value: unknown): asserts value is ChainPackage {
  if (!value || typeof value !== 'object') throw new Error('数据包必须是 JSON 对象。');
  const pkg = value as Record<string, unknown>;
  for (const field of ['id', 'version', 'license', 'source_url', 'as_of']) if (typeof pkg[field] !== 'string' || !(pkg[field] as string).trim()) throw new Error(`缺少必填字段：${field}`);
  if (!safeUrl(pkg.source_url as string)) throw new Error('source_url 必须是有效 HTTP(S) 来源链接，且不能包含凭据。');
  if (Number.isNaN(Date.parse(pkg.as_of as string))) throw new Error('as_of 必须提供有效的 ISO8601 时间。');
  for (const field of ['nodes', 'edges', 'evidence']) if (!Array.isArray(pkg[field])) throw new Error(`${field} 必须是数组。`);
}
function ChainImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const action = useAction();
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; setFileError(null); if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setFileError('请选择不超过 5 MB 的 JSON 文件，较大数据包请分批导入。'); event.target.value = ''; return; }
    try { setText(await file.text()); } catch { setFileError('无法读取文件，请重新选择或直接粘贴 JSON。'); }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); void action.run(async () => {
      setWarnings([]); let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new Error('JSON 格式错误，请检查引号、逗号与括号。'); }
      validatePackage(parsed); const response = await post<ChainPackage>('/chain/import', parsed);
      action.setNotice(`数据包已导入：${response.data.nodes.length} 个节点、${response.data.edges.length} 条关系。`); setWarnings(response.meta.warnings); onDone();
    });
  }
  return <section className="import-section"><h2>导入有来源的产业数据</h2><p>后端校验许可、事实证据和完整引用。请勿上传密钥或敏感信息。</p><details><summary>数据包字段要求</summary><div className="schema-help"><p>顶层：<code>id, version, license, source_url, as_of, nodes, edges, evidence</code>。许可须明确可验证，时间为 ISO8601。</p><p>节点：<code>id, label, kind, symbol?</code>；kind 为 industry / product / segment / company。</p><p>关系：<code>id, from_id, to_id, relation, evidence_ids, confidence, as_of, source_url</code>；relation 为 upstream / classification / disclosed_supply / inferred。</p><p>证据：<code>id, title, url, excerpt, published_at, source</code>。推断不得标为已披露供应。</p></div></details>
    <form onSubmit={submit}><div className="field"><label htmlFor="chain-file">JSON 文件（不超过 5 MB）</label><input id="chain-file" type="file" accept="application/json,.json" onChange={event => void readFile(event)} disabled={action.busy} /></div><div className="field"><label htmlFor="chain-json">产业数据包 JSON</label><textarea id="chain-json" rows={10} value={text} onChange={event => setText(event.target.value)} required spellCheck={false} disabled={action.busy} placeholder="粘贴符合 v1 契约的完整数据包" /></div><button type="submit" disabled={action.busy || !text.trim()}>{action.busy ? '正在校验并导入…' : '校验并导入'}</button></form><ErrorBox message={fileError || action.error} /><Notice message={action.notice} />{warnings.length > 0 && <ul className="warnings">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
  </section>;
}
