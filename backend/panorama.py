"""Unified read-side panorama: original documents plus open source adapters."""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

from .adapters import UpstreamError
from .config import UserError
from .core_contracts import PANORAMA_CATALOG, validate_catalog, validate_panorama, validate_draft_panorama, validate_panorama_context

MAX_DOCUMENT_BYTES = 5_000_000
CONTEXT_FILES = {'securities': 'securities.json', 'context': 'context.json',
                 'observatory': 'observatory.json', 'profiles': 'company-profiles.json'}


class Panorama:
    def __init__(self, remote, root=None, research=None):
        self.remote = remote
        self.research = research
        self.curated = None
        if root is None:
            root = Path(__file__).resolve().parent / 'data' / 'panorama'
        self.root = Path(root).resolve()
        self._position_graphs = None

    def _read(self, filename):
        # Filename comes exclusively from constants / checked IDs, never a request path.
        allowed = {iid + '.json' for iid in PANORAMA_CATALOG} | set(CONTEXT_FILES.values())
        if filename not in allowed:
            raise UserError('未知全景文档', 404)
        target = (self.root / filename).resolve()
        if not target.is_relative_to(self.root):
            raise UpstreamError('全景数据路径不符合受控目录约束')
        try:
            with target.open('rb') as stream:
                raw = stream.read(MAX_DOCUMENT_BYTES + 1)
            if len(raw) > MAX_DOCUMENT_BYTES:
                raise ValueError()
            return json.loads(raw.decode('utf-8-sig'))
        except (OSError, UnicodeError, ValueError):
            raise UpstreamError('全景文档缺失或格式无效；未补造数据') from None

    @staticmethod
    def _validated(validate, *args):
        try:
            return validate(*args)
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
            raise UpstreamError('全景结构、身份或引用校验失败；未回退其他来源') from None

    def catalog(self, mode='local'):
        if mode != 'local':
            response = self.remote.capability('GET', '/panorama/catalog', required=('items', 'schema_version'))
            self._validated(validate_catalog, response['data'])
            return response
        if self.curated:
            items = [dict(item, id=item['industry_id']) for item in self.curated.catalog()['items']]
        else:
            items = [{'id': iid, 'name': name} for iid, name in PANORAMA_CATALOG.items()]
        data = {'items': items, 'schema_version': '1'}
        return self._envelope(data)

    def context(self, mode='local'):
        if mode != 'local':
            response = self.remote.capability('GET', '/panorama/context', required=tuple(CONTEXT_FILES))
            graphs = {iid: self.remote.capability('GET', '/panorama/' + quote(iid, safe=''), required=('industry', 'nodes', 'relations'))['data'] for iid in PANORAMA_CATALOG}
        else:
            data = {key: self._read(filename) for key, filename in CONTEXT_FILES.items()}
            response = self._envelope(data)
            graphs = {iid: self._read(iid + '.json') for iid in PANORAMA_CATALOG}
        self._validated(validate_panorama_context, response['data'], graphs)
        if mode == 'local' and self.curated:
            selected = self._default_curated_graphs()
            if selected:
                data = response['data']
                # These are the same view fragments used on the selected graph;
                # never retarget old node/scenario IDs to a research package.
                data['securities'] = self._security_context(data['securities'], selected)
                data['context'] = self._context_overlay(data['context'], {iid: g['view_context'] for iid, g in selected.items()})
                data['observatory'] = self._context_overlay(data['observatory'], {iid: g['view_observatory'] for iid, g in selected.items()})
                data['default_versions'] = {iid: dict(version=g['version'], status=g['status'],
                    draft_package=g['draft']['package_id'] if g.get('draft') else None,
                    current_release=g['release']['release_id'] if g.get('release') else None) for iid, g in selected.items()}
                # Profiles and the security master remain historical documents, not
                # freshly verified research identities. Expose actual graph bindings
                # separately, with their draft status and no name-based joins.
                data['graph_identities'] = {iid: dict(version=g['version'], status=g['status'],
                    companies=g['companies'], securities=g.get('securities', []),
                    participations=g['participations']) for iid, g in selected.items()}
                response['meta'].update(source='local/panorama-defaults', completeness='partial',
                    warnings=['默认结构含明确标识的研究草稿或发布；证券主表/公司资料保留原始期间，不代表草稿已核查。'])
        return response

    @staticmethod
    def _context_overlay(document, replacements):
        # Support the existing keyed industry document, including wrapper objects.
        if isinstance(document, dict):
            iid = document.get('industry_id') or document.get('id')
            if isinstance(iid, str) and iid in replacements:
                return dict(replacements[iid], **{k: document[k] for k in ('id', 'industry_id') if k in document})
            return {key: replacements[key] if key in replacements else Panorama._context_overlay(value, replacements)
                    for key, value in document.items()}
        if isinstance(document, list):
            return [Panorama._context_overlay(value, replacements) for value in document]
        return document

    @staticmethod
    def _security_context(document, graphs, symbol=None):
        """Replace existing position lists without inventing security identities.

        The master itself (name, exchange, historical profile) stays untouched;
        explicit package bindings are also available in graph_identities.
        """
        if isinstance(document, dict):
            symbol = document.get('symbol', symbol)
            result = {}
            for key, value in document.items():
                bound = key if key.startswith(('SH:', 'SZ:', 'BJ:')) else symbol
                if key in ('positions', 'roles') and isinstance(value, list) and symbol:
                    retained = [r for r in value if not isinstance(r, dict) or r.get('industry_id') not in graphs]
                    result[key] = retained + [r for g in graphs.values() for r in Panorama._graph_roles(g, symbol)]
                else:
                    result[key] = Panorama._security_context(value, graphs, bound)
            return result
        if isinstance(document, list):
            if symbol and any(isinstance(r, dict) and 'industry_id' in r and 'node_id' in r for r in document):
                retained = [r for r in document if not isinstance(r, dict) or r.get('industry_id') not in graphs]
                return retained + [r for g in graphs.values() for r in Panorama._graph_roles(g, symbol)]
            return [Panorama._security_context(value, graphs, symbol) for value in document]
        return document

    @staticmethod
    def _graph_roles(graph, symbol):
        nodes = {n['id']: n for n in graph['nodes']}
        companies = {c['id']: c for c in graph['companies']}
        sources = {s['id']: s for s in graph['sources']}
        bound = {s['company_id'] for s in graph.get('securities', []) if s['symbol'] == symbol}
        draft = graph.get('draft')
        pid = draft['package_id'] if draft else None
        for participation in graph['participations']:
            cid, nid = participation['company_id'], participation['node_id']
            if cid not in bound:
                continue
            company, node = companies[cid], nodes[nid]
            yield dict(industry_id=graph['industry']['id'], industry_name=graph['industry']['name'],
                node_id=nid, node_name=node['name'], company_name=company['name'],
                role=participation['role'], scope=participation.get('scope'), kind='position',
                origin=participation.get('origin'), source_kind='curated_v02', status=graph['status'],
                verified_binding=False if draft else True, graph_release_id=None if draft else graph['version'],
                result_id=None if draft else graph['version'], draft_package=pid, graph_version=graph['version'],
                as_of=None, sources=[sources[s] for s in participation.get('sources', [])],
                source_record=dict(company_id=cid, company_name=company['name'],
                    draft_package=pid, graph_version=graph['version']), summary=None)

    @staticmethod
    def _context_entry(document, iid):
        if isinstance(document, dict):
            if iid in document:
                return document[iid]
            if document.get('industry_id') == iid or document.get('id') == iid:
                return document
            values = document.values()
        elif isinstance(document, list):
            values = document
        else:
            return None
        for value in values:
            found = Panorama._context_entry(value, iid)
            if found is not None:
                return found
        return None

    def _default_curated_graphs(self):
        graphs = {}
        if self.curated:
            for state in self.curated.catalog()['items']:
                iid = state['industry_id']
                if state['current_release']:
                    graph = self.curated.graph(iid, state['current_release'])
                    if not graph:
                        raise UserError('现用发布结构不可读；未回退旧图', 404)
                    graphs[iid] = self._validated(validate_panorama, graph, iid)
                elif state['drafts']:
                    graph = self.curated.draft_graph(iid, state['drafts'][-1]['package_id'])
                    graphs[iid] = self._validated(validate_draft_panorama, graph, iid)
        return graphs

    def company_positions(self, symbols, mode='local'):
        if mode != 'local':
            return self.remote.capability('GET', '/securities/positions',
                params={'symbols': ','.join(symbols)}, required=('items', 'version'))
        if self._position_graphs is None:
            self._position_graphs = {iid: self._validated(validate_panorama, self._read(iid + '.json'), iid) for iid in PANORAMA_CATALOG}
        graphs = dict(self._position_graphs)
        selected = self._default_curated_graphs()
        graphs.update(selected)
        # Both publication rollback and a newly saved latest draft invalidate cache.
        key = tuple(sorted((iid, g['version']) for iid, g in selected.items()))
        if getattr(self, '_curated_positions', None) != key:
            self.research._positions = None
            self._curated_positions = key
        data = self.research.company_positions(symbols, graphs)
        drafts = {iid: g for iid, g in selected.items() if g.get('status') == 'draft'}
        for item in data['items']:
            # Do not leak legacy/CKG roles for a chain whose default is a draft.
            item['roles'] = [r for r in item['roles'] if r['industry_id'] not in drafts]
            for graph in drafts.values():
                roles = list(self._graph_roles(graph, item['symbol']))
                item['roles'].extend(roles)
                if roles:
                    item['warnings'].append('研究草稿公司角色 · 未发布 · 待核查，不代表现行事实。')
        return {'data': data, 'meta': {'source': 'local/company-industry-positions', 'as_of': None,
            'version': '1', 'completeness': 'partial', 'warnings': []}}

    def industry(self, industry_id, mode='local', offset=0, result_id='', published_release='', draft_package=''):
        if draft_package and (published_release or result_id):
            raise UserError('draft_package与published_release/result互斥；请指定唯一资料版本', 422)
        if draft_package:
            if mode != 'local':
                raise UserError('ycore未声明精确草稿结构预览能力；未回退本地', 501)
            if not self.curated:
                raise UserError('此产业没有指定草稿包；未回退旧图', 404)
            graph = self.curated.draft_graph(industry_id, draft_package)
            self._validated(validate_draft_panorama, graph, industry_id)
            return {'data': graph, 'meta': {'source': 'sqlite/curated-v02-draft', 'version': '1', 'as_of': None,
                'completeness': 'partial', 'warnings': ['研究草稿 · 未发布 · 待核查；不用于新闻影响；公司角色仅作同版草稿展示，不是现行核实事实。']}}
        if published_release and result_id:
            raise UserError('published_release与result互斥；请指定唯一资料版本', 422)
        if published_release and mode != 'local':
            raise UserError('ycore未声明精确v0.2发布读取能力；未回退本地', 501)
        if mode == 'local' and self.curated and industry_id in {i['industry_id'] for i in self.curated.config['items']}:
            state = self.curated.detail(industry_id)
            matched = next((p['release_id'] for p in state['publications'] if p['release_id'] == result_id and result_id not in ('base', 'source')), None)
            selected_release = published_release or matched
            if not result_id or selected_release:
                graph = self.curated.graph(industry_id, selected_release or None)
                if graph:
                    self._validated(validate_panorama, graph, industry_id)
                    return {'data': graph, 'meta': {'source': 'sqlite/curated-v02', 'version': '1', 'as_of': None,
                        'completeness': 'partial', 'warnings': ['精确版本结构；发布不表示全产业覆盖。']}}
                if selected_release:
                    raise UserError('指定发布版本不存在；未替换现用图', 404)
                if not result_id and state['current_release']:
                    raise UserError('现用发布结构不可读；未回退旧图', 404)
                if not result_id and state['drafts']:
                    return self.industry(industry_id, mode, offset,
                        draft_package=state['drafts'][-1]['package_id'])
        elif published_release:
            raise UserError('此产业没有指定v0.2发布；未回退旧图', 404)
        if mode != 'local' and result_id and result_id != 'base':
            raise UserError('当前远端未声明已保存回答选择能力；未静默换为基础图', 501)
        if industry_id not in PANORAMA_CATALOG:
            if mode != 'local':
                raise UserError('当前 ycore 未接入开放来源全景能力；未静默切换本地资料', 501)
            graph = self.research.graph(industry_id, offset, result_id) if self.research else None
            if graph:
                if result_id and result_id not in ('base', 'source') and graph.get('research', {}).get('selected_result') != result_id and graph.get('result_id') != result_id:
                    raise UserError('未找到指定产业回答；未替换为来源图', 404)
                self._validated(validate_panorama, graph, industry_id)
                return {'data': graph, 'meta': {'source': 'local/' + graph.get('source_kind', graph.get('origin', 'industry-library')),
                    'as_of': graph.get('as_of'), 'version': '1', 'completeness': 'partial',
                    'warnings': ['来源记录或 AI 整理，不代表完整或当前核实的产业供需。']}}
            raise UserError('尚未收录此产业；可按名称发起开放研究', 404)
        if mode == 'local' and result_id and result_id not in ('base', 'source'):
            answer = self.research.graph(industry_id, offset, result_id) if self.research else None
            if not answer or (answer.get('research', {}).get('selected_result') != result_id and answer.get('result_id') != result_id):
                raise UserError('未找到指定产业回答；未替换为来源图', 404)
            self._validated(validate_panorama, answer, industry_id)
            return {'data': answer, 'meta': {'source': 'local/ai-industry-answer', 'as_of': None,
                'version': '1', 'completeness': 'partial', 'warnings': ['AI 回答独立于原来源图，未经独立核实。']}}
        if mode != 'local':
            response = self.remote.capability('GET', '/panorama/' + quote(industry_id, safe=''), required=('industry', 'nodes', 'relations'))
            context = self.remote.capability('GET', '/panorama/context', required=tuple(CONTEXT_FILES))['data']
            self._validated(validate_panorama_context, context)
            securities = context['securities']
        else:
            response = self._envelope(self._read(industry_id + '.json'))
            securities = self._read(CONTEXT_FILES['securities'])
        self._validated(validate_panorama, response['data'], industry_id, securities)
        if mode == 'local' and result_id in ('base', 'source'):
            # Explicit legacy versions must not inherit the latest draft's global
            # context/observatory after default selection changes.
            for field, document in (('view_context', 'context'), ('view_observatory', 'observatory')):
                fragment = self._context_entry(self._read(CONTEXT_FILES[document]), industry_id)
                if fragment is not None:
                    response['data'][field] = fragment
        if mode == 'local' and self.research:
            raw = response['data']
            raw['source_kind'] = 'panorama'
            raw['maintenance_note'] = '现有资料 / 待按v0.2新格式维护；不是v0.2正式发布'
            library = self.research.graph(industry_id, 0, 'base')
            if library:
                raw['library_available'] = True
                raw['research'] = library['research']
                explanation = library.get('explanation')
                node_ids = {n['id'] for n in raw['nodes']}
                source_ids = {s['id'] for s in raw['sources']}
                if explanation and all(set(step['node_ids']) <= node_ids and set(step['sources']) <= source_ids for step in explanation['steps']) and all(set(item['sources']) <= source_ids for item in explanation['distinctions']):
                    raw['explanation'] = explanation
        return response

    @staticmethod
    def _envelope(data):
        # Mixed reference dates are deliberately not promoted to a fresh timestamp.
        # Individual documents and source checked_at fields are preserved verbatim.
        return {'data': data, 'meta': {'source': 'local/panorama-static', 'as_of': data.get('as_of'),
                'version': '1', 'completeness': 'complete', 'warnings': []}}
