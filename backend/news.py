"""News-only contracts: bounded parsing, append-only versions and source health.

No model calls, article-page crawling, credentials or remote/local fallbacks here.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from urllib.parse import urljoin
from xml.etree.ElementTree import tostring

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

from .adapters import UpstreamError, source_time, text
from .config import UserError, validate_url
from .db import dump
from .models import utcnow


COUNTERS = ('received', 'added', 'duplicates', 'rejected', 'revisions')
MAX_NEWS_ITEMS = 1000
XML_TYPES = {'application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml', 'application/rdf+xml'}


def digest(*values):
    return hashlib.sha256(dump(values).encode('utf-8')).hexdigest()[:32]


def content_hash(title, content, level):
    # Preserve punctuation, numeric facts and word boundaries; dates are metadata,
    # not identity. A changed publication timestamp alone never creates a version.
    clean = lambda s: re.sub(r'\s+', ' ', unicodedata.normalize('NFC', s)).strip()
    # Content-level and publication metadata alone do not manufacture versions.
    return digest(clean(title), clean(content))


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def publication(value, level, at=None):
    at = at or utcnow()
    parsed = source_time(value)
    flags = []
    if not parsed:
        flags.append('invalid_published_at' if value else 'missing_published_at')
    elif timestamp(parsed) > timestamp(at):
        flags.append('future_published_at')
        parsed = None
    if level != 'full':
        flags.append('summary_only' if level == 'summary' else 'title_only')
    return parsed, flags


def safe_validator(value):
    if isinstance(value, str) and len(value) <= 1000 and all(32 <= ord(ch) <= 126 for ch in value):
        return value
    return None


def parse_news_response(source, response):
    """Network/URL errors are raised by the caller, never relabelled as XML errors."""
    if source['id'] == 'bbc-homepage':
        from .editorial import parse_homepage
        return parse_homepage(source, response)
    headers = {k.lower(): v for k, v in response['headers'].items()}
    result = dict(articles=[], received=0, rejected=0, not_modified=False,
                  etag=safe_validator(headers.get('etag')),
                  last_modified=safe_validator(headers.get('last-modified')),
                  http_status=response['status'], quality_flags=[])
    if response['status'] == 304:
        if not source.get('last_success') or not (source.get('etag') or source.get('last_modified')):
            raise UpstreamError('来源返回 304 但没有已验证缓存')
        result['not_modified'] = True
        return result
    if response['status'] != 200:
        raise UpstreamError('新闻来源未返回可用文档')
    raw = response['body']
    media = headers.get('content-type', '').split(';', 1)[0].strip().lower()
    # The connector is selected by ID, not by an untrusted response MIME type.
    if source['id'] == 'wallstreetcn':
        if media and media not in ('application/json', 'text/json'):
            raise UpstreamError('新闻 JSON 来源返回非 JSON 内容类型')
        try:
            payload = json.loads(raw.decode('utf-8-sig'))
        except (ValueError, UnicodeError):
            raise UpstreamError('新闻来源返回无效 JSON') from None
        data = payload.get('data') if isinstance(payload, dict) else None
        items = data.get('items') if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise UpstreamError('华尔街见闻响应结构改变')
        if payload.get('code', 20000) not in (0, 200, 20000):
            raise UpstreamError('华尔街见闻返回业务失败')
        if len(items) > MAX_NEWS_ITEMS:
            raise UpstreamError('来源新闻条目超过单次处理上限')
        result['received'] = len(items)
        for item in items:
            if not isinstance(item, dict):
                result['rejected'] += 1
                continue
            body = item.get('content_text') or item.get('content')
            if not isinstance(item.get('title', ''), (str, type(None))) or not isinstance(body, (str, type(None))):
                result['rejected'] += 1
                continue
            content = text(body)
            title = text(item.get('title')) or content[:100]
            external = str(item['id']) if item.get('id') is not None else None
            url = item.get('uri') or ('https://wallstreetcn.com/livenews/' + external if external else '')
            if not title or not isinstance(url, str) or not url:
                result['rejected'] += 1
                continue
            result['articles'].append(dict(title=title, content=content, url=url,
                source=source['name'], source_id=source['id'], external_id=external,
                published_at=item.get('display_time'), content_level='summary' if content else 'title'))
    else:
        if media and media not in XML_TYPES:
            raise UpstreamError('RSS/Atom 内容类型不是 XML（可能为 HTML 页面）')
        # Only actual XML parsing is caught here. In particular UserError from
        # validate_url (a ValueError subclass) must retain its safety classification.
        try:
            root = ElementTree.fromstring(raw)
        except (ElementTree.ParseError, DefusedXmlException):
            raise UpstreamError('RSS/Atom XML 无法解析或含不安全实体') from None
        local = lambda node: node.tag.rsplit('}', 1)[-1] if isinstance(node.tag, str) else ''
        feed_language = root.attrib.get('{http://www.w3.org/XML/1998/namespace}lang')
        root_name = local(root)
        if root_name == 'rss':
            channel = next((child for child in root if local(child) == 'channel'), None)
            if channel is None:
                raise UpstreamError('RSS 缺少 channel 节点')
            items = [child for child in channel if local(child) == 'item']
            feed_language = next((child.text for child in channel if local(child) == 'language'), feed_language)
        elif root.tag == '{http://www.w3.org/2005/Atom}feed':
            items = [child for child in root if local(child) == 'entry']
        elif root.tag == '{http://www.w3.org/1999/02/22-rdf-syntax-ns#}RDF':
            items = [child for child in root if local(child) == 'item']
        else:
            raise UpstreamError('文档根节点不是 RSS/Atom')
        if len(items) > MAX_NEWS_ITEMS:
            raise UpstreamError('来源新闻条目超过单次处理上限')
        result['received'] = len(items)
        for item in items:
            values, link, origin_url, categories = {}, '', None, []
            atom = '{http://www.w3.org/2005/Atom}'
            rss_content = '{http://purl.org/rss/1.0/modules/content/}encoded'
            dc_creator = '{http://purl.org/dc/elements/1.1/}creator'
            rss_namespace = '{http://purl.org/rss/1.0/}'
            for child in item:
                # Local names are not a content contract: media:content is an
                # image/video asset, and media:description is its caption. Neither
                # may replace RSS description or claim a feed-provided full body.
                if child.tag == rss_content:
                    name = 'encoded'
                elif child.tag == dc_creator:
                    name = 'creator'
                elif isinstance(child.tag, str) and (child.tag.startswith(atom) or child.tag.startswith(rss_namespace) or '}' not in child.tag):
                    name = local(child)
                else:
                    continue
                if name == 'content' and child.tag != atom + 'content':
                    continue
                if name == 'category':
                    category = text(child.attrib.get('term') or child.text)
                    if category and category not in categories:
                        categories.append(category)
                if name == 'link' and child.attrib.get('rel', 'alternate') == 'alternate':
                    link = child.attrib.get('href') or child.text or link
                if name == 'source':
                    origin_url = child.attrib.get('url')
                # Atom content src is external, not fetched. XHTML keeps paragraphs.
                if child.tag == atom + 'content' and child.attrib.get('src'):
                    continue
                values[name] = (tostring(child, encoding='unicode') if list(child)
                                else child.text or '')
            title = text(values.get('title'))
            guid = (values.get('id') or values.get('guid') or '').strip() or None
            if not link and guid and guid.startswith(('http://', 'https://')):
                link = guid
            if not title or not link.strip():
                result['rejected'] += 1
                continue
            body = text(values.get('encoded')) or text(values.get('content'))
            summary = text(values.get('description')) or text(values.get('summary'))
            content = body or summary
            # Only namespaced RSS content:encoded / Atom content qualify as a
            # feed body. Description remains a summary even when HTML-rich.
            level = 'full' if body else ('summary' if content else 'title')
            result['articles'].append(dict(title=title, content=content,
                url=urljoin(source['url'], link.strip()), source=source['name'], source_id=source['id'],
                external_id=guid, published_at=values.get('pubDate') or values.get('published') or values.get('updated'),
                content_level=level, categories=categories, body_provenance='namespaced_feed_body' if body else 'feed_summary_or_title', language=item.attrib.get('{http://www.w3.org/XML/1998/namespace}lang') or feed_language,
                origin_name=text(values.get('source')), origin_url=origin_url,
                author=text(values.get('creator') or values.get('author'))))
    if not media:
        result['quality_flags'].append('missing_content_type')
    if not result['received']:
        raise UpstreamError('来源返回空列表，无法确认更新')
    return result


def migrate_news(c):
    """Additive migration only; no deletion/rebuild of historical news or evidence."""
    columns = {row[1] for row in c.execute('PRAGMA table_info(articles)')}
    for name, kind in (
        ('source_id', 'TEXT'), ('external_id', 'TEXT'), ('identity_key', 'TEXT'),
        ('content_hash', 'TEXT'), ('source_published_at', 'TEXT'),
        ('quality_flags', "TEXT NOT NULL DEFAULT '[]'"), ('merge_reason', 'TEXT'),
        ('supersedes_id', 'TEXT')):
        if name not in columns:
            c.execute(f'ALTER TABLE articles ADD COLUMN {name} {kind}')
    if 'primary_article_id' not in {row[1] for row in c.execute('PRAGMA table_info(events)')}:
        c.execute('ALTER TABLE events ADD COLUMN primary_article_id TEXT')
    c.execute('CREATE INDEX IF NOT EXISTS news_article_identity ON articles(source_id,identity_key,content_hash)')
    c.execute('CREATE INDEX IF NOT EXISTS news_article_published ON articles(published_at)')
    c.execute('''CREATE TABLE IF NOT EXISTS news_identities(
        source_id TEXT NOT NULL,kind TEXT NOT NULL,value TEXT NOT NULL,identity_key TEXT NOT NULL,
        PRIMARY KEY(source_id,kind,value))''')
    c.execute('''CREATE TABLE IF NOT EXISTS news_fetches(
        id TEXT PRIMARY KEY,source_id TEXT NOT NULL,checked_at TEXT NOT NULL,finished_at TEXT NOT NULL,
        status TEXT NOT NULL,received INTEGER NOT NULL,added INTEGER NOT NULL,duplicates INTEGER NOT NULL,
        rejected INTEGER NOT NULL,revisions INTEGER NOT NULL,not_modified INTEGER NOT NULL,error_code TEXT)''')
    c.execute('CREATE INDEX IF NOT EXISTS news_fetch_source ON news_fetches(source_id,checked_at)')
    registry = {json.loads(row[0])['name']: json.loads(row[0])['id'] for row in c.execute('SELECT data FROM sources')}
    touched = set()
    for row in c.execute('SELECT * FROM articles WHERE identity_key IS NULL ORDER BY rowid').fetchall():
        sid = registry.get(row['source'], 'legacy:' + digest(row['source']))
        # Older code could create unrelated events when a URL was reused. Keep
        # those historical events distinct instead of hiding all but one of them.
        key = digest(sid, 'legacy_url_event', row['canonical_url'], row['event_id'])
        published, flags = publication(row['published_at'], row['content_level'], row['fetched_at'])
        # Preserve old raw fields on migration, including any invalid source time.
        # Public read projection below excludes future timestamps from sorting.
        c.execute('''UPDATE articles SET source_id=?,identity_key=?,content_hash=?,source_published_at=?,quality_flags=? WHERE id=?''',
                  (sid, key, content_hash(row['title'], row['content'], row['content_level']), row['published_at'], dump(flags), row['id']))
        c.execute('INSERT INTO news_identities VALUES (?,?,?,?) ON CONFLICT(source_id,kind,value) DO UPDATE SET identity_key=excluded.identity_key', (sid, 'url', row['canonical_url'], key))
        touched.add(row['event_id'])
    for eid in touched:
        refresh_event(c, eid)


def active_articles(c, eid):
    # rowid is a deterministic commit/insertion order even when clock precision or
    # a corrected source publication timestamp makes two versions tie/reorder.
    return c.execute('''SELECT a.*,a.rowid AS sequence FROM articles a WHERE a.event_id=? AND NOT EXISTS
        (SELECT 1 FROM articles newer WHERE newer.source_id=a.source_id
         AND newer.identity_key=a.identity_key AND newer.rowid>a.rowid)''', (eid,)).fetchall()


def article_public(row):
    result = dict(row)
    for key in ('title', 'content'):
        result[key] = text(result[key])
    result['quality_flags'] = json.loads(result.get('quality_flags') or '[]')
    # Non-destructive read repair for the former media:content collision. Keep
    # the immutable stored caption/version, but never present it as article text.
    unverified_media_feed = (result.get('source_id') in {'guardian-world', 'guardian-front', 'nyt-home'}
                             and 'namespaced_feed_body' not in result['quality_flags'])
    if result.get('content_level') == 'full' and (unverified_media_feed or re.match(r'^\s*(?:Photograph|Photo|Image|Illustration|Picture)\s*:', result['content'], re.I)):
        result['content'] = ''
        result['content_level'] = 'title'
        result['quality_flags'].append('legacy_media_caption_not_body')
    if 'future_published_at' in result['quality_flags'] or 'invalid_published_at' in result['quality_flags']:
        result['published_at'] = None
    result.pop('sequence', None)
    return result


def ordered_articles(rows):
    """Latest publication among current identities; latest revision within each."""
    return sorted(rows, key=lambda a: (bool(a['published_at']), timestamp(a['published_at']) if a['published_at'] else datetime.min.replace(tzinfo=timezone.utc), timestamp(a['fetched_at']), a['id']), reverse=True)


def event_projection(c, eid):
    active = [article_public(r) for r in active_articles(c, eid)]
    primary = ordered_articles(active)[0] if active else None
    all_rows = c.execute('SELECT source,source_id,quality_flags,merge_reason FROM articles WHERE event_id=?', (eid,)).fetchall()
    sources = sorted({r['source'] for r in all_rows})
    source_ids = {r['source_id'] or r['source'] for r in all_rows}
    return dict(primary_article_id=primary['id'] if primary else None,
                latest_published_at=max((a['published_at'] for a in active if a['published_at']), key=timestamp, default=None),
                source_count=len(source_ids), source_names=sources, article_count=len(all_rows),
                quality_flags=sorted({flag for a in active for flag in a['quality_flags']}),
                merge_reason=next((r['merge_reason'] for r in reversed(all_rows) if r['merge_reason']), None)), primary


def refresh_event(c, eid):
    projection, primary = event_projection(c, eid)
    if primary:
        tags = [w for w in ('政策', '业绩', '收购', '减持', '增持', '风险', '更正', '产业') if w in primary['title']]
        c.execute('UPDATE events SET primary_article_id=?,title=?,summary=?,published_at=?,tags=? WHERE id=?',
                  (primary['id'], primary['title'], primary['content'][:500], primary['published_at'], dump(tags), eid))
    return projection


def url_story_related(article, prior, names=()):
    """URL alone is not a story identity; allow edits, not unrelated new stories.

    Unlike cross-source aggregation, numeric/action changes are allowed here:
    these may be exactly the corrections whose versions we must preserve.
    """
    from .research import normalized

    def headline(value):
        value = text(value)
        for _ in range(3):
            value = re.sub(r'^[\s【】\[\]（）()：:—-]*(?:更正|纠正|勘误|更新|快讯|修订)[\s【】\[\]（）()：:—-]*', '', value)
        return value

    if content_hash(article['title'], article['content'], None) == content_hash(prior['title'], prior['content'], None):
        return True  # Even a short/title-only item must remain idempotent.
    a, b = headline(article['title']), headline(prior['title'])
    named = lambda s: {name for name in names if len(name) >= 2 and name in s}
    named_a = named(a) or named(article['content'][:500])
    named_b = named(b) or named(prior['content'][:500])
    if (named_a or named_b) and named_a != named_b:
        return False
    generic_entities = {'该公司', '某公司', '上市公司', '相关公司', '多家公司'}
    entities = lambda s: set(re.findall(r'[\w\u4e00-\u9fff]{1,30}?(?:公司|集团|银行)', s)) - generic_entities
    ea = entities(a) or entities(article['content'][:500])
    eb = entities(b) or entities(prior['content'][:500])
    if (ea or eb) and ea != eb:
        return False
    if not (named_a or named_b or ea or eb):
        # Also distinguish bare company names before a reporting/action verb,
        # e.g. 腾讯发布… versus 阿里巴巴发布…, without a securities catalogue.
        subject = lambda s: re.match(r'^(.{1,30}?)(?:发布|披露|公告|宣布|预计|实现|完成|签订|签署|收购|增持|减持|投产|停产)', s)
        sa, sb = subject(a), subject(b)
        if sa and sb and normalized(sa[1]) != normalized(sb[1]):
            return False
    na, nb = normalized(a), normalized(b)
    if len(na) >= 6 and na == nb:
        return True
    title_similarity = SequenceMatcher(None, na, nb).ratio()
    actions = lambda s: {w for w in ('收购', '减持', '增持', '签约', '签订', '投产', '停产', '发布', '披露', '公告', '澄清', '取消', '终止', '增长', '下降') if w in s}
    if min(len(na), len(nb)) >= 8 and title_similarity >= .90 and actions(a) == actions(b):
        return True
    body_a, body_b = normalized(article['content'][:4000]), normalized(prior['content'][:4000])
    if len(body_a) >= 40 and body_a == body_b:
        return True
    if min(len(body_a), len(body_b)) < 8:
        return False
    body_similarity = SequenceMatcher(None, body_a, body_b).ratio()
    if na and na == nb and body_similarity >= .85:
        return True  # Short financial flashes can still have clear text continuity.
    if min(len(body_a), len(body_b)) < 20:
        return False
    return bool((title_similarity >= .78 and body_similarity >= .60)
                or (min(len(body_a), len(body_b)) >= 80 and title_similarity >= .35 and body_similarity >= .88))


def resolve_identity(c, sid, external, canonical, published, incoming=None):
    lookup = lambda kind, value: c.execute('SELECT identity_key FROM news_identities WHERE source_id=? AND kind=? AND value=?', (sid, kind, value)).fetchone()
    explicit = lookup('external', external) if external else None
    if explicit:
        return explicit[0]  # GUID wins even when the URL or source time changes.
    alias = lookup('url', canonical)
    if not alias:
        return digest(sid, 'external' if external else 'url', external or canonical)
    head = c.execute('SELECT * FROM articles WHERE source_id=? AND identity_key=? ORDER BY rowid DESC LIMIT 1', (sid, alias[0])).fetchone()
    candidates = ([head] if head else []) + c.execute('''SELECT a.* FROM articles a
        WHERE a.source_id=? AND a.canonical_url=? AND a.identity_key<>? AND NOT EXISTS
        (SELECT 1 FROM articles n WHERE n.source_id=a.source_id AND n.identity_key=a.identity_key AND n.rowid>a.rowid)
        ORDER BY a.rowid DESC''', (sid, canonical, alias[0])).fetchall()
    names = [r[0] for r in c.execute('SELECT name FROM securities')]
    different_era = False
    for prior in candidates:
        if external:
            ids = {r[0] for r in c.execute("SELECT value FROM news_identities WHERE source_id=? AND kind='external' AND identity_key=?", (sid, prior['identity_key']))}
            if ids and external not in ids:
                continue
        prior_date = article_public_time(prior)
        # A matching title/body years later can still be a reused URL. Historical
        # replays can find their own older identity, never an unrelated URL head.
        if published and prior_date and abs((timestamp(published) - timestamp(prior_date)).total_seconds()) > 180 * 86400:
            different_era = True
            continue
        if incoming and url_story_related(incoming, prior, names):
            return prior['identity_key']
    if external:
        return digest(sid, 'external', external)
    return digest(sid, 'url_story', canonical,
                  content_hash(incoming['title'], incoming['content'], None) if incoming else None,
                  published[:10] if different_era and published else None)


def article_public_time(row):
    flags = json.loads(row['quality_flags'] or '[]')
    if any(flag in flags for flag in ('future_published_at', 'invalid_published_at')):
        return None
    return row['published_at']


class NewsStore:
    def __init__(self, research):
        self.research, self.db = research, research.db

    def ingest(self, article):
        from .research import canonical_url, identity, same_event, merge_safe
        if not isinstance(article, dict):
            raise UserError('新闻条目结构无效')
        if not isinstance(article.get('title'), str) or not isinstance(article.get('content', ''), (str, type(None))) or not isinstance(article.get('url'), str):
            raise UserError('新闻标题/正文/原文地址类型无效')
        title, content = text(article.get('title')), text(article.get('content'))
        if len(title) > 1000 or len(content) > 100000:
            # Reject rather than silently hashing a truncated body and losing a
            # later numeric correction beyond the truncation boundary.
            raise UserError('新闻标题或正文超过单条处理上限')
        source = str(article.get('source') or '').strip()[:500]
        if not title or not source:
            raise UserError('新闻必须包含标题和来源')
        level = article.get('content_level', 'summary')
        if level not in ('full', 'summary', 'title'):
            raise UserError('新闻内容级别无效')
        if not content:
            level = 'title'
        canonical = canonical_url(validate_url(article.get('url', ''), public=True))
        external = str(article['external_id']).strip() if article.get('external_id') is not None else None
        if external and len(external) > 4096:
            raise UserError('新闻源内 ID 过长')
        sid = article.get('source_id')
        if not sid:
            sid = next((s['id'] for s in self.db.sources() if s['name'] == source), 'legacy:' + digest(source))
        if not isinstance(sid, str) or not sid or len(sid) > 500:
            raise UserError('新闻来源 ID 无效')
        at = utcnow()
        published, flags = publication(article.get('published_at'), level, at)
        if article.get('body_provenance') == 'namespaced_feed_body':
            flags.append('namespaced_feed_body')
        raw_published = str(article['published_at'])[:200] if article.get('published_at') is not None else None
        hashed = content_hash(title, content, level)
        incoming = dict(title=title, content=content, published_at=published)
        with self.db.transaction() as c:
            key = resolve_identity(c, sid, external, canonical, published, incoming)
            prior = c.execute('SELECT * FROM articles WHERE source_id=? AND identity_key=? ORDER BY rowid DESC LIMIT 1', (sid, key)).fetchone()
            historical = c.execute('SELECT * FROM articles WHERE source_id=? AND identity_key=? AND content_hash=? ORDER BY rowid DESC LIMIT 1', (sid, key, hashed)).fetchone()
            current_same = bool(prior and prior['content_hash'] == hashed)
            watermark_key = 'news_publication_watermark:' + digest(sid, key)
            observed = c.execute('SELECT value FROM kv WHERE key=?', (watermark_key,)).fetchone()
            known_dates = [when for row in c.execute('SELECT published_at,quality_flags FROM articles WHERE source_id=? AND identity_key=?', (sid, key))
                           if (when := article_public_time(row))]
            if observed:
                known_dates.append(json.loads(observed[0]))
            latest_known = max(known_dates, key=timestamp, default=None)
            # Historical content is not necessarily a duplicate: a publisher can
            # explicitly restore A after B. Require a source time newer than the
            # current version AND every already observed time, never fetch time.
            restoring = bool(prior and historical and not current_same and published
                             and article_public_time(prior) and latest_known
                             and timestamp(published) > timestamp(latest_known))
            duplicate = prior if current_same or (historical and not restoring) else None
            if published and (current_same or not duplicate) and (not latest_known or timestamp(published) > timestamp(latest_known)):
                c.execute('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                          (watermark_key, dump(published)))
            for kind, value in (('url', canonical), ('external', external)):
                if value:
                    c.execute('INSERT INTO news_identities VALUES (?,?,?,?) ON CONFLICT(source_id,kind,value) DO UPDATE SET identity_key=excluded.identity_key', (sid, kind, value, key))
            if external:
                # Adopting a pre-migration URL identity must not discard a newly
                # observed GUID just because the title/body was already cached.
                c.execute('UPDATE articles SET external_id=? WHERE source_id=? AND identity_key=? AND external_id IS NULL', (external, sid, key))
            if duplicate:
                old_flags = json.loads(duplicate['quality_flags'])
                if current_same and level == duplicate['content_level'] and 'namespaced_feed_body' in flags and 'namespaced_feed_body' not in old_flags:
                    old_flags.append('namespaced_feed_body')
                    c.execute('UPDATE articles SET quality_flags=? WHERE id=?', (dump(old_flags), duplicate['id']))
                    # Metadata verification does not manufacture a content version.
                    if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='editorial_articles'").fetchone():
                        c.execute("UPDATE editorial_articles SET version='' WHERE article_id=?", (duplicate['id'],))
                if current_same and published and (not duplicate['published_at'] or any(f in old_flags for f in ('future_published_at', 'invalid_published_at'))):
                    # Repair missing/invalid time metadata without inventing a
                    # content version or replacing the originally observed raw time.
                    repaired = [f for f in old_flags if f not in ('missing_published_at', 'future_published_at', 'invalid_published_at')]
                    c.execute('UPDATE articles SET published_at=?,quality_flags=? WHERE id=?',
                              (published, dump(sorted(set(repaired + ['publication_repaired']))), duplicate['id']))
                    refresh_event(c, duplicate['event_id'])
                    self.db.mark_stale(c, duplicate['event_id'])
                row = c.execute("SELECT value FROM kv WHERE key='news_duplicate_count'").fetchone()
                count = (json.loads(row[0]) if row else 0) + 1
                c.execute("INSERT INTO kv VALUES ('news_duplicate_count',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (dump(count),))
                return dict(status='duplicate', event_id=duplicate['event_id'], article_id=None, observed_article_id=duplicate['id'])
            revision, eid, reason = 'initial', None, None
            if prior:
                eid = prior['event_id']
                revision = 'correction' if re.search(r'更正|纠正|勘误|澄清|不实|撤回', title + content[:200]) else 'update'
                reason = 'same_source_identity_restoration' if restoring else 'same_source_identity_revision'
            else:
                candidates = c.execute('''SELECT a.* FROM articles a WHERE NOT EXISTS
                    (SELECT 1 FROM articles n WHERE n.source_id=a.source_id AND n.identity_key=a.identity_key AND n.rowid>a.rowid)
                    ORDER BY a.rowid DESC LIMIT 1200''').fetchall()
                names = [r[0] for r in c.execute('SELECT name FROM securities')]
                for candidate in candidates:
                    candidate = article_public(candidate)
                    if (not external and candidate['source_id'] == sid and candidate['canonical_url'] == canonical
                            and not url_story_related(incoming, candidate, names)):
                        continue  # Do not undo an unrelated reused-URL split via aggregation.
                    if not same_event(incoming, candidate, names):
                        continue
                    members = [article_public(r) for r in active_articles(c, candidate['event_id'])]
                    if not external and any(member['source_id'] == sid and member['canonical_url'] == canonical
                                            and not url_story_related(incoming, member, names) for member in members):
                        continue  # A syndicated member must not bridge an unrelated reused URL.
                    if not all(merge_safe(incoming, member, names) for member in members):
                        continue
                    eid, reason = candidate['event_id'], 'same_subject_time_and_nonconflicting_facts'
                    break
            # News ingestion is deterministic and does not call configured AI.
            importance = self.research.rules.decide('importance', {'title': title}).value
            # Repeated content can be a distinct, chronologically newer version.
            # Salt restorations by their predecessor so A→B→A never collides with
            # A's old primary key or the retained legacy unique index.
            aid = 'article:' + (digest(sid, key, hashed, prior['id'], published) if restoring else digest(sid, key, hashed))
            if not eid:
                eid = 'event:' + identity(aid)
                c.execute('INSERT INTO events(id,title,summary,published_at,updated_at,importance,tags) VALUES (?,?,?,?,?,?,?)',
                          (eid, title, content[:500], published, at, importance, '[]'))
            else:
                self.db.mark_stale(c, eid)
                c.execute('UPDATE events SET updated_at=?,importance=max(importance,?) WHERE id=?', (at, importance, eid))
            # The legacy fingerprint column is identity-scoped to coexist with
            # its old unique index (including reused URLs/GUIDs). content_hash is
            # the unsalted, punctuation-preserving title+body text fingerprint.
            c.execute('''INSERT INTO articles(id,event_id,title,content,url,canonical_url,source,published_at,fetched_at,
                content_level,revision_kind,fingerprint,source_id,external_id,identity_key,content_hash,source_published_at,
                quality_flags,merge_reason,supersedes_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (aid, eid, title, content, article['url'], canonical, source, published, at, level, revision,
                 digest(key, hashed, aid) if restoring else digest(key, hashed), sid, external, key, hashed, raw_published,
                 dump(flags), reason, prior['id'] if prior else None))
            refresh_event(c, eid)
            self.research._match_symbols(c, eid)
            self.db.refresh_fts(c, eid)
        return dict(status='revision' if prior else 'added', event_id=eid, article_id=aid)


def public_sources(db):
    now = timestamp(utcnow())
    result = []
    with db.connect() as c:
        for source in db.sources():
            source = dict(source)
            for field in ('last_checked', 'last_success', 'latest_published_at', 'next_retry_at', 'etag', 'last_modified', 'http_status', 'error_code'):
                source.setdefault(field, None)
            source.setdefault('failure_count', 0)
            source.setdefault('statistics', {k: 0 for k in COUNTERS})
            source.setdefault('quality_flags', [])
            quality_counts = {}
            for row in c.execute('''SELECT a.quality_flags FROM articles a WHERE source_id=? AND NOT EXISTS
                (SELECT 1 FROM articles n WHERE n.source_id=a.source_id AND n.identity_key=a.identity_key AND n.rowid>a.rowid)''', (source['id'],)):
                for flag in json.loads(row[0]):
                    quality_counts[flag] = quality_counts.get(flag, 0) + 1
            source['article_quality_counts'] = quality_counts
            source['quality_flags'] = sorted(set(source['quality_flags']) | set(quality_counts))
            source['latest_published_at'] = latest_publication(c, source['id'])
            total = c.execute('SELECT coalesce(sum(received),0),coalesce(sum(added),0),coalesce(sum(duplicates),0),coalesce(sum(rejected),0),coalesce(sum(revisions),0) FROM news_fetches WHERE source_id=?', (source['id'],)).fetchone()
            source['total_statistics'] = dict(zip(COUNTERS, total))
            for name in ('last_checked', 'last_success'):
                value = source.get(name)
                source[name + '_age_seconds'] = max(0, int((now - timestamp(value)).total_seconds())) if value else None
            # Disabled is an effective state, not a replacement for the last result.
            source['effective_status'] = source['status'] if source.get('enabled') else 'disabled'
            result.append(source)
    return result


def latest_publication(c, source_id=None):
    sql = '''SELECT a.published_at FROM articles a WHERE a.published_at IS NOT NULL AND
        a.quality_flags NOT LIKE '%future_published_at%' AND a.quality_flags NOT LIKE '%invalid_published_at%'
        AND NOT EXISTS (SELECT 1 FROM articles n WHERE n.source_id=a.source_id AND n.identity_key=a.identity_key AND n.rowid>a.rowid)'''
    values = (row[0] for row in c.execute(sql + (' AND a.source_id=?' if source_id else ''), (source_id,) if source_id else ()))
    return max(values, key=timestamp, default=None)


def news_overview(db):
    sources = [s for s in public_sources(db) if 'news' in s.get('capabilities', []) and not s.get('paid')]
    with db.connect() as c:
        event_count = c.execute('SELECT count(*) FROM events').fetchone()[0]
        article_count = c.execute('SELECT count(*) FROM articles').fetchone()[0]
        revision_count = c.execute("SELECT count(*) FROM articles WHERE revision_kind IN ('update','correction')").fetchone()[0]
        topics = {}
        for row in c.execute('SELECT tags FROM events'):
            for name in set(json.loads(row[0])):
                topics[name] = topics.get(name, 0) + 1
        published = latest_publication(c)
    warnings = ['统计口径：事件为当前库事件；文章含全部历史版本；来源为已配置公开新闻源（含停用）；重复为本次升级后累计重复观测；修订为库内 update/correction 版本数；主题按事件计数，可多标签。',
                'hot/score 为本地规则排序分，不是阅读量或全网热度；来源状态仅表示最近抓取结果。']
    for source in sources:
        if source.get('enabled') and source['status'] not in ('ok',):
            warnings.append(source['name'] + '：' + (source.get('last_error') or '尚未完成成功抓取'))
    return dict(event_count=event_count, article_count=article_count, source_count=len(sources),
                duplicate_count=db.get('news_duplicate_count', 0), revision_count=revision_count,
                last_checked=max((s['last_checked'] for s in sources if s['last_checked']), default=None),
                latest_published_at=published,
                topics=[dict(name=name, count=count) for name, count in sorted(topics.items(), key=lambda p: (-p[1], p[0]))],
                warnings=warnings)


def safe_news_error(exc):
    message = str(exc)
    if re.fullmatch(r'上游 HTTP \d{3}', message):
        return message, 'http_error'
    known = {
        '上游网络请求失败或超时': 'network_error',
        '上游请求总耗时超过限制': 'request_timeout',
        '上游响应大小或总耗时超过限制': 'response_limit',
        '上游重定向次数过多': 'redirect_limit',
        '来源新闻条目超过单次处理上限': 'item_limit',
        'RSS/Atom 内容类型不是 XML（可能为 HTML 页面）': 'invalid_content_type',
        '新闻 JSON 来源返回非 JSON 内容类型': 'invalid_content_type',
        'RSS/Atom XML 无法解析或含不安全实体': 'invalid_xml',
        '文档根节点不是 RSS/Atom': 'invalid_feed_root',
        'RSS 缺少 channel 节点': 'invalid_feed_structure',
        '新闻来源返回无效 JSON': 'invalid_json',
        '华尔街见闻响应结构改变': 'invalid_json_structure',
        '华尔街见闻返回业务失败': 'upstream_business_error',
        '来源返回空列表，无法确认更新': 'empty_feed',
        '来源条目全部未通过新闻数据校验': 'all_items_rejected',
        '来源返回 304 但没有已验证缓存': 'unexpected_not_modified',
        '新闻来源未返回可用文档': 'invalid_http_status',
    }
    if message in known:
        return message, known[message]
    # Injected connectors may attach arbitrary exception text. Never surface it.
    return '公开新闻来源抓取失败；保留已有数据', 'upstream_failure'


class NewsCollector:
    """One failed source never prevents another source from being attempted."""
    def __init__(self, db, research, public):
        self.db, self.store, self.public = db, NewsStore(research), public

    def collect(self, source):
        now = utcnow()
        # All refreshes, including manual/worker retries, honor a small cooldown.
        # This prevents an immediate job retry from hammering a failed endpoint.
        with self.db.transaction() as c:
            row = c.execute('SELECT data FROM sources WHERE id=?', (source['id'],)).fetchone()
            source = json.loads(row[0]) if row else source
            if not source.get('enabled') or (source.get('next_retry_at') and timestamp(now) < timestamp(source['next_retry_at'])):
                return dict(status='deferred', statistics={k: 0 for k in COUNTERS}, source_id=source['id'])
            # Durable lease prevents two worker processes or news/all jobs from
            # fetching the same endpoint concurrently. A crash releases by time.
            claimed = dict(source, last_checked=now, next_retry_at=(timestamp(now) + timedelta(minutes=5)).isoformat().replace('+00:00', 'Z'))
            c.execute('UPDATE sources SET data=? WHERE id=?', (dump(claimed), source['id']))
        counts = {k: 0 for k in COUNTERS}
        batch, error, error_code, http_status, retry_after = None, None, None, None, None
        try:
            from .adapters import PublicData
            fetch = getattr(self.public, 'news_batch', None)
            if isinstance(self.public, PublicData) and type(self.public).news is not PublicData.news and type(self.public).news_batch is PublicData.news_batch:
                fetch = None  # Preserve pre-existing injected news() overrides.
            if fetch:
                batch = fetch(source)
            else:
                # Existing injected public adapters remain supported.
                articles = self.public.news(source)
                batch = dict(articles=articles, received=len(articles), rejected=0, not_modified=False)
            counts['received'], counts['rejected'] = batch['received'], batch.get('rejected', 0)
            if not batch.get('not_modified') and not counts['received']:
                raise UpstreamError('来源返回空列表，无法确认更新')
            for article in batch['articles']:
                try:
                    article = dict(article, source_id=source['id'], source=source['name'])
                    outcome = self.store.ingest(article)
                    from .editorial import record_input
                    with self.db.transaction() as c:
                        record_input(c, article, outcome)
                    if outcome['status'] == 'duplicate':
                        counts['duplicates'] += 1
                    elif outcome['status'] == 'revision':
                        counts['revisions'] += 1
                    else:
                        counts['added'] += 1
                except (UserError, TypeError, KeyError, ValueError):
                    counts['rejected'] += 1
            if not batch.get('not_modified') and not (counts['added'] or counts['revisions'] or counts['duplicates']):
                raise UpstreamError('来源条目全部未通过新闻数据校验')
        except UserError:
            # URL safety failure is not a parse error and is visible as its own
            # classification. Never leak the rejected URL or arbitrary exception.
            error, error_code = '来源 URL 未通过公开地址安全校验；未作为 RSS 解析失败处理', 'unsafe_source_url'
        except UpstreamError as exc:
            error, error_code = safe_news_error(exc)
            http_status = getattr(exc, 'http_status', None)
            if http_status in (429, 503):
                retry_after = getattr(exc, 'retry_after', None)
        except Exception:
            error, error_code = '公开新闻来源响应结构或处理异常；保留已有数据', 'invalid_response'
        finished = utcnow()
        changes = dict(last_checked=now, statistics=counts, error_code=error_code,
                       http_status=batch.get('http_status') if batch else http_status)
        if error:
            failures = min(int(source.get('failure_count', 0)) + 1, 20)
            delay = min(3600, 60 * 2 ** min(failures - 1, 6))
            if isinstance(retry_after, int) and not isinstance(retry_after, bool):
                delay = max(delay, min(86400, max(0, retry_after)))
            changes.update(status='error', last_error=error, failure_count=failures,
                           next_retry_at=(timestamp(finished) + timedelta(seconds=delay)).isoformat().replace('+00:00', 'Z'))
        else:
            with self.db.connect() as c:
                latest = latest_publication(c, source['id'])
            cached_partial = bool(batch.get('not_modified') and source.get('cache_status', source.get('status')) == 'partial')
            changes.update(status='partial' if counts['rejected'] or cached_partial else 'ok', last_success=finished,
                           last_error='部分条目未通过数据校验，已跳过' if counts['rejected'] or cached_partial else None,
                           failure_count=0, latest_published_at=latest, quality_flags=source.get('quality_flags', []) if batch.get('not_modified') else batch.get('quality_flags', []),
                           not_modified=bool(batch.get('not_modified')),
                           next_retry_at=(timestamp(finished) + timedelta(seconds=30)).isoformat().replace('+00:00', 'Z'))
            if not batch.get('not_modified'):
                changes['cache_status'] = changes['status']
            for field in ('etag', 'last_modified'):
                # 304 may omit validators; retain the previous cache. A new 200
                # without validators clears old ones only after valid ingestion.
                if not batch.get('not_modified') or batch.get(field):
                    changes[field] = batch.get(field)
        self.db.source_merge(source['id'], changes)
        with self.db.transaction() as c:
            c.execute('INSERT INTO news_fetches VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                      (str(uuid.uuid4()), source['id'], now, finished, changes['status'],
                       *(counts[k] for k in COUNTERS), int(bool(batch and batch.get('not_modified'))), error_code))
        return dict(status=changes['status'], statistics=counts, source_id=source['id'], error=error)
