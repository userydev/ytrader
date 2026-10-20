"""Installed-topic navigation. Membership comes from packages; facts come from live DB rows."""
from __future__ import annotations

import json
import re

from .catalog import PACKAGE_NAMES
from .config import UserError
from .research import Research


BROAD_LABELS = {'公司', '产业', '行业', '产品', '供应链', '材料', '制造', '制造业', '业务', '市场', '其他制造业'}


def broad_node(node):
    label = re.sub(r'^[A-Za-z\d\s、.]+', '', node['label']).strip()
    return label in BROAD_LABELS


def business_node(node):
    return node.get('kind') in ('product', 'segment') and not broad_node(node)


class Topics:
    def __init__(self, db, research):
        self.db, self.research = db, research

    def installed(self):
        with self.db.connect() as c:
            nodes = {r[0]: json.loads(r[1]) for r in c.execute('SELECT id,data FROM nodes')}
            edges = {r[0]: json.loads(r[1]) for r in c.execute('SELECT id,data FROM edges')}
            packages = [json.loads(r[0]) for r in c.execute('SELECT data FROM packages ORDER BY id')]
        result = []
        for package in packages:
            members = {n['id']: nodes[n['id']] for n in package['nodes'] if n['id'] in nodes and not broad_node(nodes[n['id']])}
            relations = [edges[e['id']] for e in package['edges'] if e['id'] in edges
                         and edges[e['id']]['from_id'] in members and edges[e['id']]['to_id'] in members]
            result.append((package, members, relations))
        return result

    @staticmethod
    def name(package):
        return PACKAGE_NAMES.get(package['id']) or package.get('name') or package['id'].replace('-', ' ').replace('_', ' ')

    @staticmethod
    def company_links(nodes, edges, symbols):
        # A company merely sharing a market-wide industry is not a business association.
        result = []
        for edge in edges:
            a, b = nodes[edge['from_id']], nodes[edge['to_id']]
            if a.get('symbol') in symbols and a['kind'] == 'company' and business_node(b):
                result.append((a, b, edge))
            elif b.get('symbol') in symbols and b['kind'] == 'company' and business_node(a):
                result.append((b, a, edge))
        return result

    def list(self, event_id='', symbol=''):
        symbols, body = set(), ''
        if event_id:
            with self.db.connect() as c:
                row = c.execute('SELECT title,summary FROM events WHERE id=?', (event_id,)).fetchone()
                if not row:
                    raise UserError('事件不存在', 404)
                body = row['title'] + '\n' + row['summary'] + '\n' + '\n'.join(
                    r['title'] + '\n' + r['content'] for r in c.execute('SELECT title,content FROM articles WHERE event_id=?', (event_id,)))
                symbols = {r[0] for r in c.execute('SELECT symbol FROM event_symbols WHERE event_id=?', (event_id,))}
        items = []
        for package, nodes, edges in self.installed():
            event_matches, symbol_matches, evidence = set(), set(), set()
            if event_id:
                for nid, node in nodes.items():
                    if business_node(node) and len(node['label']) >= 2 and node['label'].casefold() in body.casefold():
                        related = [e for e in edges if nid in (e['from_id'], e['to_id'])]
                        if related:
                            event_matches.add('产品/环节：' + node['label'])
                            evidence.update(x for e in related for x in e['evidence_ids'])
                mentioned_symbols = symbols | {n['symbol'] for n in nodes.values() if n.get('symbol') and
                    ((len(n['label']) >= 2 and n['label'] in body) or re.search(r'(?<!\d)' + re.escape(n['symbol'].split(':')[1]) + r'(?!\d)', body))}
                for company, business, edge in self.company_links(nodes, edges, mentioned_symbols):
                    event_matches.add('公司业务：' + company['label'] + ' · ' + business['label'])
                    evidence.update(edge['evidence_ids'])
            if symbol:
                for company, business, edge in self.company_links(nodes, edges, {symbol}):
                    symbol_matches.add('公司业务：' + company['label'] + ' · ' + business['label'])
                    evidence.update(edge['evidence_ids'])
            if (event_id and not event_matches) or (symbol and not symbol_matches):
                continue
            items.append(dict(id=package['id'], name=self.name(package), description=package.get('description', ''),
                              company_count=sum(n['kind'] == 'company' for n in nodes.values()),
                              product_count=sum(n['kind'] == 'product' for n in nodes.values()),
                              relation_count=len(edges), matched_by=sorted(event_matches | symbol_matches), evidence_ids=sorted(evidence)))
        return dict(items=items, context=dict(event_id=event_id or None, symbol=symbol or None))

    def graph(self, topic_id):
        for package, nodes, edges in self.installed():
            if package['id'] != topic_id:
                continue
            selected = set(nodes)
            paths = self.research._paths(selected, edges, selected, primary_seeds=selected, limit=201)
            gaps = ['研究路径过多，已截断为200条；请缩小范围'] if len(paths) > 200 else []
            return dict(nodes=[nodes[n] for n in sorted(nodes)], edges=edges, paths=paths[:200], gaps=gaps)
        raise UserError('已安装产业主题不存在', 404)

    def businesses(self, symbol):
        with self.db.connect() as c:
            nodes = {r[0]: json.loads(r[1]) for r in c.execute('SELECT id,data FROM nodes')}
            edges = [json.loads(r[0]) for r in c.execute('SELECT data FROM edges ORDER BY id')]
        found = {}
        for _, business, edge in self.company_links(nodes, edges, {symbol}):
            item = found.setdefault(business['id'], dict(node_id=business['id'], label=business['label'], kind=business['kind'], evidence_ids=[]))
            item['evidence_ids'] = sorted(set(item['evidence_ids']) | set(edge['evidence_ids']))
        return [found[k] for k in sorted(found)]


def company_graph(graph, symbol):
    """Own businesses and non-company neighbors only, never another stock's research."""
    nodes = {n['id']: n for n in graph['nodes']}
    roots = {nid for nid, n in nodes.items() if n.get('symbol') == symbol and n['kind'] == 'company'}
    allowed = roots | {nid for nid, n in nodes.items() if business_node(n)}
    edges = [e for e in graph['edges'] if e['from_id'] in allowed and e['to_id'] in allowed]
    selected, frontier = set(roots), set(roots)
    for _ in range(3):
        additions = {other for e in edges for here, other in ((e['from_id'], e['to_id']), (e['to_id'], e['from_id'])) if here in frontier} - selected
        selected.update(additions)
        frontier = additions
    edges = [e for e in edges if e['from_id'] in selected and e['to_id'] in selected]
    return dict(nodes=[nodes[n] for n in sorted(selected)], edges=edges,
                paths=Research._paths(selected, edges, roots, primary_seeds=roots), gaps=[])
