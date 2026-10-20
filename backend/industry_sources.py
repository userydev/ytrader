"""Read-only source adapters. No imports into the evidence DB, downloads or model calls.

Atlas (MIT) and evidence packs are shipped; CKG stays in its optional external
JSONL directory. Classification and business association are never supply edges.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import threading
from pathlib import Path

from .config import UserError

ATLAS_URL = 'https://github.com/JiMoxiao/industry-chain-atlas'
ATLAS_COMMIT = '06661655379f918564a78ac905c045b3e824a76e'
CKG_URL = 'https://github.com/liuhuanyong/ChainKnowledgeGraph'
CKG_COMMIT = '498a21293a7cf50a8438154c4351349c2732fe1e'
# Part of every source/research binding. Old raw-neighbour graphs are not reusable.
CHAIN_POLICY = 'theme-structure-20261020-v1'
CKG_FILES = {'industry.json', 'product.json', 'industry_industry.json', 'company_industry.json',
             'product_product.json', 'company_product.json', 'company.json'}


# CKG's scraped business table includes accounting rows among product names.
# Keep this predicate shared by directory, business joins and both edge ends;
# never drop arbitrary products just because they contain “其他” or “销售”.
CKG_NON_PRODUCTS = frozenset({
    '平衡项目', '平衡项', '抵销项目', '抵消项目', '调整项目', '调整项',
    '销售商品', '提供劳务', '销售商品及提供劳务', '销售商品和提供劳务',
    '销售商品、提供劳务', '销售商品、提供劳务收到的现金',
    '合计', '小计', '总计', '总额', '其他', '其它',
    '营业收入', '营业总收入', '营业成本', '营业总成本', '营业利润',
    '主营业务收入', '主营业务成本', '主营业务利润',
    '其他业务收入', '其它业务收入', '其他业务成本', '其它业务成本',
    '其他业务利润', '其他收入', '其它收入', '收入', '成本', '费用', '利润',
    '未分配项目', '未分配金额', '分部间交易', '内部交易',
})


def ckg_product_name(value):
    """Reject explicit financial/statistical headings, not broad word matches."""
    if not isinstance(value, str) or not value.strip():
        return False
    name = re.sub(r'\s+', '', value).replace('（', '(').replace('）', ')')
    name = re.sub(r'\((?:补充|调整|抵销前|抵销后|抵消前|抵消后|主营业务|其他业务)\)$', '', name)
    if name in CKG_NON_PRODUCTS:
        return False
    if re.fullmatch(r'.*(?:合计|小计|总计)(?:\([^()]*\))?', name):
        return False
    if re.fullmatch(r'(?:主营业务|其他业务|其它业务|其他主营业务|其他经营业务)(?:收入|成本|利润|毛利)?', name):
        return False
    if re.fullmatch(r'(?:分部间|分部|内部|公司间)?(?:抵销|抵消)(?:项|项目|数|金额|收入|成本)?', name):
        return False
    if re.fullmatch(r'(?:销售商品(?:及|和|、)?(?:提供劳务)?|提供劳务)(?:收入|成本|收到的现金)?', name):
        return False
    return True


def key(prefix, name):
    return prefix + hashlib.sha256(name.encode()).hexdigest()[:24]


def version(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def security_symbol(code):
    if not isinstance(code, str):
        return None
    if re.fullmatch(r'(SH|SZ|BJ):\d{6}', code):
        return code
    match = re.fullmatch(r'(\d{6})\.(SH|SZ|BJ)', code)
    if match:
        return match[2] + ':' + match[1]
    # The code is supplied by the source, not inferred from a company name.
    if re.fullmatch(r'\d{6}', code):
        exchange = 'SH' if code.startswith('6') else 'SZ' if code.startswith(('0', '3')) else 'BJ' if code.startswith(('4', '8', '9')) else None
        return exchange + ':' + code if exchange else None
    return None


def source(sid, title, url, locator, **extra):
    return dict(id=sid, title=title, publisher=title, url=url, locator=locator,
                checked_at='', access='source_record', status='source_record', **extra)


def graph(iid, name, sources, *, summary=None, origin='source_record'):
    return dict(format='industry-reference-v1', status=origin, industry=dict(id=iid, name=name,
        summary=summary or '已收录环节、业务关系与公司位置；不代表当前完整供需或交易事实。',
        demand='研究产品、活动与公司分工', boundary='资料记录不等于当前核实；未收录不代表不存在。'),
        nodes=[], relations=[], companies=[], participations=[], sources=sources,
        scenarios=[], structure={'groups': []}, version='1', origin=origin)


def finish(g):
    """The original panorama view model, with no fabricated metrics or scenarios."""
    for company in g['companies']:
        company.setdefault('profile', {})
    if not g['structure']['groups']:
        g['structure']['groups'] = [dict(id='records', title='已收录环节', role='core',
            node_ids=[n['id'] for n in g['nodes']])]
    g['structure']['note'] = ('AI 归纳的产业关系，未经独立核实；不是本条新闻的确定因果路径。'
        if g.get('origin') == 'ai' else '线表示来源记录的业务/产品关系，非本条新闻的因果路径。分类关系单列，不作上下游。')
    g.setdefault('needs_research', False)
    g.setdefault('source_quality', 'ai_organized_unverified' if g.get('origin') == 'ai' else 'structured_source_record')
    g.setdefault('structure_gap', g['needs_research'])
    g['strategy_version'] = CHAIN_POLICY
    g['version'] = version(dict(policy=CHAIN_POLICY, content={k: g.get(k) for k in
        ('nodes', 'relations', 'companies', 'participations', 'sources', 'structure', 'source_version')}))
    summary = dict(text=g['industry']['summary'], paragraphs=[g['industry']['summary']],
                   attribution='Atlas: JiMoxiao/industry-chain-atlas · MIT' if g.get('source_kind') == 'atlas' else '保留来源记录与历史期间；未提升为独立核实。', sources=g['sources'])
    g['view_context'] = dict(summary=summary, scenarios={})
    g['view_observatory'] = dict(nodes={}, news=[])
    return g


def from_industry(base):
    g = graph(base['industry']['id'], base['industry']['name'], copy.deepcopy(base['sources']),
              summary=base['industry']['summary'], origin=base.get('origin', 'ai'))
    for field in ('industry', 'nodes', 'relations', 'companies', 'participations', 'explanation'):
        g[field] = copy.deepcopy(base[field])
    if base.get('structure'):
        g['structure'] = copy.deepcopy(base['structure'])
    g['model'] = base.get('model')
    g['created_at'] = base.get('created_at')
    g['source_id'] = base.get('source_id')
    g = finish(g)
    g['version'] = base.get('input_version', g['version'])
    if base.get('origin') == 'ai':
        g['view_context']['summary']['paragraphs'].append('AI 知识整理 · ' + str(base.get('model') or '模型身份见保存结果') + '；未作为已核实资料。')
    return g


class IndustrySources:
    def __init__(self, root=None, reference_dir=None):
        self.root = Path(root or Path(__file__).parent / 'data')
        configured = reference_dir if reference_dir is not None else os.environ.get('YTRADER_CHAIN_REFERENCE_DIR')
        self.reference_dir = Path(configured).expanduser().resolve() if configured else None
        self._bundled = None
        self._ckg_catalog = None
        self._ckg_industries = None
        self._company_positions = None
        self.lock = threading.RLock()
        self._graphs = {}

    def bundled(self):
        with self.lock:
            if self._bundled is not None:
                return self._bundled
            result = {}
            for path in sorted((self.root / 'packs').glob('*.json')):
                raw = json.loads(path.read_text(encoding='utf-8'))
                evidence = [source(e['id'], e['title'], e['url'], e.get('excerpt', ''),
                                   as_of=e.get('published_at')) for e in raw['evidence']]
                nodes = {n['id']: n for n in raw['nodes']}
                theme = next((n['label'] for n in raw['nodes'] if n['kind'] == 'segment'), raw['id'])
                g = graph('pack-' + raw['id'], theme, evidence)
                g.update(source_kind='pack', as_of=raw.get('as_of'))
                g['nodes'] = [dict(id=n['id'], name=n['label'], kind='product',
                    description='来源产品/类别记录', sources=[s['id'] for s in evidence]) for n in raw['nodes'] if n['kind'] != 'company']
                g['companies'] = [dict(id=n['id'], name=n['label'], symbol=security_symbol(n.get('symbol'))) for n in raw['nodes'] if n['kind'] == 'company']
                ids = {n['id'] for n in g['nodes']}
                company_ids = {c['id'] for c in g['companies']}
                for edge in raw['edges']:
                    a, b = edge['from_id'], edge['to_id']
                    if a in company_ids and b in ids:
                        g['participations'].append(dict(company_id=a, node_id=b, role='来源披露业务类别（非供货）', sources=edge['evidence_ids']))
                    elif a in ids and b in ids and edge['relation'] == 'upstream':
                        g['relations'].append(dict(id=edge['id'], from_id=a, to_id=b, kind='input_to',
                            explanation='来源记录的产品/工艺关系；不代表公司间交易', sources=edge['evidence_ids']))
                from .industry_structure import directed_levels
                levels = directed_levels([n['id'] for n in g['nodes']], [(r['from_id'], r['to_id']) for r in g['relations']])
                g['structure']['groups'] = [dict(id=f'stage-{level}', title=' / '.join(n['name'] for n in g['nodes'] if levels[n['id']] == level),
                    role='core', node_ids=[n['id'] for n in g['nodes'] if levels[n['id']] == level]) for level in sorted(set(levels.values()))]
                g['source_version'] = version(raw)
                g['needs_research'] = len(g['nodes']) < 3 or not g['relations']
                result[g['industry']['id']] = finish(g)
            for path in sorted((self.root / 'atlas').glob('*.json')):
                if path.name == 'PROVENANCE.json':
                    continue
                raw = json.loads(path.read_text(encoding='utf-8'))
                sid = 'atlas:' + path.stem
                src = source(sid, 'industry-chain-atlas · MIT', ATLAS_URL + '/blob/' + ATLAS_COMMIT + '/data/' + path.stem + '.yaml',
                             'segments / key_companies / supply_relationships；未采用热度、产能、份额、排名或宣传描述', commit=ATLAS_COMMIT)
                g = graph('atlas-' + path.stem, raw['industry'], [src])
                g.update(source_kind='atlas', source_version=version(raw), source_relations=[])
                positions, company_map, groups = {}, {}, {}
                labels = raw.get('group_labels', {})
                for index, segment in enumerate(raw['segments']):
                    nid = segment['id']
                    gid = str(segment.get('group') or segment.get('position') or 'segments')
                    groups.setdefault(gid, []).append(nid)
                    g['nodes'].append(dict(id=nid, name=segment['name'], kind='product', description='Atlas 环节位置记录；业务角色尚未独立核实', sources=[sid],
                        **{k: segment[k] for k in ('group', 'layer', 'position', 'tier') if k in segment}))
                    for record in segment.get('key_companies', []):
                        symbol = security_symbol(record.get('code'))
                        cid = key('company-', symbol or record['name'])
                        company_map.setdefault(cid, dict(id=cid, name=record['name'], symbol=symbol))
                        locator = dict(file=path.name, segment=index, company_code=record.get('code'), historical_name=record['name'])
                        existing = next((p for p in g['participations'] if p['company_id'] == cid and p['node_id'] == nid), None)
                        if existing:
                            existing['source_records'].append(locator)
                        else:
                            g['participations'].append(dict(company_id=cid, node_id=nid, role='Atlas 来源业务位置（非 AI 角色，未独立核实）', sources=[sid], source_record=locator, source_records=[locator]))
                        if record.get('code'):
                            positions.setdefault(record['code'], set()).add(nid)
                g['companies'] = list(company_map.values())
                # Only explicit supplier/buyer records with unambiguous positions
                # can be projected. Do not manufacture a flow from tier/order.
                pairs = {}
                for index, rel in enumerate(raw.get('supply_relationships', [])):
                    record = {k: rel.get(k) for k in ('supplier_code', 'buyer_code', 'product', 'relationship_type')}
                    record['source_record'] = dict(file=path.name, collection='supply_relationships', index=index)
                    g['source_relations'].append(record)
                    a, b = positions.get(rel.get('supplier_code'), set()), positions.get(rel.get('buyer_code'), set())
                    if len(a) == len(b) == 1 and a != b:
                        pair = (next(iter(a)), next(iter(b)))
                        if pair not in pairs:
                            pairs[pair] = dict(id='atlas-rel-' + str(index), from_id=pair[0], to_id=pair[1], kind='source_record',
                                explanation='Atlas 公司关系的环节投影；仅适用于列明公司/产品，不是整组供需或工业流程', sources=[sid], source_records=[])
                        pairs[pair]['source_records'].append(record)
                g['relations'] = list(pairs.values())
                order = list(dict.fromkeys(raw.get('group_order', []) + list(groups)))
                g['structure'] = dict(groups=[dict(id=gid, title=(labels.get(gid, [gid])[0] if isinstance(labels.get(gid), list) else labels.get(gid, gid)),
                    role='core', node_ids=groups[gid]) for gid in order if gid in groups], reading_order=[gid for gid in order if gid in groups])
                g['needs_research'] = len(groups) < 2 or len(g['nodes']) < 3
                result[g['industry']['id']] = finish(g)
            self._bundled = result
            return result

    def rows(self, filename):
        if not self.reference_dir or filename not in CKG_FILES:
            return
        target = (self.reference_dir / filename).resolve()
        if not target.is_relative_to(self.reference_dir) or not target.is_file():
            return
        try:
            with target.open(encoding='utf-8-sig') as handle:
                for line, text in enumerate(handle, 1):
                    if len(text) > 2_000_000:
                        continue
                    try:
                        item = json.loads(text)
                    except ValueError:
                        continue
                    if isinstance(item, dict):
                        product_fields = {'product.json': ('name',), 'company_product.json': ('product_name',),
                                          'product_product.json': ('from_entity', 'to_entity')}.get(filename, ())
                        if any(not ckg_product_name(item.get(field)) for field in product_fields):
                            continue
                        yield item, dict(file=filename, line=line, raw_relation=item.get('rel'), snapshot='2021-10-26', commit=CKG_COMMIT)
        except (OSError, UnicodeError):
            return

    def ckg_industries(self):
        with self.lock:
            if self._ckg_industries is None:
                entries = {}
                for row, loc in self.rows('industry.json'):
                    name = row.get('name')
                    if isinstance(name, str) and 0 < len(name) <= 100:
                        iid = key('ckg-i-', name)
                        entries[iid] = dict(id=iid, name=name, source_kind='ckg', kind='industry', code=row.get('code'), source_record=loc)
                self._ckg_industries = entries
            return self._ckg_industries

    def ckg_catalog(self):
        with self.lock:
            if self._ckg_catalog is None:
                entries = {}
                for filename, prefix, kind in [('industry.json', 'ckg-i-', 'industry'), ('product.json', 'ckg-p-', 'product')]:
                    for row, locator in self.rows(filename):
                        name = row.get('name')
                        if isinstance(name, str) and 0 < len(name) <= 300:
                            iid = key(prefix, name)
                            entries[iid] = dict(id=iid, name=name, source_kind='ckg', kind=kind,
                                                code=row.get('code'), source_record=locator)
                self._ckg_catalog = entries
            return self._ckg_catalog

    def company_positions(self):
        """Exact security-code reverse index. Read each business table only once.

        Classification links open the category itself, not an arbitrary first-page
        product. Main-business links open the actual product-centered graph.
        """
        with self.lock:
            if self._company_positions is not None:
                return self._company_positions
            index = {}
            product_members = {}
            catalog = self.ckg_catalog()
            for filename, field, prefix, kind, role in (
                ('company_industry.json', 'industry_name', 'ckg-i-', 'classification', '所属行业（历史分类，非上下游）'),
                ('company_product.json', 'product_name', 'ckg-p-', 'business', '主营产品关联（历史记录，非交易或当前收入占比）'),
            ):
                for row, loc in self.rows(filename):
                    symbol = security_symbol(row.get('company_code'))
                    name = row.get(field)
                    if not symbol or not isinstance(name, str) or not name.strip():
                        continue
                    if kind == 'business' and row.get('rel') != '主营产品':
                        continue
                    iid = key(prefix, name)
                    members = product_members.setdefault(name, {}) if kind == 'business' else {}
                    if kind == 'business':
                        members.setdefault(row['company_code'], len(members))
                    offset = (members.get(row['company_code'], 0) // 40) * 40
                    catalog.setdefault(iid, dict(id=iid, name=name, source_kind='ckg',
                        kind='industry' if kind == 'classification' else 'product',
                        code=row.get('industry_code'), source_record=loc))
                    index.setdefault(symbol, []).append(dict(industry_id=iid, industry_name=name,
                        node_id=iid if kind == 'business' else None, node_name=name, role=role,
                        kind=kind, origin='source_record', source_kind='ckg', as_of='2021-10-26', offset=offset,
                        historical_names=[row.get('company_name')], source_records=[loc], result_id='source',
                        sources=[source('ckg', 'ChainKnowledgeGraph · 历史资料 2021-10-26',
                            CKG_URL + '/tree/' + CKG_COMMIT + '/data', filename,
                            snapshot='2021-10-26', commit=CKG_COMMIT)], source_record=loc))
            for symbol, roles in index.items():
                unique = {}
                for item in roles:
                    signature = (item['industry_id'], item['node_id'], item['role'])
                    if signature not in unique:
                        unique[signature] = item
                    else:
                        unique[signature]['source_records'] += item['source_records']
                        unique[signature]['historical_names'] = list(dict.fromkeys(unique[signature]['historical_names'] + item['historical_names']))
                index[symbol] = list(unique.values())
            self._company_positions = index
            return index

    def catalog(self, q='', offset=0, limit=40, include_external=True):
        items = [dict(id=iid, name=g['industry']['name'], source_kind=g['source_kind'],
                      terms=[n['name'] for n in g['nodes']]) for iid, g in self.bundled().items()]
        if include_external and self.reference_dir:
            items += list(self.ckg_catalog().values())
        term = q.strip().casefold()
        items = [i for i in items if not term or term in (' '.join([i['name']] + i.get('terms', []))).casefold()]
        items.sort(key=lambda i: (0 if i['name'].casefold() == term else 1 if term in i['name'].casefold() else 2,
                                  i.get('source_kind') == 'ckg'))
        for item in items:
            item['needs_research'] = item.get('source_kind') == 'ckg' or self.bundled().get(item['id'], {}).get('needs_research', False)
            item['source_quality'] = 'raw_candidate_records' if item.get('source_kind') == 'ckg' else 'structured_source_record'
        return dict(items=[{k: v for k, v in i.items() if k != 'terms'} for i in items[offset:offset + limit]],
                    total=len(items), offset=offset, limit=limit, ckg_configured=bool(self.reference_dir))

    def get(self, iid, offset=0):
        if iid in self.bundled():
            return copy.deepcopy(self.bundled()[iid])
        record = self.ckg_catalog().get(iid) if iid.startswith('ckg-') else None
        if not record:
            return None
        with self.lock:
            cache_key = (iid, offset, self.ckg_stamp())
            if cache_key not in self._graphs:
                found = self.ckg_graph(record, offset)
                if len(self._graphs) >= 16:
                    self._graphs.pop(next(iter(self._graphs)))
                self._graphs[cache_key] = found
            return copy.deepcopy(self._graphs[cache_key])

    def ckg_graph(self, entry, offset):
        """Raw records are searchable evidence, never a topic's display graph.

        No company-co-occurrence inference and no product-neighbour expansion.
        Classification members' businesses stay in this separate, paged table.
        """
        sid, target = 'ckg', entry['name']
        src = source(sid, 'ChainKnowledgeGraph · 历史资料 2021-10-26', CKG_URL + '/tree/' + CKG_COMMIT + '/data',
                     '未经语义审查的历史候选资料；文件行号可追溯；分类/主营不是供销事实。', snapshot='2021-10-26', commit=CKG_COMMIT)
        g = graph(entry['id'], target, [src], summary='正在按主题整理主线、分支与配套；历史分类、主营与产品关系另存于来源记录，不直接作为产业链。')
        g.update(source_kind='ckg', as_of='2021-10-26', source_record=entry['source_record'], classifications=[],
                 needs_research=True, source_quality='raw_candidate_records', structure_gap=True)
        # A heading satisfies the panorama identity contract, but is not rendered
        # as a supply node, and cannot be used for news impact research.
        g['nodes'] = [dict(id=entry['id'], name=target, kind='industry', description='待整理主题，非供需环节', sources=[sid])]
        records = {}
        def retain(row, loc, kind):
            symbol = security_symbol(row.get('company_code'))
            identity = symbol or row.get('company_code') or row.get('company_name')
            signature = (kind, identity, row.get('industry_name'), row.get('product_name'),
                         row.get('from_entity'), row.get('to_entity'), row.get('rel'))
            record = records.setdefault(signature, dict(kind=kind, record=row, source_records=[], historical_names=[]))
            record['source_records'].append(loc)
            if row.get('company_name') and row['company_name'] not in record['historical_names']:
                record['historical_names'].append(row['company_name'])
        if entry['kind'] == 'industry':
            hierarchy = list(self.rows('industry_industry.json'))
            descendants = {entry.get('code')} - {None}
            for _ in range(20):
                expanded = descendants | {r.get('from_code') for r, _ in hierarchy if r.get('rel') == '上级行业' and r.get('to_code') in descendants}
                if expanded == descendants:
                    break
                descendants = expanded
            for row, loc in hierarchy:
                if entry.get('code') in (row.get('from_code'), row.get('to_code')):
                    retain(row, loc, 'classification')
            members = set()
            for row, loc in self.rows('company_industry.json'):
                if row.get('industry_code') in descendants:
                    members.add(security_symbol(row.get('company_code')) or row.get('company_code'))
                    retain(row, loc, 'historical_classification')
            for row, loc in self.rows('company_product.json'):
                if (security_symbol(row.get('company_code')) or row.get('company_code')) in members and row.get('rel') == '主营产品':
                    retain(row, loc, 'historical_business_candidate')
        else:
            for row, loc in self.rows('company_product.json'):
                if row.get('product_name') == target and row.get('rel') == '主营产品':
                    retain(row, loc, 'historical_business_candidate')
            for row, loc in self.rows('product_product.json'):
                if target in (row.get('from_entity'), row.get('to_entity')):
                    retain(row, loc, 'unreviewed_product_relation')
        g['source_records'] = list(records.values())[offset:offset + 40]
        g['pagination'] = dict(offset=offset, limit=40, total=len(records))
        # Bind to the full source snapshot, not whichever records page was opened.
        g['source_version'] = version([CKG_COMMIT, self.ckg_stamp(), entry['id']])
        return finish(g)

    def ckg_stamp(self):
        stamps = []
        for filename in sorted(CKG_FILES):
            path = (self.reference_dir / filename).resolve()
            if path.is_relative_to(self.reference_dir) and path.is_file():
                stat = path.stat()
                stamps.append((filename, stat.st_size, stat.st_mtime_ns))
        return version(stamps)
