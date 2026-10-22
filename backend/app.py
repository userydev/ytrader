from __future__ import annotations

import json
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .adapters import Network, Remote, UpstreamError
from .analysis import Analyzer, validate_result, AnalysisError, model_headers
from .catalog import PackageCatalog
from .companies import Companies
from .journeys import Topics
from .profiles import Profiles
from .fundamentals import Fundamentals
from .config import Settings, UserError, validate_url
from .db import Database, dump
from .decisions import OpenAIDecisionProvider, RulesProvider
from .jobs import Jobs
from .industries import Industries, GenerateIndustry, SupplementIndustry, IndustrySnapshot
from .models import ChainPackage, ConfigUpdate, SourceCreate, SourcePatch, SyncRequest, Watchlist, Strict, utcnow
from .official import ExchangeData
from .news import news_overview, public_sources, latest_publication
from .research import Research, identity
from .panorama import Panorama
from .industry_research import IndustryResearch
from .algorithms import registry


class OpenIndustryGenerate(GenerateIndustry):
    source_id: str | None = None
    automatic: bool = False


class TrackedIndustry(GenerateIndustry):
    id: str | None = None


class IndustryTracking(Strict):
    items: list[TrackedIndustry]


class CuratedPublish(Strict):
    package_id: str
    release_id: str


class CuratedActivate(Strict):
    release_id: str


class CuratedCandidate(Strict):
    question: str
    package_id: str | None = None


class Snapshot(Strict):
    context: dict
    evidence_version: str


def envelope(data, source='local', as_of=None, completeness='complete', warnings=None):
    return {'data': data, 'meta': {'source': source, 'as_of': as_of, 'version': '1',
                                  'completeness': completeness, 'warnings': warnings or []}}


def valid_symbol(symbol):
    if not isinstance(symbol, str) or not re.fullmatch(r'(SH|SZ|BJ):\d{6}', symbol):
        raise UserError('证券代码格式为 SH:600000 / SZ:000001 / BJ:920001', 422)
    return symbol


def validate_snapshot(snapshot):
    context = snapshot.context
    if set(context) != {'event', 'articles', 'evidence', 'paths'}:
        raise UserError('快照必须包含 event/articles/evidence/paths', 422)
    if not isinstance(context['event'], dict) or not isinstance(context['event'].get('id'), str) or not isinstance(context['event'].get('title'), str):
        raise UserError('快照事件缺少 id/title', 422)
    if context['event'].get('subject') == 'company':
        symbol = valid_symbol(context['event'].get('symbol', ''))
        if context['event']['id'] != Companies.subject_id(symbol):
            raise UserError('公司快照主体不一致', 422)
    if not snapshot.evidence_version or len(snapshot.evidence_version) > 128:
        raise UserError('无效证据版本', 422)
    if any(not isinstance(context[k], list) for k in ('articles', 'evidence', 'paths')):
        raise UserError('快照证据必须为列表', 422)
    if len(dump(context)) > 500000 or len(context['articles']) > 500 or len(context['evidence']) > 500:
        raise UserError('证据快照过大', 413)
    ids = []
    for article in context['articles']:
        if not isinstance(article, dict) or any(not isinstance(article.get(k), str) for k in ('id', 'title', 'content', 'url', 'source')):
            raise UserError('新闻证据字段不完整', 422)
        validate_url(article['url'])
        ids.append(article['id'])
    from .models import Evidence
    for evidence in context['evidence']:
        evidence = Evidence.model_validate(evidence)
        validate_url(evidence.url)
        ids.append(evidence.id)
    if len(ids) != len(set(ids)) or not ids:
        raise UserError('快照证据 ID 重复或无证据', 422)
    for path in context['paths']:
        if not isinstance(path, dict) or not set(path.get('evidence_ids', [])) <= set(ids) or path.get('kind') not in ('classification', 'disclosed', 'inferred'):
            raise UserError('快照路径引用无效', 422)
    return context


def create_app(data_dir=None, *, network=None, start_worker=True, public=None, decision=None):
    directory = Path(data_dir or os.environ.get('YTRADER_DATA_DIR', str(Path.home() / '.local/share/ytrader')))
    db = Database(directory / 'ytrader.sqlite3')
    settings = Settings(db, directory)
    network = network or Network()
    remote = Remote(settings, network)
    panorama = Panorama(remote)
    if decision is None:
        provider = os.environ.get('YTRADER_DECISION_PROVIDER', 'rules')
        if provider == 'openai-compatible':
            decision = OpenAIDecisionProvider(settings, network, os.environ.get('YTRADER_DECISION_MODEL'))
        else:
            decision = RulesProvider()  # Jev is deliberately not an implementation/automatic fallback.
    research = Research(db, decision)
    catalog = PackageCatalog(db, research)
    analyzer = Analyzer(db, settings, research, remote, network)
    topics = Topics(db, research)
    profiles = Profiles(db, research, topics, network)
    fundamentals = Fundamentals(db, research, network, remote)
    companies = Companies(db, settings, research, profiles, analyzer, remote)
    industries = Industries(db, settings, network, remote)
    open_industry = IndustryResearch(db, industries)
    panorama.research = open_industry
    from .curated_chains import CuratedChains
    curated = CuratedChains(db)
    panorama.curated = curated
    open_industry.curated = curated
    analyzer.industry_research = open_industry
    jobs = Jobs(db, settings, research, public or ExchangeData(network), remote, analyzer, companies, industries)
    jobs.industry_research = open_industry
    jobs.curated = curated

    @asynccontextmanager
    async def lifespan(app):
        if start_worker:
            jobs.start()
        yield
        if start_worker:
            jobs.close()

    app = FastAPI(title='ytrader', version='1', lifespan=lifespan)
    app.state.db, app.state.settings, app.state.research = db, settings, research
    app.state.jobs, app.state.analyzer, app.state.network = jobs, analyzer, network
    app.state.catalog, app.state.topics = catalog, topics
    app.state.profiles, app.state.companies = profiles, companies
    app.state.fundamentals = fundamentals
    app.state.industries = industries
    app.state.panorama = panorama
    app.state.curated_chains = curated
    from .editorial import Editorial
    editorial = Editorial(db, open_industry)
    app.state.industry_research = open_industry
    app.state.editorial = editorial
    origins = [x.strip() for x in os.environ.get('YTRADER_WEB_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:58720,http://127.0.0.1:58721').split(',') if x.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                       allow_methods=['GET', 'POST', 'PUT', 'PATCH'], allow_headers=['Content-Type'])

    @app.middleware('http')
    async def browser_safety(request, call_next):
        origin = request.headers.get('origin')
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and origin and origin.rstrip('/') not in origins + [str(request.base_url).rstrip('/')]:
            return JSONResponse({'detail': '拒绝跨站写入请求'}, status_code=403)
        length = request.headers.get('content-length')
        if length and (not length.isdigit() or int(length) > 8_000_000):
            return JSONResponse({'detail': '请求体超过大小限制'}, status_code=413)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(UserError)
    async def user_error(request, exc):
        return JSONResponse({'detail': str(exc)}, status_code=exc.status)

    @app.exception_handler(UpstreamError)
    async def upstream_error(request, exc):
        return JSONResponse({'detail': str(exc)}, status_code=502)

    @app.exception_handler(ValidationError)
    @app.exception_handler(RequestValidationError)
    async def input_error(request, exc):
        if request.url.path.startswith('/api/v1/curated-chains'):
            return JSONResponse({'detail': '维护请求格式错误：导入/检查直接提交完整JSON对象（非字符串、数组或包裹层）；publish须提供package_id与release_id，activate须提供release_id。'}, status_code=422)
        return JSONResponse({'detail': '请求字段或取值不符合 v1 契约'}, status_code=422)

    def remote_data(method, path, **kwargs):
        return remote.call(method, path, **kwargs)

    def local_mode():
        return settings.get().data_mode == 'local'

    def news_meta(data):
        state = db.get('news_sync', {})
        warnings = list(state.get('warnings', []))
        with db.connect() as c:
            as_of = latest_publication(c)
        return envelope(data, 'local/public-news', as_of, state.get('completeness', 'partial' if data else 'unavailable'), warnings)

    def remote_news_ready():
        # Old ycore servers may silently ignore unknown filters. Probe the new
        # capability rather than passing an apparently successful unfiltered list.
        return remote.capability('GET', '/news/overview', required=(
            'event_count', 'article_count', 'source_count', 'duplicate_count', 'revision_count',
            'last_checked', 'latest_published_at', 'topics', 'warnings'))

    @app.get('/api/v1/health')
    @app.get('/health', include_in_schema=False)
    def health():
        with db.connect() as c:
            c.execute('SELECT 1').fetchone()
        return envelope({'status': 'ok', 'database': 'ok'}, 'sqlite')

    @app.get('/api/v1/config')
    def get_config():
        return envelope(settings.get().model_dump())

    @app.put('/api/v1/config')
    def put_config(update: ConfigUpdate):
        return envelope(settings.update(update).model_dump())

    @app.post('/api/v1/config/test-model')
    def test_model():
        config = settings.analysis_ready()
        started = time.monotonic()
        try:
            if config.ai_mode == 'ycore':
                result = remote_data('POST', '/config/test-model')['data']
                if (not isinstance(result, dict) or result.get('ok') is not True
                        or not isinstance(result.get('model'), str) or not result['model'].strip()
                        or len(result['model']) > 200):
                    raise UpstreamError('模型测试响应无效')
                model = result['model']
            else:
                # Leave bounded room for reasoning tokens before the visible reply.
                result = network.json('POST', config.model_base_url.rstrip('/') + '/chat/completions',
                                      headers=model_headers(settings),
                                      body={'model': config.model_name, 'max_tokens': 256,
                                            'messages': [{'role': 'user', 'content': 'Reply with OK.'}]})
                try:
                    content = result['choices'][0]['message']['content']
                    if not isinstance(content, str) or not content.strip():
                        raise ValueError()
                except (KeyError, IndexError, TypeError, ValueError):
                    raise UpstreamError('模型测试响应无效') from None
                model = config.model_name
        except UpstreamError as exc:
            # Only locally generated classifications escape; never return an upstream body,
            # prompt, Authorization header, arbitrary exception text or service URL.
            code = re.fullmatch(r'上游 HTTP (\d{3})', str(exc))
            status = int(code.group(1)) if code else None
            target = 'ycore 服务' if config.ai_mode == 'ycore' else '模型服务'
            if status in (401, 403):
                raise UserError(target + '拒绝认证，请检查已保存的密钥与访问权限', 502) from None
            if status == 429:
                raise UserError(target + '限流或额度不足，请稍后重试并检查额度', 503) from None
            if status == 409:
                raise UserError('ycore 尚未完成模型配置，请检查远端 AI 设置', 409) from None
            if status == 404:
                raise UserError(target + '接口或模型不存在，请检查服务地址和模型名称', 502) from None
            raise UserError(target + '测试失败：网络超时、服务不可用或未返回有效回答；请检查地址和模型设置', 502) from None
        # A remote display name is data, not a reason to return any locally saved credential.
        for kind in ('model', 'ycore'):
            key = settings.key(kind)
            if key:
                model = model.replace(key, '[redacted]')
        return envelope(dict(ok=True, model=model, latency_ms=round((time.monotonic() - started) * 1000, 2)),
                        'ycore/model-test' if config.ai_mode == 'ycore' else 'local/openai-compatible')

    @app.get('/api/v1/overview')
    def overview():
        config = settings.get()
        try:
            settings.analysis_ready()
            model_ready = True
        except UserError:
            model_ready = False
        response = None
        if local_mode():
            data = research.overview()
        else:
            response = remote_data('GET', '/overview')
            remote_overview = response['data']
            try:
                counts = {name: remote_overview['counts'][name]
                          for name in ('events', 'securities', 'relations', 'industries', 'products')}
                if any(type(count) is not int or count < 0 for count in counts.values()):
                    raise ValueError()
                from .models import iso
                data = dict(counts=counts, last_sync_at=iso(remote_overview['last_sync_at']))
            except (KeyError, TypeError, ValueError, AttributeError):
                raise UpstreamError('ycore 总览响应不符合 v1 契约') from None
        data.update(model_ready=model_ready, model_name='ycore' if config.ai_mode == 'ycore' else config.model_name,
                    data_mode=config.data_mode, ai_mode=config.ai_mode)
        if response is not None:
            response['data'] = data
            return response
        return envelope(data, 'sqlite/overview', data['last_sync_at'])

    @app.get('/api/v1/sources')
    def sources():
        if not local_mode():
            return remote_data('GET', '/sources')
        return envelope(public_sources(db), 'public-source-registry')

    @app.post('/api/v1/sources', status_code=201)
    def create_source(body: SourceCreate):
        if not local_mode():
            return remote_data('POST', '/sources', body=body.model_dump())
        url = validate_url(body.url, public=True)
        sid = 'rss:' + identity(url)
        with db.transaction() as c:
            old = c.execute('SELECT data FROM sources WHERE id=?', (sid,)).fetchone()
            if old:
                return envelope(json.loads(old[0]))
            data = dict(id=sid, name=body.name.strip(), url=url, coverage='用户添加的公开 RSS/Atom', content_level='summary',
                        enabled=True, status='never_synced', last_success=None, last_error=None, capabilities=['news', 'rss'], paid=False)
            if not data['name']:
                raise UserError('来源名称不能为空', 422)
            c.execute('INSERT INTO sources VALUES (?,?)', (sid, dump(data)))
        return envelope(data)

    @app.patch('/api/v1/sources/{sid}')
    def patch_source(sid: str, body: SourcePatch):
        if not local_mode():
            return remote_data('PATCH', '/sources/' + quote(sid, safe=''), body=body.model_dump())
        with db.transaction() as c:
            row = c.execute('SELECT data FROM sources WHERE id=?', (sid,)).fetchone()
            if not row:
                raise UserError('来源不存在', 404)
            if sid == 'ifind' and body.enabled:
                raise UserError('iFinD 尚未接入且需要商业授权，不能启用', 409)
            source = json.loads(row[0])
            source['enabled'] = body.enabled
            c.execute('UPDATE sources SET data=? WHERE id=?', (dump(source), sid))
        return envelope(source)

    @app.post('/api/v1/sync', status_code=202)
    def sync(body: SyncRequest):
        return envelope(jobs.enqueue(body.kind), 'sqlite/jobs')

    @app.get('/api/v1/jobs')
    def list_jobs():
        return envelope(jobs.list(), 'sqlite/jobs')

    @app.get('/api/v1/news/overview')
    def get_news_overview():
        if not local_mode():
            return remote_news_ready()
        data = news_overview(db)
        unhealthy = any(s.get('enabled') and s['status'] != 'ok' for s in db.sources() if 'news' in s.get('capabilities', []))
        return envelope(data, 'sqlite/news-radar', data['latest_published_at'],
                        'unavailable' if not data['article_count'] else ('partial' if unhealthy else 'complete'), data['warnings'])

    @app.get('/api/v1/news/editorial')
    def get_editorial():
        if not local_mode():
            return remote.capability('GET', '/news/editorial', required=('items', 'generated_at', 'algorithm_version', 'state'))
        data = editorial.feed()
        warnings = data['collection']['warnings']
        return envelope(data, 'local/editorial-rules', data['generated_at'],
                        'unavailable' if data['state'] == 'empty' else 'partial' if warnings or not data['items'] else 'complete', warnings)

    @app.get('/api/v1/news/editorial/events/{eid}')
    def editorial_event(eid: str):
        if not local_mode():
            return remote.capability('GET', '/news/editorial/events/' + quote(eid, safe=''),
                                     required=('event', 'title', 'summary', 'articles', 'industry_links', 'current', 'story'))
        data = editorial.detail(eid)
        return envelope(data, 'local/editorial-rules', data['generated_at'])

    @app.get('/api/v1/news/editorial/stories/{sid}')
    def editorial_story(sid: str):
        if not local_mode():
            return remote.capability('GET', '/news/editorial/stories/' + quote(sid, safe=''), required=('id', 'progresses', 'basis'))
        return envelope(editorial.story(sid), 'local/editorial-rules', utcnow())

    @app.get('/api/v1/news/editorial/diagnostics')
    def editorial_diagnostics():
        if not local_mode():
            return remote.capability('GET', '/news/editorial/diagnostics', required=('version', 'weights', 'limitations'))
        return envelope(editorial.diagnostics(), 'local/editorial-rules', utcnow())

    @app.get('/api/v1/events')
    def events(q: str = Query('', max_length=300), limit: int = Query(50, ge=1, le=500),
               source: str = Query('', max_length=500), period: str = Query('all', pattern='^(all|24h|7d)$'),
               sort: str = Query('latest', pattern='^(latest|hot)$'),
               content_level: str = Query('all', pattern='^(all|full|summary|title)$'),
               tag: str = Query('', max_length=100)):
        if not local_mode():
            remote_news_ready()
            response = remote.capability('GET', '/events', params=dict(q=q, limit=limit, source=source,
                                         period=period, sort=sort, content_level=content_level, tag=tag))
            if not isinstance(response['data'], list) or any(not isinstance(e, dict) or not {'id', 'source_count', 'latest_published_at', 'quality_flags', 'merge_reason'} <= e.keys() for e in response['data']):
                raise UserError('ycore 缺少新闻雷达筛选/质量契约；未回退本地', 501)
            for event in response['data']:
                cached = analyzer.cached(event['id'])
                event['analysis_status'] = cached['status'] if cached else 'not_analyzed'
            return response
        items = research.events(q, limit, source=source, period=period, sort=sort, content_level=content_level, tag=tag)
        for item in items:
            cached = analyzer.cached(item['id'])
            if cached:
                item['analysis_status'] = cached['status']
        return news_meta(items)

    @app.get('/api/v1/events/{eid}')
    def event_detail(eid: str):
        if local_mode():
            detail = research.detail(eid)
            context, version = analyzer.context(eid, 'local')
            detail['analysis'] = analyzer.cached(eid, context, version)
            detail['event']['analysis_status'] = detail['analysis']['status'] if detail['analysis'] else 'not_analyzed'
            return news_meta(detail)
        response = remote.capability('GET', '/events/' + quote(eid, safe=''), required=('event', 'articles', 'primary_article_id'))
        if not isinstance(response['data']['articles'], list) or any(not isinstance(a, dict) or not {'source_id', 'external_id', 'quality_flags', 'merge_reason'} <= a.keys() for a in response['data']['articles']):
            raise UserError('ycore 缺少新闻版本/质量契约；未回退本地', 501)
        context, version = analyzer.context(eid, 'ycore')
        cached = analyzer.cached(eid, context, version)
        original = response['data'].get('analysis')
        if cached:
            response['data']['analysis'] = cached
        elif settings.get().ai_mode == 'ycore' and original:
            try:
                validate_result({'sections': original['sections'], 'warnings': original.get('warnings', [])}, context)
                if original.get('evidence_version') != version:
                    original['status'] = 'stale'
                elif not original.get('industry_association', {}).get('links') or original.get('industry_association', {}).get('evidence_version') != version:
                    original['status'] = 'pending_review'
                response['data']['analysis'] = original
            except (AnalysisError, KeyError):
                response['data']['analysis'] = None
                response['meta']['warnings'].append('远程分析引用校验失败，已隐藏未验证结果')
        else:
            response['data']['analysis'] = None
        analysis = response['data']['analysis']
        response['data']['event']['analysis_status'] = analysis['status'] if analysis else 'not_analyzed'
        return response

    @app.post('/api/v1/events/{eid}/analyze', status_code=202)
    def analyze(eid: str):
        settings.analysis_ready()
        # Fail nonexistent IDs synchronously; no mock work is queued.
        analyzer.context(eid, settings.get().data_mode)
        return envelope(jobs.enqueue('analyze', {'event_id': eid}), 'sqlite/jobs')

    @app.post('/api/v1/analysis/snapshot')
    def analyze_snapshot(body: Snapshot):
        # A hosted instance must set its own model configuration. Never recurse to another ycore.
        if settings.get().ai_mode != 'local':
            raise UserError('快照分析服务必须配置独立本地模型适配器', 409)
        settings.local_analysis_ready()
        context = validate_snapshot(body)
        result, model = analyzer.local(context)
        analysis = dict(id='analysis:' + identity(context['event']['id'], body.evidence_version, utcnow()),
                        event_id=context['event']['id'], status='complete', model=model, created_at=utcnow(),
                        evidence_version=body.evidence_version, sections=result.sections.model_dump(), warnings=result.warnings)
        if context['event'].get('subject') == 'company':
            analysis.update(subject='company', symbol=context['event']['symbol'])
        else:
            analysis['status'] = 'pending_review'
            analysis['warnings'].append('快照仅返回分析内容；调用方须完成同稿件版本产业关联后才能整项完成。')
        return envelope(analysis, 'Cloudflare AI Gateway routing' if os.environ.get('YTRADER_HOSTED') == '1' else 'local/openai-compatible', analysis['created_at'])

    @app.get('/api/v1/securities')
    def securities(q: str = Query('', max_length=300), exchange: str = Query('', pattern='^(SH|SZ|BJ)?$'),
                   limit: int = Query(100, ge=1, le=10000), offset: int | None = Query(None, ge=0)):
        if not local_mode():
            params = {'q': q, 'exchange': exchange, 'limit': limit}
            if offset is not None:
                params['offset'] = offset
            return remote_data('GET', '/securities', params=params)
        data = research.securities(q, exchange, limit, offset=offset or 0)
        coverage = db.get('coverage', {})
        return envelope(data, coverage.get('source', 'local/public-securities'), coverage.get('as_of'),
                        'complete' if coverage.get('status') == 'complete' else ('partial' if data else 'unavailable'), coverage.get('warnings', []))

    @app.get('/api/v1/securities/positions')
    def securities_positions(symbols: str = Query(..., max_length=400)):
        selected = list(dict.fromkeys(symbols.split(',')))
        if not 1 <= len(selected) <= 24:
            raise UserError('每次最多查询当前页24家公司', 422)
        for symbol in selected:
            valid_symbol(symbol)
        return panorama.company_positions(selected, settings.get().data_mode)

    @app.get('/api/v1/securities/{symbol}')
    def security_detail(symbol: str):
        valid_symbol(symbol)
        if not local_mode():
            return remote_data('GET', '/securities/' + quote(symbol, safe=''))
        data = research.security(symbol)
        warnings = [] if data['security']['industry'] else ['来源未提供所属行业，未猜测行业或供应关系']
        return envelope(data, data['security']['source'], data['security']['as_of'], 'partial' if warnings else 'complete', warnings)

    @app.get('/api/v1/securities/{symbol}/profile')
    def company_profile(symbol: str):
        valid_symbol(symbol)
        data = companies.profile(symbol, settings.get().data_mode)
        return envelope(data, data['source'], data['as_of'],
                        'complete' if data['status'] == 'ok' else ('partial' if data['status'] == 'stale' else 'unavailable'),
                        [] if data['status'] == 'ok' else ['公司资料来源暂不可用；保留缓存与业务关系，未估造简介'])

    @app.get('/api/v1/securities/{symbol}/fundamentals')
    def company_fundamentals(symbol: str):
        valid_symbol(symbol)
        data = fundamentals.get(symbol, settings.get().data_mode)
        return envelope(data, data['source'], data['periods'][0]['period_end'] if data['periods'] else None,
                        'unavailable' if data['status'] == 'unavailable' else 'partial' if data['status'] == 'stale' or data['warnings'] else 'complete',
                        data['warnings'])

    @app.get('/api/v1/securities/{symbol}/analysis')
    def company_analysis(symbol: str):
        valid_symbol(symbol)
        return envelope(companies.detail(symbol), 'sqlite/company-research')

    @app.post('/api/v1/securities/{symbol}/analyze', status_code=202)
    def analyze_company(symbol: str):
        valid_symbol(symbol)
        settings.analysis_ready()
        context, _ = companies.context(symbol, settings.get().data_mode)
        if not context['articles'] and not context['evidence']:
            raise UserError('该公司暂无可用于研究的有来源证据；未调用模型', 409)
        return envelope(jobs.enqueue('company_analyze', {'symbol': symbol}), 'sqlite/jobs')

    @app.get('/api/v1/coverage')
    def coverage():
        if not local_mode():
            return remote_data('GET', '/coverage')
        data = db.get('coverage', dict(as_of=None, counts={'SH': 0, 'SZ': 0, 'BJ': 0}, status='unavailable', source='公开交易所主表；尚未同步',
                                       missing_exchanges=['SH', 'SZ', 'BJ'], warnings=['请同步证券主表；证券源时间未知时不伪造发布时间']))
        return envelope(data, data['source'], data['as_of'], 'complete' if data['status'] == 'complete' else ('partial' if any(data['counts'].values()) else 'unavailable'), data['warnings'])

    @app.get('/api/v1/quotes/{symbol}')
    def quotes(symbol: str):
        valid_symbol(symbol)
        if not local_mode():
            try:
                return remote_data('GET', '/quotes/' + quote(symbol, safe=''))
            except UpstreamError:
                data = dict(symbol=symbol, price=None, change_percent=None, as_of=None, source='ycore', status='unavailable')
        else:
            data = jobs.public.quote(symbol)
        return envelope(data, data['source'], data['as_of'], 'complete' if data['status'] == 'ok' else 'unavailable',
                        [] if data['status'] == 'ok' else ['行情不可用，未使用估算值'])

    @app.get('/api/v1/watchlist')
    def watchlist():
        # Personal state is local in every service combination; no token/account dependency.
        return envelope(db.get('watchlist', []), 'sqlite/user')

    @app.put('/api/v1/watchlist')
    def put_watchlist(body: Watchlist):
        db.put('watchlist', body.symbols)
        return envelope(body.symbols, 'sqlite/user')

    @app.get('/api/v1/algorithms')
    def algorithms():
        return envelope(registry(), 'local/algorithm-registry')

    @app.get('/api/v1/contracts/core')
    def core_contract():
        contract = Path(__file__).resolve().parent / 'contracts/core-v1.schema.json'
        try:
            data = json.loads(contract.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise UpstreamError('核心契约文件未随服务发布') from None
        return envelope(data, 'local/core-contract')

    def curated_local():
        if not local_mode():
            raise UserError('当前 ycore 未声明v0.2维护包能力；未读取或写入本地替代数据', 501)

    def curated_response(action, *args, source='sqlite/curated-v02'):
        with settings.lock:
            curated_local()
            return envelope(action(*args), source)

    @app.get('/api/v1/curated-chains')
    def curated_catalog():
        return curated_response(curated.catalog)

    @app.get('/api/v1/curated-chains/{industry_id}')
    def curated_detail(industry_id: str):
        return curated_response(curated.detail, industry_id)

    @app.post('/api/v1/curated-chains/{industry_id}/validate')
    def curated_validate(industry_id: str, body: dict):
        return curated_response(curated.validate, industry_id, body, source='local/curated-check')

    @app.post('/api/v1/curated-chains/{industry_id}/drafts')
    def curated_save(industry_id: str, body: dict):
        return curated_response(curated.save, industry_id, body)

    @app.get('/api/v1/curated-chains/{industry_id}/packages/{package_id}')
    def curated_package(industry_id: str, package_id: str):
        return curated_response(curated.package, industry_id, package_id)

    @app.post('/api/v1/curated-chains/{industry_id}/publish')
    def curated_publish(industry_id: str, body: CuratedPublish):
        return curated_response(curated.publish, industry_id, body.package_id, body.release_id)

    @app.post('/api/v1/curated-chains/{industry_id}/activate')
    def curated_activate(industry_id: str, body: CuratedActivate):
        return curated_response(curated.activate, industry_id, body.release_id)

    @app.post('/api/v1/curated-chains/{industry_id}/candidates', status_code=202)
    def curated_candidate(industry_id: str, body: CuratedCandidate):
        curated_local()
        if settings.get().ai_mode != 'local':
            raise UserError('ycore未声明v0.2候选能力；未回退本地模型', 501)
        question = body.question.strip()
        if not 1 <= len(question) <= 1000:
            raise UserError('请输入1至1000字的具体补充问题', 422)
        industries.ready()
        payload = curated.candidate_payload(industry_id, body.package_id, question)
        job = jobs.enqueue('curated_candidate', payload)
        curated.candidate_request(industry_id, job['id'], payload)
        return envelope(job, 'sqlite/curated-candidates')

    @app.get('/api/v1/chain-monitor')
    def chain_monitor():
        from .chain_monitor import snapshot
        with settings.lock:
            # Capability is deliberately not inferred from old ycore responses.
            if not local_mode():
                raise UserError('ycore未声明chain-monitor能力；未读取本地快照', 501)
            return snapshot(curated)

    # Static routes must precede the dynamic industry ID, separate from /industries.
    @app.get('/api/v1/panorama/catalog')
    def panorama_catalog():
        return panorama.catalog(settings.get().data_mode)

    @app.get('/api/v1/panorama/context')
    def panorama_context():
        return panorama.context(settings.get().data_mode)

    @app.get('/api/v1/panorama/{industry_id}')
    def panorama_industry(industry_id: str, offset: int = Query(0, ge=0, le=1000000), result: str = Query('', max_length=300), published_release: str = Query('', max_length=300), draft_package: str = Query('', max_length=300)):
        return panorama.industry(industry_id, settings.get().data_mode, offset, result, published_release, draft_package)

    @app.get('/api/v1/industry-research/catalog')
    def open_industry_catalog(q: str = Query('', max_length=100), offset: int = Query(0, ge=0), limit: int = Query(40, ge=1, le=100)):
        return envelope(open_industry.catalog(q, offset, limit), 'local/open-industry-directory')

    def research_reference(source_id, name):
        if settings.get().data_mode != 'local':
            raise UserError('当前远端未声明来源语义整理能力；未切换本地资料', 501)
        reference = open_industry.sources.get(source_id)
        if reference is None:
            reference = panorama.industry(source_id, 'local', result_id='base')['data']
        if reference['industry']['name'] != name:
            raise UserError('所选资料身份不符，未提交模型', 422)
        return reference

    @app.get('/api/v1/industry-research/resolve')
    def resolve_industry(name: str = Query(..., min_length=1, max_length=100), source_id: str | None = Query(None, max_length=100)):
        reference = research_reference(source_id, name) if source_id else None
        return envelope(dict(existing=industries.find_existing(name, source_id, reference['version'] if reference else None)), 'local/industry-library')

    @app.post('/api/v1/industry-research/generate', status_code=202)
    def open_generate_industry(body: OpenIndustryGenerate):
        curated_local()
        if body.automatic:
            raise UserError('结构补充只能通过明确按钮请求；结果仅为AI候选', 422)
        from .industry_sources import CHAIN_POLICY, version
        reference = research_reference(body.source_id, body.name) if body.source_id else None
        binding = reference['version'] if reference else None
        existing = industries.find_existing(body.name, body.source_id, binding)
        if existing:
            return envelope(dict(status='cached', industry_id=existing['id'],
                target_url='/chain?' + 'industry=' + quote(existing['id'], safe=''), message='打开同主题、同来源版本的已保存研究'), 'sqlite/cache')
        payload = industries.generate_payload(body.name, body.source_id, binding)
        payload.update(source_id=body.source_id, strategy_version=CHAIN_POLICY)
        if reference:
            payload['source_context'] = open_industry.source_context(reference)
        attempt_key = 'industry-structure-attempt:' + version([payload['industry_id'], binding, CHAIN_POLICY])
        attempt = db.get(attempt_key)
        if attempt:
            previous = db.job(attempt['job_id'])
            if previous and previous['status'] in ('queued', 'running'):
                return envelope(previous, 'sqlite/jobs')
            if body.automatic:
                return envelope(dict(status='attempted', message=previous['message'] if previous else '此来源版本已尝试整理，请手动重试',
                                     job_id=attempt['job_id']), 'sqlite/jobs')
        industries.ready()
        job = jobs.enqueue('industry_generate', payload)
        db.put(attempt_key, dict(job_id=job['id']))
        return envelope(job, 'sqlite/jobs')

    @app.get('/api/v1/industry-research/tracking')
    def industry_tracking():
        return envelope(open_industry.tracking(), 'sqlite/user')

    @app.put('/api/v1/industry-research/tracking')
    def put_industry_tracking(body: IndustryTracking):
        from .algorithms.industry_association import resolve
        if len(body.items) > 200:
            raise UserError('持续跟踪最多200项', 422)
        catalog_items = open_industry.association_catalog()
        items = []
        for item in body.items:
            iid = resolve(item.name, catalog_items)
            if item.id:
                record = next((i for i in catalog_items if i['id'] == item.id and i['name'] == item.name), None)
                if not record and item.id.startswith('ckg-'):
                    record = open_industry.sources.ckg_catalog().get(item.id)
                if record and record['name'] == item.name:
                    iid = record['id']
            if not any(i['name'] == item.name for i in items):
                items.append(dict(id=iid, name=item.name))
        db.put('industry_tracking', items)
        return envelope(items, 'sqlite/user')

    @app.post('/api/v1/news/editorial/events/{eid}/associate', status_code=202)
    def update_industry_associations(eid: str, progress: str = '', automatic: bool = False):
        curated_local()
        if automatic:
            raise UserError('阅读页面不自动请求关联；请使用分析或明确更新按钮', 422)
        detail = editorial.detail(eid)
        item = next((i for i in detail['progresses'] if i['id'] == progress), None) if progress else detail['current']
        if not item:
            raise UserError('未找到指定新闻进展，未替换其他进展', 404)
        payload = open_industry.association_payload(item)
        # An immutable successful result is reused even after its job completed.
        if db.get('industry-association:' + payload['input_version']):
            return envelope(dict(status='cached', message='已有同版本关联结果，未重复调用模型'), 'sqlite/cache')
        attempt_key = 'industry-association-attempt:' + payload['input_version']
        if automatic and db.get(attempt_key):
            attempted = db.job(db.get(attempt_key)['job_id'])
            if attempted and attempted['status'] in ('queued', 'running'):
                return envelope(attempted, 'sqlite/jobs')
            return envelope(dict(status='cached', message='已提交过此新闻版本；可继续阅读，失败时可手动重试'), 'sqlite/cache')
        with db.connect() as c:
            pending = c.execute("SELECT count(*) FROM jobs WHERE kind='industry_associate' AND status IN ('queued','running')").fetchone()[0]
        if pending >= 2:
            return envelope(dict(status='cached', message='后台关联队列繁忙，已保留来源关联；可稍后更新'), 'sqlite/jobs')
        settings.analysis_ready()
        job = jobs.enqueue('industry_associate', payload)
        db.put(attempt_key, dict(job_id=job['id']))
        return envelope(job, 'sqlite/jobs')

    def impact_context(industry_id, news, progress, offset, result_id='', published_release=''):
        detail = editorial.detail(news)
        item = next((i for i in detail['progresses'] if i['id'] == progress), None) if progress else detail['current']
        if not item:
            raise UserError('未找到指定新闻进展', 404)
        graph = panorama.industry(industry_id, settings.get().data_mode, offset, result_id, published_release)['data']
        if graph.get('status') == 'draft' or graph.get('format') == 'curated-chain-draft-v02':
            raise UserError('默认结构为未发布研究草稿，不读取或生成新闻影响；请精确选择正式发布或原资料', 409)
        if all(n.get('kind') == 'industry' for n in graph['nodes']):
            raise UserError('来源只有行业分类，尚无实际产品结构；请先结合资料开展开放研究', 409)
        return open_industry.impact_payload(item, graph)

    @app.get('/api/v1/industry-research/{industry_id}/impact')
    def industry_impact_cache(industry_id: str, news: str, progress: str = '', offset: int = Query(0, ge=0, le=1000000), result: str = Query('', max_length=300), published_release: str = Query('', max_length=300), draft_package: str = Query('', max_length=300)):
        curated_local()
        if draft_package:
            raise UserError('研究草稿仅供结构体验，不读取或生成新闻影响', 409)
        payload = impact_context(industry_id, news, progress, offset, result, published_release)
        cached = db.get('industry-impact:' + payload['input_version'])
        return envelope(cached or dict(status='missing', input_version=payload['input_version'], links=[]), 'sqlite/industry-impact')

    @app.post('/api/v1/industry-research/{industry_id}/impact', status_code=202)
    def prepare_industry_impact(industry_id: str, news: str, progress: str = '', automatic: bool = False,
                                offset: int = Query(0, ge=0, le=1000000), result: str = Query('', max_length=300), published_release: str = Query('', max_length=300), draft_package: str = Query('', max_length=300)):
        curated_local()
        if draft_package:
            raise UserError('研究草稿仅供结构体验，不读取或生成新闻影响', 409)
        payload = impact_context(industry_id, news, progress, offset, result, published_release)
        cache_key = 'industry-impact:' + payload['input_version']
        if db.get(cache_key):
            return envelope(dict(status='cached', message='已有本新闻与资料版本的条件影响'), 'sqlite/cache')
        attempt_key = 'industry-impact-attempt:' + payload['input_version']
        if automatic and db.get(attempt_key):
            attempted = db.job(db.get(attempt_key)['job_id'])
            if attempted and attempted['status'] in ('queued', 'running'):
                return envelope(attempted, 'sqlite/jobs')
            return envelope(dict(status='attempted', message='此版本已提交研究；可稍后刷新，失败时可重试'), 'sqlite/cache')
        with db.connect() as c:
            pending = c.execute("SELECT count(*) FROM jobs WHERE kind IN ('industry_impact','industry_associate') AND status IN ('queued','running')").fetchone()[0]
        if pending >= 2:
            return envelope(dict(status='busy', message='后台研究队列繁忙，可稍后重试；资料与新闻仍可阅读'), 'sqlite/jobs')
        settings.analysis_ready()
        job = jobs.enqueue('industry_impact', payload)
        db.put(attempt_key, dict(job_id=job['id']))
        return envelope(job, 'sqlite/jobs')

    @app.get('/api/v1/industries')
    def industry_list(q: str = Query('', max_length=100), symbol: str = ''):
        if symbol:
            valid_symbol(symbol)
        # Bundled knowledge and personal AI drafts are independent of the news data service.
        return envelope(industries.items(q.strip(), symbol), 'local/industry-library')

    @app.post('/api/v1/industries/generate', status_code=202)
    def generate_industry(body: GenerateIndustry):
        curated_local()
        industries.ready()
        return envelope(jobs.enqueue('industry_generate', industries.generate_payload(body.name)), 'sqlite/jobs')

    @app.post('/api/v1/industries/explain')
    def explain_industry(body: IndustrySnapshot):
        # Snapshot-only remote capability: never recurse or silently change AI services.
        from .industries import validate_graph
        if settings.get().ai_mode != 'local':
            raise UserError('产业解释服务须配置独立本地模型适配器；未转发其他服务', 409)
        if body.base:
            validate_graph(body.base.model_dump(), ai=True, supplied=body.base.model_dump()['sources'], industry_id=body.industry_id, allow_symbols=True)
        graph, model = industries.local(body)
        return envelope(dict(graph=graph, model=model, input_version=body.input_version), 'ai/industry-explanation')

    @app.get('/api/v1/industries/{industry_id}')
    def industry_detail(industry_id: str):
        return envelope(industries.detail(industry_id), 'local/industry-library')

    @app.post('/api/v1/industries/{industry_id}/supplement', status_code=202)
    def supplement_industry(industry_id: str, body: SupplementIndustry):
        curated_local()
        industries.ready()
        return envelope(jobs.enqueue('industry_supplement', industries.supplement_payload(industry_id, body.question)), 'sqlite/jobs')

    @app.get('/api/v1/securities/{symbol}/industries')
    def company_industries(symbol: str):
        valid_symbol(symbol)
        response = panorama.company_positions([symbol], settings.get().data_mode)
        positions = response['data']['items'][0]
        # Keep the old library list additive for existing clients.
        return dict(data=dict(positions, items=industries.items(symbol=symbol)['items']), meta=response['meta'])

    @app.get('/api/v1/chain')
    def chain(q: str = Query('', max_length=300), symbol: str = '', event_id: str = '', node_id: str = Query('', max_length=200),
              topic_id: str = Query('', max_length=200)):
        if symbol:
            valid_symbol(symbol)
        if not local_mode():
            params = {'q': q, 'symbol': symbol, 'event_id': event_id}
            if node_id:
                params['node_id'] = node_id
            if topic_id:
                params['topic_id'] = topic_id
                # Older servers ignore unknown query parameters. Check the new topic
                # capability first rather than accidentally showing their global graph.
                directory = remote.capability('GET', '/chain/topics', required=('items', 'context'))['data']
                if not any(item['id'] == topic_id for item in directory['items']):
                    raise UserError('已安装产业主题不存在', 404)
                response = remote.capability('GET', '/chain', params=params, required=('nodes', 'edges', 'paths', 'gaps'))
                if response['data'].get('topic_id', topic_id) != topic_id:
                    raise UpstreamError('ycore 未返回所请求的主题图；未回退本地')
                return response
            return remote_data('GET', '/chain', params=params)
        data = topics.graph(topic_id) if topic_id else research.chain(q, symbol, event_id, node_id)
        if topic_id:
            data['topic_id'] = topic_id
        return envelope(data, 'sqlite/evidence-graph', None, 'partial' if data['gaps'] else 'complete', data['gaps'])

    @app.get('/api/v1/chain/topics')
    def chain_topics(event_id: str = '', symbol: str = ''):
        if symbol:
            valid_symbol(symbol)
        if not local_mode():
            return remote.capability('GET', '/chain/topics', params={'event_id': event_id, 'symbol': symbol}, required=('items', 'context'))
        return envelope(topics.list(event_id, symbol), 'sqlite/installed-topics')

    @app.get('/api/v1/chain/directory')
    def chain_directory(q: str = Query('', max_length=300)):
        if not local_mode():
            return remote_data('GET', '/chain/directory', params={'q': q})
        return envelope(research.chain_directory(q), 'sqlite/evidence-directory')

    @app.get('/api/v1/chain/packages')
    def chain_packages():
        if not local_mode():
            return remote_data('GET', '/chain/packages')
        data, warnings = catalog.items()
        return envelope(data, 'local/builtin-packages', completeness='partial' if warnings else 'complete', warnings=warnings)

    @app.post('/api/v1/chain/packages/{pid}/install')
    def install_package(pid: str):
        if not catalog.valid_id(pid):
            raise UserError('内置关系包不存在', 404)
        if not local_mode():
            return remote_data('POST', '/chain/packages/' + quote(pid, safe='') + '/install')
        return envelope(catalog.install(pid), 'local/builtin-packages')

    @app.post('/api/v1/chain/import')
    def import_chain(body: ChainPackage):
        if not local_mode():
            return remote_data('POST', '/chain/import', body=body.model_dump())
        return envelope(research.import_chain(body), body.source_url, body.as_of)

    @app.get('/api/v1/evidence/{eid}')
    def evidence(eid: str):
        if not local_mode():
            return remote_data('GET', '/evidence/' + quote(eid, safe=''))
        data = research.evidence(eid)
        return envelope(data, data['source'], data['published_at'])

    # Resolve only the public build output; never serve project files or API typos as HTML.
    dist = Path(os.environ.get('YTRADER_WEB_DIST', str(Path(__file__).resolve().parent.parent / 'frontend/dist'))).resolve()

    @app.get('/{web_path:path}', include_in_schema=False)
    def web(web_path: str):
        if web_path == 'api' or web_path.startswith('api/') or not (dist / 'index.html').is_file():
            raise UserError('路径不存在', 404)
        target = (dist / web_path).resolve()
        if not target.is_relative_to(dist):
            raise UserError('路径不存在', 404)
        if target.is_file():
            return FileResponse(target)
        if web_path.startswith('assets/') or (web_path and '.' in Path(web_path).name):
            raise UserError('静态资源不存在', 404)
        return FileResponse(dist / 'index.html')

    return app


_default_app = None


def __getattr__(name):
    # uvicorn backend.app:app works without creating a user database merely on test import.
    global _default_app
    if name == 'app':
        if _default_app is None:
            _default_app = create_app()
        return _default_app
    raise AttributeError(name)
