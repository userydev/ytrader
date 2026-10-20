from copy import deepcopy

from conftest import article, security
from backend.analysis import validate_result
from backend.models import ModelResult
from backend.research import same_event


def test_fingerprint_and_url_idempotency_preserves_reprints(app):
    research = app.state.research
    eid = research.ingest(article(url='https://news.example.com/a?utm_source=x&ref=share'))
    assert research.ingest(article()) is None
    assert research.ingest(article(url='https://other.example.com/reprint', source='来源乙')) == eid
    event = research.detail(eid)
    assert event['event']['article_count'] == 2
    assert event['event']['source_names'] == ['来源乙', '来源甲']


def test_known_short_security_name_rewrite_and_conflicts(app):
    r = app.state.research
    r.store_securities('SZ', [security()], True)
    eid = r.ingest(article())
    assert r.ingest(article(title='前三季度净利润增长20%，宁德时代发布业绩', url='https://other.example.com/a')) == eid
    assert r.ingest(article(title='宁德时代前三季度净利润增长30%', url='https://other.example.com/b')) != eid
    assert r.ingest(article(title='宁德时代前三季度净利润下降20%', url='https://other.example.com/c')) != eid
    assert len(r.events()) == 3


def test_unknown_time_and_old_news_do_not_merge(app):
    r = app.state.research
    ids = [r.ingest(article(url=f'https://news.example.com/{n}', published_at=t)) for n, t in enumerate([
        None, None, '2024-09-01T02:00:00Z', '2026-09-01T02:00:00Z'])]
    assert len(set(ids)) == 4
    assert r.detail(ids[0])['event']['published_at'] is None


def test_same_url_reused_years_later_is_not_revision(app):
    r = app.state.research
    first = r.ingest(article(published_at='2024-09-01T02:00:00Z'))
    second = r.ingest(article(published_at='2026-09-01T02:00:00Z'))
    assert first != second
    assert r.detail(second)['articles'][0]['revision_kind'] == 'initial'


def test_correction_keeps_old_evidence_and_stales_analysis(app):
    r = app.state.research
    eid = r.ingest(article())
    context, version = r.evidence_context(eid)
    result = ModelResult(sections={k: [] for k in ('facts', 'links', 'companies', 'conditions', 'counter_evidence', 'unknowns')})
    app.state.analyzer.save(eid, result, 'test-model', version, 'local')
    r.ingest(article(title='更正：宁德时代前三季度净利润增长10%', content='原20%数字有误，更正为10%。', published_at='2026-09-01T03:00:00Z'))
    detail = r.detail(eid)
    assert [a['revision_kind'] for a in detail['articles']] == ['correction', 'initial']
    assert detail['analysis']['status'] == 'stale'
    assert detail['event']['title'].startswith('更正')
    assert detail['articles'][0]['content'] != detail['articles'][1]['content']


def test_unrelated_company_headlines_never_merge(app):
    r = app.state.research
    a = r.ingest(article(title='甲公司宣布收购乙公司部分股权', content='甲公司收购公告'))
    b = r.ingest(article(title='丙公司宣布收购丁公司部分股权', content='丙公司收购公告', url='https://news.example.com/b'))
    assert a != b


def test_fts_literal_chinese_and_quote_input(app, client):
    app.state.research.ingest(article())
    assert len(client.get('/api/v1/events', params={'q': '净利润增长'}).json()['data']) == 1
    assert client.get('/api/v1/events', params={'q': '" OR x*'}).status_code == 200


def test_watch_industry_relevance_separate_from_importance(app):
    r = app.state.research
    r.store_securities('SZ', [security(), security(code='300001', name='测试企业')], True)
    eid = r.ingest(article())
    before = r.detail(eid)['event']
    app.state.db.put('watchlist', ['SZ:300001'])
    after = r.detail(eid)['event']
    assert after['importance'] == before['importance']
    assert after['relevance'] == 20
    app.state.db.put('watchlist', ['SZ:300750'])
    assert r.detail(eid)['event']['relevance'] == 50


def test_source_diversity_reorders_crowded_list(app):
    r = app.state.research
    for n in range(5):
        r.ingest(article(title=f'不同公司{n}宣布项目安排', content=f'不同事项{n}', url=f'https://a.example/{n}', source='密集来源'))
    other = r.ingest(article(title='其他来源独立研究事项', content='不同事件', url='https://b.example/1', source='另一来源'))
    events = r.events(sort='hot')
    assert next(i for i, x in enumerate(events) if x['id'] == other) <= 1


def test_classification_source_and_unknown_industry(app):
    r = app.state.research
    r.store_securities('SZ', [security(), security(code='000001', name='平安银行', industry=None)], True)
    graph = r.chain(symbol='SZ:300750')
    assert graph['edges'][0]['relation'] == 'classification'
    assert graph['paths'][0]['kind'] == 'classification'
    evidence = r.evidence(graph['edges'][0]['evidence_ids'][0])
    assert evidence['url'].startswith('https://www.szse.cn/')
    assert evidence['published_at'] is None
    assert '不代表供应' in evidence['excerpt']
    assert any('未知所属行业' in x for x in r.chain(symbol='SZ:000001')['gaps'])


def test_security_observation_timestamp_alone_does_not_stale_analysis(app):
    r = app.state.research
    row = security()
    r.store_securities('SZ', [row], True)
    eid = r.ingest(article())
    context, version = r.evidence_context(eid)
    result = ModelResult(sections={k: [] for k in ('facts', 'links', 'companies', 'conditions', 'counter_evidence', 'unknowns')})
    app.state.analyzer.save(eid, result, 'test', version, 'local')
    r.store_securities('SZ', [dict(row, as_of='2026-09-02T00:00:00Z')], True)
    assert r.evidence_context(eid)[1] == version
    assert r.detail(eid)['analysis']['status'] == 'complete'
    r.store_securities('SZ', [dict(row, industry='电子')], True)
    assert r.detail(eid)['analysis']['status'] == 'stale'
