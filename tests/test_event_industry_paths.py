from conftest import article


def test_product_price_event_traces_disclosed_evidence_without_naming_company(app, client):
    # Original fictional business graph, explicitly test-only; no real supply claim.
    url = 'https://example.org/original-test-business-disclosure'
    value = {'id': 'original-material-chain-demo', 'version': '1', 'license': 'CC0-1.0', 'source_url': url,
        'as_of': '2026-01-01T00:00:00Z',
        'nodes': [
            {'id': 'lithium', 'label': '碳酸锂', 'kind': 'product'},
            {'id': 'battery', 'label': '动力电池', 'kind': 'segment'},
            {'id': 'fictional-company', 'label': '原创演示电池企业（仅测试）', 'kind': 'company', 'symbol': 'SZ:300001'}],
        'edges': [
            {'id': 'material-to-battery', 'from_id': 'lithium', 'to_id': 'battery', 'relation': 'upstream',
             'evidence_ids': ['material-fact'], 'confidence': None, 'as_of': None, 'source_url': url},
            {'id': 'company-business', 'from_id': 'fictional-company', 'to_id': 'battery', 'relation': 'classification',
             'evidence_ids': ['business-fact'], 'confidence': None, 'as_of': None, 'source_url': url}],
        'evidence': [
            {'id': 'material-fact', 'title': '原创测试材料用途证据', 'url': url, 'excerpt': '本原创演示图中，碳酸锂是动力电池材料链的上游产品。并未披露任意公司的订单。', 'published_at': None, 'source': '作者原创、仅用于测试'},
            {'id': 'business-fact', 'title': '原创测试业务分类证据', 'url': url, 'excerpt': '虚构演示公司被分类到动力电池环节；不代表供货关系。', 'published_at': None, 'source': '作者原创、仅用于测试'}]}
    assert client.post('/api/v1/chain/import', json=value).status_code == 200
    eid = app.state.research.ingest(article(title='碳酸锂价格上涨，采购成本变化受关注', content='本周碳酸锂现货价格上涨。此新闻不提公司名称或代码。'))
    detail = client.get('/api/v1/events/' + eid).json()['data']
    assert not detail['event']['symbols']
    path = next(p for p in detail['paths'] if p['node_ids'] == ['lithium', 'battery', 'fictional-company'])
    assert path['kind'] == 'inferred'
    assert path['evidence_ids'] == ['business-fact', 'material-fact']
    assert '反向分类' in path['condition'] and '不是供货' in path['condition']
    assert '须验证' in path['condition']
    for evidence_id in path['evidence_ids']:
        ev = client.get('/api/v1/evidence/' + evidence_id).json()['data']
        assert ev['url'] == url and ev['published_at'] is None
    unrelated = app.state.research.ingest(article(title='无关的宏观天气消息', content='没有明确提及任何产业节点。', url='https://news.example.com/unrelated'))
    assert not app.state.research.detail(unrelated)['paths']
