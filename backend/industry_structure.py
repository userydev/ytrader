"""Industry-independent structure checks and read-only legacy organization."""
from __future__ import annotations

import copy


def check_structure(graph):
    """Raise ValueError for incomplete organization; never change factual edges."""
    structure = graph.get('structure')
    if not isinstance(structure, dict) or type(structure.get('version')) is not int or structure['version'] != 1:
        raise ValueError('解释结构版本无效')
    if structure.get('organization') not in ('production', 'composition', 'development', 'mixed'):
        raise ValueError('解释机制无效')
    if not isinstance(structure.get('thesis'), str) or not structure['thesis'].strip():
        raise ValueError('缺少解释主旨')
    groups = structure.get('groups')
    if not isinstance(groups, list) or not groups:
        raise ValueError('缺少解释分组')
    owners, roles, group_ids = {}, {}, []
    for group in groups:
        gid = group['id']
        if gid in roles or group['role'] not in ('core', 'support'):
            raise ValueError('分组标识重复或角色无效')
        if not group['title'].strip() or not group['purpose'].strip() or not group['node_ids']:
            raise ValueError('分组缺少必要性解释或环节')
        group_ids.append(gid)
        roles[gid] = group['role']
        for nid in group['node_ids']:
            if nid in owners:
                raise ValueError('环节重复分组')
            owners[nid] = gid
    if set(owners) != {node['id'] for node in graph['nodes']}:
        raise ValueError('分组未完整覆盖环节或引用未知环节')
    if 'core' not in roles.values():
        raise ValueError('解释结构缺少主干')
    order = structure.get('reading_order', [])
    if len(order) != len(group_ids) or set(order) != set(group_ids):
        raise ValueError('阅读顺序必须完整且不重复')
    primary = structure.get('primary_relation_ids', [])
    edges = {edge['id']: edge for edge in graph['relations']}
    if len(primary) != len(set(primary)) or not set(primary) <= set(edges):
        raise ValueError('主干关系重复或引用未知关系')
    for rid in primary:
        edge = edges[rid]
        if any(roles[owners[edge[key]]] != 'core' for key in ('from_id', 'to_id')):
            raise ValueError('主干关系两端必须属于主干组')
    # A support group may reach a core through another support group. No edge is invented.
    adjacent = {gid: set() for gid in group_ids}
    for edge in graph['relations']:
        a, b = owners[edge['from_id']], owners[edge['to_id']]
        adjacent[a].add(b)
        adjacent[b].add(a)
    reached = {gid for gid in group_ids if roles[gid] == 'core'}
    pending = list(reached)
    while pending:
        for gid in adjacent[pending.pop()] - reached:
            reached.add(gid)
            pending.append(gid)
    if set(group_ids) != reached:
        raise ValueError('配套分组缺少通向主干对象的真实关系')


def directed_levels(ids, pairs):
    """Condense strongly connected components before ranking; retain cycles/isolates."""
    adjacent = {nid: [] for nid in ids}
    for a, b in pairs:
        if a in adjacent and b in adjacent:
            adjacent[a].append(b)
    indices, low, stack, active, components = {}, {}, [], set(), []

    def visit(nid):
        indices[nid] = low[nid] = len(indices)
        stack.append(nid)
        active.add(nid)
        for other in adjacent[nid]:
            if other not in indices:
                visit(other)
                low[nid] = min(low[nid], low[other])
            elif other in active:
                low[nid] = min(low[nid], indices[other])
        if low[nid] == indices[nid]:
            component = []
            while True:
                other = stack.pop()
                active.remove(other)
                component.append(other)
                if other == nid:
                    break
            components.append(component)

    for nid in ids:
        if nid not in indices:
            visit(nid)
    owner = {nid: i for i, group in enumerate(components) for nid in group}
    incoming = {i: set() for i in range(len(components))}
    for a in ids:
        for b in adjacent[a]:
            if owner[a] != owner[b]:
                incoming[owner[b]].add(owner[a])
    ranks = {}

    def rank(i):
        if i not in ranks:
            ranks[i] = max((rank(j) + 1 for j in incoming[i]), default=0)
        return ranks[i]

    return {nid: rank(owner[nid]) for nid in ids}


def legacy_structure(graph):
    nodes, edges = graph['nodes'], graph['relations']
    material = {edge[key] for edge in edges if edge['kind'] != 'supports' for key in ('from_id', 'to_id')}
    support = {node['id'] for node in nodes if node['id'] not in material
               and any(edge['from_id'] == node['id'] and edge['kind'] == 'supports' for edge in edges)}
    core = [node['id'] for node in nodes if node['id'] not in support]
    if not core:
        core = [node['id'] for node in nodes]
        support = set()
    # Disconnected support-only components must not be hidden or claim an attachment.
    adjacent = {node['id']: set() for node in nodes}
    for edge in edges:
        adjacent[edge['from_id']].add(edge['to_id'])
        adjacent[edge['to_id']].add(edge['from_id'])
    reached, pending = set(core), list(core)
    while pending:
        for nid in adjacent[pending.pop()] - reached:
            reached.add(nid)
            pending.append(nid)
    core.extend(node['id'] for node in nodes if node['id'] not in reached)
    support &= reached
    levels = directed_levels(core, [(edge['from_id'], edge['to_id']) for edge in edges])
    maximum = max(levels.values(), default=0)
    buckets = {}
    for nid in core:
        bucket = min(5, levels[nid] * 6 // (maximum + 1))
        buckets.setdefault(bucket, []).append(nid)
    by_id = {node['id']: node for node in nodes}
    groups = []
    for index, ids in sorted(buckets.items()):
        groups.append(dict(id=f'legacy-core-{index}', title=' / '.join(by_id[nid]['name'] for nid in ids[:2]) + ('等' if len(ids) > 2 else ''),
                           role='core', purpose='兼容归组：' + '；'.join(by_id[nid]['description'] for nid in ids[:3]), node_ids=ids))
    if support:
        groups.append(dict(id='legacy-support', title='配套与服务', role='support',
                           purpose='按已有支撑边归组；分别挂接下方标明的对象，不代表必经阶段。',
                           node_ids=[node['id'] for node in nodes if node['id'] in support]))
    return dict(version=1, organization='mixed', thesis=graph['explanation'].get('overview') or graph['industry']['summary'],
                groups=groups, primary_relation_ids=[edge['id'] for edge in edges if edge['from_id'] in core and edge['to_id'] in core],
                reading_order=[group['id'] for group in groups])


def reading_graph(graph):
    """Return an output copy only. Stored data/version fingerprints remain untouched."""
    result = copy.deepcopy(graph)
    try:
        check_structure(result)
    except (ValueError, KeyError, TypeError):
        result['structure'] = legacy_structure(result)
        result['structure_origin'] = 'compatibility'
        result['structure_notice'] = '历史结构缺失或不完整：仅按已有关系兼容组织，未通过新生成结构检查；顺序不是新增事实，可继续提问重新组织。'
    else:
        if result.get('structure_origin') != 'compatibility':
            result['structure_origin'] = 'provided'
            result.pop('structure_notice', None)
    return result
