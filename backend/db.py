from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from threading import RLock

from .models import utcnow

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL,
 published_at TEXT, updated_at TEXT NOT NULL, importance REAL NOT NULL, tags TEXT NOT NULL,
 analysis_status TEXT NOT NULL DEFAULT 'not_analyzed');
CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
 title TEXT NOT NULL, content TEXT NOT NULL, url TEXT NOT NULL, canonical_url TEXT NOT NULL,
 source TEXT NOT NULL, published_at TEXT, fetched_at TEXT NOT NULL, content_level TEXT NOT NULL,
 revision_kind TEXT NOT NULL, fingerprint TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS article_identity ON articles(canonical_url,source,fingerprint,published_at,title);
CREATE INDEX IF NOT EXISTS article_event ON articles(event_id);
CREATE INDEX IF NOT EXISTS article_fingerprint ON articles(fingerprint);
CREATE TABLE IF NOT EXISTS event_symbols(event_id TEXT NOT NULL REFERENCES events(id), symbol TEXT NOT NULL,
 PRIMARY KEY(event_id,symbol));
CREATE TABLE IF NOT EXISTS securities(symbol TEXT PRIMARY KEY,code TEXT NOT NULL,name TEXT NOT NULL,
 exchange TEXT NOT NULL,industry TEXT,status TEXT NOT NULL,as_of TEXT,source TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS security_exchange ON securities(exchange);
CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS edges(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS packages(id TEXT PRIMARY KEY,version TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analyses(event_id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS company_profiles(symbol TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS company_fundamentals(symbol TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS company_analyses(symbol TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS industry_results(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 industry_id TEXT NOT NULL,result_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS industry_result_lookup ON industry_results(industry_id,sequence);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,
 progress REAL NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,active_key TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS job_active ON jobs(active_key) WHERE active_key IS NOT NULL;
CREATE VIRTUAL TABLE IF NOT EXISTS event_fts USING fts5(event_id UNINDEXED,title,body,tokenize='trigram');
"""


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


class Database:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = RLock()
        with self.connect() as c:
            c.executescript(SCHEMA)
            c.execute('BEGIN IMMEDIATE')
            from .news import migrate_news
            migrate_news(c)
            from .editorial import migrate_editorial, editorial_sources
            migrate_editorial(c)
            defaults = [
                dict(id='chinanews-finance', name='中国新闻网财经', url='https://www.chinanews.com.cn/rss/finance.xml', coverage='官方财经 RSS，非完整历史', content_level='summary', enabled=True, status='never_synced', last_success=None, last_error=None, capabilities=['news', 'rss'], paid=False),
                dict(id='ithome', name='IT之家', url='https://www.ithome.com/rss/', coverage='官方 RSS；description 为来源摘要/源提供正文，不标作全文', content_level='summary', enabled=True, status='never_synced', last_success=None, last_error=None, capabilities=['news', 'rss'], paid=False),
                dict(id='wallstreetcn', name='华尔街见闻公开快讯', url='https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=100', coverage='公开财经快讯，非完整历史', content_level='summary', enabled=True, status='never_synced', last_success=None, last_error=None, capabilities=['news'], paid=False),
                dict(id='ifind', name='iFinD（未接入）', url='https://www.51ifind.com/', coverage='需独立商业授权，首版不提供连接器', content_level='title', enabled=False, status='disabled', last_success=None, last_error=None, capabilities=['licensed_news', 'licensed_securities'], paid=True),
            ]
            # Explicit opt-in, separate data directory: the existing 58710 registry
            # and refresh behavior are unchanged unless the host enables this draft.
            if os.environ.get('YTRADER_EDITORIAL') == '1':
                defaults.extend(editorial_sources())
            for source in defaults:
                c.execute('INSERT OR IGNORE INTO sources VALUES (?,?)', (source['id'], dump(source)))
        os.chmod(self.path, 0o600)

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path, timeout=15)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('PRAGMA busy_timeout=15000')
        try:
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    @contextmanager
    def transaction(self):
        with self.lock, self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            yield c

    def get(self, key, default=None):
        with self.connect() as c:
            row = c.execute('SELECT value FROM kv WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key, value):
        with self.transaction() as c:
            c.execute('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, dump(value)))

    def sources(self):
        with self.connect() as c:
            return [json.loads(r[0]) for r in c.execute('SELECT data FROM sources ORDER BY id')]

    def source_update(self, source):
        with self.transaction() as c:
            c.execute('INSERT INTO sources VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (source['id'], dump(source)))

    def source_merge(self, sid, changes):
        """Merge fetch metadata without overwriting a concurrent enabled change."""
        with self.transaction() as c:
            row = c.execute('SELECT data FROM sources WHERE id=?', (sid,)).fetchone()
            if not row:
                return None
            source = json.loads(row[0])
            source.update(changes)
            c.execute('UPDATE sources SET data=? WHERE id=?', (dump(source), sid))
        return source

    def mark_stale(self, c, event_id):
        row = c.execute('SELECT data FROM analyses WHERE event_id=?', (event_id,)).fetchone()
        if row:
            data = json.loads(row[0])
            data['status'] = 'stale'
            c.execute('UPDATE analyses SET data=? WHERE event_id=?', (dump(data), event_id))
            c.execute("UPDATE events SET analysis_status='stale' WHERE id=?", (event_id,))

    def refresh_fts(self, c, event_id):
        event = c.execute('SELECT title FROM events WHERE id=?', (event_id,)).fetchone()
        body = '\n'.join(r[0] for r in c.execute('SELECT content FROM articles WHERE event_id=?', (event_id,)))
        c.execute('DELETE FROM event_fts WHERE event_id=?', (event_id,))
        c.execute('INSERT INTO event_fts VALUES (?,?,?)', (event_id, event['title'], body))

    def job(self, job_id):
        with self.connect() as c:
            row = c.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        return public_job(row) if row else None


def public_job(row):
    job = {key: row[key] for key in ('id', 'kind', 'status', 'progress', 'message', 'created_at', 'updated_at')}
    payload = json.loads(row['payload'])
    if row['kind'] in ('industry_generate', 'industry_supplement'):
        from urllib.parse import quote
        job.update(subject_label=payload.get('name', '产业解释'),
                   target_url='/chain?industry_id=' + quote(payload['industry_id'], safe=''))
    return job
