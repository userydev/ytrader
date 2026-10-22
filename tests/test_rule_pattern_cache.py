"""Rule-pattern caching must preserve the original literal matching semantics."""
import re
from unittest.mock import patch

import pytest

from backend.algorithms import common


def original_matches(value, term):
    if re.search(r'[A-Za-z]', term):
        return re.search(r'(?<![A-Za-z0-9_])' + re.escape(term) + r'(?![A-Za-z0-9_])', value, re.I)
    return re.search(re.escape(term), value, re.I)


@pytest.fixture(autouse=True)
def isolated_pattern_cache():
    common._rule_pattern.cache_clear()
    yield
    common._rule_pattern.cache_clear()


@pytest.mark.parametrize('value, term, expected_span', [
    ('中国芯片产业芯片', '芯片', (2, 4)),
    ('没有相关内容', '芯片', None),
    ('支持ai算力', 'AI', (2, 4)),
    ('said award metadata', 'AI', None),
    ('said award metadata', 'war', None),
    ('said award metadata', 'Meta', None),
    ('9AI', 'AI', None),
    ('AI9', 'AI', None),
    ('_AI', 'AI', None),
    ('AI_', 'AI', None),
    ('éAIé', 'AI', (1, 3)),
    ('１AI２', 'AI', (1, 3)),
    ('(mEtA)', 'Meta', (1, 5)),
    ('Use C++ today', 'C++', (4, 7)),
    ('Use C++17 today', 'C++', None),
    ('axb a.b', 'a.b', (4, 7)),
    ('[ai]', '[AI]', (0, 4)),
    ('x[AI]', '[AI]', None),
    ('价格上涨(确认)', '上涨(确认)', (2, 8)),
    ('编号16002760', '600276', (3, 9)),
    ('第１２３期', '123', None),
    ('数值 12.3', '12.3', (3, 7)),
    ('前_后', '_', (1, 2)),
    ('符号 .* 完整', '.*', (3, 5)),
    ('K', 'K', (0, 1)),
    ('İ', 'i', (0, 1)),
    ('任意内容', '', (0, 0)),
])
def test_matches_preserves_original_span_and_group(value, term, expected_span):
    expected = original_matches(value, term)
    actual = common.matches(value, term)
    if expected_span is None:
        assert expected is None
        assert actual is None
    else:
        assert isinstance(actual, re.Match)
        assert actual.span() == expected.span() == expected_span
        assert actual.group() == expected.group()
        assert actual.groups() == expected.groups()
        assert actual.string == value


def test_hits_preserves_input_order_and_duplicates():
    value = '芯片支持 ai，Meta 编号16002760；a.b'
    terms = ['Meta', 'AI', '不存在', 'AI', '600276', '芯片', 'a.b']
    expected = [term for term in terms if original_matches(value, term)]
    assert common.hits(value, terms) == expected
    assert expected == ['Meta', 'AI', 'AI', '600276', '芯片', 'a.b']


@pytest.mark.parametrize('value, term', [
    ('  前文' * 40 + ' ai ' + '后文 ' * 70, 'AI'),
    ('  芯片新闻  ', '芯片'),
    ('没有命中', 'AI'),
    ('  空词  ', ''),
])
def test_snippet_preserves_original_position_and_trimming(value, term):
    match = original_matches(value, term)
    expected = value[max(0, match.start() - 70):match.end() + 110].strip() if match else ''
    assert common.snippet(value, term) == expected


def test_repeated_terms_compile_once_beyond_global_regex_cache_capacity():
    terms = [f'rule_{index:04d}' for index in range(1024)]
    with patch.object(common.re, 'compile', wraps=re.compile) as compile_pattern:
        for term in terms:
            assert common.matches(f'({term.upper()})', term).group() == term.upper()
        assert compile_pattern.call_count == len(terms)

        # Reverse the result on a different article: only patterns are cached.
        for term in terms:
            assert common.matches('no matching rule here', term) is None
        assert compile_pattern.call_count == len(terms)

    info = common._rule_pattern.cache_info()
    assert info.misses == len(terms)
    assert info.hits == len(terms)
    assert info.currsize == len(terms)


def test_pattern_cache_is_bounded_and_evicts_old_terms():
    capacity = common._rule_pattern.cache_info().maxsize
    assert capacity == 8192
    for index in range(capacity + 1):
        assert common.matches('', f'bounded_rule_{index}') is None
        assert common._rule_pattern.cache_info().currsize <= capacity

    before = common._rule_pattern.cache_info()
    assert before.currsize == capacity
    assert before.misses == capacity + 1
    assert common.matches('bounded_rule_0', 'bounded_rule_0').group() == 'bounded_rule_0'
    after = common._rule_pattern.cache_info()
    assert after.misses == before.misses + 1
    assert after.currsize == capacity
