import type { IndustryGraph, IndustryGroup, IndustryRelation, IndustryRelationKind, IndustryStructure } from './types';

export const relationNames: Record<IndustryRelationKind, string> = {
  input_to: '投入', produces: '产出', component_of: '组成', supports: '支撑', used_for: '用于', precedes: '阶段先后',
};
export const organizationNotes: Record<IndustryStructure['organization'], string> = {
  production: '生产与分流：投入、加工和产出按真实关系连接。',
  composition: '组成与协作：部件组成系统，配套提供运行条件，并非加工顺序。',
  development: '研发与验证：阶段先后不保证推进、成功或获批。',
  mixed: '混合机制：组成、生产、用途与服务分别保留原关系含义。',
};

/** Condense cycles before ranking. Reading order breaks ties, never creates edges. */
export function directedLevels(ids: string[], pairs: [string, string][]): Map<string, number> {
  const adjacent = new Map(ids.map(id => [id, [] as string[]]));
  pairs.forEach(([a, b]) => { if (adjacent.has(a) && adjacent.has(b)) adjacent.get(a)!.push(b); });
  const indices = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], active = new Set<string>(), components: string[][] = [];
  function visit(id: string) {
    indices.set(id, indices.size); low.set(id, indices.get(id)!); stack.push(id); active.add(id);
    for (const other of adjacent.get(id)!) {
      if (!indices.has(other)) { visit(other); low.set(id, Math.min(low.get(id)!, low.get(other)!)); }
      else if (active.has(other)) low.set(id, Math.min(low.get(id)!, indices.get(other)!));
    }
    if (low.get(id) === indices.get(id)) {
      const component: string[] = [];
      let other: string;
      do { other = stack.pop()!; active.delete(other); component.push(other); } while (other !== id);
      components.push(component);
    }
  }
  ids.forEach(id => { if (!indices.has(id)) visit(id); });
  const owner = new Map<string, number>();
  components.forEach((group, i) => group.forEach(id => owner.set(id, i)));
  const incoming = components.map(() => new Set<number>());
  pairs.forEach(([a, b]) => { if (owner.has(a) && owner.has(b) && owner.get(a) !== owner.get(b)) incoming[owner.get(b)!].add(owner.get(a)!); });
  const ranks = new Map<number, number>();
  function rank(i: number): number {
    if (!ranks.has(i)) ranks.set(i, Math.max(0, ...[...incoming[i]].map(j => rank(j) + 1)));
    return ranks.get(i)!;
  }
  return new Map(ids.map(id => [id, rank(owner.get(id)!)]));
}

export function structureIssues(graph: IndustryGraph, structure: IndustryStructure | null | undefined): string[] {
  if (!structure) return ['缺少解释结构'];
  if (structure.version !== 1 || !['production', 'composition', 'development', 'mixed'].includes(structure.organization)) return ['结构版本或机制无效'];
  if (!structure.thesis?.trim() || !Array.isArray(structure.groups) || !structure.groups.length) return ['缺少主旨或分组'];
  const groups = new Map<string, IndustryGroup>(), owner = new Map<string, string>();
  for (const group of structure.groups) {
    if (!group.id || groups.has(group.id) || !['core', 'support'].includes(group.role) || !group.title?.trim() || !group.purpose?.trim() || !Array.isArray(group.node_ids) || !group.node_ids.length) return ['分组不完整或重复'];
    groups.set(group.id, group);
    for (const id of group.node_ids) { if (owner.has(id)) return ['节点重复分组']; owner.set(id, group.id); }
  }
  if (owner.size !== graph.nodes.length || graph.nodes.some(node => !owner.has(node.id))) return ['节点覆盖不完整或引用无效'];
  const order = structure.reading_order;
  if (!Array.isArray(order) || order.length !== groups.size || new Set(order).size !== groups.size || order.some(id => !groups.has(id))) return ['阅读顺序不完整或重复'];
  const core = [...groups.values()].filter(group => group.role === 'core').map(group => group.id);
  if (!core.length) return ['缺少主干'];
  const edges = new Map(graph.relations.map(edge => [edge.id, edge]));
  const primary = structure.primary_relation_ids;
  if (!Array.isArray(primary) || new Set(primary).size !== primary.length || primary.some(id => {
    const edge = edges.get(id);
    return !edge || !core.includes(owner.get(edge.from_id)!) || !core.includes(owner.get(edge.to_id)!);
  })) return ['主干引用无效或端点不属于主干'];
  const reached = new Set(core);
  let changed = true;
  while (changed) {
    changed = false;
    graph.relations.forEach(edge => {
      const a = owner.get(edge.from_id), b = owner.get(edge.to_id);
      if (a && b && (reached.has(a) || reached.has(b))) {
        if (!reached.has(a) || !reached.has(b)) changed = true;
        reached.add(a); reached.add(b);
      }
    });
  }
  return reached.size === groups.size ? [] : ['配套缺少通向主干的真实关系'];
}

function legacyStructure(graph: IndustryGraph): IndustryStructure {
  const material = new Set(graph.relations.filter(edge => edge.kind !== 'supports').flatMap(edge => [edge.from_id, edge.to_id]));
  const support = new Set(graph.nodes.filter(node => !material.has(node.id) && graph.relations.some(edge => edge.from_id === node.id && edge.kind === 'supports')).map(node => node.id));
  let core = graph.nodes.filter(node => !support.has(node.id)).map(node => node.id);
  if (!core.length) { core = graph.nodes.map(node => node.id); support.clear(); }
  const reached = new Set(core);
  let changed = true;
  while (changed) {
    changed = false;
    graph.relations.forEach(edge => {
      if (reached.has(edge.from_id) || reached.has(edge.to_id)) {
        if (!reached.has(edge.from_id) || !reached.has(edge.to_id)) changed = true;
        reached.add(edge.from_id); reached.add(edge.to_id);
      }
    });
  }
  graph.nodes.forEach(node => { if (!reached.has(node.id)) { core.push(node.id); support.delete(node.id); } });
  const levels = directedLevels(core, graph.relations.map(edge => [edge.from_id, edge.to_id]));
  const maximum = Math.max(0, ...levels.values());
  const buckets = new Map<number, string[]>();
  core.forEach(id => { const bucket = Math.min(5, Math.floor(levels.get(id)! * 6 / (maximum + 1))); buckets.set(bucket, [...(buckets.get(bucket) || []), id]); });
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const groups: IndustryGroup[] = [...buckets.entries()].sort(([a], [b]) => a - b).map(([i, ids]) => ({
    id: `legacy-core-${i}`, title: ids.slice(0, 2).map(id => nodes.get(id)!.name).join(' / ') + (ids.length > 2 ? '等' : ''), role: 'core',
    purpose: `兼容归组：${ids.slice(0, 3).map(id => nodes.get(id)!.description).join('；')}`, node_ids: ids,
  }));
  if (support.size) groups.push({ id: 'legacy-support', title: '配套与服务', role: 'support', purpose: '按已有支撑边归组；分别挂接标明的对象，不代表必经阶段。', node_ids: graph.nodes.filter(node => support.has(node.id)).map(node => node.id) });
  return { version: 1, organization: 'mixed', thesis: graph.explanation.overview || graph.industry.summary, groups,
    primary_relation_ids: graph.relations.filter(edge => core.includes(edge.from_id) && core.includes(edge.to_id)).map(edge => edge.id), reading_order: groups.map(group => group.id) };
}

export interface GroupConnection { from: string; to: string; edges: IndustryRelation[]; primary: boolean }
export function prepareStructure(graph: IndustryGraph) {
  const issues = structureIssues(graph, graph.structure);
  const compatibility = issues.length > 0 || graph.structure_origin === 'compatibility';
  const structure = issues.length ? legacyStructure(graph) : graph.structure!;
  const groups = structure.reading_order.map(id => structure.groups.find(group => group.id === id)!);
  const byId = new Map(groups.map(group => [group.id, group]));
  const owner = new Map(groups.flatMap(group => group.node_ids.map(id => [id, group.id] as const)));
  const primary = new Set(structure.primary_relation_ids), links = new Map<string, GroupConnection>();
  graph.relations.forEach(edge => {
    const from = owner.get(edge.from_id)!, to = owner.get(edge.to_id)!;
    if (from === to) return;
    const key = JSON.stringify([from, to]);
    const connection: GroupConnection = links.get(key) || { from, to, edges: [], primary: false };
    connection.edges.push(edge); connection.primary ||= primary.has(edge.id); links.set(key, connection);
  });
  const connections = [...links.values()];
  const core = groups.filter(group => group.role === 'core');
  const levels = directedLevels(core.map(group => group.id), connections.map(link => [link.from, link.to]));
  const ranks = [...new Set(levels.values())].sort((a, b) => a - b);
  const support = groups.filter(group => group.role === 'support');
  // Reachable core objects are for placement only; UI labels only actual edges as relationships.
  const supportRanks = new Map<string, number>();
  support.forEach(group => {
    let frontier = [group.id];
    const seen = new Set(frontier), targets: string[] = [];
    while (frontier.length && !targets.length) {
      const next: string[] = [];
      frontier.forEach(id => connections.forEach(link => {
        const other = link.from === id ? link.to : link.to === id ? link.from : '';
        if (!other || seen.has(other)) return;
        seen.add(other);
        if (levels.has(other)) targets.push(other); else next.push(other);
      }));
      frontier = next;
    }
    supportRanks.set(group.id, targets.length ? Math.min(...targets.map(id => levels.get(id)!)) : (ranks[0] || 0));
  });
  return { structure, compatibility, issues, groups, byId, owner, primary, connections,
    rows: ranks.map(rank => ({ rank, core: core.filter(group => levels.get(group.id) === rank), support: support.filter(group => supportRanks.get(group.id) === rank) })) };
}
