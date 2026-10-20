from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .config import UserError, validate_url
from .db import dump
from .models import ChainPackage, utcnow, iso
from .algorithms.event_grouping import normalized, hours, merge_safe, same_event
from .algorithms.security_matching import build_matcher, match_symbols
from .algorithms.recommendation import research_score, research_hot


def identity(*parts):
    return hashlib.sha256('\x1f'.join(str(p) for p in parts).encode()).hexdigest()[:32]


def canonical_url(url):
    url = validate_url(url)
    u = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True)
             if not k.lower().startswith('utm_') and k.lower() not in ('spm', 'from', 'source', 'ref', 'share', 'share_id')]
    host = u.netloc.lower().removeprefix('www.')
    return urlunsplit((u.scheme.lower(), host, u.path.rstrip('/') or '/', urlencode(sorted(query)), ''))


class Research:
    def __init__(self, db, decision=None):
        from .decisions import RulesProvider
        self.db = db
        self.decision = decision or RulesProvider()
        self.rules = RulesProvider()

    def decide(self, task, inputs):
        try:
            return self.decision.decide(task, inputs).value
        except Exception:
            self.decision_warning = '决策模型失败，已回退规则；未使用失败输出'
            return self.rules.decide(task, inputs).value

    def ingest(self, article):
        # Preserve the historical event-id / None return contract.
        from .news import NewsStore
        result = NewsStore(self).ingest(article)
        return None if result['status'] == 'duplicate' else result['event_id']

    @staticmethod
    def _build_symbol_matcher(c):
        # Keep compiled patterns alive for this operation, even when the security
        # catalogue exceeds re's cache. Never cache across security updates.
        return build_matcher(c.execute('SELECT symbol,code,name FROM securities'))

    def _match_symbols(self, c, eid, matcher=None):
        if matcher is None:
            matcher = self._build_symbol_matcher(c)
        articles = c.execute('SELECT title,content FROM articles WHERE event_id=?', (eid,)).fetchall()
        body = '\n'.join(r['title'] + '\n' + r['content'] for r in articles)
        for symbol in match_symbols(body, matcher):
            c.execute('INSERT OR IGNORE INTO event_symbols VALUES (?,?)', (eid, symbol))

    def reindex_symbols(self):
        with self.db.transaction() as c:
            matcher = self._build_symbol_matcher(c)
            for row in c.execute('SELECT id FROM events').fetchall():
                before = {r[0] for r in c.execute('SELECT symbol FROM event_symbols WHERE event_id=?', (row[0],))}
                self._match_symbols(c, row[0], matcher)
                after = {r[0] for r in c.execute('SELECT symbol FROM event_symbols WHERE event_id=?', (row[0],))}
                if before != after:
                    self.db.mark_stale(c, row[0])

    def _affinity(self, c):
        nodes = {r[0]: json.loads(r[1]) for r in c.execute('SELECT id,data FROM nodes')}
        industry_by_symbol = {}
        adjacency = {}
        for edge_row in c.execute('SELECT data FROM edges'):
            edge = json.loads(edge_row[0])
            if not edge.get('evidence_ids'):
                continue
            adjacency.setdefault(edge['from_id'], set()).add(edge['to_id'])
            adjacency.setdefault(edge['to_id'], set()).add(edge['from_id'])
            if edge['relation'] == 'classification':
                sym = nodes.get(edge['from_id'], {}).get('symbol')
                if sym:
                    industry_by_symbol.setdefault(sym, set()).add(edge['to_id'])
        return nodes, industry_by_symbol, adjacency

    def _event(self, c, row, watch, affinity=None):
        symbols = [r[0] for r in c.execute('SELECT symbol FROM event_symbols WHERE event_id=? ORDER BY symbol', (row['id'],))]
        from .news import event_projection
        projection, primary = event_projection(c, row['id'])
        sources = projection['source_names']
        count = projection['article_count']
        # Legacy events are projected from their latest readable version too.
        row = dict(row)
        if primary:
            row.update(title=primary['title'], summary=primary['content'][:500], published_at=primary['published_at'])
        nodes, industry_by_symbol, adjacency = affinity or self._affinity(c)
        relevance, score = research_score(row, symbols, watch, nodes, industry_by_symbol, adjacency, sources, now=utcnow())
        return dict(id=row['id'], title=row['title'], summary=row['summary'], published_at=row['published_at'],
                    updated_at=row['updated_at'], importance=row['importance'], relevance=relevance, score=score,
                    article_count=count, source_names=sources, symbols=symbols, tags=json.loads(row['tags']), analysis_status=row['analysis_status'],
                    source_count=projection['source_count'], latest_published_at=projection['latest_published_at'],
                    quality_flags=projection['quality_flags'], merge_reason=projection['merge_reason'],
                    primary_article_id=projection['primary_article_id'])

    def events(self, q='', limit=50, symbol=None, *, source='', period='all', sort='latest', content_level='all', tag=''):
        if period not in ('all', '24h', '7d') or sort not in ('latest', 'hot') or content_level not in ('all', 'full', 'summary', 'title'):
            raise UserError('新闻筛选取值无效', 422)
        limit = max(1, min(int(limit), 500))
        watch = self.db.get('watchlist', [])
        with self.db.connect() as c:
            params, conditions, article_conditions = [], [], ['a.event_id=e.id']
            # A single current article must satisfy source, level, search and
            # period together. Historical versions remain available in detail.
            article_conditions.append('NOT EXISTS (SELECT 1 FROM articles n WHERE n.source_id=a.source_id AND n.identity_key=a.identity_key AND n.rowid>a.rowid)')
            if q:
                article_conditions.append('(instr(lower(a.title),lower(?))>0 OR instr(lower(a.content),lower(?))>0)')
                params.extend([q, q])
            if source:
                article_conditions.append('a.source=?')
                params.append(source)
            if content_level != 'all':
                article_conditions.append('a.content_level=?')
                params.append(content_level)
            if period != 'all':
                from datetime import timedelta
                since = (datetime.now(timezone.utc) - timedelta(hours=24 if period == '24h' else 168)).isoformat().replace('+00:00', 'Z')
                article_conditions.extend(['julianday(a.published_at)>=julianday(?)', "a.quality_flags NOT LIKE '%future_published_at%'", "a.quality_flags NOT LIKE '%invalid_published_at%'"])
                params.append(since)
            conditions.append('EXISTS (SELECT 1 FROM articles a WHERE ' + ' AND '.join(article_conditions) + ')')
            if symbol:
                conditions.append('e.id IN (SELECT event_id FROM event_symbols WHERE symbol=?)')
                params.append(symbol)
            # JSON membership is checked in Python to support older SQLite builds
            # and to avoid substring/LIKE matching of topic labels.
            rows = c.execute('SELECT e.* FROM events e WHERE ' + ' AND '.join(conditions), params).fetchall()
            affinity = self._affinity(c)
            result = [self._event(c, row, watch, affinity) for row in rows if not tag or tag in json.loads(row['tags'])]
        if sort == 'latest':
            from .news import timestamp
            return sorted(result, key=lambda e: (bool(e['latest_published_at']), timestamp(e['latest_published_at']) if e['latest_published_at'] else datetime.min.replace(tzinfo=timezone.utc), e['id']), reverse=True)[:limit]
        # Hot is a local rule score, never a reading-count / global popularity claim.
        return research_hot(result, limit)

    def detail(self, eid):
        with self.db.connect() as c:
            row = c.execute('SELECT * FROM events WHERE id=?', (eid,)).fetchone()
            if not row:
                raise UserError('事件不存在', 404)
            event = self._event(c, row, self.db.get('watchlist', []))
            from .news import article_public, ordered_articles
            articles = [article_public(r) for r in c.execute('SELECT * FROM articles WHERE event_id=? ORDER BY rowid DESC', (eid,))]
            # Primary first, then newest version heads, then historical versions.
            # Explicit supersession is stronger than a publisher's corrected date.
            superseded = {a['supersedes_id'] for a in articles if a.get('supersedes_id')}
            heads = {a['identity_key']: a['id'] for a in reversed(articles)}
            current = [a for a in articles if heads[a['identity_key']] == a['id'] and a['id'] not in superseded]
            history = [a for a in articles if a not in current]
            articles = sorted(ordered_articles(current), key=lambda a: a['id'] != event['primary_article_id']) + history
            analysis = c.execute('SELECT data FROM analyses WHERE event_id=?', (eid,)).fetchone()
        return dict(event=event, articles=articles, primary_article_id=event['primary_article_id'],
                    analysis=json.loads(analysis[0]) if analysis else None, paths=self.chain(event_id=eid)['paths'])

    def securities(self, q='', exchange='', limit=100, offset=0):
        if type(offset) is not int or offset < 0:
            raise UserError('offset 必须为非负整数', 422)
        conditions, args = [], []
        if q:
            conditions.append('(instr(symbol,?)>0 OR instr(name,?)>0 OR instr(coalesce(industry,\'\'),?)>0)')
            args.extend([q, q, q])
        if exchange:
            conditions.append('exchange=?')
            args.append(exchange)
        with self.db.connect() as c:
            return [dict(r) for r in c.execute('SELECT * FROM securities' + (' WHERE ' + ' AND '.join(conditions) if conditions else '') + ' ORDER BY symbol LIMIT ? OFFSET ?', args + [limit, offset])]

    def security(self, symbol):
        with self.db.connect() as c:
            row = c.execute('SELECT * FROM securities WHERE symbol=?', (symbol,)).fetchone()
        if not row:
            raise UserError('证券不存在，请先同步证券主表', 404)
        return dict(security=dict(row), events=self.events(symbol=symbol), paths=self.chain(symbol=symbol)['paths'])

    def store_securities(self, exchange, rows, complete):
        with self.db.transaction() as c:
            for row in rows:
                if row['exchange'] != exchange or row['symbol'] != exchange + ':' + row['code']:
                    raise UserError('证券来源交易所不一致')
                c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET name=excluded.name,industry=excluded.industry,status=excluded.status,as_of=excluded.as_of,source=excluded.source',
                          tuple(row.get(k) for k in ('symbol', 'code', 'name', 'exchange', 'industry', 'status', 'as_of', 'source')))
                self._classification(c, row)
            # Absence is NOT proof of delisting, even in a seemingly complete public snapshot.
            # Explicit exchange delisting disclosures can be integrated separately.
        self.reindex_symbols()

    def _classification(self, c, security):
        symbol, industry = security['symbol'], security.get('industry')
        company = dict(id='company:' + symbol, label=security['name'], kind='company', symbol=symbol)
        self._upsert_json(c, 'nodes', company)
        edge_id = 'classification:' + symbol
        if not industry:
            if c.execute('SELECT 1 FROM edges WHERE id=?', (edge_id,)).fetchone():
                c.execute('DELETE FROM edges WHERE id=?', (edge_id,))
                self._stale_all(c)
            return
        node = dict(id='industry:' + identity(industry), label=industry, kind='industry')
        url = security.get('_source_url') or 'https://quote.eastmoney.com/center/gridlist.html'
        evidence = dict(id='security-industry:' + symbol, title=security['name'] + '所属行业（公开主表）', url=url,
                        excerpt=f"{symbol} {security['name']}；所属行业：{industry}。仅为行业分类，不代表供应关系。来源：{security['source']}。",
                        published_at=None, source=security['source'])
        edge = dict(id=edge_id, from_id=company['id'], to_id=node['id'], relation='classification',
                    evidence_ids=[evidence['id']], confidence=None, as_of=security['as_of'], source_url=url)
        old = c.execute('SELECT data FROM edges WHERE id=?', (edge_id,)).fetchone()
        old_evidence = c.execute('SELECT data FROM evidence WHERE id=?', (evidence['id'],)).fetchone()
        self._upsert_json(c, 'nodes', node)
        self._upsert_json(c, 'evidence', evidence)
        self._upsert_json(c, 'edges', edge)
        changed = not old or {k: v for k, v in json.loads(old[0]).items() if k != 'as_of'} != {k: v for k, v in edge.items() if k != 'as_of'} or not old_evidence or json.loads(old_evidence[0]) != evidence
        if changed:
            for row in c.execute('SELECT event_id FROM event_symbols WHERE symbol=?', (symbol,)).fetchall():
                self.db.mark_stale(c, row[0])

    @staticmethod
    def _upsert_json(c, table, data):
        assert table in ('nodes', 'edges', 'evidence')
        c.execute(f'INSERT INTO {table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (data['id'], dump(data)))

    def _stale_all(self, c):
        for row in c.execute('SELECT event_id FROM analyses').fetchall():
            self.db.mark_stale(c, row[0])

    @staticmethod
    def validate_chain(package: ChainPackage):
        licenses = {'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'ODC-BY-1.0', 'ODbL-1.0', 'PDDL-1.0', 'MIT', 'Apache-2.0'}
        if package.license not in licenses:
            raise UserError('未知或未明确授权的许可；请提供受支持的 SPDX 许可标识')
        validate_url(package.source_url)
        if datetime.fromisoformat(package.as_of.replace('Z', '+00:00')) > datetime.now(timezone.utc):
            raise UserError('数据时间不能在未来')
        for collection in (package.nodes, package.edges, package.evidence):
            ids = [x.id for x in collection]
            if len(ids) != len(set(ids)):
                raise UserError('包内 ID 不可重复')
        node_ids = {n.id for n in package.nodes}
        evidence = {e.id: e for e in package.evidence}
        for e in package.evidence:
            validate_url(e.url)
            if not e.excerpt.strip() or not e.source.strip():
                raise UserError('证据必须包含原文摘要与来源')
        for edge in package.edges:
            validate_url(edge.source_url)
            if edge.from_id not in node_ids or edge.to_id not in node_ids or edge.from_id == edge.to_id:
                raise UserError('关系节点引用缺失或为自引用')
            if not set(edge.evidence_ids).issubset(evidence):
                raise UserError('关系必须引用本包中的事实证据')
            if any(evidence[eid].url != edge.source_url for eid in edge.evidence_ids):
                raise UserError('关系来源 URL 必须与所引事实证据一致')
            if edge.as_of and datetime.fromisoformat(edge.as_of.replace('Z', '+00:00')) > datetime.fromisoformat(package.as_of.replace('Z', '+00:00')):
                raise UserError('关系时间不能晚于包时间')

    def import_chain(self, package: ChainPackage):
        self.validate_chain(package)
        data = package.model_dump()
        data['nodes'] = [node.model_dump(exclude_none=True) for node in package.nodes]
        with self.db.transaction() as c:
            old = c.execute('SELECT version,data FROM packages WHERE id=?', (package.id,)).fetchone()
            if old and old['version'] == package.version:
                if json.loads(old['data']) != data:
                    raise UserError('同一包版本内容冲突', 409)
                return data
            # Shared IDs may be reused only when identical. This prevents a package from silently
            # rewriting another package's facts (and reserves source-generated IDs).
            for table in ('nodes', 'edges', 'evidence'):
                for item in data[table]:
                    existing = c.execute(f'SELECT data FROM {table} WHERE id=?', (item['id'],)).fetchone()
                    if existing and json.loads(existing[0]) != item:
                        raise UserError('关系或证据 ID 冲突；更新内容请使用新的版本化 ID', 409)
                    self._upsert_json(c, table, item)
            c.execute('INSERT INTO packages VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data', (package.id, package.version, dump(data)))
            self._stale_all(c)
        return data

    def chain_directory(self, q=''):
        """Unbounded catalogue counts; the graph view's budgets never affect these."""
        with self.db.connect() as c:
            nodes = {r[0]: json.loads(r[1]) for r in c.execute('SELECT id,data FROM nodes')}
            edges = [json.loads(r[0]) for r in c.execute('SELECT data FROM edges')]
        totals = {plural: sum(n['kind'] == kind for n in nodes.values())
                  for plural, kind in (('companies', 'company'), ('industries', 'industry'),
                                       ('products', 'product'), ('segments', 'segment'))}
        totals['relations'] = len(edges)
        companies, relations = {}, {}
        for edge in edges:
            a, b = edge['from_id'], edge['to_id']
            for nid, other in ((a, b), (b, a)):
                relations[nid] = relations.get(nid, 0) + 1
                if nodes.get(other, {}).get('kind') == 'company':
                    companies.setdefault(nid, set()).add(other)
        items = [dict(id=nid, label=n['label'], kind=n['kind'],
                      company_count=len(companies.get(nid, ())), relation_count=relations.get(nid, 0))
                 for nid, n in nodes.items()
                 if n['kind'] != 'company' and q.casefold() in n['label'].casefold()]
        items.sort(key=lambda n: (n['label'], n['kind'], n['id']))
        return dict(items=items, totals=totals)

    def overview(self):
        with self.db.connect() as c:
            counts = {name: c.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
                      for name, table in (('events', 'events'), ('securities', 'securities'), ('relations', 'edges'))}
            kinds = [json.loads(r[0])['kind'] for r in c.execute('SELECT data FROM nodes')]
            counts.update(industries=kinds.count('industry'), products=kinds.count('product'))
            last_job = c.execute("SELECT max(updated_at) FROM jobs WHERE kind IN ('news','securities','all') AND status='succeeded'").fetchone()[0]
        # Fetch time is a sync time, not a claim about publication time of public data.
        candidates = [last_job, self.db.get('news_sync', {}).get('fetched_at')]
        candidates.extend(s.get('last_success') for s in self.db.sources())
        candidates.extend(o.get('fetched_at') for o in self.db.get('coverage_observations', {}).values())
        times = [iso(value) for value in candidates if value]
        latest = max(times, key=lambda value: datetime.fromisoformat(value.replace('Z', '+00:00'))) if times else None
        return dict(counts=counts, last_sync_at=latest)

    def chain(self, q='', symbol='', event_id='', node_id=''):
        with self.db.connect() as c:
            nodes = {r[0]: json.loads(r[1]) for r in c.execute('SELECT id,data FROM nodes')}
            all_edges = [json.loads(r[0]) for r in c.execute('SELECT data FROM edges ORDER BY id')]
            if node_id and node_id not in nodes:
                raise UserError('产业节点不存在', 404)
            symbols = {symbol} if symbol else set()
            event_text = ''
            if event_id:
                if not c.execute('SELECT 1 FROM events WHERE id=?', (event_id,)).fetchone():
                    raise UserError('事件不存在', 404)
                symbols.update(r[0] for r in c.execute('SELECT symbol FROM event_symbols WHERE event_id=?', (event_id,)))
                event_text = '\n'.join(r['title'] + '\n' + r['content'] for r in c.execute('SELECT title,content FROM articles WHERE event_id=?', (event_id,)))
            gaps = []
            if symbols:
                missing = [s for s in symbols if not any(n.get('symbol') == s for n in nodes.values())]
                gaps.extend('缺少公司关系节点：' + s for s in sorted(missing))
                for s in sorted(symbols):
                    row = c.execute('SELECT industry FROM securities WHERE symbol=?', (s,)).fetchone()
                    if row and not row[0]:
                        gaps.append('未知所属行业：' + s)
        generic = {'公司', '产业', '行业', '产品', '供应链', '材料', '制造', '业务', '市场'}
        mentioned = {nid for nid, n in nodes.items() if event_id and n['kind'] in ('product', 'segment', 'industry')
                     and len(n['label']) >= 2 and n['label'] not in generic and n['label'] in event_text}
        if node_id:
            seeds = {node_id}
        elif event_id:
            seeds = mentioned | {nid for nid, n in nodes.items() if n.get('symbol') in symbols}
        elif symbol:
            seeds = {nid for nid, n in nodes.items() if n.get('symbol') == symbol}
        else:
            seeds = set(nodes)
        if q and not node_id:
            seeds = {nid for nid in seeds if q.casefold() in (nodes[nid]['label'] + ' ' + (nodes[nid].get('symbol') or '')).casefold()}
        # Keep the user's roots distinct from nodes discovered during traversal. In
        # particular, discovering a company's industry is not a request for its peers.
        original_seeds = set(seeds)
        if not (q or symbol or event_id or node_id):
            # Keep the directory visible before filling the bounded view with companies.
            seeds = set(sorted(nodes, key=lambda nid: (nodes[nid]['kind'] == 'company', nodes[nid]['label'], nid))[:300])
        if len(seeds) > 300:
            seeds = set(sorted(seeds)[:300])
        omitted_seeds = original_seeds - seeds
        leaf_industries = {nid for nid, n in nodes.items()
                           if n['kind'] == 'industry' and nid not in original_seeds}
        if event_id and not symbols:
            gaps.append('事件未明确提及证券；仅按原文明示的产品/环节/行业定位，分类关联不等于供货或受益')
        if event_id and not seeds:
            gaps.append('事件尚未匹配到明确证券或产业节点；不会猜测关联公司')
        neighbors = {}
        for e in all_edges:
            if e['from_id'] in nodes and e['to_id'] in nodes:
                neighbors.setdefault(e['from_id'], set()).add(e['to_id'])
                neighbors.setdefault(e['to_id'], set()).add(e['from_id'])
        selected, frontier = set(seeds), set(seeds)
        depth = dict.fromkeys(seeds, 0)
        node_truncated = False
        for distance in range(1, 4):
            candidates = {other for nid in frontier if nid not in leaf_industries
                          for other in neighbors.get(nid, ())} - selected
            remaining = max(0, 500 - len(selected))
            node_truncated |= len(candidates) > remaining
            # Breadth first: roots and direct business links cannot be displaced by
            # alphabetically earlier nodes reached on later hops. Industries are leaves
            # unless they were roots, and take budget after explicit business nodes.
            additions = sorted(candidates, key=lambda nid: (nodes[nid]['kind'] == 'industry', nodes[nid]['label'], nid))[:remaining]
            if not additions:
                break
            selected.update(additions)
            depth.update(dict.fromkeys(additions, distance))
            frontier = set(additions)
        candidate_edges = [e for e in all_edges if e['from_id'] in selected and e['to_id'] in selected]
        candidate_edges.sort(key=lambda e: (min(depth[e['from_id']], depth[e['to_id']]),
                                            max(depth[e['from_id']], depth[e['to_id']]), e['id']))
        edges = candidate_edges[:1000]
        if omitted_seeds - selected or node_truncated or len(candidate_edges) > 1000:
            gaps.append('关系结果已截断，请按公司或行业缩小范围')
        path_roots = seeds | {e['from_id'] for e in edges if e['to_id'] in seeds}
        paths = self._paths(selected, edges, path_roots, primary_seeds=seeds,
                            leaf_nodes=leaf_industries, limit=201)
        if len(paths) > 200:
            paths = paths[:200]
            gaps.append('研究路径过多，已截断为200条；请缩小范围')
        if not edges:
            gaps.append('暂无有来源的产业关系；请同步证券或导入授权数据')
        return dict(nodes=[nodes[x] for x in sorted(selected) if x in nodes], edges=edges, paths=paths, gaps=gaps)

    @staticmethod
    def _paths(selected, edges, seeds, *, primary_seeds=(), leaf_nodes=(), limit=200):
        adjacency = {}
        for edge in edges:
            adjacency.setdefault(edge['from_id'], []).append(edge)
            if edge['relation'] == 'classification':
                reverse = dict(edge, from_id=edge['to_id'], to_id=edge['from_id'], _reverse_classification=True)
                adjacency.setdefault(reverse['from_id'], []).append(reverse)
        for outgoing in adjacency.values():
            # Follow the seed's own downstream links before reverse classification
            # lookups, which can otherwise exhaust the path budget first.
            outgoing.sort(key=lambda edge: (bool(edge.get('_reverse_classification')), edge['id']))
        result = []

        def visit(nids, chosen):
            if len(result) >= limit:
                return
            if chosen:
                relations = {e['relation'] for e in chosen}
                kind = 'classification' if relations == {'classification'} else ('disclosed' if relations <= {'classification', 'disclosed_supply'} else 'inferred')
                condition = {'classification': '仅表示所属行业/分类，不代表供货或收入受益。', 'disclosed': '仅限所引披露的对象和时点；不代表当前订单或业绩。', 'inferred': '研究假设；须验证需求、供给、订单与成本传导，不代表已披露供应关系。'}[kind]
                if any(e.get('_reverse_classification') for e in chosen):
                    condition += ' 反向分类仅表示业务/行业相关，用于定位公司，不是供货关系或确定受益。'
                result.append(dict(id='path:' + identity(*nids, *(e['id'] for e in chosen)), node_ids=nids,
                                   edge_ids=[e['id'] for e in chosen], condition=condition,
                                   evidence_ids=sorted({x for e in chosen for x in e['evidence_ids']}), kind=kind))
            if len(chosen) >= 4 or len(result) >= limit or nids[-1] in leaf_nodes:
                return
            for edge in adjacency.get(nids[-1], []):
                if edge['to_id'] not in nids:
                    visit(nids + [edge['to_id']], chosen + [edge])
                if len(result) >= limit:
                    break
        for seed in sorted(seeds, key=lambda nid: (nid not in primary_seeds, nid)):
            visit([seed], [])
            if len(result) >= limit:
                break
        return result

    def evidence(self, eid):
        with self.db.connect() as c:
            row = c.execute('SELECT data FROM evidence WHERE id=?', (eid,)).fetchone()
        if not row:
            raise UserError('证据不存在', 404)
        return json.loads(row[0])

    def evidence_context(self, eid):
        detail = self.detail(eid)
        graph = self.chain(event_id=eid)
        ids = {x for edge in graph['edges'] for x in edge['evidence_ids']}
        evidence = [self.evidence(x) for x in sorted(ids)]
        context = dict(event=detail['event'], articles=detail['articles'], paths=detail['paths'], evidence=evidence)
        # Version only evidence and relationships, not ranks, status or fetched UI state.
        version = identity(dump({'articles': detail['articles'], 'evidence': evidence, 'edges': [{k: v for k, v in e.items() if k != 'as_of'} for e in graph['edges']]}))
        return context, version
