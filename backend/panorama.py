"""Unified read-side panorama: original documents plus open source adapters."""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import quote

from .adapters import UpstreamError
from .config import UserError
from .core_contracts import PANORAMA_CATALOG, validate_catalog, validate_panorama, validate_panorama_context

MAX_DOCUMENT_BYTES = 5_000_000
CONTEXT_FILES = {'securities': 'securities.json', 'context': 'context.json',
                 'observatory': 'observatory.json', 'profiles': 'company-profiles.json'}


class Panorama:
    def __init__(self, remote, root=None, research=None):
        self.remote = remote
        self.research = research
        if root is None:
            dist = os.environ.get('YTRADER_WEB_DIST')
            root = Path(dist) / 'industry/data' if dist else Path(__file__).resolve().parent.parent / 'frontend/public/industry/data'
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
        graphs = {iid: self._validated(validate_panorama, self._read(iid + '.json'), iid) for iid in PANORAMA_CATALOG}
        items = self.research.catalog(limit=10000, external=False)['items'] if self.research else [{'id': iid, 'name': graph['industry']['name']} for iid, graph in graphs.items()]
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
        return response

    def company_positions(self, symbols, mode='local'):
        if mode != 'local':
            return self.remote.capability('GET', '/securities/positions',
                params={'symbols': ','.join(symbols)}, required=('items', 'version'))
        if self._position_graphs is None:
            self._position_graphs = {iid: self._validated(validate_panorama, self._read(iid + '.json'), iid) for iid in PANORAMA_CATALOG}
        data = self.research.company_positions(symbols, self._position_graphs)
        return {'data': data, 'meta': {'source': 'local/company-industry-positions', 'as_of': None,
            'version': '1', 'completeness': 'partial', 'warnings': []}}

    def industry(self, industry_id, mode='local', offset=0, result_id=''):
        if mode != 'local' and result_id and result_id != 'base':
            raise UserError('当前远端未声明已保存回答选择能力；未静默换为基础图', 501)
        if industry_id not in PANORAMA_CATALOG:
            if mode != 'local':
                raise UserError('当前 ycore 未接入开放来源全景能力；未静默切换本地资料', 501)
            graph = self.research.graph(industry_id, offset, result_id) if self.research else None
            if graph:
                self._validated(validate_panorama, graph, industry_id)
                return {'data': graph, 'meta': {'source': 'local/' + graph.get('source_kind', graph.get('origin', 'industry-library')),
                    'as_of': graph.get('as_of'), 'version': '1', 'completeness': 'partial',
                    'warnings': ['来源记录或 AI 整理，不代表完整或当前核实的产业供需。']}}
            raise UserError('尚未收录此产业；可按名称发起开放研究', 404)
        if mode == 'local' and result_id and result_id != 'base':
            answer = self.research.graph(industry_id, offset, result_id) if self.research else None
            if not answer:
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
        if mode == 'local' and self.research:
            raw = response['data']
            raw['source_kind'] = 'panorama'
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
