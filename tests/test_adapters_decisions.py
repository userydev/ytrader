import io
import json
import zipfile
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import pytest
from openpyxl import Workbook

from backend.adapters import Network, PublicData, UpstreamError
from backend.decisions import RulesProvider, evaluate, CAPABILITIES
from backend.official import ExchangeData


def test_wallstreet_source_fields_unknown_time_and_rss():
    def handler(request):
        if request.url.path == '/wall':
            return httpx.Response(200, json={'data': {'items': [{'id': 42, 'title': '公开快讯标题', 'content_text': '公开快讯内容', 'uri': 'https://wallstreetcn.com/livenews/42', 'display_time': 1792316337}]}})
        return httpx.Response(200, content=b'<rss><channel><item><title>RSS title</title><link>https://example.org/a</link><description>summary</description></item></channel></rss>')
    public = PublicData(Network(httpx.MockTransport(handler)))
    assert public.news({'id': 'wallstreetcn', 'url': 'https://example.org/wall', 'name': 'wall'})[0]['published_at'].endswith('Z')
    rss = public.news({'id': 'rss:one', 'url': 'https://example.org/rss', 'name': 'rss'})
    assert rss[0]['published_at'] is None
    assert rss[0]['content_level'] == 'summary'


def test_bj_cookie_redirect_same_form_and_real_fields():
    seen = []

    def handler(request):
        seen.append(request)
        assert request.method == 'POST'
        form = parse_qs(request.content.decode())
        assert form['xxfcbj[]'] == ['2']
        assert 'xxzqdm' in form or 'xxzqdm=' in request.content.decode()
        if 'session=public' not in request.headers.get('cookie', ''):
            return httpx.Response(307, headers={'location': str(request.url), 'set-cookie': 'session=public; Path=/'})
        content = {'totalElements': 1, 'totalPages': 1, 'content': [{'xxzqdm': '920000', 'xxzqjc': '安徽凤凰', 'xxhyzl': '汽车制造业', 'xxjsrq': '20261016'}]}
        return httpx.Response(200, text='null(' + json.dumps([content]) + ')')
    official = ExchangeData(Network(httpx.MockTransport(handler)))
    rows = official.bj()
    assert len(seen) == 2
    assert rows[0]['industry'] == '汽车制造业'
    assert rows[0]['as_of'] is None
    assert official.report_dates['BJ'] == ['20261016']


def test_sse_both_board_types_jsonp_and_missing_industry():
    types = []

    def handler(request):
        types.append(request.url.params['STOCK_TYPE'])
        assert request.url.params['pageHelp.pageSize'] == '10000'
        assert request.headers['referer'].endswith('/assortment/stock/list/share/')
        code = '600000' if types[-1] == '1' else '688001'
        data = {'pageHelp': {'total': 1}, 'result': [{'A_STOCK_CODE': code, 'COMPANY_ABBR': '测试企业'}]}
        return httpx.Response(200, text='jsonpCallback(' + json.dumps(data) + ');')
    rows = ExchangeData(Network(httpx.MockTransport(handler))).sh()
    assert types == ['1', '8']
    assert len(rows) == 2 and all(r['industry'] is None for r in rows)


def test_sz_incorrect_xlsx_dimensions_are_reset():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'A股列表'
    sheet.append(['板块', 'A股代码', 'A股简称', '所属行业'])
    sheet.append(['主板', '000001', '平安银行', '货币金融服务'])
    original = io.BytesIO()
    workbook.save(original)
    changed = io.BytesIO()
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(changed, 'w') as target:
        for name in source.namelist():
            raw = source.read(name)
            if name == 'xl/worksheets/sheet1.xml':
                raw = raw.replace(b'ref="A1:D2"', b'ref="A1"')
            target.writestr(name, raw)
    network = Network(httpx.MockTransport(lambda request: httpx.Response(200, content=changed.getvalue())))
    rows = ExchangeData(network).sz()
    assert rows[0]['code'] == '000001'
    assert rows[0]['industry'] == '货币金融服务'


def test_remote_credentials_never_follow_redirect():
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(307, headers={'location': 'https://evil.example/token'})
    network = Network(httpx.MockTransport(handler))
    with pytest.raises(UpstreamError):
        network.request('POST', 'https://model.example/v1', headers={'Authorization': 'Bearer private'})
    assert len(calls) == 1


def test_public_redirect_to_private_rejected():
    network = Network(httpx.MockTransport(lambda r: httpx.Response(302, headers={'location': 'http://127.0.0.1/private'})))
    from backend.config import UserError
    with pytest.raises(UserError):
        network.request('GET', 'https://example.org/rss', public=True)


def test_rules_evaluation_time_splits_and_calibration():
    samples = json.loads((Path(__file__).parents[1] / 'backend/fixtures/decision_samples.json').read_text())
    report = evaluate(RulesProvider(), [x for x in samples if x['split'] == 'test'])
    assert report['accuracy'] == 1
    assert report['brier'] < .01
    assert report['latency_ms_mean'] >= 0
    assert report['cost'] == 0
    assert 'real_model_accuracy' in report['unmeasured']
    assert not CAPABILITIES['jev']['verified']
    for row in report['results']:
        assert row['confidence'] == (.95 if row['value'] else .05)
