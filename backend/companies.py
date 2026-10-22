"""Independent, evidence-versioned company research; never writes a synthetic news event."""
from __future__ import annotations

import json
from urllib.parse import quote

from pydantic import ValidationError

from .analysis import AnalysisError, validate_result
from .config import UserError
from .db import dump, public_job
from .journeys import company_graph
from .models import CompanyProfile, Evidence, utcnow
from .research import identity


class Companies:
    def __init__(self, db, settings, research, profiles, analyzer, remote):
        self.db, self.settings, self.research = db, settings, research
        self.profiles, self.analyzer, self.remote = profiles, analyzer, remote

    @staticmethod
    def subject_id(symbol):
        return 'company-research:' + symbol

    def profile(self, symbol, data_mode, *, refresh=True):
        if data_mode == 'local':
            return self.profiles.get(symbol, refresh=refresh)
        profile = self.remote.capability('GET', '/securities/' + quote(symbol, safe='') + '/profile',
            required=('symbol', 'name', 'status', 'evidence_ids', 'businesses', 'topics'))['data']
        try:
            profile = CompanyProfile.model_validate(profile).model_dump()
        except ValidationError:
            raise AnalysisError('ycore 公司资料不符合 v1 契约；未回退本地') from None
        if profile['symbol'] != symbol:
            raise AnalysisError('ycore 公司资料主体不一致')
        return profile

    def context(self, symbol, data_mode, *, refresh=True):
        profile = self.profile(symbol, data_mode, refresh=refresh)
        if data_mode == 'local':
            graph = self.research.chain(symbol=symbol)
            with self.db.connect() as c:
                event_ids = [r[0] for r in c.execute(
                    'SELECT e.id FROM events e JOIN event_symbols s ON s.event_id=e.id WHERE s.symbol=? '
                    'ORDER BY coalesce(e.published_at,e.updated_at) DESC,e.id LIMIT 10', (symbol,))]
            details = [self.research.detail(eid) for eid in event_ids]
            evidence_reader = self.research.evidence
        else:
            path = '/securities/' + quote(symbol, safe='')
            security = self.remote.call('GET', path)['data']
            if security.get('security', {}).get('symbol') != symbol:
                raise AnalysisError('ycore 证券主体不一致')
            graph = self.remote.call('GET', '/chain', params={'symbol': symbol})['data']
            events = [e for e in security['events'] if symbol in e.get('symbols', [])]
            events.sort(key=lambda e: (e.get('published_at') or e.get('updated_at') or '', e['id']), reverse=True)
            details = [self.remote.call('GET', '/events/' + quote(e['id'], safe=''))['data'] for e in events[:10]]
            evidence_reader = lambda eid: self.remote.call('GET', '/evidence/' + quote(eid, safe=''))['data']
        graph = company_graph(graph, symbol)
        articles = []
        for detail in details:
            if symbol not in detail['event'].get('symbols', []):
                raise AnalysisError('近期事件未关联目标证券，未混入公司研究')
            articles.extend(detail['articles'])
        # Deduplicate before supplying IDs; evidence from other stocks' analyses is never read.
        articles = sorted({a['id']: a for a in articles}.values(), key=lambda a: a['id'])
        ids = set(profile['evidence_ids']) | {eid for e in graph['edges'] for eid in e['evidence_ids']}
        try:
            evidence = [Evidence.model_validate(evidence_reader(eid)).model_dump() for eid in sorted(ids)]
        except ValidationError:
            raise AnalysisError('公司来源证据不符合 v1 契约') from None
        if {e['id'] for e in evidence} != ids:
            raise AnalysisError('公司证据 ID 不一致')
        context = dict(event=dict(id=self.subject_id(symbol), title='独立公司研究：' + profile['name'] + '（' + symbol + '）',
                                  subject='company', symbol=symbol, profile_status=profile['status']),
                       articles=articles, evidence=evidence, paths=graph['paths'])
        # Fetch times and UI ranks are not evidence changes. Source facts, profile availability,
        # business links and the selected recent-event set are part of this company's version.
        version = identity(dump(dict(data_mode=data_mode, symbol=symbol,
            profile={k: v for k, v in profile.items() if k != 'fetched_at'}, articles=articles, evidence=evidence,
            edges=[{k: v for k, v in e.items() if k != 'as_of'} for e in graph['edges']])))
        return context, version

    def latest_job(self, symbol):
        with self.db.connect() as c:
            rows = c.execute("SELECT * FROM jobs WHERE kind='company_analyze' ORDER BY created_at DESC,rowid DESC").fetchall()
        config = self.settings.get()
        for row in rows:
            payload = json.loads(row['payload'])
            if payload.get('symbol') == symbol and payload.get('data_mode') == config.data_mode:
                return public_job(row)
        return None

    def cached(self, symbol, version):
        with self.db.connect() as c:
            row = c.execute('SELECT data FROM company_analyses WHERE symbol=?', (symbol,)).fetchone()
        if not row:
            return None
        analysis = json.loads(row[0])
        if analysis.get('subject') != 'company' or analysis.get('symbol') != symbol or analysis.get('event_id') != self.subject_id(symbol):
            raise AnalysisError('已存公司研究主体不一致，未返回其他证券结果')
        if analysis['evidence_version'] != version and analysis['status'] != 'stale':
            analysis['status'] = 'stale'
            with self.db.transaction() as c:
                # Do not overwrite a newer result committed by the worker during a read.
                c.execute('UPDATE company_analyses SET data=? WHERE symbol=? AND data=?', (dump(analysis), symbol, row[0]))
        return analysis

    def detail(self, symbol):
        _, version = self.context(symbol, self.settings.get().data_mode)
        return dict(analysis=self.cached(symbol, version), job=self.latest_job(symbol))

    def run(self, jid, payload, update):
        symbol, data_mode = payload['symbol'], payload['data_mode']
        self.settings.analysis_ready()
        context, version = self.context(symbol, data_mode)
        if not context['articles'] and not context['evidence']:
            raise UserError('该公司暂无可用于研究的有来源证据；未调用模型', 409)
        update(jid, progress=15, message='已读取该公司档案、业务及近期事件证据，正在研究')
        result, model = self.analyzer.local(context, payload)
        # Validate adapters too: all results, including local ones, use the same citation rules.
        validate_result(result.model_dump(), context)
        analysis = dict(id='analysis:' + identity(symbol, version, utcnow()), event_id=self.subject_id(symbol),
                        subject='company', symbol=symbol, status='complete', model=model, created_at=utcnow(),
                        evidence_version=version, sections=result.sections.model_dump(), warnings=result.warnings)
        # Profile requests must not take place inside a DB transaction. Recheck the snapshot
        # immediately before committing; local ingestion shares the transaction lock below.
        _, current = self.context(symbol, data_mode)
        with self.settings.lock:
            self.settings.check_ai_destination(payload)
        with self.db.transaction() as c:
            if current != version:
                analysis['status'] = 'stale'
            if data_mode == 'local':
                _, locked = self.context(symbol, data_mode, refresh=False)
                if locked != version:
                    analysis['status'] = 'stale'
            c.execute('INSERT INTO company_analyses VALUES (?,?) ON CONFLICT(symbol) DO UPDATE SET data=excluded.data', (symbol, dump(analysis)))
        return '独立公司研究已保存；引用已验证，证据变更时标记陈旧'
