"""Host-owned, bounded news quality checks. All data and network are disposable."""
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.adapters import Network, PublicData, UpstreamError
from backend.app import create_app
from backend.config import UserError

NOW = datetime.now(timezone.utc).replace(microsecond=0)
STAMP = (NOW - timedelta(hours=1)).isoformat().replace('+00:00', 'Z')


def item(**changes):
    value = dict(title='甲公司发布季度经营数据与项目说明', content='甲公司披露季度营业收入1.2亿元，项目仍在建设，具体进度以公司后续公告为准。',
                 url='https://news.example.com/a', source='来源甲', source_id='alpha', external_id='a-1',
                 published_at=STAMP, content_level='summary')
    value.update(changes)
    return value


@pytest.fixture
def app(tmp_path):
    return create_app(tmp_path / 'news', start_worker=False)


def test_repeat_guid_ignores_timestamp_jitter(app):
    r = app.state.research
    eid = r.ingest(item())
    assert r.ingest(item(published_at=NOW.isoformat())) is None
    assert r.detail(eid)['event']['article_count'] == 1


@pytest.mark.parametrize(('before','after'), [('1.2','12'), ('-5','5')])
def test_numeric_corrections_preserve_versions_and_select_latest(app, before, after):
    r = app.state.research
    eid = r.ingest(item(content=f'季度营收为{before}亿元。其他条件不变。'))
    assert r.ingest(item(content=f'季度营收为{after}亿元。其他条件不变。')) == eid
    detail = r.detail(eid)
    assert len(detail['articles']) == 2
    primary = next(a for a in detail['articles'] if a['id'] == detail['primary_article_id'])
    assert primary['content'] == f'季度营收为{after}亿元。其他条件不变。'


def test_source_scoped_guid_keeps_both_provenances(app):
    r = app.state.research
    eid = r.ingest(item())
    assert r.ingest(item(source='来源乙', source_id='beta', url='https://other.example.com/b')) == eid
    detail = r.detail(eid)
    assert len(detail['articles']) == 2
    assert set(detail['event']['source_names']) == {'来源甲', '来源乙'}


def test_distinct_numeric_facts_do_not_merge_by_shared_title(app):
    r = app.state.research
    first = r.ingest(item())
    other = r.ingest(item(source='来源乙', source_id='beta', external_id='b-2',url='https://other.example.com/b',
                          content='甲公司披露季度营业收入12亿元，项目仍在建设，具体进度以公司后续公告为准。'))
    assert other != first


def test_old_url_reuse_is_new_story_without_guid(app):
    r = app.state.research
    first = r.ingest(item(external_id='', published_at='2024-09-01T00:00:00Z'))
    second = r.ingest(item(external_id='', published_at=STAMP))
    assert first != second and second is not None


def test_unknown_time_is_retained_without_invented_date(app):
    r = app.state.research
    unknown = r.ingest(item(external_id='unknown', url='https://news.example.com/unknown',published_at=None))
    recent = r.ingest(item(external_id='recent', url='https://news.example.com/recent'))
    assert r.detail(unknown)['event']['published_at'] is None
    assert r.detail(unknown)['event']['quality_flags']
    with TestClient(app) as c:
        events = c.get('/api/v1/events',params={'sort':'latest'}).json()['data']
    assert events[0]['id'] == recent


def test_future_time_is_flagged(app):
    r = app.state.research
    eid = r.ingest(item(published_at=(NOW+timedelta(days=7)).isoformat()))
    assert r.detail(eid)['event']['quality_flags']


def test_source_and_content_filters_match_one_article(app):
    r = app.state.research
    eid = r.ingest(item(content_level='full'))
    assert r.ingest(item(source='来源乙',source_id='beta',url='https://other.example.com/b',content_level='summary')) == eid
    with TestClient(app) as c:
        no = c.get('/api/v1/events',params={'source':'来源甲','content_level':'summary'}).json()['data']
        yes = c.get('/api/v1/events',params={'source':'来源乙','content_level':'summary','q':'季度'}).json()['data']
    assert no == []
    assert len(yes) == 1


class Feeds:
    def __init__(self):
        self.html = False
        self.conditional = False
        self.calls = []

    def __call__(self, request):
        self.calls.append((request.url.host, dict(request.headers)))
        host = request.url.host
        if host == 'api-one.wallstcn.com':
            return httpx.Response(200,json={'data':{'items':[{'id':11,'title':'市场交易安排发布新通知','content_text':'交易安排通知明确本周的交易时间安排。',
                'uri':'https://wallstreetcn.com/livenews/11','display_time':int(NOW.timestamp())}]}})
        if host == 'www.chinanews.com.cn' and self.html:
            return httpx.Response(200,text='<html><body>源站维护中</body></html>',headers={'Content-Type':'text/html'})
        if self.conditional and request.headers.get('If-None-Match') == '"news-v1"':
            return httpx.Response(304,headers={'ETag':'"news-v1"'})
        title = '全国工业生产数据公布最新进展' if host == 'www.chinanews.com.cn' else '新型计算芯片发布技术参数'
        content = '各地工业生产平稳推进，数据口径以官方公布内容为准。' if host == 'www.chinanews.com.cn' else '芯片厂商公布产品技术参数，实际量产表现仍需继续观察。'
        rss=f'<rss version="2.0"><channel><title>feed</title><item><title>{title}</title><link>https://{host}/news/1</link><guid>one</guid><pubDate>{format_datetime(NOW)}</pubDate><description>{content}</description></item></channel></rss>'
        return httpx.Response(200,text=rss,headers={'Content-Type':'application/rss+xml','ETag':'"news-v1"'})


def sync(app):
    job=app.state.jobs.enqueue('news')
    assert app.state.jobs.run_one()
    return app.state.db.job(job['id'])


def test_html_200_is_failed_source_while_other_sources_survive(tmp_path):
    feeds=Feeds();feeds.html=True
    app=create_app(tmp_path/'feeds',network=Network(transport=httpx.MockTransport(feeds)),start_worker=False)
    sync(app)
    sources={s['id']:s for s in app.state.db.sources()}
    bad=next(s for s in sources.values() if 'chinanews.com.cn' in s['url'])
    assert bad['status']=='error'
    assert bad['last_success'] is None
    assert bad['last_error']
    assert len(app.state.research.events())==2


def test_conditional_304_keeps_articles_and_source_publication_time(tmp_path):
    feeds=Feeds()
    app=create_app(tmp_path/'feeds',network=Network(transport=httpx.MockTransport(feeds)),start_worker=False)
    assert sync(app)['status']=='succeeded'
    before={s['id']:s.get('latest_published_at') for s in app.state.db.sources()}
    feeds.conditional=True
    for source in app.state.db.sources():
        source['next_retry_at']=(NOW-timedelta(minutes=1)).isoformat()
        app.state.db.source_update(source)
    assert sync(app)['status']=='succeeded'
    assert len(app.state.research.events())==3
    after={s['id']:s.get('latest_published_at') for s in app.state.db.sources()}
    assert before==after
    assert any('if-none-match' in headers for _,headers in feeds.calls)


def test_user_rss_private_url_rejected_before_network():
    calls=[]
    network=Network(transport=httpx.MockTransport(lambda r:calls.append(r) or httpx.Response(200,text='<rss/>')))
    with pytest.raises((UserError, UpstreamError)) as caught:
        PublicData(network).news({'id':'rss:test','name':'test','url':'http://127.0.0.1/private'})
    assert calls==[]
    assert "文档无法解析" not in str(caught.value)


def test_same_url_unrelated_story_is_not_revision(app):
    r=app.state.research
    first=r.ingest(item(external_id=''))
    second=r.ingest(item(external_id='',title='乙公司宣布停止海外工厂建设计划',content='乙公司宣布取消海外工厂扩建，董事会重新评估投资项目。',published_at=NOW.isoformat()))
    assert second and second != first
    assert len(r.detail(first)['articles']) == 1


def test_newer_reversion_creates_third_version_but_old_replay_does_not(app):
    r=app.state.research
    a=item(published_at=(NOW-timedelta(hours=3)).isoformat())
    eid=r.ingest(a)
    b=item(content='甲公司披露季度营业收入12亿元，项目仍在建设，具体进度以公司后续公告为准。',published_at=(NOW-timedelta(hours=2)).isoformat())
    assert r.ingest(b)==eid
    assert r.ingest(a) is None
    assert r.ingest(item())==eid
    detail=r.detail(eid)
    assert len(detail['articles'])==3
    assert detail['articles'][0]['content']==a['content']


def test_retry_after_is_honored_and_bounded(tmp_path):
    feeds=Feeds()
    def limited(req):
        if req.url.host=='www.chinanews.com.cn':
            return httpx.Response(429,headers={'Retry-After':'3600'})
        return feeds(req)
    app=create_app(tmp_path/'limits',network=Network(transport=httpx.MockTransport(limited)),start_worker=False)
    sync(app)
    source=next(s for s in app.state.db.sources() if 'chinanews.com.cn' in s['url'])
    retry=datetime.fromisoformat(source['next_retry_at'].replace('Z','+00:00'))
    assert timedelta(minutes=59) < retry-datetime.now(timezone.utc) <= timedelta(hours=24)
    assert source['status']=='error'
    assert len(app.state.research.events())==2
