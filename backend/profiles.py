"""Bounded public Eastmoney profiles, with a persistent per-security last-good cache."""
from __future__ import annotations

import json
from contextlib import nullcontext
from datetime import date, datetime, timezone
from threading import RLock

from .adapters import UpstreamError, text
from .config import UserError, validate_url
from .db import dump
from .models import utcnow
from .research import identity

PROFILE_ENDPOINT = 'https://emweb.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax'
PROFILE_SOURCE = '东方财富公开公司资料（来源表述，未经独立核验）'
PROFILE_FIELDS = {
    'full_name': 'ORG_NAME', 'introduction': 'ORG_PROFILE', 'business_scope': 'BUSINESS_SCOPE',
    'website': 'ORG_WEB', 'province': 'PROVINCE', 'industry': 'INDUSTRYCSRC1',
}


def profile_date(value):
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        return None


class Profiles:
    TTL = 24 * 60 * 60
    FAILURE_TTL = 60

    def __init__(self, db, research, topics, network):
        self.db, self.research, self.topics, self.network = db, research, topics, network
        self.lock = RLock()

    @staticmethod
    def source_url(symbol):
        return PROFILE_ENDPOINT + '?code=' + symbol.replace(':', '')

    def fetch(self, symbol):
        exchange, code = symbol.split(':')
        raw = self.network.json('GET', self.source_url(symbol), public=True, timeout=8)
        try:
            base = raw['jbzl'][0]
            # Both identifiers are in the verified source. Do not accept a same-name entity
            # or a cross-exchange response, even if its descriptive fields look plausible.
            if str(base['SECURITY_CODE']).strip() != code or str(base['SECUCODE']).strip().upper() != code + '.' + exchange:
                raise ValueError()
            offering = raw.get('fxxg') or []
            offering = offering[0] if offering else {}
            if not isinstance(offering, dict):
                raise ValueError()
            fields = {}
            for key, upstream in PROFILE_FIELDS.items():
                value = base.get(upstream)
                limit = 20000 if key in ('introduction', 'business_scope') else (2048 if key == 'website' else 500)
                value = text(value)[:limit] if isinstance(value, str) else ''
                fields[key] = value if value and value not in ('-', '--') else None
            if not fields['full_name'] or not (fields['introduction'] or fields['business_scope']):
                raise ValueError()
            website = fields['website']
            if website:
                try:
                    fields['website'] = validate_url(website if '://' in website else 'https://' + website)
                except UserError:
                    fields['website'] = None
            fields.update(established_date=profile_date(offering.get('FOUND_DATE')), listing_date=profile_date(offering.get('LISTING_DATE')))
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            raise UpstreamError('公司资料身份不一致或公开源结构变化') from None
        url = self.source_url(symbol)
        # Stable content-addressed evidence: polling time is not a publication date or fact revision.
        eid = 'company-profile:' + identity(symbol, dump(fields))
        excerpt = f"来源：东方财富公开公司资料；证券 {symbol}；全称：{fields['full_name']}。以下为来源表述，不为公司宣传背书。"
        if fields['introduction']:
            excerpt += '\n公司简介（来源表述）：' + fields['introduction'][:6500]
        if fields['business_scope']:
            excerpt += '\n工商经营范围（非收入构成）：' + fields['business_scope'][:3500]
        excerpt += '\n' + '；'.join(f'{k}：{fields[k]}' for k in ('website', 'province', 'industry', 'listing_date', 'established_date') if fields[k])
        evidence = dict(id=eid, title=symbol + '公司资料来源摘要', url=url, excerpt=excerpt,
                        published_at=None, source=PROFILE_SOURCE)
        data = dict(symbol=symbol, **fields, source=PROFILE_SOURCE, source_url=url, as_of=None,
                    fetched_at=utcnow(), status='ok', evidence_ids=[eid])
        with self.db.transaction() as c:
            self.research._upsert_json(c, 'evidence', evidence)
            c.execute('INSERT INTO company_profiles VALUES (?,?) ON CONFLICT(symbol) DO UPDATE SET data=excluded.data', (symbol, dump(data)))
        return data

    def get(self, symbol, *, refresh=True):
        # Validate the master independently of the optional upstream profile.
        with self.db.connect() as c:
            security = c.execute('SELECT name FROM securities WHERE symbol=?', (symbol,)).fetchone()
        if not security:
            raise UserError('证券不存在，请先同步证券主表', 404)
        with (self.lock if refresh else nullcontext()):
            with self.db.connect() as c:
                row = c.execute('SELECT data FROM company_profiles WHERE symbol=?', (symbol,)).fetchone()
            cached = json.loads(row[0]) if row else None
            now = datetime.now(timezone.utc)
            fresh = False
            if cached and cached.get('fetched_at'):
                age = (now - datetime.fromisoformat(cached['fetched_at'].replace('Z', '+00:00'))).total_seconds()
                fresh = 0 <= age < self.TTL
            retry_at = self.db.get('profile-retry:' + symbol)
            retry = not retry_at or (now - datetime.fromisoformat(retry_at.replace('Z', '+00:00'))).total_seconds() >= self.FAILURE_TTL
            if not fresh and retry and refresh:
                try:
                    cached = self.fetch(symbol)
                    fresh = True
                except (UpstreamError, UserError, ValueError, TypeError, KeyError, AttributeError):
                    # Cache only a locally generated failure timestamp, never an upstream body.
                    self.db.put('profile-retry:' + symbol, utcnow())
            if cached:
                data = dict(cached, status='ok' if fresh else 'stale')
            else:
                data = dict(symbol=symbol, **{key: None for key in PROFILE_FIELDS}, listing_date=None,
                            established_date=None, source=PROFILE_SOURCE, source_url=self.source_url(symbol),
                            as_of=None, fetched_at=None, status='unavailable', evidence_ids=[])
        data['name'] = security['name']
        data['businesses'] = self.topics.businesses(symbol)
        data['topics'] = [dict(id=t['id'], name=t['name']) for t in self.topics.list(symbol=symbol)['items']]
        return data
