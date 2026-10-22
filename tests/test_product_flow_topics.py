"""Synthetic cross-topic events belong in tests, never in the installed news feed."""
from copy import deepcopy

import httpx
from fastapi.testclient import TestClient

from backend.adapters import Network
from backend.app import create_app
from backend.models import ConfigUpdate
from conftest import article


def topic(pid, label, symbol, company, *, business=True):
    url = 'https://example.org/test-only/' + pid
    nodes = [dict(id='test:manufacturing', label='C制造业', kind='industry'),
             dict(id='company:' + symbol, label=company, kind='company', symbol=symbol),
             dict(id=pid + ':product', label=label, kind='product')]
    edges = [dict(id=pid + ':industry', from_id='company:' + symbol, to_id='test:manufacturing',
                  relation='classification', evidence_ids=[pid + ':evidence'], confidence=None, as_of=None, source_url=url)]
    if business:
        edges.append(dict(edges[0], id=pid + ':business', to_id=pid + ':product'))
    return dict(id=pid, version='1', license='CC0-1.0', source_url=url, as_of='2026-01-01T00:00:00Z',
                nodes=nodes, edges=edges, evidence=[dict(id=pid + ':evidence', title='测试用业务分类', url=url,
                    excerpt='作者原创、仅用于测试的公司业务分类，不代表供货关系或业绩。', published_at=None, source='原创测试数据')])


def install(client, package):
    response = client.post('/api/v1/chain/import', json=package)
    assert response.status_code == 200, response.text


def test_topics_are_installed_only_and_multi_topic_events_have_grounded_reasons(app, client):
    assert client.get('/api/v1/chain/topics').json()['data'] == {'items': [], 'context': {'event_id': None, 'symbol': None}}
    install(client, topic('test-earth', '稀土氧化物', 'SH:600392', '盛和资源'))
    install(client, topic('test-battery', '动力电池', 'SZ:300750', '宁德时代'))
    eid = app.state.research.ingest(article(title='测试：稀土氧化物与动力电池需求动态', content='这是仅用于测试的跨主题消息，不涉及特定公司。'))
    data = client.get('/api/v1/chain/topics', params={'event_id': eid}).json()['data']
    assert data['context'] == {'event_id': eid, 'symbol': None}
    assert {item['id'] for item in data['items']} == {'test-earth', 'test-battery'}
    for item in data['items']:
        assert item['company_count'] == item['product_count'] == item['relation_count'] == 1
        assert len(item['matched_by']) == 1 and '产品/环节' in item['matched_by'][0]
        assert item['evidence_ids'] == [item['id'] + ':evidence']
        for evidence_id in item['evidence_ids']:
            assert client.get('/api/v1/evidence/' + evidence_id).status_code == 200


def test_no_match_and_shared_manufacturing_do_not_invent_topic_associations(app, client):
    install(client, topic('test-earth', '稀土氧化物', 'SH:600392', '盛和资源'))
    install(client, topic('test-battery', '动力电池', 'SZ:300750', '宁德时代'))
    install(client, topic('test-industry-only', '其他明确产品', 'BJ:920001', '测试行业公司', business=False))
    for index, title in enumerate(('天气消息：周末有雨', 'C制造业的行业分类说明', '测试行业公司的日常消息')):
        eid = app.state.research.ingest(article(title=title, content=title, url=f'https://news.example.com/no-topic/{index}'))
        assert client.get('/api/v1/chain/topics', params={'event_id': eid}).json()['data']['items'] == []
    assert client.get('/api/v1/chain/topics', params={'symbol': 'BJ:920001'}).json()['data']['items'] == []


def test_company_business_matching_and_combined_filter_intersection(app, client):
    install(client, topic('test-earth', '稀土氧化物', 'SH:600392', '盛和资源'))
    install(client, topic('test-battery', '动力电池', 'SZ:300750', '宁德时代'))
    # Matching still works before a master-table sync: installed business evidence is explicit.
    eid = app.state.research.ingest(article(title='盛和资源发布业务动态', content='本测试报道没有产品名。'))
    items = client.get('/api/v1/chain/topics', params={'event_id': eid}).json()['data']['items']
    assert [item['id'] for item in items] == ['test-earth']
    assert any('公司业务：盛和资源' in reason for reason in items[0]['matched_by'])
    assert client.get('/api/v1/chain/topics', params={'event_id': eid, 'symbol': 'SZ:300750'}).json()['data']['items'] == []
    assert [item['id'] for item in client.get('/api/v1/chain/topics', params={'symbol': 'SZ:300750'}).json()['data']['items']] == ['test-battery']
    assert client.get('/api/v1/chain/topics', params={'event_id': 'missing'}).status_code == 404
    assert client.get('/api/v1/chain/topics', params={'symbol': 'bad'}).status_code == 422


def test_one_company_can_belong_to_multiple_topics_without_graph_leakage(client):
    earth = topic('test-earth', '稀土氧化物', 'SH:600392', '测试跨业务公司')
    battery = topic('test-battery', '动力电池', 'SH:600392', '测试跨业务公司')
    install(client, earth)
    install(client, battery)
    assert len(client.get('/api/v1/chain/topics', params={'symbol': 'SH:600392'}).json()['data']['items']) == 2
    for package in (earth, battery):
        graph = client.get('/api/v1/chain', params={'topic_id': package['id']}).json()['data']
        expected = {'company:SH:600392', package['id'] + ':product'}
        assert {node['id'] for node in graph['nodes']} == expected
        assert [edge['id'] for edge in graph['edges']] == [package['id'] + ':business']
        assert graph['paths']
        assert all(set(path['node_ids']) <= expected for path in graph['paths'])
        assert all(path['evidence_ids'] == [package['id'] + ':evidence'] for path in graph['paths'])
    assert client.get('/api/v1/chain', params={'topic_id': 'not-installed'}).status_code == 404


def test_topic_graph_uses_current_database_facts_not_package_embedded_snapshot(app, client):
    package = topic('test-earth', '稀土氧化物', 'SH:600392', '盛和资源')
    install(client, package)
    # Simulate an authoritative DB-side label update; membership must remain package-scoped.
    node = deepcopy(package['nodes'][-1])
    node['label'] = '数据库内已更新的产品名称'
    with app.state.db.transaction() as c:
        app.state.research._upsert_json(c, 'nodes', node)
    graph = client.get('/api/v1/chain', params={'topic_id': package['id']}).json()['data']
    assert next(n for n in graph['nodes'] if n['kind'] == 'product')['label'] == node['label']


def test_remote_new_topics_report_missing_capability_without_local_fallback(tmp_path):
    seen = []

    def handler(request):
        seen.append(request.url.path)
        return httpx.Response(404)

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    app.state.settings.update(ConfigUpdate(data_mode='ycore', ycore_url='https://ycore.example'))
    with TestClient(app) as client:
        for path in ('/api/v1/chain/topics', '/api/v1/chain?topic_id=rare-earth', '/api/v1/securities/SH:600392/profile'):
            response = client.get(path)
            assert response.status_code == 501
            assert '能力' in response.json()['detail'] and '未回退' in response.json()['detail']
    assert '/api/v1/chain' not in seen  # A legacy global graph must not replace a topic graph.
