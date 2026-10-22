"""Data protection tests: fake public responses and an isolated temporary database."""
import copy
import json
from urllib.parse import parse_qs, urlsplit

import pytest

from backend.adapters import UpstreamError
from backend.config import UserError
from backend.db import Database, dump
from backend.fundamentals import Fundamentals, number, validate_remote

SYMBOL = 'SH:600276'


def row(when, **changes):
    value = dict(SECUCODE='600276.SH', SECURITY_CODE='600276', REPORT_DATE=when + ' 00:00:00',
                 CURRENCY='CNY', ORG_TYPE='通用', TOTALOPERATEREVE=0, PARENTNETPROFIT=-20,
                 TOTALOPERATEREVETZ=12.3, PARENTNETPROFITTZ=0, XSMLL=-3, ZCFZL=None)
    value.update(changes)
    return value


class FakeNetwork:
    def __init__(self):
        self.calls = []
        self.fail = set()
        self.bad = None
        self.org = '通用'
        self.assets = 100
        self.debt_source = None
        self.cash = 0
        self.omit_date = None
        self.recent = [row('2026-06-30'), row('2025-12-31')]
        self.annual = [row('2025-12-31'), row('2024-12-31', TOTALOPERATEREVE=40)]

    def json(self, method, url, **kwargs):
        assert method == 'GET' and kwargs == dict(public=True, timeout=8)
        self.calls.append(url)
        query = parse_qs(urlsplit(url).query)
        name = urlsplit(url).path.rsplit('/', 1)[-1]
        assert query['code'] == ['SH600276']
        if name in self.fail:
            raise UpstreamError('test network unavailable')
        if name == 'ZYZBAjaxNew':
            rows = copy.deepcopy(self.annual if query['type'] == ['1'] else self.recent)
            for item in rows:
                item['ORG_TYPE'] = self.org
                item['ZCFZL'] = self.debt_source
        elif name in ('zcfzbAjaxNew', 'xjllbAjaxNew'):
            assert query['companyType'] == ['4']
            dates = query['dates'][0].split(',')
            rows = [row(d, TOTAL_ASSETS=self.assets, TOTAL_LIABILITIES=20,
                        NETCASH_OPERATE=self.cash if d == '2026-06-30' else -5) for d in reversed(dates) if d != self.omit_date]
        elif name == 'PageAjax':
            rows = [row('2026-06-30', MAINOP_TYPE=2, ITEM_NAME='产品', MAIN_BUSINESS_INCOME=0,
                        MBI_RATIO=0.902464, GROSS_RPOFIT_RATIO=-0.1),
                    row('2026-06-30', MAINOP_TYPE=3, ITEM_NAME='地区', MAIN_BUSINESS_INCOME=99,
                        MBI_RATIO=1, GROSS_RPOFIT_RATIO=0.8),
                    row('2025-12-31', MAINOP_TYPE=2, ITEM_NAME='旧产品', MAIN_BUSINESS_INCOME=30,
                        MBI_RATIO=1, GROSS_RPOFIT_RATIO=0.7)]
            # Matches verified composition response: no independent currency field.
            for item in rows:
                item.pop('CURRENCY')
        else:
            raise AssertionError(url)
        if self.bad == name:
            rows[-1]['SECUCODE'] = '600276.SZ'
        return {'zygcfx' if name == 'PageAjax' else 'data': rows}


class EvidenceStore:
    @staticmethod
    def _upsert_json(c, table, value):
        assert table == 'evidence'
        c.execute('INSERT INTO evidence VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
                  (value['id'], dump(value)))


@pytest.fixture
def service(tmp_path):
    db = Database(tmp_path / 'fundamentals.sqlite3')
    with db.transaction() as c:
        c.execute('INSERT INTO securities VALUES (?,?,?,?,?,?,?,?)',
                  (SYMBOL, '600276', '测试公司', 'SH', None, 'listed', None, 'test'))
    return Fundamentals(db, EvidenceStore(), FakeNetwork())


def expire(service):
    with service.db.transaction() as c:
        value = json.loads(c.execute('SELECT data FROM company_fundamentals WHERE symbol=?', (SYMBOL,)).fetchone()[0])
        for item in [*value['indicator_parts'].values(), *value['tables'].values()]:
            if item.get('fetched_at'):
                item['fetched_at'] = '2000-01-01T00:00:00Z'
        c.execute('UPDATE company_fundamentals SET data=? WHERE symbol=?', (dump(value), SYMBOL))
    service.db.put('fundamentals-retry:' + SYMBOL, None)


def test_units_zero_dates_and_cache(service):
    data = service.get(SYMBOL)
    assert data['status'] == 'ok'
    assert [p['period_end'] for p in data['periods']] == ['2026-06-30', '2025-12-31', '2024-12-31']
    latest = data['periods'][0]
    assert latest['revenue'] == latest['operating_cash_flow'] == latest['net_profit_parent_yoy_pct'] == 0
    assert latest['net_profit_parent'] == -20 and latest['gross_margin_pct'] == -3
    assert latest['revenue_yoy_pct'] == 12.3
    assert latest['debt_to_asset_pct'] == 20 and latest['debt_to_asset_basis'] == 'computed'
    assert data['periods'][1]['operating_cash_flow'] == -5  # not latest copied onto history
    comp = data['composition']
    assert comp['period_end'] == '2026-06-30' and comp['basis'] == 'product'
    assert len(comp['items']) == 1 and comp['items'][0]['revenue'] == 0
    assert comp['items'][0]['share_ratio'] == 0.902464
    assert comp['items'][0]['gross_margin_ratio'] == -0.1
    financial_urls = [u for u in service.network.calls if 'dates=' in u]
    assert len(financial_urls) == 2
    assert all(set(parse_qs(urlsplit(u).query)['dates'][0].split(',')) == {'2026-06-30', '2025-12-31', '2024-12-31'} for u in financial_urls)
    calls = len(service.network.calls)
    assert service.get(SYMBOL)['periods'] == data['periods']
    assert len(service.network.calls) == calls  # ordinary GET honors 24h TTL
    assert all(t['fetched_at'] and t['source_urls'] for t in data['tables'].values())
    with service.db.connect() as c:
        evidence = json.loads(c.execute('SELECT data FROM evidence WHERE id=?', (data['evidence_ids'][0],)).fetchone()[0])
    assert '2024-12-31' in evidence['excerpt'] and '未经独立核验' in evidence['excerpt']


@pytest.mark.parametrize('table', ['ZYZBAjaxNew', 'zcfzbAjaxNew', 'xjllbAjaxNew', 'PageAjax'])
def test_identity_poisoning_keeps_last_good(service, table):
    before = service.get(SYMBOL)
    expire(service)
    service.network.bad = table
    service.network.cash = 999
    data = service.get(SYMBOL)
    assert data['status'] == 'stale'
    assert any('身份不一致，已拒收' in w for w in data['warnings'])
    key = {'ZYZBAjaxNew': 'indicators', 'zcfzbAjaxNew': 'balance', 'xjllbAjaxNew': 'cashflow', 'PageAjax': 'composition'}[table]
    assert data['tables'][key]['status'] == 'stale'
    assert data['tables'][key]['fetched_at'] == '2000-01-01T00:00:00Z'
    if key == 'composition':
        assert data['composition'] == before['composition']
    if key == 'cashflow':
        assert data['periods'][0]['operating_cash_flow'] == 0
    else:
        assert data['periods'][0]['operating_cash_flow'] == 999


def test_partial_failure_and_backoff(service):
    service.get(SYMBOL)
    expire(service)
    service.network.fail = {'xjllbAjaxNew'}
    service.network.assets = 200
    data = service.get(SYMBOL)
    assert data['tables']['cashflow']['status'] == 'stale'
    assert data['tables']['balance']['status'] == 'ok'
    assert data['periods'][0]['operating_cash_flow'] == 0
    assert data['periods'][0]['debt_to_asset_pct'] == 10
    assert data['fetched_at'] == '2000-01-01T00:00:00Z'
    count = len(service.network.calls)
    assert service.get(SYMBOL)['status'] == 'stale'
    assert len(service.network.calls) == count


@pytest.mark.parametrize('assets', [0, -100, 'NaN', 'Infinity', '--'])
def test_no_invalid_asset_division(service, assets):
    service.network.assets = assets
    data = service.get(SYMBOL)
    assert all(p['debt_to_asset_pct'] is None and p['debt_to_asset_basis'] is None for p in data['periods'])


def test_source_ratio_preferred_and_financial_org_not_generic(service):
    service.network.assets = 0
    service.network.debt_source = 0
    data = service.get(SYMBOL)
    assert data['periods'][0]['debt_to_asset_pct'] == 0
    assert data['periods'][0]['debt_to_asset_basis'] == 'source'
    expire(service)
    service.network.org = '银行'
    service.network.calls.clear()
    data = service.get(SYMBOL)
    assert not any('companyType' in url for url in service.network.calls)
    assert data['periods'][0]['total_assets'] is None
    assert data['periods'][0]['revenue'] == 0
    assert any('金融类报表口径未接入' in w for w in data['warnings'])


def test_first_failure_unavailable_and_missing_master_404(service):
    service.network.fail = {'ZYZBAjaxNew', 'PageAjax'}
    assert service.get(SYMBOL)['status'] == 'unavailable'
    with pytest.raises(UserError) as exc:
        service.get('SZ:000001')
    assert exc.value.status == 404


@pytest.mark.parametrize('value', [True, False, 'NaN', 'inf', '--', '', None, {}, []])
def test_non_numbers_are_missing(value):
    assert number(value) is None


def test_partial_dates_preserve_last_good(service):
    service.get(SYMBOL)
    expire(service)
    service.network.omit_date = '2025-12-31'
    data = service.get(SYMBOL)
    previous = next(p for p in data['periods'] if p['period_end'] == '2025-12-31')
    assert previous['operating_cash_flow'] == -5 and previous['total_assets'] == 100
    assert data['tables']['cashflow']['status'] == 'stale'


class FakeRemote:
    def __init__(self, payload=None, error=False):
        self.payload, self.error = payload, error
        self.calls = []

    def capability(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if self.error:
            raise UpstreamError('remote failed')
        return {'data': self.payload}


@pytest.mark.parametrize('corrupt', ['symbol', 'number', 'period', 'currency', 'table', 'composition', 'missing', 'network'])
def test_ycore_bad_contract_never_uses_local_cache(service, corrupt):
    payload = service.get(SYMBOL)
    if corrupt == 'symbol':
        payload['symbol'] = 'SZ:600276'
    elif corrupt == 'number':
        payload['periods'][0]['revenue'] = '12'
    elif corrupt == 'period':
        payload['periods'][0]['period_end'] = '2026-02-30'
    elif corrupt == 'currency':
        payload['periods'][0]['currency'] = 'unknown'
    elif corrupt == 'table':
        payload['tables']['balance']['fetched_at'] = None
    elif corrupt == 'composition':
        payload['composition']['items'][0]['revenue'] = {'unexpected': 12}
    elif corrupt == 'missing':
        payload.pop('tables')
    remote = FakeRemote(payload, error=corrupt == 'network')
    service.remote = remote
    count = len(service.network.calls)
    result = service.get(SYMBOL, 'ycore')
    assert result['status'] == 'unavailable' and not result['periods']
    assert result['composition'] is None and result['evidence_ids'] == []
    assert '未回退本地' in result['warnings'][0]
    assert len(service.network.calls) == count
    assert remote.calls[0][2]['required'] == ('symbol', 'status', 'periods')


def test_valid_remote_is_checked_without_local_fetch(service):
    payload = service.get(SYMBOL)
    assert validate_remote(payload, SYMBOL)['periods'] == payload['periods']
    service.remote = FakeRemote(payload)
    count = len(service.network.calls)
    assert service.get(SYMBOL, 'ycore')['periods'] == payload['periods']
    assert len(service.network.calls) == count


@pytest.mark.parametrize('field,value', [('SECURITY_CODE', '000001'), ('SECUCODE', '600276.SZ'),
                                        ('REPORT_DATE', '2026-02-30'), ('CURRENCY', 'unknown')])
def test_bad_rows_reject_entire_indicator_table(service, field, value):
    service.network.recent[-1][field] = value
    service.network.annual[-1][field] = value
    data = service.get(SYMBOL)
    assert data['tables']['indicators']['status'] == 'unavailable'
    assert data['periods'] == []


def test_failed_annual_keeps_history_while_recent_refreshes(service):
    service.get(SYMBOL)
    expire(service)
    original = service.network.json

    def fake(method, url, **kwargs):
        if 'ZYZBAjaxNew' in url and parse_qs(urlsplit(url).query)['type'] == ['1']:
            raise UpstreamError('annual unavailable')
        return original(method, url, **kwargs)

    service.network.json = fake
    service.network.recent[0]['TOTALOPERATEREVE'] = 77
    data = service.get(SYMBOL)
    assert data['periods'][0]['revenue'] == 77
    assert next(p for p in data['periods'] if p['period_end'] == '2024-12-31')['revenue'] == 40
    assert data['tables']['indicators']['status'] == 'stale'


@pytest.mark.parametrize('field,value', [('CURRENCY', 'USD'), ('REPORT_DATE', '2023-12-31 00:00:00')])
def test_wrong_currency_or_unrequested_date_cannot_join_cashflow(service, field, value):
    before = service.get(SYMBOL)
    expire(service)
    original = service.network.json

    def fake(method, url, **kwargs):
        result = original(method, url, **kwargs)
        if 'xjllbAjaxNew' in url:
            result['data'][0][field] = value
        return result

    service.network.json = fake
    data = service.get(SYMBOL)
    assert data['tables']['cashflow']['status'] == 'stale'
    assert [p['operating_cash_flow'] for p in data['periods']] == [p['operating_cash_flow'] for p in before['periods']]
    assert all(p['period_end'] != '2023-12-31' for p in data['periods'])
