import json
import os

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.adapters import Network, UpstreamError
from backend.models import ConfigUpdate
from conftest import article, security


def test_config_secrets_permissions_clear_and_persistence(tmp_path):
    app = create_app(tmp_path, start_worker=False)
    with TestClient(app) as c:
        assert c.get('/api/v1/health').json()['data'] == {'status': 'ok', 'database': 'ok'}
        r = c.put('/api/v1/config', json={'model_api_key': 'private-model-token', 'ycore_api_key': 'private-ycore-token', 'model_name': 'real-model', 'sync_interval_minutes': 0})
        assert r.status_code == 200
        assert 'private-model-token' not in r.text
        assert r.json()['data']['model_key_set']
        c.put('/api/v1/config', json={'model_api_key': ''})
        assert c.get('/api/v1/config').json()['data']['model_key_set']
        assert os.stat(tmp_path / 'keys.json').st_mode & 0o777 == 0o600
        c.put('/api/v1/watchlist', json={'symbols': ['SH:600000', 'SH:600000']})
        app.state.jobs.schedule()
        assert not app.state.jobs.list()
    restarted = create_app(tmp_path, start_worker=False)
    with TestClient(restarted) as c:
        assert c.get('/api/v1/watchlist').json()['data'] == ['SH:600000']
        assert c.get('/api/v1/config').json()['data']['model_key_set']
        c.put('/api/v1/config', json={'clear_model_key': True})
        assert not c.get('/api/v1/config').json()['data']['model_key_set']


@pytest.mark.parametrize('url', ['file:///etc/passwd', 'https://a:b@example.org', 'http://169.254.169.254/v1', 'https://example.org/#fragment'])
def test_bad_remote_urls(client, url):
    assert client.put('/api/v1/config', json={'ycore_url': url}).status_code == 400


def test_sources_disabled_ifind_rss_private_rejected(client):
    sources = client.get('/api/v1/sources').json()['data']
    assert not next(s for s in sources if s['id'] == 'ifind')['enabled']
    assert client.patch('/api/v1/sources/ifind', json={'enabled': True}).status_code == 409
    assert client.post('/api/v1/sources', json={'name': 'private', 'url': 'http://127.0.0.1/rss'}).status_code == 400
    result = client.post('/api/v1/sources', json={'name': '公开RSS', 'url': 'https://example.org/rss'})
    assert result.status_code == 201
    assert client.patch('/api/v1/sources/' + result.json()['data']['id'], json={'enabled': False}).status_code == 200


def test_unconfigured_analysis_409_evidence_readable(app, client):
    eid = app.state.research.ingest(article())
    assert client.post(f'/api/v1/events/{eid}/analyze').status_code == 409
    detail = client.get(f'/api/v1/events/{eid}').json()['data']
    assert detail['articles'] and detail['analysis'] is None


def test_job_active_idempotency_and_recovery(app):
    jobs, db = app.state.jobs, app.state.db
    one = jobs.enqueue('news')
    assert jobs.enqueue('news')['id'] == one['id']
    with db.transaction() as c:
        c.execute("UPDATE jobs SET status='running',attempts=1 WHERE id=?", (one['id'],))
    jobs.recover()
    assert db.job(one['id'])['status'] == 'queued'
    with db.transaction() as c:
        c.execute("UPDATE jobs SET status='running',attempts=3 WHERE id=?", (one['id'],))
    jobs.recover()
    assert db.job(one['id'])['status'] == 'failed'
    assert jobs.enqueue('news')['id'] != one['id']


class PartialData:
    def securities(self, exchange):
        if exchange == 'BJ':
            raise UpstreamError('simulated timeout')
        if exchange == 'SH':
            return [security('600000', '浦发银行', '银行', 'SH')], False, 2000
        return [security()], True, 1

    def news(self, source):
        if source['id'] == 'wallstreetcn':
            raise UpstreamError('source failure')
        return [article(source=source['name'])]


def test_partial_coverage_never_delists_and_sources_isolated(tmp_path):
    app = create_app(tmp_path, start_worker=False, public=PartialData())
    r, jobs = app.state.research, app.state.jobs
    r.store_securities('BJ', [security('920000', '安徽凤凰', '汽车制造业', 'BJ')], True)
    r.store_securities('SH', [security('600001', '已有公司', None, 'SH')], True)
    with TestClient(app) as c:
        c.post('/api/v1/sources', json={'name': '可用RSS', 'url': 'https://example.org/rss'})
        jid = c.post('/api/v1/sync', json={'kind': 'all'}).json()['data']['id']
        for _ in range(3):
            assert jobs.run_one()
        assert app.state.db.job(jid)['status'] == 'failed'
        assert r.security('BJ:920000')['security']['status'] == 'listed'
        assert r.security('SH:600001')['security']['status'] == 'listed'
        coverage = c.get('/api/v1/coverage').json()['data']
        assert coverage['missing_exchanges'] == []
        assert coverage['status'] == 'partial'
        assert coverage['counts']['BJ'] == 1
        assert len(r.events()) == 1
        sources = c.get('/api/v1/sources').json()['data']
        assert next(s for s in sources if s['id'] == 'wallstreetcn')['status'] == 'error'
        assert next(s for s in sources if s['name'] == '可用RSS')['status'] == 'ok'


def test_unavailable_quotes_are_not_invented(tmp_path):
    network = Network(httpx.MockTransport(lambda request: httpx.Response(503)))
    with TestClient(create_app(tmp_path, network=network, start_worker=False)) as c:
        result = c.get('/api/v1/quotes/SH:600000').json()
        assert result['data']['price'] is None
        assert result['data']['as_of'] is None
        assert result['meta']['completeness'] == 'unavailable'


def test_errors_are_string_detail_and_api_unknown_not_spa(client):
    response = client.put('/api/v1/watchlist', json={'symbols': ['invalid']})
    assert response.status_code == 422 and isinstance(response.json()['detail'], str)
    assert client.get('/api/v1/misspelled').status_code == 404
    assert client.post('/api/v1/sync', json={'kind': 'all'}, headers={'Origin': 'https://evil.example'}).status_code == 403


def test_spa_and_assets_do_not_swallow_api(tmp_path, monkeypatch):
    dist = tmp_path / 'web'
    dist.mkdir()
    (dist / 'index.html').write_text('<html>研究工作台</html>', encoding='utf-8')
    (dist / 'entry.js').write_text('console.log(1)')
    monkeypatch.setenv('YTRADER_WEB_DIST', str(dist))
    with TestClient(create_app(tmp_path / 'data', start_worker=False)) as c:
        assert c.get('/events/some-id').status_code == 200
        assert c.get('/entry.js').status_code == 200
        assert c.get('/assets/missing.js').status_code == 404
        assert c.get('/api/v1/missing').status_code == 404
