"""Recovery contracts. All external calls use synthetic transports; no live services."""
import json
from copy import deepcopy
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.adapters import Network, PublicData, UpstreamError
from backend.app import create_app, envelope
from backend.models import ConfigUpdate
from conftest import article, security
from test_chain import package


def test_directory_counts_entire_database_and_exact_node_seed(app, client):
    value = package()
    industries = [dict(id=f'industry:{i:04d}', label='zz重复行业' if i in (0, 649) else f'目录行业{i:04d}', kind='industry')
                  for i in range(650)]
    companies = [dict(id=f'company:{i:04d}', label=f'测试公司{i:04d}', kind='company') for i in range(621)]
    product = dict(id='product:test', label='独立产品', kind='product')
    segment = dict(id='segment:test', label='独立环节', kind='segment')
    value['nodes'] = industries + companies + [product, segment]
    value['edges'] = [dict(value['edges'][0], id=f'edge:{i:04d}', from_id=n['id'],
                           to_id=industries[0 if i < 620 else 649]['id']) for i, n in enumerate(companies)]
    value['edges'].append(dict(value['edges'][0], id='product-segment', from_id=product['id'], to_id=segment['id'], relation='upstream'))
    assert client.post('/api/v1/chain/import', json=value).status_code == 200
    directory = client.get('/api/v1/chain/directory').json()['data']
    assert len(directory['items']) == 652
    assert directory['totals'] == dict(companies=621, industries=650, products=1, segments=1, relations=622)
    by_id = {n['id']: n for n in directory['items']}
    assert by_id[industries[0]['id']]['company_count'] == 620
    assert by_id[industries[0]['id']]['relation_count'] == 620
    assert by_id[industries[1]['id']]['company_count'] == 0
    filtered = client.get('/api/v1/chain/directory', params={'q': 'zz重复行业'}).json()['data']
    assert len(filtered['items']) == 2 and filtered['totals'] == directory['totals']
    exact = client.get('/api/v1/chain', params={'node_id': industries[649]['id'], 'q': '不匹配的旧搜索'}).json()['data']
    assert {n['id'] for n in exact['nodes']} == {industries[649]['id'], companies[-1]['id']}
    assert exact['paths'][0]['node_ids'][0] == industries[649]['id']
    assert not exact['gaps']
    empty = client.get('/api/v1/chain', params={'node_id': industries[1]['id']}).json()['data']
    assert [n['id'] for n in empty['nodes']] == [industries[1]['id']]
    assert empty['edges'] == []
    assert client.get('/api/v1/chain', params={'node_id': 'missing'}).status_code == 404


def test_overview_is_real_counts_and_configuration_only(app, client):
    empty = client.get('/api/v1/overview').json()['data']
    assert empty['counts'] == dict(events=0, securities=0, relations=0, industries=0, products=0)
    assert not empty['model_ready'] and empty['last_sync_at'] is None
    app.state.research.store_securities('SZ', [security()], True)
    app.state.research.ingest(article())
    app.state.db.put('news_sync', {'fetched_at': '2026-09-01T03:00:00Z'})
    assert client.put('/api/v1/config', json={'model_name': 'saved-model', 'model_api_key': 'only-private-key'}).status_code == 200
    response = client.get('/api/v1/overview')
    data = response.json()['data']
    assert data['counts'] == dict(events=1, securities=1, relations=1, industries=1, products=0)
    assert data['model_ready'] and data['model_name'] == 'saved-model'
    assert data['data_mode'] == data['ai_mode'] == 'local'
    assert data['last_sync_at'] == '2026-09-01T03:00:00Z'
    assert 'only-private-key' not in response.text
    client.put('/api/v1/config', json={'clear_model_key': True})
    assert not client.get('/api/v1/overview').json()['data']['model_ready']
    client.put('/api/v1/config', json={'model_base_url': 'http://127.0.0.1:11434/v1'})
    assert client.get('/api/v1/overview').json()['data']['model_ready']


def tencent_line(ticker, *, price='12.30', stamp='20261016161430', percent='2.50', code=None):
    fields = [''] * 33
    fields[0:5] = ['51', '测试证券', code or ticker[2:], price, '12.00']
    fields[30:33] = [stamp, '0.30', percent]
    return ('v_' + ticker + '="' + '~'.join(fields) + '";').encode('gb18030')


@pytest.mark.parametrize('symbol,ticker', [('SH:600000', 'sh600000'), ('SZ:300750', 'sz300750'), ('BJ:920001', 'bj920001')])
def test_tencent_actual_fields_timezone_and_cache(monkeypatch, symbol, ticker):
    clock, calls = [100.0], []
    monkeypatch.setattr('backend.adapters.time.monotonic', lambda: clock[0])

    def upstream(request):
        calls.append(request)
        assert request.url.host == 'qt.gtimg.cn'
        assert request.url.path == '/q=' + ticker
        assert request.headers['referer'] == 'https://finance.sina.com.cn'
        assert request.extensions['timeout']['read'] == 5
        assert 'authorization' not in request.headers
        return httpx.Response(200, content=tencent_line(ticker))

    public = PublicData(Network(httpx.MockTransport(upstream)))
    result = public.quote(symbol)
    assert result == dict(symbol=symbol, price=12.3, change_percent=2.5, as_of='2026-10-16T08:14:30Z', source='腾讯公开行情', status='ok')
    result['price'] = 0  # callers cannot mutate the cached data
    assert public.quote(symbol)['price'] == 12.3 and len(calls) == 1
    clock[0] += 16
    assert public.quote(symbol)['as_of'] == '2026-10-16T08:14:30Z'
    assert len(calls) == 2


@pytest.mark.parametrize('bad', ['http', 'timestamp', 'price', 'code', 'encoding'])
def test_tencent_invalid_data_uses_bounded_real_fallback(bad):
    calls = []
    stamp = 1792138470

    def upstream(request):
        calls.append(request)
        if request.url.host == 'qt.gtimg.cn':
            if bad == 'http':
                return httpx.Response(503)
            if bad == 'encoding':
                return httpx.Response(200, content=b'\x81')
            return httpx.Response(200, content=tencent_line('bj920001',
                stamp='' if bad == 'timestamp' else '20261016161430',
                price='NaN' if bad == 'price' else '12.30', code='600000' if bad == 'code' else None))
        assert request.url.host == 'push2.eastmoney.com'
        assert request.url.params['secid'] == '0.920001'
        assert request.extensions['timeout']['read'] == 5
        return httpx.Response(200, json={'data': {'f43': 10.5, 'f170': -1.2, 'f86': stamp}})

    public = PublicData(Network(httpx.MockTransport(upstream)))
    result = public.quote('BJ:920001')
    assert result['status'] == 'ok' and result['price'] == 10.5
    assert result['as_of'] == datetime.fromtimestamp(stamp, timezone.utc).isoformat().replace('+00:00', 'Z')
    assert '备用源' in result['source']
    assert len(calls) == 2
    assert public.quote('BJ:920001') == result and len(calls) == 2


def test_user_rss_keeps_dns_safety_even_on_a_builtin_host():
    class CheckedNetwork(Network):
        def request(self, method, url, **kwargs):
            assert kwargs['public'] is True and kwargs['allow_builtin'] is False
            return super().request(method, url, **kwargs)

    network = CheckedNetwork(httpx.MockTransport(lambda r: httpx.Response(200, content=b'<rss><channel/></rss>')))
    with pytest.raises(UpstreamError, match='来源返回空列表'):
        PublicData(network).news({'id': 'rss:user', 'url': 'https://qt.gtimg.cn/user-feed', 'name': 'user'})


def test_both_quote_sources_fail_honestly_and_failure_cache_expires(monkeypatch):
    clock, calls = [100.0], []
    monkeypatch.setattr('backend.adapters.time.monotonic', lambda: clock[0])

    def upstream(request):
        calls.append(request)
        return httpx.Response(200, json={'data': {'f43': 99, 'f86': None}})

    public = PublicData(Network(httpx.MockTransport(upstream)))
    result = public.quote('SH:600000')
    assert result['status'] == 'unavailable' and result['price'] is None and result['as_of'] is None
    assert public.quote('SH:600000') == result and len(calls) == 2
    clock[0] += 6
    public.quote('SH:600000')
    assert len(calls) == 4


def test_package_catalog_missing_invalid_and_confined(app, client, tmp_path):
    root = tmp_path / 'allowed-packs'
    app.state.catalog.directory = root
    assert client.get('/api/v1/chain/packages').json()['data'] == []
    root.mkdir()
    value = package()
    value['name'], value['description'] = '原创测试关系包', '仅用于测试'
    # The API uses the declared ID, not the filename.
    (root / 'unrelated-filename.json').write_text(json.dumps(value), encoding='utf-8')
    (root / 'invalid.json').write_text('{}', encoding='utf-8')
    outside = tmp_path / 'outside.json'
    outside_value = package()
    outside_value['id'] = 'outside-package'
    outside.write_text(json.dumps(outside_value), encoding='utf-8')
    (root / 'escape.json').symlink_to(outside)
    listed = client.get('/api/v1/chain/packages').json()
    assert listed['meta']['warnings']
    assert len(listed['data']) == 1
    item = listed['data'][0]
    assert item['id'] == value['id'] and item['name'] == value['name']
    assert item['node_count'] == 2 and item['edge_count'] == 1
    assert item['source_urls'] == [value['source_url']] and not item['installed']
    assert client.post('/api/v1/chain/packages/outside-package/install').status_code == 404
    assert client.post('/api/v1/chain/packages/unrelated-filename/install').status_code == 404
    assert client.post('/api/v1/chain/packages/..%5Coutside/install').status_code == 404
    assert client.post('/api/v1/chain/packages/%2Ftmp%2Foutside/install').status_code in (404, 405)
    with app.state.db.connect() as connection:
        assert connection.execute('SELECT count(*) FROM packages').fetchone()[0] == 0
    endpoint = '/api/v1/chain/packages/' + value['id'] + '/install'
    assert client.post(endpoint).json()['data'] == {'id': value['id'], 'installed': True}
    assert client.post(endpoint).status_code == 200
    assert client.get('/api/v1/chain/packages').json()['data'][0]['installed']
    value['version'] = '2'
    (root / 'unrelated-filename.json').write_text(json.dumps(value), encoding='utf-8')
    assert not client.get('/api/v1/chain/packages').json()['data'][0]['installed']
    assert client.post(endpoint).status_code == 200


@pytest.mark.parametrize('pid,name', [
    ('rare-earth', '稀土材料'), ('semiconductor-computing', '半导体与算力'),
    ('semiconductor-equipment', '半导体设备'), ('photovoltaic', '光伏'),
    ('industrial-automation', '工业自动化'), ('medical-devices', '医疗器械'),
    ('lithium-battery-business-map', '锂电池'),
])
def test_strict_packages_have_readable_names(app, client, tmp_path, pid, name):
    root = tmp_path / 'packs'
    root.mkdir()
    app.state.catalog.directory = root
    value = package()
    value['id'] = pid
    (root / 'one.json').write_text(json.dumps(value), encoding='utf-8')
    data = client.get('/api/v1/chain/packages').json()['data']
    assert data[0]['name'] == name and data[0]['id'] == pid
    assert not app.state.db.get('config', {})  # discovery does not change settings


def test_catalog_install_reuses_import_validation_and_event_paths(app, client, tmp_path):
    root = tmp_path / 'packs'
    root.mkdir()
    app.state.catalog.directory = root
    value = package()
    value['nodes'][1].update(label='测试材料', kind='product')
    (root / 'one.json').write_text(json.dumps(value), encoding='utf-8')
    eid = app.state.research.ingest(article(title='测试材料价格变化', content='公开报道测试材料价格变化，未提任何公司。'))
    assert not app.state.research.detail(eid)['paths']
    assert client.post('/api/v1/chain/packages/' + value['id'] + '/install').status_code == 200
    assert app.state.research.detail(eid)['paths']
    conflict = deepcopy(value)
    conflict['id'] = 'conflicting-package'
    conflict['evidence'][0]['excerpt'] = '不同事实不能静默覆盖'
    conflict['nodes'].insert(0, dict(id='must-not-write', kind='industry', label='不能部分写入'))
    (root / 'two.json').write_text(json.dumps(conflict), encoding='utf-8')
    assert client.post('/api/v1/chain/packages/conflicting-package/install').status_code == 409
    assert client.get('/api/v1/chain', params={'node_id': 'must-not-write'}).status_code == 404


@pytest.mark.parametrize('ai_mode', ['local', 'ycore'])
def test_saved_model_test_independent_of_data_mode(tmp_path, ai_mode):
    calls = []

    def upstream(request):
        calls.append(request)
        if ai_mode == 'local':
            assert request.url.host == 'model.example'
            assert request.url.path == '/v1/chat/completions'
            assert request.headers['authorization'] == 'Bearer private-model'
            assert b'private-ycore' not in request.content
            body = json.loads(request.content)
            assert body['model'] == 'saved-model' and body['max_tokens'] == 256
            return httpx.Response(200, json={'choices': [{'message': {'content': 'OK'}}]})
        assert request.url.host == 'ycore.example' and request.url.path == '/api/v1/config/test-model'
        assert request.headers['authorization'] == 'Bearer private-ycore'
        assert b'private-model' not in request.content
        return httpx.Response(200, json=envelope({'ok': True, 'model': 'remote-model', 'latency_ms': 8,
                                                 'untrusted_extra': 'private-ycore'}))

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(upstream)))
    with TestClient(app) as client:
        assert client.post('/api/v1/config/test-model').status_code == 409
        app.state.settings.update(ConfigUpdate(data_mode='ycore' if ai_mode == 'local' else 'local', ai_mode=ai_mode,
            model_name='saved-model', model_api_key='private-model', model_base_url='https://model.example/v1',
            ycore_url='https://ycore.example', ycore_api_key='private-ycore'))
        assert calls == []  # saving settings is not consent to make a model call
        saved_config = app.state.settings.get().model_dump()
        response = client.post('/api/v1/config/test-model')
        assert response.status_code == 200
        data = response.json()['data']
        assert set(data) == {'ok', 'model', 'latency_ms'} and data['ok'] and data['latency_ms'] >= 0
        assert data['model'] == ('saved-model' if ai_mode == 'local' else 'remote-model')
        assert 'private-model' not in response.text and 'private-ycore' not in response.text
        assert len(calls) == 1
        assert app.state.settings.get().model_dump() == saved_config


@pytest.mark.parametrize('content', ['', ' \n ', None, [], {'text': 'OK'}])
def test_model_probe_rejects_invalid_content_despite_reasoning(tmp_path, content):
    calls = []

    def upstream(request):
        calls.append(request)
        assert json.loads(request.content)['max_tokens'] == 256
        return httpx.Response(200, json={'choices': [{'finish_reason': 'length', 'message': {
            'content': content, 'reasoning_content': 'private-model private-ycore'}}]})

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(upstream)))
    app.state.settings.update(ConfigUpdate(model_name='saved-model', model_api_key='private-model',
                                           ycore_api_key='private-ycore', model_base_url='https://model.example/v1'))
    with TestClient(app) as client:
        response = client.post('/api/v1/config/test-model')
        assert response.status_code == 502
        assert 'private-model' not in response.text and 'private-ycore' not in response.text
        assert len(calls) == 1  # Invalid output is rejected, not retried.


def test_loopback_saved_model_test_needs_no_key(tmp_path):
    def upstream(request):
        assert request.url.host == '127.0.0.1'
        assert 'authorization' not in request.headers
        return httpx.Response(200, json={'choices': [{'message': {'content': 'OK'}}]})

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(upstream)))
    app.state.settings.update(ConfigUpdate(model_name='loopback-model', model_base_url='http://127.0.0.1:11434/v1'))
    with TestClient(app) as client:
        response = client.post('/api/v1/config/test-model')
        assert response.status_code == 200 and response.json()['data']['model'] == 'loopback-model'


@pytest.mark.parametrize('status', [401, 403, 404, 429, 503, 200])
def test_model_test_failures_do_not_echo_body_or_credentials(tmp_path, status):
    def upstream(request):
        # Includes an upstream body which must never appear in detail or public jobs.
        return httpx.Response(status, json={'error': {'message': 'private-model and private-ycore full upstream body'}})

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(upstream)))
    app.state.settings.update(ConfigUpdate(model_name='saved-model', model_api_key='private-model',
                                           ycore_api_key='private-ycore', model_base_url='https://model.example/v1'))
    with TestClient(app) as client:
        response = client.post('/api/v1/config/test-model')
        assert response.status_code in (502, 503)
        assert isinstance(response.json()['detail'], str)
        assert 'private-model' not in response.text and 'private-ycore' not in response.text
        assert 'full upstream body' not in response.text
        assert client.get('/api/v1/jobs').json()['data'] == []


def test_new_remote_data_apis_passthrough_but_overview_uses_selected_ai(tmp_path):
    calls = []

    def upstream(request):
        calls.append(request)
        assert request.headers['authorization'] == 'Bearer remote-only'
        path = request.url.path
        if path == '/api/v1/overview':
            return httpx.Response(200, json=envelope(dict(counts=dict(events=12, securities=5000, relations=100, industries=20, products=30),
                last_sync_at='2026-10-16T08:00:00Z', model_ready=True, model_name='remote-model', data_mode='local', ai_mode='local')))
        if path == '/api/v1/chain':
            assert request.url.params['node_id'] == 'industry:exact'
            return httpx.Response(200, json=envelope(dict(nodes=[], edges=[], paths=[], gaps=[])))
        if path == '/api/v1/chain/directory':
            assert request.url.params['q'] == '材料'
            return httpx.Response(200, json=envelope({'items': [], 'totals': {'companies': 5000}}))
        if path == '/api/v1/chain/packages':
            return httpx.Response(200, json=envelope([{'id': 'remote-pack', 'installed': False}]))
        assert path == '/api/v1/chain/packages/remote-pack/install' and request.method == 'POST'
        return httpx.Response(200, json=envelope({'id': 'remote-pack', 'installed': True}))

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(upstream)))
    app.state.settings.update(ConfigUpdate(data_mode='ycore', ycore_url='https://ycore.example/api/v1', ycore_api_key='remote-only'))
    with TestClient(app) as client:
        overview = client.get('/api/v1/overview').json()['data']
        assert overview['counts']['securities'] == 5000
        assert overview['data_mode'] == 'ycore' and overview['ai_mode'] == 'local'
        assert not overview['model_ready'] and overview['model_name'] == ''
        assert client.get('/api/v1/chain', params={'node_id': 'industry:exact'}).status_code == 200
        assert client.get('/api/v1/chain/directory', params={'q': '材料'}).status_code == 200
        assert client.get('/api/v1/chain/packages').json()['data'][0]['id'] == 'remote-pack'
        assert client.post('/api/v1/chain/packages/remote-pack/install').json()['data']['installed']
    assert len(calls) == 5
