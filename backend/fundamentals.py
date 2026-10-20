"""Public, consolidated company fundamentals; independent last-good table caches."""
from __future__ import annotations

import json
import math
import re
from datetime import date, datetime, timezone
from threading import RLock
from urllib.parse import quote, urlencode

from .adapters import UpstreamError, text
from .config import UserError, validate_url
from .db import dump
from .models import utcnow
from .research import identity

BASE = 'https://emweb.eastmoney.com/PC_HSF10/'
SOURCE = '东方财富公开财务数据（来源表述，未经独立核验）'
TABLES = ('indicators', 'balance', 'cashflow', 'composition')
CURRENCIES = {'CNY', 'HKD', 'USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF', 'SGD'}
INDICATORS = {
    'revenue': 'TOTALOPERATEREVE', 'net_profit_parent': 'PARENTNETPROFIT',
    'revenue_yoy_pct': 'TOTALOPERATEREVETZ', 'net_profit_parent_yoy_pct': 'PARENTNETPROFITTZ',
    'gross_margin_pct': 'XSMLL', 'debt_to_asset_pct': 'ZCFZL',
    'net_profit_excluding_nonrecurring': 'KCFJCXSYJLR',
    'net_profit_excluding_nonrecurring_yoy_pct': 'KCFJCXSYJLRTZ',
    'roe_weighted_pct': 'ROEJQ', 'basic_eps': 'EPSJB',
}
BALANCE_FIELDS = {'total_liabilities': 'TOTAL_LIABILITIES', 'total_assets': 'TOTAL_ASSETS',
                  'monetary_funds': 'MONETARYFUNDS', 'accounts_receivable': 'ACCOUNTS_RECE', 'inventories': 'INVENTORY'}
OPTIONAL_NUMERIC = {'net_profit_excluding_nonrecurring', 'net_profit_excluding_nonrecurring_yoy_pct',
                    'roe_weighted_pct', 'basic_eps', 'monetary_funds', 'accounts_receivable', 'inventories'}
NUMERIC = (*INDICATORS, 'operating_cash_flow', *BALANCE_FIELDS)
CACHE_SCHEMA_VERSION = 2


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError, OverflowError):
        return None


def report_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:[ T].*)?', value):
        raise ValueError('报告期无效')
    result = date.fromisoformat(value[:10]).isoformat()
    if result[5:] not in ('03-31', '06-30', '09-30', '12-31'):
        raise ValueError('报告期无效')
    return result


def period_type(value):
    return {'03-31': 'Q1', '06-30': 'H1', '09-30': 'Q3', '12-31': 'FY'}[value[5:]]


def age(stamp):
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(stamp.replace('Z', '+00:00'))).total_seconds()
    except (ValueError, TypeError, AttributeError):
        return float('inf')


class Fundamentals:
    TTL = 24 * 60 * 60
    FAILURE_TTL = 60

    def __init__(self, db, research, network, remote=None):
        self.db, self.research, self.network, self.remote = db, research, network, remote
        self.lock = RLock()

    @staticmethod
    def source_url(symbol):
        return BASE + 'NewFinanceAnalysis/ZYZBAjaxNew?' + urlencode({'type': 0, 'code': symbol.replace(':', '')})

    def empty(self, symbol, warning=None):
        return dict(symbol=symbol, status='unavailable', source=SOURCE, source_url=self.source_url(symbol),
                    fetched_at=None, periods=[], composition=None, evidence_ids=[],
                    tables={key: dict(status='unavailable', fetched_at=None, source_urls=[]) for key in TABLES},
                    warnings=[warning] if warning else [])

    def rows(self, symbol, path, params, key='data', currencies=None):
        url = BASE + path + '?' + urlencode(dict(params, code=symbol.replace(':', '')))
        raw = self.network.json('GET', url, public=True, timeout=8)
        rows = raw.get(key) if isinstance(raw, dict) else None
        if not isinstance(rows, list) or not rows or len(rows) > 2000:
            raise ValueError('来源未提供可用报告')
        exchange, code = symbol.split(':')
        result = []
        latest_composition = None
        for row in rows:
            if (not isinstance(row, dict) or str(row.get('SECURITY_CODE', '')).strip() != code
                    or str(row.get('SECUCODE', '')).strip().upper() != code + '.' + exchange):
                raise ValueError('身份不一致，已拒收')
            when = report_date(row.get('REPORT_DATE'))
            if key == 'zygcfx' and str(row.get('MAINOP_TYPE')) in ('2', '3'):
                latest_composition = max(latest_composition or when, when)
            currency = row.get('CURRENCY')
            # BusinessAnalysis omits currency in the verified response. Only borrow
            # from the identity-checked indicator for this exact report date.
            if currency is None and key == 'zygcfx' and currencies:
                currency = currencies.get(when)
            if currency not in CURRENCIES:
                if key == 'zygcfx' and row.get('CURRENCY') is None and when not in (currencies or {}):
                    # Historical composition outside the fetched indicator periods
                    # cannot be assigned a currency, so it is not adopted.
                    continue
                raise ValueError('币种缺失或无效，已拒收')
            if currencies and when in currencies and currencies[when] != currency:
                raise ValueError('同报告期币种不一致，已拒收')
            result.append((row, when, currency))
        if not result:
            raise ValueError('来源未提供可核对币种的报告')
        if latest_composition and not any(when == latest_composition and str(row.get('MAINOP_TYPE')) in ('2', '3') for row, when, _ in result):
            raise ValueError('最新构成报告期币种未核实，已拒收')
        return result, url

    def indicators(self, symbol, annual):
        rows, url = self.rows(symbol, 'NewFinanceAnalysis/ZYZBAjaxNew', {'type': 1 if annual else 0})
        mapped = {}
        for row, when, currency in rows:
            if annual and period_type(when) != 'FY':
                raise ValueError('年报接口报告期不一致，已拒收')
            item = dict(period_end=when, currency=currency,
                        org_type=text(row.get('ORG_TYPE'))[:100],
                        **{key: number(row.get(field)) for key, field in INDICATORS.items()})
            if when in mapped and mapped[when] != item:
                raise ValueError('同报告期数据冲突，已拒收')
            mapped[when] = item
        return dict(rows=list(mapped.values()), fetched_at=utcnow(), source_urls=[url], status='ok', warnings=[])

    def financial(self, symbol, table, indicators):
        currencies = {row['period_end']: row['currency'] for row in indicators}
        dates = sorted(currencies, reverse=True)
        if not dates:
            raise ValueError('尚无可核对报告期')
        endpoint = 'zcfzbAjaxNew' if table == 'balance' else 'xjllbAjaxNew'
        rows, url = self.rows(symbol, 'NewFinanceAnalysis/' + endpoint,
                              dict(companyType=4, reportDateType=0, reportType=1, dates=','.join(dates)),
                              currencies=currencies)
        fields = BALANCE_FIELDS if table == 'balance' else {'operating_cash_flow': 'NETCASH_OPERATE'}
        mapped = {}
        for row, when, currency in rows:
            if when not in currencies:
                raise ValueError('分表返回未请求报告期，已拒收')
            item = dict(period_end=when, currency=currency, **{key: number(row.get(field)) for key, field in fields.items()})
            if when in mapped and mapped[when] != item:
                raise ValueError('同报告期数据冲突，已拒收')
            mapped[when] = item
        missing = set(dates) - set(mapped)
        warnings = ['部分报告期未提供：' + '、'.join(sorted(missing))] if missing else []
        return dict(rows=list(mapped.values()), fetched_at=utcnow(), source_urls=[url], status='ok', warnings=warnings)

    def composition(self, symbol, indicators):
        currencies = {row['period_end']: row['currency'] for row in indicators}
        rows, url = self.rows(symbol, 'BusinessAnalysis/PageAjax', {}, 'zygcfx', currencies)
        groups = {}
        group_currencies = {}
        borrowed = False
        for row, when, currency in rows:
            kind = str(row.get('MAINOP_TYPE'))
            if kind not in ('2', '3'):
                continue
            name = text(row.get('ITEM_NAME'))[:500]
            if not name:
                continue
            borrowed |= row.get('CURRENCY') is None
            item = dict(name=name, revenue=number(row.get('MAIN_BUSINESS_INCOME')),
                        share_ratio=number(row.get('MBI_RATIO')), gross_margin_ratio=number(row.get('GROSS_RPOFIT_RATIO')))
            # Negative profit/margin is meaningful. Only a revenue share is bounded.
            if item['share_ratio'] is not None and not 0 <= item['share_ratio'] <= 1:
                item['share_ratio'] = None
            if when in group_currencies and group_currencies[when] != currency:
                raise ValueError('同报告期币种不一致，已拒收')
            group_currencies[when] = currency
            group = groups.setdefault((when, kind), {})
            if name in group and group[name] != item:
                raise ValueError('收入分类存在冲突，已拒收')
            group[name] = item
        if not groups:
            raise ValueError('来源未提供产品或地区收入构成')
        latest = max(when for when, _ in groups)
        kind = '2' if (latest, '2') in groups else '3'
        value = dict(period_end=latest, currency=group_currencies[latest], basis='product' if kind == '2' else 'region',
                     items=list(groups[latest, kind].values()))
        return dict(value=value, fetched_at=utcnow(), source_urls=[url], status='ok',
                    warnings=['构成表未单列币种，沿用同报告期指标币种'] if borrowed else [])

    @staticmethod
    def indicator_rows(parts):
        mapped = {}
        # Annual history first; recent report wins only for the same identity/date.
        for key in ('annual', 'recent'):
            for row in parts.get(key, {}).get('rows', []):
                existing = mapped.get(row['period_end'])
                if existing and existing['currency'] != row['currency']:
                    raise ValueError('同报告期币种不一致，已拒收')
                mapped[row['period_end']] = dict(existing or {}, **{key: value for key, value in row.items() if value is not None or key not in (existing or {})})
        return sorted(mapped.values(), key=lambda row: row['period_end'], reverse=True)

    def get(self, symbol, mode='local', *, refresh=True):
        if mode != 'local':
            return self.remote_get(symbol)
        with self.db.connect() as c:
            security = c.execute('SELECT symbol FROM securities WHERE symbol=?', (symbol,)).fetchone()
        if not security:
            raise UserError('证券不存在，请先同步证券主表', 404)
        with self.lock:
            with self.db.connect() as c:
                saved = c.execute('SELECT data FROM company_fundamentals WHERE symbol=?', (symbol,)).fetchone()
            cache = json.loads(saved[0]) if saved else {}
            parts = cache.setdefault('indicator_parts', {})
            tables = cache.setdefault('tables', {})
            retry = self.db.get('fundamentals-retry:' + symbol)
            allowed = refresh and (not retry or age(retry) >= self.FAILURE_TTL)
            failed = False

            def update(key, old, fetch):
                nonlocal failed
                fresh = old.get('status') == 'ok' and 0 <= age(old.get('fetched_at')) < self.TTL
                # Refresh old schemas once, not once per absent/null source field.
                if key in ('recent', 'annual', 'balance') and old.get('schema_version') != CACHE_SCHEMA_VERSION:
                    fresh = False
                if fresh and key in ('balance', 'cashflow'):
                    fresh = {r['period_end'] for r in indicators} <= {r['period_end'] for r in old.get('rows', [])}
                if fresh or not allowed:
                    return old
                try:
                    new = dict(fetch(), schema_version=CACHE_SCHEMA_VERSION)
                    # A partial response is not permission to erase last-good dates.
                    if key in ('balance', 'cashflow'):
                        new_dates = {r['period_end'] for r in new['rows']}
                        requested = {r['period_end'] for r in indicators}
                        retained = [r for r in old.get('rows', []) if r['period_end'] in requested and r['period_end'] not in new_dates]
                        if retained:
                            new['rows'].extend(retained)
                            new['fetched_at'] = min(new['fetched_at'], old['fetched_at'])
                            new['status'] = 'stale'
                    if new.get('warnings') and key in ('balance', 'cashflow'):
                        new['status'] = 'stale'
                    if new['status'] != 'ok':
                        failed = True
                    return new
                except (UpstreamError, UserError, ValueError, TypeError, KeyError, AttributeError) as exc:
                    failed = True
                    reason = str(exc) if type(exc) is ValueError and str(exc) in (
                        '身份不一致，已拒收', '报告期无效', '币种缺失或无效，已拒收',
                        '同报告期币种不一致，已拒收', '年报接口报告期不一致，已拒收',
                        '分表返回未请求报告期，已拒收', '同报告期数据冲突，已拒收',
                        '来源未提供可用报告', '来源未提供可核对币种的报告',
                        '来源未提供产品或地区收入构成', '尚无可核对报告期', '最新构成报告期币种未核实，已拒收') else '获取失败或数据未通过核对'
                    return dict(old, schema_version=CACHE_SCHEMA_VERSION,
                                status='stale' if old.get('fetched_at') else 'unavailable',
                                warnings=[reason + '；保留最近可用数据'])

            for key, annual in (('recent', False), ('annual', True)):
                def fetch_indicator(annual=annual, key=key):
                    value = self.indicators(symbol, annual)
                    self.indicator_rows(dict(parts, **{key: value}))
                    return value
                parts[key] = update(key, parts.get(key, {}), fetch_indicator)
            indicators = self.indicator_rows(parts)
            org_types = {r.get('org_type') for r in indicators}
            generic = bool(org_types) and org_types <= {'通用'}
            for key in ('balance', 'cashflow'):
                if generic:
                    tables[key] = update(key, tables.get(key, {}), lambda key=key: self.financial(symbol, key, indicators))
                else:
                    # Never apply generic companyType=4 to banks/insurers/brokers,
                    # or to an unknown reporting organization type.
                    tables[key] = dict(status='unavailable', fetched_at=None, source_urls=[], rows=[],
                                       warnings=['金融类报表口径未接入' if org_types and any(t and t != '通用' for t in org_types) else '报表类别未核实，未采用通用类分表'])
                    failed = True
            tables['composition'] = update('composition', tables.get('composition', {}), lambda: self.composition(symbol, indicators))
            if allowed:
                if failed:
                    self.db.put('fundamentals-retry:' + symbol, utcnow())
                with self.db.transaction() as c:
                    c.execute('INSERT INTO company_fundamentals VALUES (?,?) ON CONFLICT(symbol) DO UPDATE SET data=excluded.data',
                              (symbol, dump(cache)))
            data = self.assemble(symbol, cache)
            if data['periods'] or data['composition']:
                eid = 'company-fundamentals:' + identity(symbol, dump([data['periods'], data['composition']]))
                dates = [p['period_end'] for p in data['periods']]
                excerpt = f'来源：{SOURCE}；证券：{symbol}；报告期：' + (' 至 '.join((min(dates), max(dates))) if dates else data['composition']['period_end'])
                excerpt += '\n' + '\n'.join(key + '：' + value['status'] + '；获取：' + str(value['fetched_at']) + '；' + '；'.join(value['source_urls']) for key, value in data['tables'].items())
                excerpt += '\n公开数据源表述，未经独立核验，不代表授权再分发。公司合并口径；收入、利润和现金流为年初至报告期末累计；资产、负债和资产负债率为期末值。同比为来源值，未自行估算。'
                evidence = dict(id=eid, title=symbol + '公司基本面来源摘要', url=data['source_url'],
                                excerpt=excerpt, published_at=None, source=SOURCE)
                with self.db.transaction() as c:
                    self.research._upsert_json(c, 'evidence', evidence)
                data['evidence_ids'] = [eid]
            return data

    def assemble(self, symbol, cache):
        data = self.empty(symbol)
        parts, stored = cache.get('indicator_parts', {}), cache.get('tables', {})
        sources = list(parts.values())
        times = [s['fetched_at'] for s in sources if s.get('fetched_at')]
        indicators = dict(rows=self.indicator_rows(parts), fetched_at=min(times) if times else None,
                          source_urls=[url for s in sources for url in s.get('source_urls', [])],
                          warnings=[w for s in sources for w in s.get('warnings', [])],
                          status='ok' if len(sources) == 2 and all(s.get('status') == 'ok' and 0 <= age(s.get('fetched_at')) < self.TTL for s in sources) else 'stale' if times else 'unavailable')
        tables = dict(stored, indicators=indicators)
        warnings = []
        for key in TABLES:
            table = tables.get(key, {})
            stamp = table.get('fetched_at')
            status = table.get('status', 'unavailable')
            if stamp and not 0 <= age(stamp) < self.TTL:
                status = 'stale'
            data['tables'][key] = dict(status=status, fetched_at=stamp, source_urls=table.get('source_urls', []))
            warnings.extend(key + '：' + w for w in table.get('warnings', []))
        mapped = {}
        for key in ('indicators', 'balance', 'cashflow'):
            for row in tables.get(key, {}).get('rows', []):
                when = row['period_end']
                item = mapped.setdefault(when, dict(period_end=when, period_type=period_type(when), currency=row['currency'],
                                                   **{field: None for field in NUMERIC}, debt_to_asset_basis=None))
                if item['currency'] != row['currency']:
                    warnings.append('不同币种的分表未合并：' + when)
                    continue
                for field in NUMERIC:
                    if field in row:
                        item[field] = row[field]
        for item in mapped.values():
            if item['debt_to_asset_pct'] is not None:
                item['debt_to_asset_basis'] = 'source'
            elif item['total_assets'] is not None and item['total_assets'] > 0 and item['total_liabilities'] is not None:
                ratio = number(item['total_liabilities'] / item['total_assets'] * 100)
                item['debt_to_asset_pct'] = ratio
                item['debt_to_asset_basis'] = 'computed' if ratio is not None else None
        data['periods'] = sorted(mapped.values(), key=lambda row: row['period_end'], reverse=True)
        data['composition'] = stored.get('composition', {}).get('value')
        stamps = [t['fetched_at'] for t in data['tables'].values() if t['fetched_at']]
        data['fetched_at'] = min(stamps) if stamps else None
        has_data = any(any(p[field] is not None for field in NUMERIC) for p in data['periods']) or bool(data['composition'])
        data['status'] = ('ok' if all(t['status'] == 'ok' for t in data['tables'].values()) else 'stale') if has_data else 'unavailable'
        # Source fields may be null even in successfully fetched tables.
        if any(any(p[field] is None for field in NUMERIC) for p in data['periods']):
            warnings.append('部分报告期指标未提供；空缺不代表零，同比沿用来源口径')
        data['warnings'] = list(dict.fromkeys(warnings))
        return data

    def remote_get(self, symbol):
        try:
            response = self.remote.capability('GET', '/securities/' + quote(symbol, safe='') + '/fundamentals',
                                              required=('symbol', 'status', 'periods'))
            return validate_remote(response['data'], symbol)
        except (UpstreamError, UserError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
            return self.empty(symbol, '远端公司基本面不可用或未通过核对；未回退本地')


def validate_remote(raw, symbol):
    """Do not let a remote company, string-valued number or malformed table reach UI."""
    if not isinstance(raw, dict) or raw.get('symbol') != symbol or raw.get('status') not in ('ok', 'stale', 'unavailable'):
        raise ValueError('远端主体或状态无效')

    def string(value, limit=2000):
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError('远端文本无效')
        return value

    def stamp(value):
        if value is None:
            return None
        string(value, 100)
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('远端获取时间无效')
        return value

    def numeric(value):
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or number(value) is None:
            raise ValueError('远端数值无效')
        return number(value)

    def strings(value, limit=100):
        if not isinstance(value, list) or len(value) > limit:
            raise ValueError('远端列表无效')
        return [string(v) for v in value]

    source_url = validate_url(string(raw['source_url']), public=True)
    result = dict(symbol=symbol, status=raw['status'], source=string(raw['source']), source_url=source_url,
                  fetched_at=stamp(raw['fetched_at']), warnings=strings(raw['warnings']),
                  evidence_ids=strings(raw['evidence_ids']), periods=[], composition=None, tables={})
    if not isinstance(raw['periods'], list) or len(raw['periods']) > 200:
        raise ValueError('远端报告期列表无效')
    seen = set()
    for row in raw['periods']:
        when = report_date(row['period_end'])
        if when != row['period_end'] or when in seen or row['period_type'] != period_type(when) or row['currency'] not in CURRENCIES:
            raise ValueError('远端报告期或币种无效')
        seen.add(when)
        basis = row['debt_to_asset_basis']
        if basis not in (None, 'source', 'computed'):
            raise ValueError('远端计算口径无效')
        item = dict(period_end=when, period_type=period_type(when), currency=row['currency'],
                    debt_to_asset_basis=basis, **{key: numeric(row.get(key) if key in OPTIONAL_NUMERIC else row[key]) for key in NUMERIC})
        if (item['debt_to_asset_pct'] is None) != (basis is None):
            raise ValueError('远端负债率口径不完整')
        if basis == 'computed' and (item['total_assets'] is None or item['total_assets'] <= 0 or item['total_liabilities'] is None):
            raise ValueError('远端资产无效')
        result['periods'].append(item)
    result['periods'].sort(key=lambda row: row['period_end'], reverse=True)
    for key in TABLES:
        table = raw['tables'][key]
        if table['status'] not in ('ok', 'stale', 'unavailable'):
            raise ValueError('远端分表状态无效')
        fetched = stamp(table['fetched_at'])
        if table['status'] != 'unavailable' and fetched is None:
            raise ValueError('远端分表缺少获取时间')
        urls = [validate_url(url, public=True) for url in strings(table.get('source_urls', [source_url]))]
        result['tables'][key] = dict(status=table['status'], fetched_at=fetched, source_urls=urls)
    comp = raw['composition']
    if comp is not None:
        when = report_date(comp['period_end'])
        if when != comp['period_end'] or comp['basis'] not in ('product', 'region') or not isinstance(comp['items'], list) or not 0 < len(comp['items']) <= 1000:
            raise ValueError('远端构成无效')
        currency = comp.get('currency') or next((p['currency'] for p in result['periods'] if p['period_end'] == when), None)
        matching_currency = next((p['currency'] for p in result['periods'] if p['period_end'] == when), None)
        if currency not in CURRENCIES or (matching_currency is not None and matching_currency != currency):
            raise ValueError('远端构成币种无效')
        items = []
        for row in comp['items']:
            item = dict(name=string(row['name'], 500), **{key: numeric(row[key]) for key in ('revenue', 'share_ratio', 'gross_margin_ratio')})
            if item['share_ratio'] is not None and not 0 <= item['share_ratio'] <= 1:
                raise ValueError('远端收入占比无效')
            items.append(item)
        result['composition'] = dict(period_end=when, basis=comp['basis'], currency=currency, items=items)
    if result['status'] == 'ok' and (not result['periods'] or any(t['status'] != 'ok' for t in result['tables'].values())):
        raise ValueError('远端完整状态不一致')
    return result
