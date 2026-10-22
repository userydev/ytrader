import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.adapters import BUILTIN_PUBLIC_HOSTS, Network
from backend.app import create_app
from backend.db import dump
from conftest import security
from test_product_flow_topics import install, topic


SAMPLES = [('SH:600392', '盛和资源'), ('SZ:300750', '宁德时代'), ('BJ:920001', '纬达光电')]


def profile_payload(symbol, name='测试公司', introduction='公开资料中的公司简介，仅为测试响应。'):
    exchange, code = symbol.split(':')
    return dict(jbzl=[dict(SECURITY_CODE=code, SECUCODE=code + '.' + exchange,
        ORG_NAME=name + '股份有限公司', ORG_PROFILE=introduction, BUSINESS_SCOPE='测试工商经营范围，不是收入构成。',
        ORG_WEB='https://www.example.org', PROVINCE='测试省份', INDUSTRYCSRC1='制造业',
        UNNEEDED_PRIVATE_FIELD='must-not-be-stored')],
        fxxg=[dict(FOUND_DATE='2000-01-02 00:00:00', LISTING_DATE='2020-03-04 00:00:00', OTHER_FIELD='discard')],
        raw_contacts=['must-not-be-stored'])


def add_master(app, symbol, name):
    exchange, code = symbol.split(':')
    app.state.research.store_securities(exchange, [security(code=code, name=name, exchange=exchange, industry='C制造业')], True)


def expire_profile(app, symbol):
    with app.state.db.transaction() as c:
        value = json.loads(c.execute('SELECT data FROM company_profiles WHERE symbol=?', (symbol,)).fetchone()[0])
        value['fetched_at'] = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        c.execute('UPDATE company_profiles SET data=? WHERE symbol=?', (dump(value), symbol))


@pytest.mark.parametrize('symbol,name', SAMPLES)
def test_verified_profile_shape_all_exchanges_whitelist_evidence_and_cache(tmp_path, symbol, name):
    seen = []

    def handler(request):
        seen.append(request)
        assert request.method == 'GET'
        assert request.url.host == 'emweb.eastmoney.com'
        assert request.url.path == '/PC_HSF10/CompanySurvey/PageAjax'
        assert request.url.params['code'] == symbol.replace(':', '')
        assert 'authorization' not in request.headers
        return httpx.Response(200, json=profile_payload(symbol, name))

    network = Network(httpx.MockTransport(handler))
    app = create_app(tmp_path, start_worker=False, network=network)
    add_master(app, symbol, name)
    with TestClient(app) as client:
        assert client.get('/api/v1/securities/' + symbol).status_code == 200
        assert not seen  # Optional profile loading must not block the existing security API.
        response = client.get('/api/v1/securities/' + symbol + '/profile')
        assert response.status_code == 200
        profile = response.json()['data']
        assert profile['symbol'] == symbol and profile['name'] == name
        assert profile['full_name'] == name + '股份有限公司'
        assert profile['introduction'] == profile_payload(symbol)['jbzl'][0]['ORG_PROFILE']
        assert profile['listing_date'] == '2020-03-04' and profile['established_date'] == '2000-01-02'
        assert profile['status'] == 'ok' and profile['as_of'] is None and profile['fetched_at']
        assert profile['businesses'] == profile['topics'] == []  # Manufacturing alone isn't a business map.
        evidence = client.get('/api/v1/evidence/' + profile['evidence_ids'][0]).json()['data']
        assert evidence['url'] == profile['source_url'] and evidence['published_at'] is None
        assert '来源表述' in evidence['excerpt'] and '非收入构成' in evidence['excerpt']
        assert client.get('/api/v1/securities/' + symbol + '/profile').json()['data'] == profile
    assert len(seen) == 1
    # The 24h cache survives process recreation; no raw upstream fields are persisted.
    restored = create_app(tmp_path, start_worker=False, network=network)
    with TestClient(restored) as client:
        assert client.get('/api/v1/securities/' + symbol + '/profile').json()['data']['evidence_ids'] == profile['evidence_ids']
    assert len(seen) == 1
    with restored.state.db.connect() as c:
        stored = c.execute('SELECT data FROM company_profiles').fetchone()[0]
        assert 'UNNEEDED_PRIVATE_FIELD' not in stored and 'must-not-be-stored' not in stored
        assert 'must-not-be-stored' not in c.execute('SELECT data FROM evidence WHERE id=?', (profile['evidence_ids'][0],)).fetchone()[0]


@pytest.mark.parametrize('bad_field,bad_value', [('SECURITY_CODE', '300750'), ('SECUCODE', '600392.SZ')])
def test_profile_identity_mismatch_keeps_last_good_cache(tmp_path, bad_field, bad_value):
    state = {'bad': False, 'calls': 0}

    def handler(request):
        state['calls'] += 1
        payload = profile_payload('SH:600392', '盛和资源')
        if state['bad']:
            payload['jbzl'][0][bad_field] = bad_value
            payload['jbzl'][0]['ORG_PROFILE'] = 'wrong-entity-description'
        return httpx.Response(200, json=payload)

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    add_master(app, 'SH:600392', '盛和资源')
    with TestClient(app) as client:
        path = '/api/v1/securities/SH:600392/profile'
        good = client.get(path).json()['data']
        expire_profile(app, 'SH:600392')
        state['bad'] = True
        stale = client.get(path).json()['data']
        assert stale['status'] == 'stale'
        assert stale['introduction'] == good['introduction']
        assert stale['evidence_ids'] == good['evidence_ids'] and stale['as_of'] is None
        assert stale['fetched_at'] != good['fetched_at']  # Retains the previous (now expired) fetch time.
        assert client.get(path).json()['data']['status'] == 'stale'
        assert state['calls'] == 2  # Failure cooldown, not a new request on each rerender.
        assert client.get('/api/v1/securities/SH:600392').status_code == 200
        assert 'wrong-entity-description' not in dump(stale)


def test_initial_failure_retains_master_businesses_and_topics_but_no_fake_profile(tmp_path):
    def handler(request):
        return httpx.Response(503)

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    add_master(app, 'SH:600392', '盛和资源')
    with TestClient(app) as client:
        install(client, topic('test-earth', '稀土氧化物', 'SH:600392', '盛和资源'))
        profile = client.get('/api/v1/securities/SH:600392/profile').json()['data']
        assert profile['status'] == 'unavailable' and profile['name'] == '盛和资源'
        assert profile['full_name'] is profile['introduction'] is profile['business_scope'] is None
        assert profile['as_of'] is profile['fetched_at'] is None
        assert profile['evidence_ids'] == []
        assert profile['businesses'][0]['label'] == '稀土氧化物'
        assert [t['id'] for t in profile['topics']] == ['test-earth']
        assert client.get('/api/v1/securities/SH:600392').status_code == 200
        assert client.get('/api/v1/quotes/SH:600392').json()['data']['status'] == 'unavailable'
        assert client.get('/api/v1/securities/SH:999999/profile').status_code == 404


def test_first_response_wrong_exchange_does_not_seed_cache_or_evidence(tmp_path):
    def handler(request):
        return httpx.Response(200, json=profile_payload('SZ:600392'))

    app = create_app(tmp_path, start_worker=False, network=Network(httpx.MockTransport(handler)))
    add_master(app, 'SH:600392', '盛和资源')
    with TestClient(app) as client:
        data = client.get('/api/v1/securities/SH:600392/profile').json()['data']
        assert data['status'] == 'unavailable' and not data['evidence_ids']
    with app.state.db.connect() as c:
        assert c.execute('SELECT count(*) FROM company_profiles').fetchone()[0] == 0
        assert c.execute("SELECT count(*) FROM evidence WHERE id LIKE 'company-profile:%'").fetchone()[0] == 0


def test_profile_fetch_uses_eight_second_public_request_budget(tmp_path):
    class RecordingNetwork:
        def json(self, method, url, **kwargs):
            assert kwargs['public'] is True and 0 < kwargs['timeout'] <= 8
            return profile_payload('BJ:920001')

    app = create_app(tmp_path, start_worker=False, network=RecordingNetwork())
    add_master(app, 'BJ:920001', '纬达光电')
    with TestClient(app) as client:
        assert client.get('/api/v1/securities/BJ:920001/profile').json()['data']['status'] == 'ok'
    assert 'emweb.eastmoney.com' in BUILTIN_PUBLIC_HOSTS
    assert '*.eastmoney.com' not in BUILTIN_PUBLIC_HOSTS
    assert 'untrusted.emweb.eastmoney.com' not in BUILTIN_PUBLIC_HOSTS
