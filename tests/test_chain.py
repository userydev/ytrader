from copy import deepcopy

import pytest


def package():
    return {'id': 'original-test-demo', 'version': '1', 'license': 'CC0-1.0',
            'source_url': 'https://example.org/original-disclosure', 'as_of': '2026-01-01T00:00:00Z',
            'nodes': [{'id': 'demo-company', 'label': '原创演示企业（仅测试）', 'kind': 'company', 'symbol': 'SH:600000'},
                      {'id': 'demo-industry', 'label': '原创演示行业（仅测试）', 'kind': 'industry'}],
            'edges': [{'id': 'demo-edge', 'from_id': 'demo-company', 'to_id': 'demo-industry', 'relation': 'classification',
                       'evidence_ids': ['demo-evidence'], 'confidence': None, 'as_of': '2026-01-01T00:00:00Z',
                       'source_url': 'https://example.org/original-disclosure'}],
            'evidence': [{'id': 'demo-evidence', 'title': '原创演示证据（仅测试）', 'url': 'https://example.org/original-disclosure',
                          'excerpt': '本样本为作者原创的分类演示，不代表真实公司或供应事实。', 'published_at': None, 'source': '原创测试 fixture'}]}


def test_empty_database_has_no_demo_graph(client):
    assert client.get('/api/v1/chain').json()['data']['nodes'] == []


def test_transactional_import_and_reference_query(client):
    value = package()
    assert client.post('/api/v1/chain/import', json=value).status_code == 200
    assert client.post('/api/v1/chain/import', json=value).status_code == 200
    graph = client.get('/api/v1/chain', params={'symbol': 'SH:600000'}).json()['data']
    assert graph['paths'][0]['evidence_ids'] == ['demo-evidence']
    assert graph['paths'][0]['kind'] == 'classification'
    assert client.get('/api/v1/evidence/demo-evidence').json()['data']['excerpt'] == value['evidence'][0]['excerpt']
    industry = client.get('/api/v1/chain', params={'q': '原创演示行业'}).json()['data']
    assert industry['paths']


@pytest.mark.parametrize('mutation', ['license', 'evidence', 'node', 'relation', 'time', 'source', 'empty_excerpt'])
def test_invalid_package_is_rejected_atomically(client, mutation):
    value = package()
    if mutation == 'license': value['license'] = 'unknown'
    if mutation == 'evidence': value['edges'][0]['evidence_ids'] = ['invented']
    if mutation == 'node': value['edges'][0]['to_id'] = 'invented'
    if mutation == 'relation': value['edges'][0]['relation'] = 'supplier'
    if mutation == 'time': value['as_of'] = 'missing'
    if mutation == 'source': value['source_url'] = 'file:///tmp/private'
    if mutation == 'empty_excerpt': value['evidence'][0]['excerpt'] = ''
    assert client.post('/api/v1/chain/import', json=value).status_code in (400, 422)
    assert not client.get('/api/v1/chain').json()['data']['nodes']


def test_id_conflicts_do_not_partially_write(client):
    first = package()
    client.post('/api/v1/chain/import', json=first)
    second = deepcopy(first)
    second['id'] = 'new-package'
    second['nodes'].insert(0, {'id': 'new-node', 'label': '不可部分写入', 'kind': 'product'})
    second['evidence'][0]['excerpt'] = '试图篡改旧证据'
    assert client.post('/api/v1/chain/import', json=second).status_code == 409
    assert 'new-node' not in {n['id'] for n in client.get('/api/v1/chain').json()['data']['nodes']}


def import_test_graph(client, name, nodes, links):
    """Synthetic relationships only; no real-world supply claim is made."""
    value = package()
    value.update(id=name, nodes=nodes, edges=[
        dict(value['edges'][0], id=eid, from_id=source, to_id=target, relation=relation)
        for eid, source, target, relation in links
    ])
    response = client.post('/api/v1/chain/import', json=value)
    assert response.status_code == 200, response.text


def import_industry_peers(client, industry, count, prefix='peer'):
    # Small packages also exercise shared, identical industry/evidence IDs.
    for start in range(0, count, 100):
        companies = [{'id': f'company:000-{prefix}-{i:04d}', 'label': f'无关制造公司{i:04d}',
                      'kind': 'company', 'symbol': f'SH:{600000 + i:06d}'}
                     for i in range(start, min(start + 100, count))]
        import_test_graph(client, f'{prefix}-{start}', [industry, *companies], [
            (f'classification:{n["id"]}', n['id'], industry['id'], 'classification') for n in companies
        ])


@pytest.fixture
def lithium_graph(client):
    manufacturing = {'id': 'industry:manufacturing', 'label': 'C制造业', 'kind': 'industry'}
    business_nodes = [
        manufacturing,
        {'id': 'company:ganfeng', 'label': '赣锋锂业', 'kind': 'company', 'symbol': 'SZ:002460'},
        {'id': 'company:catl', 'label': '宁德时代', 'kind': 'company', 'symbol': 'SZ:300750'},
        {'id': 'product:ore', 'label': '锂矿', 'kind': 'product'},
        {'id': 'segment:extraction', 'label': '提锂环节', 'kind': 'segment'},
        {'id': 'product:carbonate', 'label': '碳酸锂', 'kind': 'product'},
        {'id': 'product:cathode', 'label': '正极材料', 'kind': 'product'},
        {'id': 'segment:battery', 'label': '锂电池制造环节', 'kind': 'segment'},
    ]
    # These disconnected directory entries sort after company IDs. They must not
    # disappear when hundreds of company records fill the default view's budget.
    directory = [{'id': f'z-directory:{i:02d}', 'label': f'目录行业{i:02d}', 'kind': 'industry'} for i in range(24)]
    import_test_graph(client, 'synthetic-lithium', business_nodes + directory, [
        ('ore-extraction', 'product:ore', 'segment:extraction', 'disclosed_supply'),
        ('extraction-carbonate', 'segment:extraction', 'product:carbonate', 'disclosed_supply'),
        ('carbonate-cathode', 'product:carbonate', 'product:cathode', 'disclosed_supply'),
        ('cathode-battery', 'product:cathode', 'segment:battery', 'disclosed_supply'),
        ('ganfeng-carbonate', 'company:ganfeng', 'product:carbonate', 'classification'),
        ('catl-battery', 'company:catl', 'segment:battery', 'classification'),
        ('ganfeng-industry', 'company:ganfeng', manufacturing['id'], 'classification'),
        ('catl-industry', 'company:catl', manufacturing['id'], 'classification'),
    ])
    import_industry_peers(client, manufacturing, 520)
    return dict(business_ids={n['id'] for n in business_nodes},
                directory_ids={n['id'] for n in business_nodes + directory if n['kind'] != 'company'})


def test_product_neighborhood_does_not_spread_through_shared_industry(client, lithium_graph):
    graph = client.get('/api/v1/chain', params={'q': '碳酸锂'}).json()['data']
    assert {n['id'] for n in graph['nodes']} == lithium_graph['business_ids']
    assert {n['label'] for n in graph['nodes'] if n['kind'] == 'company'} == {'赣锋锂业', '宁德时代'}
    assert {e['id'] for e in graph['edges']} == {
        'ore-extraction', 'extraction-carbonate', 'carbonate-cathode', 'cathode-battery',
        'ganfeng-carbonate', 'catl-battery', 'ganfeng-industry', 'catl-industry',
    }
    assert not graph['gaps']
    assert graph['paths'][0]['node_ids'][0] == 'product:carbonate'
    assert any(p['node_ids'][:2] == ['product:carbonate', 'company:ganfeng'] for p in graph['paths'])
    assert any('company:catl' in p['node_ids'] for p in graph['paths'])
    assert max(len(p['edge_ids']) for p in graph['paths']) == 4
    for path in graph['paths']:
        assert path['evidence_ids'] == ['demo-evidence']
        assert '不代表' in path['condition'] or '不是供货关系' in path['condition']
        # Even when both companies are independently relevant, a shared industry
        # must never become an intermediate hop between them.
        if 'industry:manufacturing' in path['node_ids']:
            assert path['node_ids'][-1] == 'industry:manufacturing'
    reverse = [p for p in graph['paths'] if p['node_ids'][:2] == ['product:carbonate', 'company:ganfeng']]
    assert all('反向分类' in p['condition'] for p in reverse)


def test_company_industry_is_a_leaf_unless_industry_is_selected(client, lithium_graph):
    company = client.get('/api/v1/chain', params={'symbol': 'SZ:002460'}).json()['data']
    assert 'industry:manufacturing' in {n['id'] for n in company['nodes']}
    assert not any(n['id'].startswith('company:000-peer-') for n in company['nodes'])
    assert not company['gaps']

    industry = client.get('/api/v1/chain', params={'q': 'C制造业'}).json()['data']
    assert len(industry['nodes']) == 500
    assert any(n['id'].startswith('company:000-peer-') for n in industry['nodes'])
    assert any('关系结果已截断' in gap for gap in industry['gaps'])
    assert industry['paths'][0]['node_ids'][0] == 'industry:manufacturing'
    assert '反向分类' in industry['paths'][0]['condition']


def test_default_directory_keeps_all_industries_products_and_segments(client, lithium_graph):
    graph = client.get('/api/v1/chain').json()['data']
    assert lithium_graph['directory_ids'] <= {n['id'] for n in graph['nodes']}
    assert len(graph['nodes']) == 500
    assert any('关系结果已截断' in gap for gap in graph['gaps'])


def test_path_budget_prioritizes_actual_product_root_and_downstream(client):
    root = {'id': 'product:zz-root', 'label': '碳酸锂', 'kind': 'product'}
    downstream = {'id': 'segment:downstream', 'label': '明确下游环节', 'kind': 'segment'}
    companies = [{'id': f'company:{i:04d}', 'label': f'明确业务公司{i:04d}',
                  'kind': 'company', 'symbol': f'SH:{600000 + i:06d}'} for i in range(205)]
    import_test_graph(client, 'many-explicit-businesses', [root, downstream, *companies], [
        # These IDs deliberately sort before the downstream edge. A reverse
        # classification lookup must not consume all 200 paths first.
        *[(f'a-classification-{i:04d}', n['id'], root['id'], 'classification') for i, n in enumerate(companies)],
        ('z-downstream', root['id'], downstream['id'], 'disclosed_supply'),
    ])
    graph = client.get('/api/v1/chain', params={'q': '碳酸锂'}).json()['data']
    assert {n['id'] for n in graph['nodes']} == {root['id'], downstream['id'], *(n['id'] for n in companies)}
    assert len(graph['paths']) == 200
    assert graph['paths'][0]['node_ids'] == [root['id'], downstream['id']]
    assert all(p['node_ids'][0] == root['id'] for p in graph['paths'])
    assert any('研究路径过多' in gap for gap in graph['gaps'])
    assert not any('关系结果已截断' in gap for gap in graph['gaps'])


@pytest.mark.parametrize('company_count, truncated', [(499, False), (500, True)])
def test_node_limit_reports_actual_omission_not_merely_full_budget(client, company_count, truncated):
    industry = {'id': 'industry:budget', 'label': '节点预算行业', 'kind': 'industry'}
    import_industry_peers(client, industry, company_count, prefix='budget')
    graph = client.get('/api/v1/chain', params={'q': '节点预算行业'}).json()['data']
    assert len(graph['nodes']) == 500
    assert any('关系结果已截断' in gap for gap in graph['gaps']) is truncated


@pytest.mark.parametrize('path_count, truncated', [(200, False), (201, True)])
def test_path_limit_reports_actual_omission(client, path_count, truncated):
    root = {'id': 'product:path-budget', 'label': '路径预算产品', 'kind': 'product'}
    downstream = [{'id': f'segment:{i:04d}', 'label': f'明确下游{i:04d}', 'kind': 'segment'} for i in range(path_count)]
    import_test_graph(client, 'path-budget', [root, *downstream], [
        (f'downstream-{i:04d}', root['id'], n['id'], 'disclosed_supply') for i, n in enumerate(downstream)
    ])
    graph = client.get('/api/v1/chain', params={'q': root['label']}).json()['data']
    assert len(graph['paths']) == 200
    assert any('研究路径过多' in gap for gap in graph['gaps']) is truncated
    assert not any('关系结果已截断' in gap for gap in graph['gaps'])
