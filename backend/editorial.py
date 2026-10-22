"""Replayable evidence-linked rules projection. Storage/collection only; algorithms live in algorithms/."""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from .adapters import NEWS_BUILTIN_URLS, UpstreamError, text
from .config import UserError, validate_url
from .db import dump
from .models import utcnow
from .news import article_public, digest, timestamp
from .algorithms.common import hits, matches, snippet, norm
from .algorithms import algorithm_versions
from .algorithms import recommendation, event_grouping, industry_transmission, industry_association, features

RULES = json.loads(Path(__file__).with_name('editorial_rules.json').read_text(encoding='utf-8'))
VERSION = RULES['version']
PROJECTION_VERSION = VERSION + ':' + digest(algorithm_versions())
PUBLISHERS = {
    'bbc-world': 'BBC', 'bbc-top': 'BBC', 'bbc-homepage': 'BBC',
    'guardian-world': 'The Guardian', 'guardian-front': 'The Guardian',
    'nyt-home': 'The New York Times', 'ft-home': 'Financial Times',
    'aljazeera': 'Al Jazeera', 'wallstreetcn': '华尔街见闻',
    'chinanews-finance': '中国新闻网', 'ithome': 'IT之家',
}
SELECTIONS = {'guardian-front', 'nyt-home', 'ft-home'}


# Compatibility wrappers bind configuration at the IO boundary, not inside algorithms.
def importance(article):
    return recommendation.importance(article, RULES)


def editorial_exclusions(article, meta):
    return recommendation.editorial_exclusions(article, meta, RULES)


def industry_links(article, feature):
    return industry_transmission.industry_links(article, feature, RULES)


def editorial_sources():
    names = {'bbc-world': 'BBC World', 'bbc-top': 'BBC News', 'guardian-world': 'The Guardian World',
             'guardian-front': 'The Guardian 首页精选', 'aljazeera': 'Al Jazeera',
             'nyt-home': 'The New York Times 首页精选', 'ft-home': 'Financial Times 首页精选',
             'bbc-homepage': 'BBC 首页版面观察'}
    return [dict(id=sid, name=name, url=NEWS_BUILTIN_URLS[sid], enabled=True, paid=False,
                 coverage=('BBC News 主区 h2 报道链接；位置仅代表本次国际版观察，不代表全球统一头条' if sid == 'bbc-homepage'
                           else '媒体首页精选 RSS；无首页版位证据' if sid in SELECTIONS else '公开全球新闻流；不作为头版'),
                 content_level='title' if sid == 'bbc-homepage' else 'summary',
                 capabilities=['news', 'homepage' if sid == 'bbc-homepage' else 'rss'],
                 status='never_synced', last_success=None, last_error=None) for sid, name in names.items()]


def migrate_editorial(c):
    statements = [
        'CREATE TABLE IF NOT EXISTS editorial_inputs(article_id TEXT PRIMARY KEY, data TEXT NOT NULL)',
        '''CREATE TABLE IF NOT EXISTS editorial_observations(id TEXT PRIMARY KEY, article_id TEXT NOT NULL,
           event_id TEXT NOT NULL, source_id TEXT NOT NULL, observed_at TEXT NOT NULL, page_url TEXT NOT NULL,
           edition TEXT NOT NULL, position INTEGER NOT NULL, kind TEXT NOT NULL)''',
        'CREATE INDEX IF NOT EXISTS editorial_observed_article ON editorial_observations(article_id,observed_at)',
        '''CREATE TABLE IF NOT EXISTS editorial_stories(id TEXT PRIMARY KEY, rule_key TEXT NOT NULL,
           name TEXT NOT NULL, basis TEXT NOT NULL, first_observed_at TEXT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS editorial_progress(id TEXT PRIMARY KEY, story_id TEXT NOT NULL,
           event_id TEXT NOT NULL, signature TEXT NOT NULL, exact_hash TEXT NOT NULL,
           first_observed_at TEXT NOT NULL, fact_at TEXT)''',
        'CREATE INDEX IF NOT EXISTS editorial_progress_story ON editorial_progress(story_id)',
        'CREATE INDEX IF NOT EXISTS editorial_progress_signature ON editorial_progress(signature)',
        '''CREATE TABLE IF NOT EXISTS editorial_articles(article_id TEXT PRIMARY KEY, progress_id TEXT NOT NULL,
           version TEXT NOT NULL, data TEXT NOT NULL)''',
        'CREATE INDEX IF NOT EXISTS editorial_article_progress ON editorial_articles(progress_id)',
        'CREATE TABLE IF NOT EXISTS editorial_runs(id TEXT PRIMARY KEY, generated_at TEXT NOT NULL, version TEXT NOT NULL, data TEXT NOT NULL)',
    ]
    for statement in statements:
        c.execute(statement)


class BBCMain(HTMLParser):
    """Bounded h2-in-link parser; fails closed on a changed page structure."""
    def __init__(self):
        super().__init__()
        self.anchor = None
        self.heading = None
        self.items = []
        self.stopped = False
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'nav', 'footer'):
            self.ignored += 1
        if self.ignored or self.stopped:
            return
        if tag == 'a':
            self.anchor = attrs.get('href', '')
        if tag == 'h2':
            self.heading = {'url': self.anchor, 'parts': []}

    def handle_data(self, data):
        if self.heading is not None and not self.ignored and not self.stopped:
            self.heading['parts'].append(data)

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'nav', 'footer'):
            self.ignored = max(0, self.ignored - 1)
        if tag == 'h2' and self.heading is not None:
            heading, self.heading = self.heading, None
            title = text(' '.join(heading['parts']))
            url = urljoin('https://www.bbc.com/news', heading['url'] or '')
            parsed = urlsplit(url)
            if title and parsed.hostname == 'www.bbc.com' and re.match(r'^/news/(articles|live)/', parsed.path):
                if not self.stopped and not any(item['url'] == url for item in self.items):
                    self.items.append(dict(title=title, url=url))
            elif title and not heading['url'] and self.items:
                self.stopped = True
        if tag == 'a':
            self.anchor = None


def parse_homepage(source, response):
    if response['status'] == 304:
        if not source.get('last_success'):
            raise UpstreamError('来源返回 304 但没有已验证缓存')
        return dict(articles=[], received=0, rejected=0, not_modified=True, http_status=304)
    if response['status'] != 200:
        raise UpstreamError('新闻来源未返回可用文档')
    media = next((v for k, v in response['headers'].items() if k.lower() == 'content-type'), '')
    if media and 'text/html' not in media.lower():
        raise UpstreamError('首页观察返回非 HTML 文档')
    parser = BBCMain()
    try:
        parser.feed(response['body'].decode('utf-8-sig'))
        parser.close()
    except (ValueError, UnicodeError):
        raise UpstreamError('首页结构无法识别，未生成版位') from None
    if not parser.items:
        raise UpstreamError('首页结构无法识别，未生成版位')
    observed = utcnow()
    articles = [dict(item, source=source['name'], source_id=source['id'], content='', content_level='title',
                     published_at=None, homepage=dict(observed_at=observed, position=i + 1,
                     page_url=source['url'], edition='BBC News / international web observation', kind='homepage'))
                for i, item in enumerate(parser.items[:6])]
    return dict(articles=articles, received=len(articles), rejected=0, not_modified=False,
                quality_flags=['homepage_observation_not_publication'], http_status=200)


def record_input(c, article, outcome):
    aid = outcome.get('article_id') or outcome.get('observed_article_id')
    if not aid:
        return
    meta = {key: article[key] for key in ('language', 'origin_name', 'origin_url', 'author', 'categories') if article.get(key)}
    prior = c.execute('SELECT data FROM editorial_inputs WHERE article_id=?', (aid,)).fetchone()
    saved = json.loads(prior[0]) if prior else {}
    merged = dict(meta, **saved)
    if not prior or merged != saved:
        c.execute('INSERT INTO editorial_inputs VALUES (?,?) ON CONFLICT(article_id) DO UPDATE SET data=excluded.data', (aid, dump(merged)))
        c.execute("UPDATE editorial_articles SET version='' WHERE article_id=?", (aid,))
    observation = article.get('homepage')
    if observation:
        c.execute('INSERT OR IGNORE INTO editorial_observations VALUES (?,?,?,?,?,?,?,?,?)',
                  ('observation:' + digest(aid, observation['observed_at']), aid, outcome['event_id'],
                   article['source_id'], observation['observed_at'], observation['page_url'],
                   observation['edition'], observation['position'], observation['kind']))


def attribution(article, meta):
    origin_url = None
    if meta.get('origin_url'):
        try:
            origin_url = validate_url(meta['origin_url'], public=True)
        except UserError:
            pass
    return recommendation.attribution(article, meta, PUBLISHERS, origin_url=origin_url)


def extract(article, meta):
    return features.extract(article, meta, RULES, attribution(article, meta))


class Editorial:
    def __init__(self, db, industry_research=None):
        self.db = db
        self.industry_research = industry_research

    def project(self):
        """Replay features only; never reassign historical progress/story/event IDs."""
        with self.db.transaction() as c:
            pending = c.execute('''SELECT a.* FROM articles a LEFT JOIN editorial_articles e ON e.article_id=a.id
                WHERE e.article_id IS NULL OR e.version<>? ORDER BY a.rowid''', (PROJECTION_VERSION,)).fetchall()
            for row in pending:
                article = article_public(row)
                meta = c.execute('SELECT data FROM editorial_inputs WHERE article_id=?', (article['id'],)).fetchone()
                feature = extract(article, json.loads(meta[0]) if meta else {})
                old = c.execute('SELECT progress_id FROM editorial_articles WHERE article_id=?', (article['id'],)).fetchone()
                pid = old[0] if old else self._progress(c, article, feature)
                c.execute('INSERT INTO editorial_articles VALUES (?,?,?,?) ON CONFLICT(article_id) DO UPDATE SET version=excluded.version,data=excluded.data',
                          (article['id'], pid, PROJECTION_VERSION, dump(feature)))

    def _progress(self, c, article, feature):
        signature = digest(norm(article['title']), feature['numeric_facts'], sorted(feature['actions']), sorted(feature['entities']))
        exact = digest(norm(article['title']), norm(article['content']))
        fact_at = article['published_at']

        def reuse(candidate):
            if fact_at and (not candidate['fact_at'] or timestamp(fact_at) < timestamp(candidate['fact_at'])):
                c.execute('UPDATE editorial_progress SET fact_at=? WHERE id=?', (fact_at, candidate['id']))
            return candidate['id']

        for candidate in c.execute('''SELECT a.title,a.content_level,p.* FROM articles a
            JOIN editorial_articles e ON e.article_id=a.id JOIN editorial_progress p ON p.id=e.progress_id
            WHERE a.canonical_url=? ORDER BY a.rowid DESC''', (article['canonical_url'],)).fetchall():
            if event_grouping.homepage_progress(article, candidate):
                return reuse(candidate)
        for row in c.execute('SELECT * FROM editorial_progress WHERE signature=? ORDER BY first_observed_at', (signature,)).fetchall():
            prior = [article_public(r) for r in c.execute('''SELECT a.* FROM editorial_articles e JOIN articles a ON a.id=e.article_id
                WHERE e.progress_id=?''', (row['id'],))]
            same_identity = any(a['source_id'] == article['source_id'] and a['identity_key'] == article['identity_key'] for a in prior)
            if event_grouping.signature_progress(article, row, exact, same_identity, prior):
                return reuse(row)
        decision = event_grouping.story_rule(article, feature, RULES)
        rule_key, basis, name = decision['rule_key'], decision['basis'], decision['name']
        story = None
        if decision['max_gap_days'] is not None:
            reference = fact_at or article['fetched_at']
            for candidate in c.execute('''SELECT s.id,max(coalesce(p.fact_at,p.first_observed_at)) AS latest,
                min(coalesce(p.fact_at,p.first_observed_at)) AS earliest FROM editorial_stories s
                JOIN editorial_progress p ON p.story_id=s.id WHERE s.rule_key=? GROUP BY s.id ORDER BY latest DESC''', (rule_key,)):
                if event_grouping.story_in_window(reference, candidate, decision['max_gap_days']):
                    story = candidate['id']
                    break
        if not story and rule_key.startswith('standalone:'):
            prior = c.execute('SELECT id FROM editorial_stories WHERE rule_key=?', (rule_key,)).fetchone()
            story = prior[0] if prior else None
        if not story:
            story = 'story:' + digest(rule_key, article['id'])
            c.execute('INSERT INTO editorial_stories(id,rule_key,name,basis,first_observed_at) VALUES (?,?,?,?,?)',
                      (story, rule_key, name, basis, article['fetched_at']))
        pid = 'progress:' + digest(article['id'])
        c.execute('INSERT INTO editorial_progress(id,story_id,event_id,signature,exact_hash,first_observed_at,fact_at) VALUES (?,?,?,?,?,?,?)',
                  (pid, story, article['event_id'], signature, exact, article['fetched_at'], fact_at))
        return pid

    def _item(self, c, progress, now, history=False, enhance=True, previous_recommendations=()):
        rows = c.execute('''SELECT a.*,e.data AS feature_data,a.rowid AS article_sequence,
            NOT EXISTS (SELECT 1 FROM articles n WHERE n.source_id=a.source_id
                AND n.identity_key=a.identity_key AND n.rowid>a.rowid) AS current_head
            FROM editorial_articles e JOIN articles a ON a.id=e.article_id
            WHERE e.progress_id=? ORDER BY a.rowid''', (progress['id'],)).fetchall()
        if not rows:
            return None
        rows = sorted(rows, key=lambda r: (not r['current_head'], not bool(article_public(r)['content']),
                                           article_public(r)['content_level'] != 'full', -r['article_sequence'], r['id']))
        all_rows = rows
        current_heads = sum(bool(r['current_head']) for r in rows)
        rows = [r for r in rows if r['current_head']] or rows
        primary = article_public(rows[0])
        features = [json.loads(row['feature_data']) for row in rows]
        observations = [dict(row) for row in c.execute('''SELECT o.* FROM editorial_observations o
            JOIN editorial_articles e ON e.article_id=o.article_id WHERE e.progress_id=? ORDER BY o.observed_at DESC,o.position''', (progress['id'],))]
        fact_at = progress['fact_at']
        repaired_dates = [a['published_at'] for a in (article_public(r) for r in rows) if a['published_at']]
        earliest = min(repaired_dates, key=timestamp, default=None)
        if earliest and (not fact_at or timestamp(earliest) < timestamp(fact_at)):
            fact_at = earliest
            c.execute('UPDATE editorial_progress SET fact_at=? WHERE id=?', (fact_at, progress['id']))
        actions = sorted({key for f in features for key in f['actions']})
        triggers = [dict(t, article_id=r['id']) for r, f in zip(rows, features) for t in f['triggers']]
        links = []
        for f in features:
            for link in f['industry_links']:
                if not any((x['industry_id'], x['variable']) == (link['industry_id'], link['variable']) for x in links):
                    links.append(link)
        publishers = sorted({f['attribution']['publisher'] for f in features})
        story = dict(c.execute('SELECT * FROM editorial_stories WHERE id=?', (progress['story_id'],)).fetchone())
        articles = []
        for row in all_rows:
            f = json.loads(row['feature_data'])
            a = article_public(row)
            a.pop('feature_data', None)
            a.update(attribution=f['attribution'], language=f['language'], language_basis=f['language_basis'])
            articles.append(a)
        # History stays readable below, but cannot supply proof for a revision.
        current_ids = {r['id'] for r in rows if r['current_head']}
        current_articles = [a for a in articles if a['id'] in current_ids]
        decision_articles = [article_public(r) for r in rows]
        decision_args = dict(now=now, fact_at=fact_at, current_heads=current_heads,
                             rules=RULES, selections=SELECTIONS,
                             previous_recommendations=previous_recommendations, progress_id=progress['id'])
        # No directory/projection IO for the cheap quality, time and importance
        # pass. With no snapshot, every otherwise-admissible important candidate
        # is pending_review, never eligible. Reuse that exact contract rather
        # than introducing a faster, weaker eligibility implementation.
        decision = recommendation.evaluate(features, decision_articles, observations, **decision_args)
        needs_projection = bool(current_articles) and (enhance or decision['admission_status'] == 'pending_review')
        associations, impacts, nv, cv = [], links, None, None
        projection_status = 'skipped_precheck'
        projection_error = None
        if needs_projection:
            projection_status = 'complete'
            try:
                if self.industry_research:
                    associations, impacts, nv, cv = self.industry_research.projection(current_articles, links)
                else:
                    # Rules-only installations do not require an AI service or graph.
                    cv = 'identity-only-v1'
                    nv = industry_association.binding(current_articles, cv)
                    associations = industry_association.associate(current_articles, [])
            except Exception as error:
                # Failure is an auditable pending candidate, never a silent admission
                # through legacy feature impacts. Do not expose provider error text.
                projection_status = 'failed'
                projection_error = type(error).__name__
        snapshot = dict(status=projection_status, links=associations, news_version=nv, catalog_version=cv,
                        algorithm_version=industry_association.VERSION)
        if needs_projection:
            decision = recommendation.evaluate(features, decision_articles, observations,
                                               association_snapshot=snapshot, **decision_args)
        decision['association_gate']['projection_status'] = projection_status
        if projection_error:
            decision['association_gate']['projection_error'] = projection_error
        # Only current, proof-bound associations are presented as validated.
        display_gate = recommendation.association_gate(current_articles, snapshot, current_ids)
        associations = display_gate['links']
        # Compatibility links expose all broad entry names. Exact conditional
        # impacts remain separate and can only be rendered on an industry page.
        entry_links = list(impacts)
        for association in associations:
            if association.get('association_id'):
                entry_links = [i for i in entry_links if i['industry_id'] != association['industry_id'] or i.get('relation') != 'association']
                entry_links.append(association)
            elif not any(i['industry_id'] == association['industry_id'] for i in entry_links):
                entry_links.append(association)
        analysis_row = c.execute('SELECT data FROM analyses WHERE event_id=?', (progress['event_id'],)).fetchone()
        analysis = json.loads(analysis_row[0]) if analysis_row else None
        association = analysis.get('industry_association', {}) if analysis else {}
        analysis_status = analysis.get('status', 'not_analyzed') if analysis else 'not_analyzed'
        analysis_proof = recommendation.association_gate(current_articles,
            dict(snapshot, links=association.get('links', [])), current_ids)
        if analysis_status == 'complete' and (association.get('status') != 'complete'
                or association.get('evidence_version') != analysis.get('evidence_version')
                or analysis_proof['status'] != 'complete'):
            analysis_status = 'pending_review'
        return dict(id=progress['id'], event_id=progress['event_id'], event_ids=sorted({r['event_id'] for r in rows}),
                    analysis_status=analysis_status, association_status=display_gate['status'],
                    title=primary['title'], summary=primary['content'][:650], published_at=fact_at,
                    first_observed_at=progress['first_observed_at'], observations=observations[:30], primary_article_id=primary['id'],
                    story=story, industry_links=entry_links, industry_associations=associations, industry_impacts=impacts,
                    news_version=nv, catalog_version=cv, articles=articles, unique_publisher_count=len(publishers), publishers=publishers,
                    origin_count=len(decision['origin_keys']), feature_evidence=triggers, actions=actions,
                    has_current_head=bool(current_heads), latest_sequence=max(r['article_sequence'] for r in rows), **decision)

    def feed(self, limit=36):
        self.project()
        generated = utcnow()
        now = timestamp(generated)
        with self.db.connect() as c:
            progresses = c.execute('''SELECT * FROM editorial_progress ORDER BY
                coalesce(fact_at,first_observed_at) DESC LIMIT 2000''').fetchall()
            previous_run = c.execute('SELECT data FROM editorial_runs ORDER BY generated_at DESC,rowid DESC LIMIT 1').fetchone()
            previous = json.loads(previous_run[0]).get('selected', []) if previous_run else []
            # Defer expensive directory-backed projection until the cheap
            # admission pass succeeds, but still before any ranking/selection.
            items = [self._item(c, row, now, enhance=False, previous_recommendations=previous) for row in progresses]
            total = c.execute('SELECT count(*) FROM articles').fetchone()[0]
            active = c.execute("SELECT id,status FROM jobs WHERE kind IN ('news','all') AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").fetchone()
        selected, deferred = recommendation.diversify(items, min(36, max(0, limit)), RULES['diversity'])
        sync = self.db.get('news_sync', {})
        sources = [s for s in self.db.sources() if s.get('enabled') and not s.get('paid') and 'news' in s.get('capabilities', [])]
        state = 'collecting' if active else 'empty' if not total else 'ready' if selected else 'no_current_selection'
        if not active and sources and all(s.get('status') == 'error' for s in sources):
            state = 'sources_unavailable'
        payload = dict(generated_at=generated, algorithm_version=VERSION, algorithm_versions=algorithm_versions(), state=state,
                       items=selected, default_event_id=selected[0]['event_id'] if selected else None,
                       exclusive_available=any(i['exclusive_claims'] for i in selected),
                       coverage_note='限于已接入公开来源；版位仅代表具体媒体/版本观察，不是全球热榜。',
                       collection=dict(active_job_id=active['id'] if active else None,
                                       last_checked=sync.get('fetched_at'), warnings=sync.get('warnings', [])))
        audit = dict(selected=[dict(id=i['id'], algorithm=i['algorithm'], reasons=i['reasons'],
                                    article_versions=i['information_increment']['article_versions'],
                                    information_increment=i['information_increment']) for i in selected],
                     pending=[dict(id=i['id'], event_id=i['event_id'], primary_article_id=i['primary_article_id'],
                                   importance=i['importance'], association_gate=i['association_gate'],
                                   news_version=i['news_version'], catalog_version=i['catalog_version'],
                                   reasons=i['algorithm']['excluded']) for i in items if i and i['admission_status'] == 'pending_review'],
                     excluded=[dict(id=i['id'], reasons=i['algorithm']['excluded']) for i in items if i and i['admission_status'] == 'excluded'],
                     diversity_deferred=deferred, candidate_window=2000, scanned=len(progresses), weights=RULES['weights'],
                     algorithm_versions=algorithm_versions())
        rid = 'editorial-run:' + digest(VERSION, audit)
        with self.db.transaction() as c:
            c.execute('INSERT OR IGNORE INTO editorial_runs VALUES (?,?,?,?)', (rid, generated, VERSION, dump(audit)))
        payload['run_id'] = rid
        return payload

    def detail(self, event_id):
        self.project()
        now = timestamp(utcnow())
        with self.db.connect() as c:
            event = c.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
            if not event:
                raise UserError('新闻不存在', 404)
            progresses = c.execute('''SELECT DISTINCT p.* FROM editorial_progress p JOIN editorial_articles e ON e.progress_id=p.id
                JOIN articles a ON a.id=e.article_id WHERE a.event_id=? ORDER BY coalesce(p.fact_at,p.first_observed_at) DESC''', (event_id,)).fetchall()
            items = [self._item(c, p, now, True) for p in progresses]
            items = [i for i in items if i]
            items.sort(key=lambda i: (i['has_current_head'], i['published_at'] or i['first_observed_at'], i['latest_sequence']), reverse=True)
            if not items:
                raise UserError('此新闻尚无可读的稿件投影', 404)
            current = items[0]
            articles = [article_public(row) for row in c.execute('SELECT * FROM articles WHERE event_id=? ORDER BY rowid DESC', (event_id,))]
            projected = {a['id']: a for item in items for a in item['articles']}
            articles = list({a['id']: projected.get(a['id'], a) for a in articles + list(projected.values())}.values())
            event_data = dict(id=event_id, title=current['title'], summary=current['summary'], published_at=current['published_at'])
            return dict(event=event_data, title=current['title'], summary=current['summary'], articles=articles,
                        industry_links=current['industry_links'], current=current, progresses=items,
                        story=self._story(c, current['story']['id'], now), generated_at=utcnow(), algorithm_version=VERSION,
                        algorithm_versions=algorithm_versions())

    def _story(self, c, sid, now):
        row = c.execute('SELECT * FROM editorial_stories WHERE id=?', (sid,)).fetchone()
        if not row:
            raise UserError('持续议题不存在', 404)
        progresses = c.execute('''SELECT * FROM editorial_progress WHERE story_id=?
            ORDER BY coalesce(fact_at,first_observed_at) DESC LIMIT 150''', (sid,)).fetchall()
        items = [self._item(c, p, now, True) for p in progresses]
        items = [i for i in items if i and i['has_current_head']]
        items.sort(key=lambda i: (i['published_at'] or i['first_observed_at'], i['latest_sequence']), reverse=True)
        latest = max((i['published_at'] for i in items if i['published_at']), key=timestamp, default=None)
        earliest_observation = c.execute('SELECT min(first_observed_at) FROM editorial_progress WHERE story_id=?', (sid,)).fetchone()[0]
        stage = event_grouping.story_stage(items[0]['title'] if items else '')
        return dict(dict(row), first_observed_at=earliest_observation or row['first_observed_at'], latest_fact_at=latest,
                    stage=stage, phase=event_grouping.story_phase(latest, now=now),
                    history_note='从最早收录观察起的有限历史，不代表事件真实起点；最多显示最近150个进展。',
                    progresses=[dict(id=i['id'], event_id=i['event_id'], title=i['title'], summary=i['summary'],
                                     published_at=i['published_at'], first_observed_at=i['first_observed_at'],
                                     publishers=i['publishers'], reasons=i['reasons']) for i in items])

    def story(self, sid):
        self.project()
        with self.db.connect() as c:
            return self._story(c, sid, timestamp(utcnow()))

    def diagnostics(self):
        with self.db.connect() as c:
            row = c.execute('SELECT * FROM editorial_runs ORDER BY generated_at DESC,rowid DESC LIMIT 1').fetchone()
        return dict(version=VERSION, algorithm_versions=algorithm_versions(), weights=RULES['weights'], latest_run=dict(row, data=json.loads(row['data'])) if row else None,
                    limitations=['推荐前校验同稿件版本产业证据；缺失/失败保留待核查，不自动调用模型或补图', '未知转载可能未识别；出处数不等于独立验证',
                                 '新进展归并核对正文数字/动作；历史进展ID不重建，历史误合并不自动拆分',
                                 '仅BBC首页HTML观察版位，其余首页RSS只标精选', '原文全文未另行抓取，不绕付费墙'])
