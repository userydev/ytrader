import re
import sqlite3
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from backend.research import Research


@pytest.fixture
def symbols_db():
    # Only the tables used by matching/reindexing; no app, workers or disk DB.
    c = sqlite3.connect(':memory:')
    c.row_factory = sqlite3.Row
    c.executescript('''
        CREATE TABLE events(id TEXT PRIMARY KEY);
        CREATE TABLE articles(event_id TEXT, title TEXT, content TEXT);
        CREATE TABLE securities(symbol TEXT PRIMARY KEY, code TEXT, name TEXT);
        CREATE TABLE event_symbols(event_id TEXT, symbol TEXT,
                                   PRIMARY KEY(event_id, symbol));
    ''')
    db = SimpleNamespace(transaction=lambda: c, mark_stale=Mock())
    try:
        yield Research(db), c
    finally:
        c.close()


def add_event(c, eid, title='', content=''):
    c.execute('INSERT INTO events VALUES (?)', (eid,))
    c.execute('INSERT INTO articles VALUES (?,?,?)', (eid, title, content))


def matched(c, eid):
    return {r[0] for r in c.execute('SELECT symbol FROM event_symbols WHERE event_id=?', (eid,))}


@pytest.mark.parametrize('name,code,text,expected', [
    ('宁德时代', '300750', '宁德时代发布公告', True),
    ('宁德时代', '300750', '前缀宁德时代后缀', True),
    ('宁德时代', '300750', '宁德发布公告', False),
    ('宁', '300750', '宁发布公告', False),
    ('', '300750', '证券市场新闻', False),
    ('未提及公司', '300750', '300750', True),
    ('未提及公司', '300750', '（300750）', True),
    ('未提及公司', '300750', 'SZ300750.SZ', True),
    ('未提及公司', '300750', '中300750文', True),
    ('未提及公司', '300750', '300750.5', True),
    ('未提及公司', '300750', '1300750', False),
    ('未提及公司', '300750', '3007500', False),
    ('未提及公司', '300750', '13007500', False),
    ('未提及公司', '300750', '１300750', False),
    ('未提及公司', '300750', '300750١', False),
    ('未提及公司', '300750', '３００７５０', False),
    ('未提及公司', '000001', '000001', True),
    ('未提及公司', '000001', '0000001', False),
    ('未提及公司', '30.750', '30.750', True),
    ('未提及公司', '30.750', '30x750', False),
])
@pytest.mark.parametrize('field', ['title', 'content'])
def test_symbol_name_and_code_boundaries(symbols_db, name, code, text, expected, field):
    research, c = symbols_db
    c.execute('INSERT INTO securities VALUES (?,?,?)', ('SZ:' + code, code, name))
    add_event(c, 'event', **{field: text})

    # The two-argument form is also used during direct news ingestion.
    research._match_symbols(c, 'event')

    assert matched(c, 'event') == ({'SZ:' + code} if expected else set())


def test_matching_keeps_all_event_articles_without_cross_boundary_matches(symbols_db):
    research, c = symbols_db
    c.executemany('INSERT INTO securities VALUES (?,?,?)', [
        ('SZ:300750', '300750', '宁德时代'),
        ('SH:600000', '600000', '浦发银行'),
        ('SZ:123456', '123456', '未提及公司'),
    ])
    add_event(c, 'event', '123', '456')
    c.execute('INSERT INTO articles VALUES (?,?,?)', ('event', '早前报道宁德时代', '600000'))
    add_event(c, 'other', '123456')

    research._match_symbols(c, 'event')

    assert matched(c, 'event') == {'SZ:300750', 'SH:600000'}
    assert matched(c, 'other') == set()


def test_reindex_loads_and_compiles_catalogue_once_per_operation(symbols_db):
    research, c = symbols_db
    # More distinct codes than re's normal 512-entry pattern cache.
    count = 520
    c.executemany('INSERT INTO securities VALUES (?,?,?)', [
        (f'SZ:{100000 + i}', str(100000 + i), f'测试公司{i}') for i in range(count)
    ])
    for i in range(3):
        add_event(c, str(i), '证券市场观察', '100000')
    statements = []
    c.set_trace_callback(statements.append)

    with patch('backend.research.re.compile', wraps=re.compile) as compile_pattern:
        research.reindex_symbols()
        assert compile_pattern.call_count == count
        research.reindex_symbols()
        assert compile_pattern.call_count == count * 2

    assert sum(sql == 'SELECT symbol,code,name FROM securities' for sql in statements) == 2
    for i in range(3):
        assert matched(c, str(i)) == {'SZ:100000'}
    # The second, unchanged reindex must not mark any events stale again.
    assert [call.args[1] for call in research.db.mark_stale.call_args_list] == ['0', '1', '2']


def test_reindex_preserves_links_and_refreshes_after_security_updates(symbols_db):
    research, c = symbols_db
    c.execute('INSERT INTO securities VALUES (?,?,?)', ('SH:600001', '600001', '原公司'))
    add_event(c, 'event', '原公司与新公司公告', '另见600003')
    add_event(c, 'unchanged', '证券市场观察')
    c.execute('INSERT INTO event_symbols VALUES (?,?)', ('unchanged', 'SH:600001'))

    research.reindex_symbols()
    assert matched(c, 'event') == {'SH:600001'}
    assert [call.args[1] for call in research.db.mark_stale.call_args_list] == ['event']
    research.db.mark_stale.reset_mock()

    c.execute('UPDATE securities SET name=? WHERE symbol=?', ('更名公司', 'SH:600001'))
    c.executemany('INSERT INTO securities VALUES (?,?,?)', [
        ('SH:600002', '600002', '新公司'),
        ('SH:600003', '600003', '另一公司'),
    ])
    research.reindex_symbols()

    assert matched(c, 'event') == {'SH:600001', 'SH:600002', 'SH:600003'}
    assert matched(c, 'unchanged') == {'SH:600001'}
    assert [call.args[1] for call in research.db.mark_stale.call_args_list] == ['event']
    research.db.mark_stale.reset_mock()
    research.reindex_symbols()
    research.db.mark_stale.assert_not_called()

    # Direct ingestion must see securities added after a previous matcher ran.
    add_event(c, 'direct', '新公司及600003')
    research._match_symbols(c, 'direct')
    assert matched(c, 'direct') == {'SH:600002', 'SH:600003'}
    c.execute('INSERT INTO securities VALUES (?,?,?)', ('SH:600004', '600004', '最新公司'))
    c.execute('INSERT INTO articles VALUES (?,?,?)', ('direct', '最新公司', ''))
    research._match_symbols(c, 'direct')
    assert matched(c, 'direct') == {'SH:600002', 'SH:600003', 'SH:600004'}
