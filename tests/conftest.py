import pytest
from fastapi.testclient import TestClient

from backend.app import create_app


@pytest.fixture
def app(tmp_path):
    return create_app(tmp_path / 'data', start_worker=False)


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client


def article(**changes):
    value = dict(title='宁德时代前三季度净利润增长20%', content='宁德时代披露前三季度净利润同比增长20%，公司同时说明经营情况及风险。',
                 url='https://news.example.com/a', source='来源甲', published_at='2026-09-01T02:00:00Z', content_level='summary')
    value.update(changes)
    return value


def security(code='300750', name='宁德时代', industry='电气设备', exchange='SZ', **changes):
    row = dict(symbol=f'{exchange}:{code}', code=code, name=name, exchange=exchange, industry=industry,
               status='listed', as_of='2026-09-01T00:00:00Z', source='深圳证券交易所公开 A 股列表（观测时间）',
               _source_url='https://www.szse.cn/api/report/ShowReport?SHOWTYPE=xlsx&CATALOGID=1110&TABKEY=tab1')
    row.update(changes)
    return row


def sections(aid):
    return {name: ([{'text': '输入新闻披露了该事项，仍需核实后续条件。', 'evidence_ids': [aid]}] if name == 'facts' else [])
            for name in ('facts', 'links', 'companies', 'conditions', 'counter_evidence', 'unknowns')}
