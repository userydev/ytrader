from __future__ import annotations

import email.utils
import json
import math
import re
import time
from collections import OrderedDict
from datetime import date, datetime, timezone
from threading import RLock
from zoneinfo import ZoneInfo
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx
from defusedxml import ElementTree

from .config import UserError, validate_url
from .models import utcnow, iso

MAX_BYTES = 5_000_000
# Exact built-in public endpoints may be resolved by a user's Fake-IP proxy DNS.
# User RSS is never in this exemption, and redirects are revalidated independently.
BUILTIN_PUBLIC_HOSTS = frozenset({'query.sse.com.cn', 'www.sse.com.cn', 'www.szse.cn', 'www.bse.cn',
                                  'push2.eastmoney.com', 'api-one.wallstcn.com', 'qt.gtimg.cn',
                                  'emweb.eastmoney.com'})
NEWS_BUILTIN_URLS = {
    'wallstreetcn': 'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=100',
    'chinanews-finance': 'https://www.chinanews.com.cn/rss/finance.xml',
    'ithome': 'https://www.ithome.com/rss/',
    'bbc-world': 'https://feeds.bbci.co.uk/news/world/rss.xml',
    'bbc-top': 'https://feeds.bbci.co.uk/news/rss.xml',
    'guardian-world': 'https://www.theguardian.com/world/rss',
    'guardian-front': 'https://www.theguardian.com/international/rss',
    'aljazeera': 'https://www.aljazeera.com/xml/rss/all.xml',
    'nyt-home': 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'ft-home': 'https://www.ft.com/rss/home/international',
    'bbc-homepage': 'https://www.bbc.com/news',
}
NEWS_USER_AGENT = 'YTrader-NewsRadar/1.0 (public RSS reader)'


def retry_after_seconds(value):
    """RFC delta-seconds / HTTP-date, bounded to 24h; never retain raw headers."""
    if value is None:
        return None
    value = str(value).strip()
    if not value or len(value) > 1000:
        return None
    if re.fullmatch(r'[0-9]+', value):
        digits = value.lstrip('0') or '0'
        return 86400 if len(digits) > 5 else min(86400, int(digits))
    try:
        when = email.utils.parsedate_to_datetime(value)
        if when.tzinfo is None:
            return None
        seconds = math.ceil((when - datetime.now(timezone.utc)).total_seconds())
        return max(0, min(86400, seconds))
    except (ValueError, TypeError, OverflowError):
        return None


class UpstreamError(RuntimeError):
    def __init__(self, message, *, http_status=None, retry_after=None):
        super().__init__(message)
        self.http_status = http_status
        self.retry_after = retry_after_seconds(retry_after) if http_status in (429, 503) else None


class Network:
    """Bounded requests; service credentials never follow redirects or share clients."""
    def __init__(self, transport=None):
        self.transport = transport

    def request(self, method, url, *, headers=None, params=None, body=None, form=None, public=False, timeout=None, allow_builtin=True,
                with_response=False, builtin_url=None):
        def checked(value):
            # News exemptions are endpoint-exact, including every redirect hop. A
            # custom feed on the same host never inherits the proxy-DNS exception.
            builtin = ((allow_builtin and urlsplit(value).hostname in BUILTIN_PUBLIC_HOSTS)
                       or (builtin_url in NEWS_BUILTIN_URLS.values() and value == builtin_url))
            return validate_url(value, public=public, resolve=public and not builtin and self.transport is None)
        current = checked(url)
        started = time.monotonic()
        budget = 60 if timeout is None else timeout
        try:
            # One isolated client per logical request; cookies survive only its bounded redirect chain.
            with httpx.Client(timeout=httpx.Timeout(25 if timeout is None else timeout, connect=6 if timeout is None else min(3, timeout)), transport=self.transport,
                              follow_redirects=False, trust_env=public) as client:
                for _ in range(4):
                    if time.monotonic() - started > budget:
                        raise UpstreamError('上游请求总耗时超过限制')
                    with client.stream(method, current, headers=headers, params=params, json=body, data=form) as response:
                        if response.status_code in (301, 302, 303, 307, 308):
                            if not public:
                                raise UpstreamError('远程服务重定向已拒绝，请配置最终 URL')
                            current = checked(urljoin(current, response.headers.get('location', '')))
                            if response.status_code == 303 or (response.status_code in (301, 302) and method == 'POST'):
                                method, body, form = 'GET', None, None
                            params = None
                            continue
                        if response.status_code >= 400:
                            raise UpstreamError(f'上游 HTTP {response.status_code}', http_status=response.status_code,
                                                retry_after=response.headers.get('Retry-After'))
                        data = bytearray()
                        for chunk in response.iter_bytes():
                            data.extend(chunk)
                            if len(data) > MAX_BYTES or time.monotonic() - started > budget:
                                raise UpstreamError('上游响应大小或总耗时超过限制')
                        if with_response:
                            return {'status': response.status_code, 'headers': dict(response.headers), 'body': bytes(data)}
                        return bytes(data)
        except httpx.HTTPError:
            raise UpstreamError('上游网络请求失败或超时') from None
        raise UpstreamError('上游重定向次数过多')

    def json(self, method, url, **kwargs):
        try:
            raw = self.request(method, url, **kwargs).decode('utf-8-sig').strip()
            if kwargs.get('public') and urlsplit(url).hostname == 'query.sse.com.cn' and raw.startswith('jsonpCallback('):
                raw = raw[len('jsonpCallback('):].rstrip(';').rstrip(')')
            return json.loads(raw)
        except UserError:
            raise  # URL safety is not a JSON decoding error (UserError is a ValueError).
        except (ValueError, UnicodeError):
            raise UpstreamError('上游返回无效 JSON') from None


class Remote:
    def __init__(self, settings, network):
        self.settings, self.network = settings, network

    def call(self, method, path, *, params=None, body=None):
        config = self.settings.get()
        if not config.ycore_url:
            raise UserError('请先配置 ycore_url', 409)
        headers = {'Accept': 'application/json'}
        key = self.settings.key('ycore')
        if key:
            headers['Authorization'] = 'Bearer ' + key
        result = self.network.json(method, config.ycore_url + '/api/v1' + path,
                                   headers=headers, params=params, body=body)
        if not isinstance(result, dict) or 'data' not in result or not isinstance(result.get('meta'), dict):
            raise UpstreamError('ycore 响应不符合 v1 契约')
        meta = result['meta']
        if (meta.get('version') != '1' or meta.get('completeness') not in ('complete', 'partial', 'unavailable')
                or not isinstance(meta.get('source'), str) or 'as_of' not in meta
                or not isinstance(meta.get('warnings'), list) or any(not isinstance(w, str) for w in meta['warnings'])):
            raise UpstreamError('ycore 元数据不符合 v1 契约')
        try:
            # Fundamentals reports use the source's period_end date, not an
            # invented midnight publication timestamp (same as the local API).
            value = meta['as_of']
            if path.endswith('/fundamentals') and isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                meta['as_of'] = date.fromisoformat(value).isoformat()
            else:
                meta['as_of'] = iso(value)
        except (ValueError, TypeError, AttributeError):
            raise UpstreamError('ycore 返回无效时间') from None
        if method.upper() == 'GET':
            from .core_contracts import validate_core_response, transmission_links, validate_transmission_references
            try:
                validate_core_response(path, result['data'])
                if path == '/news/editorial' or path.startswith('/news/editorial/events/'):
                    links = transmission_links(result['data'])
                    graphs = {iid: self.capability('GET', '/panorama/' + iid,
                              required=('industry', 'nodes', 'relations'))['data']
                              for iid in sorted({link['industry_id'] for link in links})}
                    validate_transmission_references(result['data'], graphs)
            except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
                raise UpstreamError('ycore 核心响应结构、身份或引用无效；未回退本地') from None
        return result

    def capability(self, method, path, *, required=(), **kwargs):
        """New contracts never fall back to local data or another AI service."""
        try:
            result = self.call(method, path, **kwargs)
        except UpstreamError as exc:
            if str(exc) in ('上游 HTTP 404', '上游 HTTP 405', '上游 HTTP 501'):
                raise UserError('ycore 缺少此 v1 接口能力，请升级远端服务；未回退本地', 501) from None
            raise
        if required and (not isinstance(result['data'], dict) or not set(required) <= result['data'].keys()):
            raise UpstreamError('ycore 缺少此 v1 响应能力；未回退本地')
        return result


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.rsplit(':', 1)[-1]
        if tag in ('script', 'style'):
            self.ignored += 1
        if tag in ('p', 'br', 'div', 'li'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        tag = tag.rsplit(':', 1)[-1]
        if tag in ('script', 'style'):
            self.ignored = max(0, self.ignored - 1)
        if tag in ('p', 'div', 'li'):
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)


def text(value):
    parser = TextExtractor()
    parser.feed(str(value or ''))
    parser.close()
    return re.sub(r'[ \t]+', ' ', unescape(''.join(parser.parts))).strip()


def source_time(value):
    if value is None or value == '':
        return None
    try:
        if isinstance(value, (int, float)) or str(value).isdigit():
            stamp = float(value)
            if stamp > 10**12:
                stamp /= 1000
            return datetime.fromtimestamp(stamp, timezone.utc).isoformat().replace('+00:00', 'Z')
        try:
            dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        except ValueError:
            dt = email.utils.parsedate_to_datetime(str(value))
        if dt.tzinfo is None:
            return None
        return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    except (ValueError, TypeError, OverflowError, OSError):
        return None


class PublicData:
    QUOTE_TTL = 15
    QUOTE_FAILURE_TTL = 5
    QUOTE_CACHE_LIMIT = 512

    def __init__(self, network):
        self.network = network
        self._quote_cache = OrderedDict()
        self._quote_lock = RLock()

    def news(self, source):
        """Legacy callers still receive a list; jobs use the richer batch contract."""
        return [dict(article, published_at=source_time(article.get('published_at')))
                for article in self.news_batch(source)['articles']]

    def news_batch(self, source):
        from .news import parse_news_response
        headers = {'User-Agent': NEWS_USER_AGENT,
                   'Accept': ('text/html' if source['id'] == 'bbc-homepage' else 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9')}
        for field, header in (('etag', 'If-None-Match'), ('last_modified', 'If-Modified-Since')):
            value = source.get(field)
            if isinstance(value, str) and len(value) <= 1000 and all(32 <= ord(ch) <= 126 for ch in value):
                headers[header] = value
        builtin = NEWS_BUILTIN_URLS.get(source['id'])
        response = self.network.request('GET', source['url'], public=True, allow_builtin=False,
                                        builtin_url=builtin if builtin == source['url'] else None,
                                        headers=headers, timeout=30, with_response=True)
        try:
            return parse_news_response(source, response)
        except UpstreamError as exc:
            exc.http_status = response['status']
            raise

    def securities(self, exchange):
        filters = {'SH': 'm:1+t:2,m:1+t:23', 'SZ': 'm:0+t:6,m:0+t:80', 'BJ': 'm:0+t:81+s:2048'}
        rows, expected = {}, None
        for page in range(1, 101):
            payload = self.network.json('GET', 'https://push2.eastmoney.com/api/qt/clist/get', public=True,
                params={'pn': page, 'pz': 100, 'po': 1, 'np': 1, 'fltt': 2, 'invt': 2, 'fid': 'f12',
                        'fs': filters[exchange], 'fields': 'f12,f13,f14,f100'})
            data = payload.get('data')
            if not isinstance(data, dict) or not isinstance(data.get('diff'), list):
                raise UpstreamError(f'{exchange} 证券源响应不完整')
            total = data.get('total')
            if not isinstance(total, int) or total <= 0 or (expected is not None and total != expected):
                raise UpstreamError(f'{exchange} 分页总数不一致，请重试')
            expected = total
            before = len(rows)
            for row in data['diff']:
                code, name = str(row.get('f12', '')), str(row.get('f14', ''))
                detected = 'BJ' if code.startswith(('4', '8', '92')) else ('SH' if str(row.get('f13')) == '1' else 'SZ')
                if detected != exchange or not re.fullmatch(r'\d{6}', code) or not name or name == '-':
                    continue
                rows[code] = dict(symbol=f'{exchange}:{code}', code=code, name=name, exchange=exchange,
                                  industry=row.get('f100') if row.get('f100') not in ('-', '') else None,
                                  status='listed', as_of=None, source='东方财富公开证券列表（源未提供发布时间）')
            if page * 100 >= expected:
                break
            if len(rows) == before:
                raise UpstreamError(f'{exchange} 分页重复或缺失')
        minimum = {'SH': 1000, 'SZ': 1500, 'BJ': 150}[exchange]
        complete = expected == len(rows) and len(rows) >= minimum
        return list(rows.values()), complete, expected

    def quote(self, symbol):
        if not re.fullmatch(r'(SH|SZ|BJ):\d{6}', symbol):
            raise UserError('证券代码格式为 SH:600000 / SZ:000001 / BJ:920001', 422)
        # Coalesce concurrent reads as well as caching failures to avoid retry storms.
        # Cache age never replaces the source's trading timestamp.
        with self._quote_lock:
            cached = self._quote_cache.get(symbol)
            if cached and time.monotonic() < cached[0]:
                self._quote_cache.move_to_end(symbol)
                return dict(cached[1])
            data = None
            for fetch in (self._tencent_quote, self._eastmoney_quote):
                try:
                    data = fetch(symbol)
                    break
                except (UpstreamError, UserError, ValueError, TypeError, AttributeError, KeyError, IndexError, OverflowError):
                    continue
            if data is None:
                data = dict(symbol=symbol, price=None, change_percent=None, as_of=None,
                            source='腾讯公开行情 / 东方财富公开行情', status='unavailable')
            ttl = self.QUOTE_TTL if data['status'] == 'ok' else self.QUOTE_FAILURE_TTL
            self._quote_cache[symbol] = (time.monotonic() + ttl, dict(data))
            self._quote_cache.move_to_end(symbol)
            while len(self._quote_cache) > self.QUOTE_CACHE_LIMIT:
                self._quote_cache.popitem(last=False)
            return data

    def _tencent_quote(self, symbol):
        exchange, code = symbol.split(':')
        ticker = exchange.lower() + code
        raw = self.network.request('GET', 'https://qt.gtimg.cn/q=' + ticker, public=True, timeout=5,
                                   headers={'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0'})
        decoded = raw.decode('gb18030')
        match = re.search(r'(?:^|\n)\s*v_' + re.escape(ticker) + r'="([^"\r\n]*)"\s*;', decoded)
        if not match:
            raise UpstreamError('腾讯行情响应结构改变')
        fields = match.group(1).split('~')
        if len(fields) < 33 or fields[2] != code or not re.fullmatch(r'\d{14}', fields[30]):
            raise UpstreamError('腾讯行情缺少代码或源时间')
        price = float(fields[3])
        if not math.isfinite(price) or price <= 0:
            raise UpstreamError('腾讯行情无有效价格')
        stamp = datetime.strptime(fields[30], '%Y%m%d%H%M%S').replace(tzinfo=ZoneInfo('Asia/Shanghai'))
        try:
            change = float(fields[32])
            change = change if math.isfinite(change) else None
        except ValueError:
            change = None
        return dict(symbol=symbol, price=price, change_percent=change,
                    as_of=stamp.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
                    source='腾讯公开行情', status='ok')

    def _eastmoney_quote(self, symbol):
        exchange, code = symbol.split(':')
        result = self.network.json('GET', 'https://push2.eastmoney.com/api/qt/stock/get', public=True, timeout=5,
            params={'secid': ('1' if exchange == 'SH' else '0') + '.' + code, 'fields': 'f43,f60,f170,f86', 'fltt': 2})
        data = result.get('data') or {}
        price, change = data.get('f43'), data.get('f170')
        stamp = source_time(data.get('f86'))
        if type(price) not in (int, float) or not math.isfinite(price) or price <= 0 or not stamp:
            raise UpstreamError('无有效行情或源时间')
        return dict(symbol=symbol, price=price,
                    change_percent=change if type(change) in (int, float) and math.isfinite(change) else None,
                    as_of=stamp, source='东方财富公开行情（腾讯不可用时的备用源）', status='ok')
