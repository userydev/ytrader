"""Contract candidates. Only fake transports and temporary databases; Codex runs these."""
import copy
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest
from fastapi.testclient import TestClient

from backend.adapters import Remote, UpstreamError
from backend.app import create_app, envelope
from backend.config import ConfigUpdate, UserError
from backend.core_contracts import PANORAMA_CATALOG, validate_core_response, validate_panorama, validate_panorama_context
from backend.fundamentals import Fundamentals, OPTIONAL_NUMERIC, validate_remote
from backend.panorama import Panorama, CONTEXT_FILES
from backend.db import Database, dump

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'backend/data/panorama'


def load(name):
    return json.loads((STATIC / name).read_text())


def context_data():
    return {key: load(filename) for key, filename in CONTEXT_FILES.items()}


def graphs_data():
    return {iid: load(iid + '.json') for iid in PANORAMA_CATALOG}


class StubNetwork:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def json(self, method, url, **kwargs):
        path = unquote(urlsplit(url).path.removeprefix('/api/v1'))
        self.calls.append((method, path, kwargs))
        assert method == 'GET'  # Read paths must never call a model or mutate a source.
        if path not in self.responses:
            raise UpstreamError('上游 HTTP 404')
        return copy.deepcopy(self.responses[path])


def test_local_panorama_is_verbatim_not_ai_industries():
    service = Panorama(None, STATIC)
    catalog = service.catalog()
    assert catalog['data']['schema_version'] == '1'
    assert {item['id'] for item in catalog['data']['items']} == set(PANORAMA_CATALOG)
    assert catalog['meta']['source'] == 'local/panorama-static' and catalog['meta']['as_of'] is None
    for iid in PANORAMA_CATALOG:
        assert service.industry(iid)['data'] == load(iid + '.json')
    assert service.context()['data'] == context_data()
    for bad in ('../financials', 'financials', 'context.json', '/gold'):
        with pytest.raises(UserError):
            service.industry(bad)


@pytest.mark.parametrize('damage', ['identity', 'node', 'source', 'company', 'group', 'scenario', 'default', 'duplicate'])
def test_panorama_bad_internal_references_fail_closed(damage):
    graph = load('ai-compute.json')
    if damage == 'identity':
        graph['industry']['id'] = 'gold'
    elif damage == 'node':
        graph['relations'][0]['to_id'] = 'missing'
    elif damage == 'source':
        graph['nodes'][0]['sources'] = ['missing']
    elif damage == 'company':
        graph['participations'][0]['company_id'] = 'missing'
    elif damage == 'group':
        graph['structure']['groups'][0]['node_ids'] = ['missing']
    elif damage == 'scenario':
        graph['scenarios'][0]['relation_ids'] = ['missing']
    elif damage == 'default':
        graph['default_company'] = 'missing'
    else:
        graph['nodes'].append(copy.deepcopy(graph['nodes'][0]))
    with pytest.raises((ValueError, KeyError, TypeError)):
        validate_panorama(graph, 'ai-compute')


@pytest.mark.parametrize('damage', ['missing', 'symbol', 'context_node', 'context_scenario', 'news_company', 'profile_company'])
def test_context_bad_cross_document_references(damage):
    data, graphs = context_data(), graphs_data()
    if damage == 'missing':
        del data['profiles']
    elif damage == 'symbol':
        data['securities']['SH:601899']['symbol'] = 'SZ:601899'
    elif damage == 'context_node':
        data['context']['industries']['ai-compute']['scenarios']['expansion']['annotations']['missing'] = {}
    elif damage == 'context_scenario':
        data['context']['industries']['gold']['scenarios']['missing'] = {'entry_node': 'mining', 'annotations': {}}
    elif damage == 'news_company':
        data['observatory']['industries']['crude-oil']['news'][0]['company_ids'] = ['missing']
    else:
        data['profiles']['companies']['missing'] = {'metrics': []}
    with pytest.raises((ValueError, KeyError, TypeError)):
        validate_panorama_context(data, graphs)


def test_local_missing_and_poisoned_files_are_not_silently_substituted(tmp_path):
    service = Panorama(None, tmp_path)
    with pytest.raises(UpstreamError):
        service.industry('gold')
    graph = load('gold.json')
    graph['relations'][0]['to_id'] = 'missing'
    (tmp_path / 'gold.json').write_text(json.dumps(graph))
    (tmp_path / 'securities.json').write_text(json.dumps(load('securities.json')))
    with pytest.raises(UpstreamError):
        service.industry('gold')


@pytest.mark.parametrize('data_mode', ['local', 'ycore'])
@pytest.mark.parametrize('ai_mode', ['local', 'ycore'])
def test_same_read_contract_all_data_ai_combinations(tmp_path, monkeypatch, data_mode, ai_mode):
    monkeypatch.delenv('YTRADER_WEB_DIST', raising=False)
    baseline = create_app(tmp_path / 'baseline', start_worker=False)
    with TestClient(baseline) as client:
        paths = ['/panorama/catalog', '/panorama/context', '/news/editorial', '/securities']
        responses = {path: client.get('/api/v1' + path).json() for path in paths}
    responses.update({'/panorama/' + iid: envelope({**graph, 'source_kind': 'panorama',
                                      'maintenance_note': '现有资料 / 待按v0.2新格式维护；不是v0.2正式发布'}, 'stub')
                      for iid, graph in graphs_data().items()})
    network = StubNetwork(responses)
    app = create_app(tmp_path / 'app', start_worker=False, network=network)
    app.state.settings.update(ConfigUpdate(data_mode=data_mode, ai_mode=ai_mode, ycore_url='https://core.example.test'))
    with TestClient(app) as client:
        for path in paths + ['/panorama/gold']:
            response = client.get('/api/v1' + path)
            assert response.status_code == 200, response.text
            body = response.json()
            validate_core_response(path, body['data'])
            if path == '/news/editorial' and data_mode == 'local':
                assert body['data']['items'] == [] and body['data']['state'] == 'empty'
                assert body['data']['algorithm_versions'] == responses[path]['data']['algorithm_versions']
            else:
                assert body['data'] == responses[path]['data']
        assert client.get('/api/v1/securities?offset=-1').status_code == 422
    assert bool(network.calls) == (data_mode == 'ycore')


def test_remote_panorama_bad_200_never_falls_back(tmp_path):
    network = StubNetwork({'/panorama/gold': envelope(load('gold.json'), 'stub'),
                           '/panorama/context': envelope(context_data(), 'stub')})
    network.responses['/panorama/gold']['data']['industry']['id'] = 'grid'
    app = create_app(tmp_path, start_worker=False, network=network)
    app.state.settings.update(ConfigUpdate(data_mode='ycore', ycore_url='https://core.example.test'))
    with TestClient(app) as client:
        response = client.get('/api/v1/panorama/gold')
        assert response.status_code == 502 and '未回退' in response.json()['detail']
    network.responses['/panorama/gold'] = envelope(load('gold.json'), 'stub')
    network.responses['/panorama/context']['data']['context']['industries']['gold']['scenarios']['bad'] = {'entry_node': 'unknown', 'annotations': {}}
    network.responses.update({'/panorama/' + iid: envelope(graph, 'stub') for iid, graph in graphs_data().items()})
    with TestClient(app) as client:
        assert client.get('/api/v1/panorama/context').status_code == 502


def test_security_offset_stable_sort_and_remote_same_parameters(tmp_path):
    app = create_app(tmp_path / 'local', start_worker=False)
    with app.state.db.transaction() as c:
        for code in ('600003', '600001', '600002'):
            c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)',
                      ('SH:' + code, code, '示例' + code, 'SH', None, 'listed', None, 'test'))
    with TestClient(app) as client:
        first = client.get('/api/v1/securities?limit=1').json()['data']
        second = client.get('/api/v1/securities?limit=1&offset=1').json()['data']
        assert first[0]['symbol'] == 'SH:600001' and second[0]['symbol'] == 'SH:600002'
        assert client.get('/api/v1/securities?offset=99').json()['data'] == []
    network = StubNetwork({'/securities': envelope(second, 'stub')})
    remote_app = create_app(tmp_path / 'remote', start_worker=False, network=network)
    remote_app.state.settings.update(ConfigUpdate(data_mode='ycore', ycore_url='https://core.example.test'))
    with TestClient(remote_app) as client:
        assert client.get('/api/v1/securities?q=示例&exchange=SH&limit=1&offset=1').json()['data'] == second
    assert network.calls[-1][2]['params'] == {'q': '示例', 'exchange': 'SH', 'limit': 1, 'offset': 1}
    network.responses['/securities']['data'][0]['code'] = '000001'
    with TestClient(remote_app) as client:
        assert client.get('/api/v1/securities').status_code == 502


def test_remote_editorial_bad_nested_shape_and_identity(tmp_path):
    feed = {'generated_at': '2026-10-20T12:00:00Z', 'algorithm_version': 'legacy', 'state': 'ready', 'items': [{}],
            'default_event_id': None, 'exclusive_available': False, 'coverage_note': 'stub',
            'collection': {'active_job_id': None, 'last_checked': None, 'warnings': []}, 'run_id': 'run:one'}
    network = StubNetwork({'/news/editorial': envelope(feed, 'stub')})
    app = create_app(tmp_path, start_worker=False, network=network)
    app.state.settings.update(ConfigUpdate(data_mode='ycore', ycore_url='https://core.example.test'))
    with TestClient(app) as client:
        assert client.get('/api/v1/news/editorial').status_code == 502
    with pytest.raises(ValueError):
        validate_core_response('/news/editorial/events/expected', {'event': {'id': 'different'}, 'title': 'x', 'summary': '',
            'articles': [], 'industry_links': [], 'current': {}, 'progresses': [], 'story': {}, 'generated_at': None, 'algorithm_version': '1'})


def financial_service(tmp_path, extras=True):
    from test_fundamentals import FakeNetwork, EvidenceStore

    class ExtraNetwork(FakeNetwork):
        def json(self, method, url, **kwargs):
            value = super().json(method, url, **kwargs)
            if extras:
                for row in value.get('data', []):
                    row.update(KCFJCXSYJLR=3729589028.7, KCFJCXSYJLRTZ=-12.714223413637, ROEJQ=8.04, EPSJB=.68,
                               MONETARYFUNDS=38734324278.37, ACCOUNTS_RECE=4920299209.76, INVENTORY=2993971049.37)
            return value

    db = Database(tmp_path / 'financial.sqlite3')
    with db.transaction() as c:
        c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)', ('SH:600276', '600276', '示例公司', 'SH', None, 'listed', None, 'test'))
    return Fundamentals(db, EvidenceStore(), ExtraNetwork())


def test_optional_financial_units_legacy_remote_and_strict_bad_numbers(tmp_path):
    service = financial_service(tmp_path)
    data = service.get('SH:600276')
    p = data['periods'][0]
    assert p['net_profit_excluding_nonrecurring'] == 3729589028.7
    assert p['net_profit_excluding_nonrecurring_yoy_pct'] == -12.714223413637
    assert p['roe_weighted_pct'] == 8.04 and p['basic_eps'] == .68
    assert p['monetary_funds'] == 38734324278.37
    assert p['accounts_receivable'] == 4920299209.76 and p['inventories'] == 2993971049.37
    assert 'cash_and_equivalents' not in p
    assert validate_remote(data, 'SH:600276')['periods'][0]['basic_eps'] == .68
    legacy = copy.deepcopy(data)
    for period in legacy['periods']:
        for key in OPTIONAL_NUMERIC:
            period.pop(key)
    assert all(validate_remote(legacy, 'SH:600276')['periods'][0][key] is None for key in OPTIONAL_NUMERIC)
    for bad in ('0.68', True, float('inf')):
        poisoned = copy.deepcopy(data)
        poisoned['periods'][0]['basic_eps'] = bad
        with pytest.raises(ValueError):
            validate_remote(poisoned, 'SH:600276')


def test_cache_schema_refresh_once_and_null_does_not_trigger_repeated_requests(tmp_path):
    service = financial_service(tmp_path, extras=False)
    service.get('SH:600276')
    with service.db.transaction() as c:
        cache = json.loads(c.execute('SELECT data FROM company_fundamentals WHERE symbol=?', ('SH:600276',)).fetchone()[0])
        for part in [*cache['indicator_parts'].values(), cache['tables']['balance']]:
            part.pop('schema_version')
        c.execute('UPDATE company_fundamentals SET data=? WHERE symbol=?', (dump(cache), 'SH:600276'))
    count = len(service.network.calls)
    data = service.get('SH:600276')
    assert len(service.network.calls) == count + 3
    assert all(data['periods'][0][key] is None for key in OPTIONAL_NUMERIC)
    count = len(service.network.calls)
    service.get('SH:600276')
    assert len(service.network.calls) == count


def test_schema_and_examples_are_machine_readable():
    schema = json.loads((ROOT / 'backend/contracts/core-v1.schema.json').read_text())
    assert schema['$schema'].endswith('2020-12/schema')
    assert OPTIONAL_NUMERIC <= schema['$defs']['period']['properties'].keys()
    assert not OPTIONAL_NUMERIC & set(schema['$defs']['period']['required'])
    # jsonschema is an optional host test tool, never a runtime dependency.
    jsonschema = pytest.importorskip('jsonschema')
    jsonschema.Draft202012Validator.check_schema(schema)
    validator = jsonschema.Draft202012Validator(schema)
    for response in json.loads((ROOT / 'tests/fixtures/core-v1.examples.json').read_text())['responses'].values():
        validator.validate(response)


def test_remote_transmission_rejects_unknown_node_without_local_mapping(tmp_path):
    examples = json.loads((ROOT / 'tests/fixtures/core-v1.examples.json').read_text())['responses']
    response = copy.deepcopy(examples['synthetic_editorial_detail'])
    response['data']['industry_links'] = [{'industry_id': 'gold', 'name': '黄金', 'industry_name': '黄金',
        'variable': '测试变量', 'mechanism': '测试机制', 'condition': '测试条件', 'node_ids': ['unknown'],
        'relation': 'conditional', 'evidence': [{'article_id': 'article:fixture', 'trigger': '测试', 'quote': '测试报道'}],
        'basis': 'rule_inference', 'rule_version': 'fixture'}]
    network = StubNetwork({'/news/editorial/events/event:fixture': response,
                           '/panorama/gold': envelope(load('gold.json'), 'stub')})
    app = create_app(tmp_path, start_worker=False, network=network)
    app.state.settings.update(ConfigUpdate(data_mode='ycore', ycore_url='https://core.example.test'))
    with TestClient(app) as client:
        assert client.get('/api/v1/news/editorial/events/event:fixture').status_code == 502
    assert any(path == '/panorama/gold' for _, path, _ in network.calls)


def test_feature_replay_keeps_all_historical_ids_and_article_rows(app):
    from conftest import article
    eid = app.state.research.ingest(article())
    editorial = app.state.editorial
    editorial.project()
    with app.state.db.transaction() as c:
        article_rows = [dict(r) for r in c.execute('SELECT * FROM articles ORDER BY id')]
        progress_rows = [dict(r) for r in c.execute('SELECT * FROM editorial_progress ORDER BY id')]
        story_rows = [dict(r) for r in c.execute('SELECT * FROM editorial_stories ORDER BY id')]
        assignments = [tuple(r) for r in c.execute('SELECT article_id,progress_id FROM editorial_articles ORDER BY article_id')]
        c.execute("UPDATE editorial_articles SET version='legacy'")
    editorial.project()
    with app.state.db.connect() as c:
        assert [dict(r) for r in c.execute('SELECT * FROM articles ORDER BY id')] == article_rows
        assert [dict(r) for r in c.execute('SELECT * FROM editorial_progress ORDER BY id')] == progress_rows
        assert [dict(r) for r in c.execute('SELECT * FROM editorial_stories ORDER BY id')] == story_rows
        assert [tuple(r) for r in c.execute('SELECT article_id,progress_id FROM editorial_articles ORDER BY article_id')] == assignments
    detail = editorial.detail(eid)
    validate_core_response('/news/editorial/events/' + eid, detail)


def test_remote_fundamentals_accepts_local_period_end_metadata(tmp_path):
    service = financial_service(tmp_path / 'source')
    data = service.get('SH:600276')
    network = StubNetwork({'/securities/SH:600276/fundamentals': envelope(data, 'stub', '2026-06-30')})
    app = create_app(tmp_path / 'client', start_worker=False, network=network)
    app.state.settings.update(ConfigUpdate(data_mode='ycore', ycore_url='https://core.example.test'))
    with TestClient(app) as client:
        response = client.get('/api/v1/securities/SH:600276/fundamentals')
        assert response.status_code == 200
        body = response.json()
        assert body['data']['status'] == 'ok' and body['meta']['as_of'] == '2026-06-30'
        assert body['data']['periods'][0]['basic_eps'] == .68
