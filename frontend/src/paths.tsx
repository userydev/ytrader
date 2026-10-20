import { Link, useLocation } from 'react-router-dom';
import { EvidenceRefs } from './evidence';
import type { Article, Chain, Edge, Path } from './types';

export const relationLabel: Record<Edge['relation'], string> = {
  upstream: '产业上游', classification: '业务分类（非供货）', disclosed_supply: '已披露供应', inferred: '推断关系',
};
export const pathLabel: Record<Path['kind'], string> = { classification: '业务分类路径（非供货关系）', disclosed: '披露路径', inferred: '推断路径（待验证）' };
export function PathList({ paths, chain, articles }: { paths: Path[]; chain?: Chain; articles?: Article[] }) {
  const location = useLocation();
  if (!paths.length) return <p className="muted">暂未收录产业路径。可在设置的数据管理中更新证券分类或安装有来源的产业主题。</p>;
  const nodes = new Map(chain?.nodes.map(node => [node.id, node]));
  const edges = new Map(chain?.edges.map(edge => [edge.id, edge]));
  return <ol className="path-list">{paths.map(path => <li key={path.id}>
    <p className={`path-kind ${path.kind === 'inferred' ? 'warning-text' : ''}`}>{pathLabel[path.kind]}</p>
    <div className="path-flow" aria-label="路径节点与关系">{path.node_ids.map((id, index) => {
      const node = nodes.get(id);
      const edge = edges.get(path.edge_ids[index]);
      return <span className="path-step" key={`${id}-${index}`}>
        <span className="path-node">{node?.symbol ? <Link to={`/securities/${encodeURIComponent(node.symbol)}`} state={{ returnTo: `${location.pathname}${location.search}`, returnLabel: '返回研究路径', returnState: location.state }}>{node.label}</Link> : node?.label || '节点名称待加载'}</span>
        {index < path.node_ids.length - 1 && <span className={`path-connector ${edge?.relation === 'inferred' || (!edge && path.kind === 'inferred') ? 'inferred' : ''}`}><span>{edge ? relationLabel[edge.relation] : '关系待加载'}</span><span aria-hidden="true" className="connector-line" /></span>}
      </span>;
    })}</div>
    <p><strong>成立条件：</strong>{path.condition || '未提供，需进一步核实'}</p>
    <EvidenceRefs ids={path.evidence_ids} articles={articles} />
  </li>)}</ol>;
}
