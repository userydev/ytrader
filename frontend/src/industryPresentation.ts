import type { IndustryGraph, IndustryRelationKind } from './types';

export const relationNames: Record<IndustryRelationKind, string> = {
  input_to: '投入', produces: '产出', component_of: '组成', supports: '支撑', used_for: '用于', precedes: '流程先后',
};
export const kindNames = { product: '产品', activity: '活动', service: '服务', application: '应用' };
export const NODE_WIDTH = 128;
export const NODE_HEIGHT = 76;
export interface Point { x: number; y: number }
interface Caption extends Point { text: string }
interface NodeCopy { title: string; purpose: string }
interface Route { points: Point[]; label: Point }
interface ReferenceLayout {
  mechanism: string; note: string; width: number; height: number;
  positions: Record<string, Point>; copy: Record<string, NodeCopy>; captions: Caption[];
  routes: Record<string, Route>;
}
export interface Presentation {
  mechanism: string; note: string; width: number; height: number;
  positions: Map<string, Point>; copy: Record<string, NodeCopy>; captions: Caption[];
  edges: { id: string; path: string; label: Point }[];
}
const p = (x: number, y: number): Point => ({ x, y });
const route = (points: Point[], x: number, y: number): Route => ({ points, label: p(x, y) });
// These are editorial positions and short names, never additional graph relationships.
// A route is used only when its corresponding edge actually exists in the data.
const references: Record<string, ReferenceLayout> = {
  'ai-compute': {
    mechanism: '把计算部件组织成协同工作的系统，完成模型训练与推理。',
    note: '主干是系统组织关系；下方是协作配套与运行条件，不是加工的下一站。',
    width: 640, height: 448,
    positions: { accelerator: p(16, 54), server: p(176, 54), cluster: p(336, 54), workload: p(496, 54), network: p(16, 216), storage: p(176, 216), software: p(336, 216), power: p(176, 358), cooling: p(336, 358) },
    copy: {
      accelerator: { title: 'GPU', purpose: '执行计算' }, server: { title: '服务器', purpose: '承载计算部件' }, cluster: { title: '集群', purpose: '组织多机协作' }, workload: { title: '训练与推理', purpose: '运行模型任务' },
      network: { title: '网络', purpose: '交换数据' }, storage: { title: '存储', purpose: '提供数据' }, software: { title: '软件', purpose: '分配任务' }, power: { title: '供电', purpose: '提供电力' }, cooling: { title: '散热', purpose: '带走热量' },
    },
    captions: [{ ...p(16, 12), text: '系统主干' }, { ...p(16, 182), text: '协作配套' }, { ...p(16, 324), text: '运行条件' }],
    routes: {
      'network>cluster': route([p(80, 216), p(80, 158), p(368, 158), p(368, 130)], 142, 158),
      'storage>cluster': route([p(240, 216), p(240, 180), p(400, 180), p(400, 130)], 304, 180),
      'software>cluster': route([p(432, 216), p(432, 130)], 432, 182),
      'power>cluster': route([p(304, 396), p(320, 396), p(320, 310), p(486, 310), p(486, 106), p(464, 106)], 486, 280),
      'cooling>cluster': route([p(464, 396), p(536, 396), p(536, 148), p(452, 148), p(452, 130)], 536, 336),
    },
  },
  'crude-oil': {
    mechanism: '开采得到原油，炼制形成燃料与化工原料两条用途分支，储运支撑投入与交付。',
    note: '炼制的两条分支是不同产出；储运是配套服务，不是一道炼制工序。',
    width: 880, height: 370,
    positions: { extraction: p(16, 108), crude: p(192, 108), refining: p(368, 108), fuels: p(544, 40), feedstock: p(544, 212), transport: p(720, 40), chemicals: p(720, 212), logistics: p(192, 282) },
    copy: { extraction: { title: '勘探与开采', purpose: '获取原油' }, crude: { title: '原油', purpose: '提供炼制投入' }, refining: { title: '炼制', purpose: '分离、转化与处理' }, fuels: { title: '燃料', purpose: '形成燃料产出' }, feedstock: { title: '化工原料', purpose: '形成化工投入' }, transport: { title: '交通与能源', purpose: '使用燃料' }, chemicals: { title: '化工生产', purpose: '使用化工原料' }, logistics: { title: '储运', purpose: '支撑接收与交付' } },
    captions: [{ ...p(16, 12), text: '获取与加工' }, { ...p(544, 6), text: '分流到用途' }, { ...p(16, 290), text: '配套服务' }],
    routes: {
      'refining>fuels': route([p(496, 132), p(520, 132), p(520, 78), p(544, 78)], 520, 100),
      'refining>feedstock': route([p(496, 160), p(520, 160), p(520, 250), p(544, 250)], 520, 200),
      'logistics>refining': route([p(320, 320), p(432, 320), p(432, 184)], 432, 258),
    },
  },
  'innovative-drugs': {
    mechanism: '研发分阶段积累证据，经审评决定能否上市，专业服务跨阶段支撑研究与供应。',
    note: '流程先后不代表必然成功或获批；以 FDA 流程为例，不等于中国注册细则。',
    width: 880, height: 408,
    positions: { discovery: p(16, 54), preclinical: p(192, 54), clinical: p(368, 54), review: p(544, 54), use: p(720, 54), cro: p(192, 242), cdmo: p(368, 320), commercial: p(720, 242) },
    copy: { discovery: { title: '药物发现', purpose: '寻找候选药物' }, preclinical: { title: '临床前', purpose: '开展实验室研究' }, clinical: { title: '临床研究', purpose: '研究安全与有效性' }, review: { title: '注册审评', purpose: '审查资料并决定' }, use: { title: '上市使用', purpose: '持续安全监测' }, cro: { title: '临床 CRO', purpose: '提供研究服务' }, cdmo: { title: 'CDMO', purpose: '研发与制造支持' }, commercial: { title: '商业化生产', purpose: '支撑药品供应' } },
    captions: [{ ...p(16, 12), text: '研发阶段与市场准入' }, { ...p(16, 210), text: '跨阶段支撑（不是下一阶段）' }],
    routes: {
      'cro>clinical': route([p(256, 242), p(256, 166), p(400, 166), p(400, 130)], 310, 166),
      'cdmo>clinical': route([p(432, 320), p(432, 130)], 432, 222),
      'cdmo>commercial': route([p(496, 358), p(608, 358), p(608, 280), p(720, 280)], 608, 322),
      'commercial>use': route([p(784, 242), p(784, 130)], 784, 186),
    },
  },
};

// Condense strongly connected components before ranking: cycles and isolated nodes
// remain visible, rather than being discarded by a topological-only layout.
function dynamicPositions(graph: IndustryGraph): Map<string, Point> {
  const ids = graph.nodes.map(node => node.id);
  const outgoing = new Map(ids.map(id => [id, [] as string[]]));
  const incoming = new Map(ids.map(id => [id, [] as string[]]));
  for (const edge of graph.relations) {
    if (!outgoing.has(edge.from_id) || !outgoing.has(edge.to_id)) continue;
    outgoing.get(edge.from_id)!.push(edge.to_id);
    incoming.get(edge.to_id)!.push(edge.from_id);
  }
  const visited = new Set<string>();
  const finish: string[] = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    visited.add(id);
    const stack = [{ id, index: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const neighbours = outgoing.get(top.id)!;
      if (top.index < neighbours.length) {
        const next = neighbours[top.index++];
        if (!visited.has(next)) { visited.add(next); stack.push({ id: next, index: 0 }); }
      } else { finish.push(top.id); stack.pop(); }
    }
  }
  const component = new Map<string, number>();
  const groups: string[][] = [];
  for (const id of finish.reverse()) {
    if (component.has(id)) continue;
    const index = groups.length;
    const members: string[] = [];
    const stack = [id];
    component.set(id, index);
    while (stack.length) {
      const current = stack.pop()!;
      members.push(current);
      for (const next of incoming.get(current)!) if (!component.has(next)) { component.set(next, index); stack.push(next); }
    }
    groups.push(members);
  }
  const children = groups.map(() => new Set<number>());
  const degree = groups.map(() => 0);
  const rank = groups.map(() => 0);
  for (const edge of graph.relations) {
    const from = component.get(edge.from_id); const to = component.get(edge.to_id);
    if (from === undefined || to === undefined || from === to || children[from].has(to)) continue;
    children[from].add(to); degree[to]++;
  }
  const queue = degree.flatMap((value, index) => value === 0 ? [index] : []);
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index];
    for (const to of children[from]) {
      rank[to] = Math.max(rank[to], rank[from] + 1);
      if (--degree[to] === 0) queue.push(to);
    }
  }
  const rows = new Map<number, number>();
  const positions = new Map<string, Point>();
  // Input order is stable between polling updates and avoids visual reshuffling.
  for (const id of ids) {
    const column = rank[component.get(id)!];
    const row = rows.get(column) || 0;
    positions.set(id, p(24 + column * 208, 54 + row * 156));
    rows.set(column, row + 1);
  }
  return positions;
}
function defaultRoute(from: Point, to: Point, index: number): Route {
  if (from.x === to.x && from.y === to.y) {
    const x = from.x + NODE_WIDTH + 24 + index % 3 * 14;
    return route([p(from.x + NODE_WIDTH, from.y + 20), p(x, from.y + 20), p(x, from.y - 20), p(from.x + 64, from.y - 20), p(from.x + 64, from.y)], x, from.y - 20);
  }
  if (to.x > from.x) {
    const start = p(from.x + NODE_WIDTH, from.y + NODE_HEIGHT / 2);
    const end = p(to.x, to.y + NODE_HEIGHT / 2);
    const middle = (start.x + end.x) / 2;
    return route([start, p(middle, start.y), p(middle, end.y), end], middle, (start.y + end.y) / 2);
  }
  const right = Math.max(from.x, to.x) + NODE_WIDTH + 24 + index % 4 * 14;
  const start = p(from.x + NODE_WIDTH, from.y + 50);
  const end = p(to.x + NODE_WIDTH, to.y + 26);
  return route([start, p(right, start.y), p(right, end.y), end], right, (start.y + end.y) / 2);
}
export function presentIndustry(graph: IndustryGraph, ai: boolean): Presentation {
  const candidate = !ai ? references[graph.industry.id] : undefined;
  const reference = candidate && Object.keys(candidate.positions).every(id => graph.nodes.some(node => node.id === id)) ? candidate : undefined;
  const positions = reference ? new Map(Object.entries(reference.positions)) : dynamicPositions(graph);
  if (reference) {
    let extra = 0;
    for (const node of graph.nodes) if (!positions.has(node.id)) { positions.set(node.id, p(16 + extra % 4 * 176, reference.height + Math.floor(extra / 4) * 156)); extra++; }
  }
  let width = reference?.width || 320;
  let height = reference?.height || 180;
  for (const point of positions.values()) { width = Math.max(width, point.x + NODE_WIDTH + (reference ? 16 : 48)); height = Math.max(height, point.y + NODE_HEIGHT + (reference ? 14 : 36)); }
  const edges = graph.relations.flatMap((edge, index) => {
    const from = positions.get(edge.from_id); const to = positions.get(edge.to_id);
    if (!from || !to) return []; // Still reachable in the full relationship index.
    const geometry = reference?.routes[`${edge.from_id}>${edge.to_id}`] || defaultRoute(from, to, index);
    for (const point of geometry.points) { width = Math.max(width, point.x + 48); height = Math.max(height, point.y + 36); }
    return [{ id: edge.id, path: geometry.points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '), label: geometry.label }];
  });
  return { mechanism: reference?.mechanism || graph.industry.summary || graph.industry.demand, note: reference?.note || '箭头说明环节之间的连接；支撑不等于加工顺序，流程先后不代表必然成功。', positions, copy: reference?.copy || {}, captions: reference?.captions || [{ ...p(24, 12), text: '产业环节与连接' }], width, height, edges };
}
