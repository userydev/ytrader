import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.adapters import Network
from backend.app import create_app, envelope
from backend.models import ConfigUpdate
from conftest import article, sections
from test_company_profiles import add_master, expire_profile, profile_payload
from test_product_flow_topics import install, topic


TARGET = 'SH:600392'
OTHER = 'SZ:300750'


def setup_companies(app, client):
    add_master(app, TARGET, '盛和资源')
    add_master(app, OTHER, '宁德时代')
    install(client, topic('test-earth', '稀土氧化物', TARGET, '盛和资源'))
    install(client, topic('test-battery', '动力电池', OTHER, '宁德时代'))
    return app.state.research.ingest(article(title='盛和资源发布测试业务进展', content='盛和资源披露业务进展，仍须关注后续条件。',
        url='https://news.example.com/test-earth'))


def configured(app, **kwargs):
    app.state.settings.update(ConfigUpdate(model_base_url='https://model.example/v1', model_name='saved-model',
                                           model_api_key='model-test-key', **kwargs))


def model_output(request, *, cited=None):
    body = json.loads(request.content)
    context = json.loads(body['messages'][1]['content'])
    aid = cited or context['evidence'][0]['id']
    assert request.url.path == '/v1/chat/completions'
    return httpx.Response(200, json={'id': 'chatcmpl-company', 'object': 'chat.completion', 'created': 1700000000,
        'model': 'actual-company-model', 'choices': [{'index': 0, 'finish_reason': 'stop',
        'message': {'role': 'assistant', 'content': json.dumps({'sections': sections(aid), 'warnings': []})}}],
        'usage': {'prompt_tokens': 120, 'completion_tokens': 60, 'total_tokens': 180}})


def test_company_research_is_opt_in_idempotent_symbol_isolated_and_not_a_news_event(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.host == 'emweb.eastmoney.com':
            ticker = request.url.params['code']
            symbol = ticker[:2] + ':' + ticker[2:]
            return httpx.Response(200, json=profile_payload(symbol))
        assert request.url.host == 'model.example'
        body = json.loads(request.content)
        assert body['model'] == 'saved-model'
        context = json.loads(body['messages'][1]['content'])
        assert context['event']['subject'] == 'company'
        symbol = context['event']['symbol']
        wrong = OTHER if symbol == TARGET else TARGET
        assert all(wrong not in e['id'] for e in context['evidence'])
        assert '净利润下降' in body['messages'][0]['content'] and '同名上市主体' in body['messages'][0]['content']
        assert '来源报道' in body['messages'][0]['content']
        return model_output(request)

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    configured(app)
    with TestClient(app) as client:
        setup_companies(app, client)
        before = len(app.state.research.events())
        for symbol in (TARGET, OTHER):
            assert client.get(f'/api/v1/securities/{symbol}/profile').status_code == 200
            assert client.get(f'/api/v1/securities/{symbol}/analysis').json()['data'] == {'analysis': None, 'job': None}
        assert not any(request.url.host == 'model.example' for request in calls)
        first = client.post(f'/api/v1/securities/{TARGET}/analyze')
        assert first.status_code == 202 and first.json()['data']['kind'] == 'company_analyze'
        first = first.json()['data']
        assert client.post(f'/api/v1/securities/{TARGET}/analyze').json()['data']['id'] == first['id']
        second = client.post(f'/api/v1/securities/{OTHER}/analyze').json()['data']
        assert second['id'] != first['id']
        assert not any(request.url.host == 'model.example' for request in calls)
        assert app.state.jobs.run_one() and app.state.jobs.run_one()
        for symbol, job in ((TARGET, first), (OTHER, second)):
            detail = client.get(f'/api/v1/securities/{symbol}/analysis').json()['data']
            result = detail['analysis']
            assert detail['job']['id'] == job['id'] and detail['job']['status'] == 'succeeded'
            assert result['symbol'] == symbol and result['subject'] == 'company' and result['status'] == 'complete'
            assert result['model'] == 'actual-company-model'
            assert result['event_id'].startswith('company-research:')
            assert 'payload' not in detail['job'] and 'model_base_url' not in detail['job']
            for claim in result['sections']['facts']:
                for evidence_id in claim['evidence_ids']:
                    assert client.get('/api/v1/evidence/' + evidence_id).status_code == 200
        assert len(app.state.research.events()) == before
        assert all(e['analysis_status'] == 'not_analyzed' for e in app.state.research.events())
        with app.state.db.connect() as c:
            assert c.execute('SELECT count(*) FROM analyses').fetchone()[0] == 0
            assert c.execute("SELECT count(*) FROM events WHERE id LIKE 'company-research:%'").fetchone()[0] == 0


def test_company_with_no_sourced_profile_or_business_cannot_trigger_ai(tmp_path):
    seen = []

    def handler(request):
        seen.append(request)
        assert request.url.host == 'emweb.eastmoney.com'
        return httpx.Response(503)

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    configured(app)
    add_master(app, TARGET, '盛和资源')
    with TestClient(app) as client:
        response = client.post(f'/api/v1/securities/{TARGET}/analyze')
        assert response.status_code == 409 and '证据' in response.json()['detail']
        assert app.state.jobs.list() == []
        assert client.get(f'/api/v1/securities/{TARGET}/analysis').json()['data'] == {'analysis': None, 'job': None}
    assert len(seen) == 1


@pytest.mark.parametrize('kind', ['profile', 'business', 'event'])
def test_only_this_company_evidence_changes_mark_stored_result_stale(tmp_path, kind):
    state = {'introduction': '初次公开资料测试内容。'}

    def handler(request):
        if request.url.host == 'emweb.eastmoney.com':
            return httpx.Response(200, json=profile_payload(TARGET, introduction=state['introduction']))
        return model_output(request)

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    configured(app)
    with TestClient(app) as client:
        setup_companies(app, client)
        job = client.post(f'/api/v1/securities/{TARGET}/analyze').json()['data']
        app.state.jobs.run_one()
        assert app.state.db.job(job['id'])['status'] == 'succeeded'
        path = f'/api/v1/securities/{TARGET}/analysis'
        original = client.get(path).json()['data']['analysis']
        expire_profile(app, TARGET)
        assert client.get(f'/api/v1/securities/{TARGET}/profile').json()['data']['status'] == 'ok'
        assert client.get(path).json()['data']['analysis']['status'] == 'complete'  # Fetch time alone isn't new evidence.
        app.state.research.ingest(article(title='宁德时代发布另一条测试事项', content='宁德时代的无关测试新闻。', url='https://news.example.com/unrelated-company'))
        assert client.get(path).json()['data']['analysis']['status'] == 'complete'
        if kind == 'profile':
            expire_profile(app, TARGET)
            state['introduction'] = '公司资料源已修订测试简介。'
            assert client.get(f'/api/v1/securities/{TARGET}/profile').json()['data']['status'] == 'ok'
        elif kind == 'business':
            install(client, topic('test-new-business', '新的明确业务产品', TARGET, '盛和资源'))
        else:
            app.state.research.ingest(article(title='盛和资源发布测试业务进展（更新）', content='盛和资源更新业务进展与条件。',
                url='https://news.example.com/test-earth', published_at='2026-09-01T03:00:00Z'))
        stale = client.get(path).json()['data']['analysis']
        assert stale['id'] == original['id'] and stale['sections'] == original['sections']
        assert stale['status'] == 'stale'


def test_evidence_arriving_while_company_model_runs_marks_result_stale(tmp_path):
    box = {}

    def handler(request):
        if request.url.host == 'emweb.eastmoney.com':
            return httpx.Response(200, json=profile_payload(TARGET))
        box['app'].state.research.ingest(article(title='盛和资源发布测试业务进展（更正）', content='盛和资源更正业务测试信息。',
            url='https://news.example.com/test-earth', published_at='2026-09-01T03:00:00Z'))
        return model_output(request)

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    box['app'] = app
    configured(app)
    with TestClient(app) as client:
        setup_companies(app, client)
        client.post(f'/api/v1/securities/{TARGET}/analyze')
        app.state.jobs.run_one()
        assert client.get(f'/api/v1/securities/{TARGET}/analysis').json()['data']['analysis']['status'] == 'stale'


@pytest.mark.parametrize('failure', ['invented', 'other-company', 'uncited'])
def test_company_analysis_rejects_ungrounded_or_other_symbol_citations(tmp_path, failure):
    box = {}

    def handler(request):
        if request.url.host == 'emweb.eastmoney.com':
            ticker = request.url.params['code']
            return httpx.Response(200, json=profile_payload(ticker[:2] + ':' + ticker[2:]))
        if failure == 'uncited':
            output = sections('ignored')
            output['facts'][0]['evidence_ids'] = []
            return httpx.Response(200, json={'id': 'chatcmpl-company', 'object': 'chat.completion', 'created': 1700000000,
                'model': 'actual-company-model', 'choices': [{'index': 0, 'finish_reason': 'stop',
                'message': {'role': 'assistant', 'content': json.dumps({'sections': output})}}], 'usage': None})
        return model_output(request, cited='invented' if failure == 'invented' else box['wrong_id'])

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    configured(app)
    with TestClient(app) as client:
        setup_companies(app, client)
        box['wrong_id'] = client.get(f'/api/v1/securities/{OTHER}/profile').json()['data']['evidence_ids'][0]
        job = client.post(f'/api/v1/securities/{TARGET}/analyze').json()['data']
        for _ in range(3):
            app.state.jobs.run_one()
        failed = app.state.db.job(job['id'])
        assert failed['status'] == 'failed'
        assert ('缺少证据' if failure == 'uncited' else '虚构的证据 ID') in failed['message']
        assert client.get(f'/api/v1/securities/{TARGET}/analysis').json()['data']['analysis'] is None
        assert client.get(f'/api/v1/securities/{OTHER}/analysis').json()['data']['analysis'] is None


@pytest.mark.parametrize('data_mode', ['local', 'ycore'])
@pytest.mark.parametrize('ai_mode', ['local', 'ycore'])
def test_company_data_and_ai_modes_are_independent(tmp_path, data_mode, ai_mode):
    def profiles(request):
        assert request.url.host == 'emweb.eastmoney.com'
        return httpx.Response(200, json=profile_payload(TARGET))

    reference = create_app(tmp_path / 'reference', start_worker=False, network=Network(httpx.MockTransport(profiles)))
    with TestClient(reference) as client:
        setup_companies(reference, client)
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.host == 'emweb.eastmoney.com':
            assert data_mode == 'local'
            return httpx.Response(200, json=profile_payload(TARGET))
        if request.url.host == 'model.example':
            assert ai_mode == 'local' and request.headers['authorization'] == 'Bearer model-test-key'
            assert b'ycore-test-key' not in request.content
            return model_output(request)
        assert request.url.host == 'ycore.example'
        assert request.headers['authorization'] == 'Bearer ycore-test-key'
        assert b'model-test-key' not in request.content
        path = request.url.path
        if path == '/api/v1/ai/capabilities':
            assert ai_mode == 'ycore' and request.method == 'GET'
            return httpx.Response(200, json=envelope(dict(contract_version='1', transport='sync', configured=True,
                chat_endpoint='/api/v1/ai/chat', purposes=['company_analysis'], response_formats=['json'],
                max_input_bytes=500000, max_output_tokens=8000, models=['configured-remote-model'])))
        if path == '/api/v1/ai/chat':
            assert ai_mode == 'ycore' and request.method == 'POST'
            body = json.loads(request.content)
            assert body['contract_version'] == '1' and body['purpose'] == 'company_analysis'
            assert body['request_id'] == request.headers['Idempotency-Key']
            assert body['max_output_tokens'] == 6000 and body['response_format'] == 'json'
            assert body['messages'][0]['role'] == 'system' and '同名上市主体' in body['messages'][0]['content']
            assert body['messages'][1]['role'] == 'user'
            context = json.loads(body['messages'][1]['content'])
            assert context['event']['subject'] == 'company' and context['event']['symbol'] == TARGET
            assert context['evidence'] and all(OTHER not in e['id'] for e in context['evidence'])
            return httpx.Response(200, json=envelope(dict(contract_version='1', request_id=body['request_id'],
                provider='synthetic-ycore', model='configured-remote-model', finish_reason='stop',
                content=json.dumps(dict(sections=sections(context['evidence'][0]['id']), warnings=[])),
                usage=dict(input_tokens=120, output_tokens=60))))
        assert data_mode == 'ycore'
        if path.endswith('/profile'):
            data = reference.state.profiles.get(TARGET)
        elif path == '/api/v1/securities/' + TARGET:
            data = reference.state.research.security(TARGET)
        elif path == '/api/v1/chain':
            assert request.url.params['symbol'] == TARGET
            data = reference.state.research.chain(symbol=TARGET)
        elif '/api/v1/events/' in path:
            data = reference.state.research.detail(path.split('/events/')[1])
        elif '/api/v1/evidence/' in path:
            data = reference.state.research.evidence(path.split('/evidence/')[1])
        else:
            return httpx.Response(404)
        return httpx.Response(200, json=envelope(data))

    app = create_app(tmp_path / 'client', start_worker=False, network=Network(httpx.MockTransport(handler)))
    configured(app, data_mode=data_mode, ai_mode=ai_mode, ycore_url='https://ycore.example', ycore_api_key='ycore-test-key')
    with TestClient(app) as client:
        if data_mode == 'local':
            setup_companies(app, client)
        assert client.get(f'/api/v1/securities/{TARGET}/analysis').json()['data']['analysis'] is None
        assert not any(r.method == 'POST' for r in seen)
        job = client.post(f'/api/v1/securities/{TARGET}/analyze').json()['data']
        app.state.jobs.run_one()
        assert app.state.db.job(job['id'])['status'] == 'succeeded', app.state.db.job(job['id'])
        result = client.get(f'/api/v1/securities/{TARGET}/analysis').json()['data']['analysis']
        assert result['symbol'] == TARGET and result['status'] == 'complete'
        assert result['model'] == ('configured-remote-model' if ai_mode == 'ycore' else 'actual-company-model')
    assert any(r.url.host == 'model.example' for r in seen) == (ai_mode == 'local')
    assert any(r.url.path == '/api/v1/ai/capabilities' for r in seen) == (ai_mode == 'ycore')
    assert any(r.url.path == '/api/v1/ai/chat' for r in seen) == (ai_mode == 'ycore')
    assert any(r.url.host == 'ycore.example' and '/ai/' not in r.url.path for r in seen) == (data_mode == 'ycore')
    assert any(r.url.host == 'emweb.eastmoney.com' for r in seen) == (data_mode == 'local')
