import test from 'node:test';
import assert from 'node:assert/strict';
import { usesChainLayout, structureLayout, structureReadingGroups } from '../public/industry/chain-layout-config.js';

// Pure presentation tests: no DOM, vendor engine, network or new dependencies.
// Execution is owned by Codex; this isolated candidate has NOT_RUN tests.
const relation = (from, to, id = `${from}->${to}`, kind = 'input_to') => ({
  id, from_id: from, to_id: to, kind,
  evidence: [{ source_id: 'original-source', quote: 'original evidence' }],
  applicability: { scope: 'original scope, not a universal process' }
});
function graphOf(ids, relations = [], groups, id = 'future-industry') {
  return {
    source_kind: 'curated_v02', industry: { id, name: '原产业名称' },
    nodes: ids.map(id => ({ id, kind: 'product', name: `原名称 ${id}` })),
    relations, companies: [],
    ...(groups ? { structure: { groups, reading_order: groups.map(group => group.id) } } : {})
  };
}
const group = (id, ids, role = 'core') => ({ id, title: `原分组 ${id}`, node_ids: ids, role });
const sorted = values => [...values].sort();
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function assertComplete(graph, presentation) {
  const ids = sorted(graph.nodes.map(node => node.id));
  assert.deepEqual(sorted(presentation.positions.keys()), ids);
  assert.equal(new Set([...presentation.positions.values()].map(({ x, y }) => `${x},${y}`)).size, ids.length);
  for (const { x, y } of presentation.positions.values()) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), 'all coordinates are finite');
  }
  for (const set of [presentation.overview, presentation.reference, presentation.support]) {
    for (const id of set) assert.ok(presentation.positions.has(id), 'membership uses original nodes only');
  }
  assert.deepEqual(sorted(presentation.groupTitles.keys()), ids);
}
function components(graph) {
  const neighbors = new Map(graph.nodes.map(node => [node.id, new Set()]));
  graph.relations.forEach(({ from_id: from, to_id: to }) => {
    neighbors.get(from).add(to); neighbors.get(to).add(from);
  });
  const unseen = new Set(neighbors.keys()), result = [];
  while (unseen.size) {
    const ids = [unseen.values().next().value]; unseen.delete(ids[0]);
    for (let i = 0; i < ids.length; i++) {
      for (const next of neighbors.get(ids[i])) if (unseen.delete(next)) ids.push(next);
    }
    result.push(ids);
  }
  return result;
}
function assertOverviewRoutes(graph, presentation) {
  for (const ids of components(graph)) {
    const visible = ids.filter(id => presentation.overview.has(id));
    assert.ok(visible.length > 0, 'every independent component has an entry');
    if (ids.length > 1) assert.ok(visible.length > 1, 'nontrivial components expose real edges, not a lone point');
    const reached = new Set([visible[0]]);
    let previousSize;
    do {
      previousSize = reached.size;
      for (const { from_id: from, to_id: to } of graph.relations) {
        if (!presentation.overview.has(from) || !presentation.overview.has(to)) continue;
        if (reached.has(from)) reached.add(to);
        if (reached.has(to)) reached.add(from);
      }
    } while (reached.size !== previousSize);
    assert.deepEqual(sorted(reached), sorted(visible), 'visible group entries connect along original relations');
  }
  for (const original of structureReadingGroups(graph)) {
    assert.ok(original.ids.some(id => presentation.overview.has(id)), 'every original group has an overview entry');
  }
}
function assertCompact(presentation) {
  const points = [...presentation.positions.values()];
  const width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
  const height = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y));
  assert.ok(width > 0 && height > 0, 'a large graph uses both dimensions');
  assert.ok(Math.max(width / height, height / width) < 8, 'large graphs do not become an unbounded one-dimensional strip');
}

test('any populated curated industry can enter; legacy/source and unloaded data cannot', () => {
  for (const id of ['new-research-2077', 'photovoltaics', 'constructor', 'toString', '__proto__']) {
    const graph = graphOf(['a', 'b'], [relation('a', 'b')], undefined, id);
    assert.equal(usesChainLayout(graph), true);
    assertComplete(graph, structureLayout(graph));
  }
  for (const source_kind of ['source', 'legacy', undefined]) {
    const graph = { ...graphOf(['a']), source_kind };
    assert.equal(usesChainLayout(graph), false);
    assert.equal(structureLayout(graph), null);
  }
  for (const graph of [null, {}, { source_kind: 'curated_v02', industry: { id: 'new' } }, graphOf([]),
    { ...graphOf(['a']), relations: undefined }]) {
    assert.equal(usesChainLayout(graph), false);
    assert.equal(structureLayout(graph), null);
  }
});

test('overview retains a directed original path, every group and every independent component', () => {
  const graph = graphOf(
    ['a', 'b', 'c', 'd', 'side', 'leaf', 'x', 'y', 'alone'],
    [relation('a', 'b'), relation('b', 'c'), relation('c', 'd'), relation('side', 'b', 'support', 'supports'),
      relation('c', 'leaf'), relation('x', 'y')],
    [group('inputs', ['a', 'side']), group('process', ['b', 'c', 'd']),
      group('branch', ['leaf']), group('independent', ['x', 'y']), group('isolate', ['alone'])]
  );
  graph.structure.primary_relation_ids = ['a->b', 'b->c', 'c->d'];
  const before = structuredClone(graph);
  const presentation = structureLayout(freeze(graph));
  assertComplete(graph, presentation);
  assertOverviewRoutes(graph, presentation);
  for (const id of ['a', 'b', 'c', 'd', 'x', 'y']) {
    assert.ok(presentation.reference.has(id), 'default path is more than a component representative');
  }
  assert.ok(presentation.overview.has('alone'));
  assert.equal(presentation.reference.has('alone'), false, 'isolated entries are not labeled as relationship paths');
  assert.deepEqual(graph, before, 'relations, directions, evidence, scope, names and groups remain unchanged');
  assert.equal(presentation.labels.size, 0, 'new industries do not acquire invented aliases');
  assert.equal(presentation.groupTitles.get('leaf'), '原分组 branch');
  assert.equal(graph.relations.some(edge => edge.from_id === 'alone' || edge.to_id === 'alone'), false);
});

test('a remote group entry reveals every intermediate node on a real connecting route', () => {
  const graph = graphOf(['a', 'b', 'c', 'd', 'e', 'u', 'v', 'w', 'remote'], [
    relation('a', 'b'), relation('b', 'c'), relation('c', 'd'), relation('d', 'e'),
    relation('b', 'u'), relation('v', 'u'), relation('v', 'w'), relation('remote', 'w')
  ], [group('main', ['a', 'b', 'c', 'd', 'e', 'u', 'v', 'w']), group('remote', ['remote'])]);
  const presentation = structureLayout(graph);
  assertComplete(graph, presentation);
  assertOverviewRoutes(graph, presentation);
  for (const id of ['u', 'v', 'w', 'remote']) assert.ok(presentation.overview.has(id));
});

test('cycles, reverse/parallel relations, self loops and ungrouped isolated nodes terminate and remain accessible', () => {
  const graph = graphOf(['a', 'b', 'c', 'self', 'alone', 'x', 'y'], [
    relation('a', 'b'), relation('b', 'c'), relation('c', 'a'), relation('b', 'a'),
    relation('a', 'b', 'parallel', 'supports'), relation('self', 'self'), relation('x', 'y')
  ]);
  const before = structuredClone(graph);
  const presentation = structureLayout(freeze(graph));
  assertComplete(graph, presentation);
  assertOverviewRoutes(graph, presentation);
  assert.ok(presentation.reference.size >= 5, 'cycles expose a path as well as other components');
  assert.deepEqual(graph, before);
});

test('one isolated node needs no groups or fabricated edge', () => {
  const graph = graphOf(['only']);
  const presentation = structureLayout(graph);
  assertComplete(graph, presentation);
  assert.deepEqual([...presentation.overview], ['only']);
  assert.equal(graph.relations.length, 0);
  assert.equal(presentation.support.size, 0);
});

test('original group order/titles survive duplicate membership, stale IDs and ungrouped nodes', () => {
  const graph = graphOf(['a', 'b', 'c', 'unassigned'], [relation('a', 'b'), relation('b', 'c')], [
    group('second', ['b', 'c', 'missing'], 'support'), group('first', ['a', 'b', 'a'])
  ]);
  graph.structure.reading_order = ['first', 'first', 'absent', 'second'];
  const before = structuredClone(graph);
  const groups = structureReadingGroups(freeze(graph));
  assert.deepEqual(groups.map(item => item.id), ['first', 'second', 'other']);
  assert.deepEqual(groups.map(item => item.ids), [['a', 'b'], ['c'], ['unassigned']]);
  const presentation = structureLayout(graph);
  assertComplete(graph, presentation);
  assertOverviewRoutes(graph, presentation);
  assert.equal(presentation.groupTitles.get('b'), '原分组 first');
  assert.deepEqual([...presentation.support], ['c']);
  assert.deepEqual(graph, before);
});

test('positions are deterministic, array-order independent, and independent of visibility collections', () => {
  const graph = graphOf(['d', 'c', 'b', 'a', 'side', 'tip', 'z'], [
    relation('a', 'b'), relation('b', 'c'), relation('c', 'd'), relation('b', 'side'), relation('c', 'tip')
  ], [group('core', ['a', 'b', 'c', 'd', 'side', 'tip']), group('separate', ['z'])]);
  const baseline = structureLayout(graph);
  assert.deepEqual(structureLayout(graph), baseline);
  const reordered = { ...graph, nodes: [...graph.nodes].reverse(), relations: [...graph.relations].reverse() };
  assert.deepEqual(structureLayout(reordered), baseline);
  assert.equal(baseline.overview.has('side'), false);
  assert.equal(baseline.overview.has('tip'), false);
  const modes = [new Set(baseline.overview), new Set([...baseline.overview, 'side']), new Set(graph.nodes.map(node => node.id))];
  for (const visible of modes) {
    const next = structureLayout(graph);
    for (const id of visible) assert.deepEqual(next.positions.get(id), baseline.positions.get(id));
  }
  const changed = structureLayout(graph);
  changed.overview.clear(); changed.reference.clear(); changed.positions.get('a').x += 999;
  assert.deepEqual(structureLayout(graph), baseline, 'presentation objects do not leak mutable state to another view');
  const ungrouped = graphOf(graph.nodes.filter(node => node.id !== 'z').map(node => node.id), graph.relations);
  assert.deepEqual(structureLayout(ungrouped), structureLayout({
    ...ungrouped, nodes: [...ungrouped.nodes].reverse(), relations: [...ungrouped.relations].reverse()
  }));
});

test('many original groups and a single large group both have complete, compact 2D positions', () => {
  const ids = Array.from({ length: 144 }, (_, index) => `n-${String(index).padStart(3, '0')}`);
  const edges = ids.slice(1).map((id, index) => relation(ids[index], id));
  for (const groups of [undefined, ids.map(id => group(`g-${id}`, [id])),
    Array.from({ length: 12 }, (_, index) => group(`g-${index}`, ids.slice(index * 12, index * 12 + 12)))]) {
    const graph = freeze(graphOf(ids, edges, groups));
    const presentation = structureLayout(graph);
    assertComplete(graph, presentation);
    assertOverviewRoutes(graph, presentation);
    assertCompact(presentation);
    assert.deepEqual(structureLayout(graph), presentation);
  }
});

const reviewed = [
  { id: 'crude-oil', prefix: 'node:', main: ['petroleum-geological-exploration', 'crude-petroleum', 'petroleum-refining'],
    support: 'hydraulic-fracturing-services', supportGroup: 'support',
    labelId: 'petroleum-geological-exploration', label: '油气地质 / 地球物理勘探' },
  { id: 'gold', prefix: 'gold:', main: ['exploration', 'mining', 'prepared_ore'],
    support: 'assay_services', supportGroup: 'support', labelId: 'prepared_ore', label: '破碎磨细的含金物料' },
  { id: 'grid', prefix: 'grid:', main: ['winding_metals', 'transformer_manufacturing', 'grid_engineering_service'],
    support: 'relay_protection_device', supportGroup: 'control', labelId: 'grid_engineering_service', label: '电网工程 / 系统集成服务' },
  { id: 'innovative-drugs', prefix: 'innovative-drugs:', main: ['discovery', 'candidate', 'clinical_trials'],
    support: 'clinical_services', supportGroup: 'cxo', labelId: 'discovery', label: '药物发现 / 筛选优化' }
];
for (const spec of reviewed) {
  test(`reviewed ${spec.id} presentation stays dedicated, with stable known slots when future nodes arrive`, () => {
    const main = spec.main.map(id => spec.prefix + id), support = spec.prefix + spec.support;
    const graph = graphOf([...main, support], [], [group('core', main), group(spec.supportGroup, [support])], spec.id);
    const baseline = structureLayout(freeze(graph));
    assertComplete(graph, baseline);
    assert.deepEqual(sorted(baseline.reference), sorted(main));
    assert.equal(baseline.labels.get(spec.prefix + spec.labelId), spec.label);
    assert.ok(baseline.support.has(support));
    assert.equal(baseline.referenceLabel, '蓝框 · 展示骨架');
    const extended = { ...graph, nodes: [...graph.nodes, { id: 'future-node', kind: 'service', name: '原新增节点' }] };
    const presentation = structureLayout(extended);
    assertComplete(extended, presentation);
    for (const node of graph.nodes) assert.deepEqual(presentation.positions.get(node.id), baseline.positions.get(node.id));
    assert.deepEqual(presentation.reference, baseline.reference);
    assert.ok(presentation.overview.has('future-node'), 'reviewed chain still exposes an independent new component');
  });
}

test('AI remains eligible but is not replaced by a generic structure presentation', () => {
  const graph = graphOf(['node_gpu_tensor_core', 'node_dgx_b200_server'],
    [relation('node_gpu_tensor_core', 'node_dgx_b200_server')], undefined, 'ai-compute');
  assert.equal(usesChainLayout(graph), true);
  // The adapter continues to call the unchanged reviewedAiPresentation, not this builder.
  assert.equal(structureLayout(graph), null);
});
