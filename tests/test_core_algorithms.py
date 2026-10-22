"""Offline candidates: behavioural boundaries rather than implementation-shaped snapshots."""
import copy
import hashlib
import importlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend.algorithms import algorithm_versions, registry, industry_association
from backend.algorithms.common import hits
from backend.algorithms.event_grouping import merge_safe, same_event, signature_progress, story_rule, story_in_window
from backend.algorithms.industry_transmission import industry_links
from backend.algorithms.recommendation import importance, editorial_exclusions, evaluate, diversify
from backend.algorithms.security_matching import build_matcher, match_symbols

RULES = json.loads((Path(__file__).resolve().parents[1] / 'backend/editorial_rules.json').read_text())
NOW = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)


def article(**changes):
    result = dict(id='article:one', event_id='event:one', source_id='feed', identity_key='identity', source='Example',
                  title='示例集团公司宣布收购目标公司全部业务', content='交易价格为10亿元。',
                  content_level='summary', url='https://example.com/news/one', published_at='2026-10-20T10:00:00Z',
                  fetched_at='2026-10-20T11:00:00Z')
    return dict(result, **changes)


@pytest.mark.parametrize('content', ['交易价格为11亿元。', '交易价格为负十亿元。', '公司否认交易价格为10亿元。', '公司尚未批准交易价格为10亿元。'])
def test_changed_body_facts_are_not_a_same_event(content):
    a, b = article(), article(content=content)
    before = copy.deepcopy((a, b))
    assert not merge_safe(a, b)
    assert not same_event(a, b)
    assert (a, b) == before


def test_english_denial_and_unknown_time_are_not_merge_permissions():
    a = article(title='Example Corporation announces acquisition of Target', content='The deal is approved.')
    assert not same_event(a, dict(a, content='The deal is not approved.'))
    assert not same_event(a, dict(a, published_at=None))
    assert not same_event(a, dict(a, published_at='2026-10-18T00:00:00Z'))
    assert same_event(a, dict(a))


def test_progress_signature_does_not_override_late_body_correction():
    prior = article(content='背景介绍。' * 180 + '交易价格为10亿元。')
    incoming = dict(prior, id='article:two', source_id='another', content='背景介绍。' * 180 + '交易价格为11亿元。')
    candidate = {'fact_at': prior['published_at'], 'event_id': prior['event_id'], 'exact_hash': 'old'}
    assert not signature_progress(incoming, candidate, 'new', False, [prior])
    assert signature_progress(prior, candidate, 'old', True, [prior])


def test_literal_security_identity_not_code_substring():
    securities = [{'symbol': 'SH:600276', 'code': '600276', 'name': '恒瑞医药'},
                  {'symbol': 'SZ:000001', 'code': '000001', 'name': '平安银行'}]
    original = copy.deepcopy(securities)
    matcher = build_matcher(securities)
    assert match_symbols('订单编号16002760，不指认证券', matcher) == []
    assert match_symbols('恒瑞医药发布公告，代码600276', matcher) == ['SH:600276']
    assert match_symbols('平安银行', matcher) == ['SZ:000001']
    assert securities == original


def test_ascii_word_boundaries_and_sports_gate():
    assert not hits('said award metadata', ['AI', 'war', 'Meta'])
    a = article(title='Football club signs player contract worth $1 billion', url='https://example.com/sport/one')
    assert editorial_exclusions(a, {}, RULES)
    a = article(title='2026 results published', content='日期和数字并不自动代表重大经济事件')
    assert importance(a, RULES)['tier'] == 0


def test_transmission_requires_local_substantive_context_and_retains_conditions():
    irrelevant = article(title='Memory supplier signs long term agreement for PCs',
                         content='The agreement covers personal computers. ' + 'Unrelated background. ' * 50 + 'Applications include AI.')
    assert not any(x['industry_id'] == 'ai-compute' and '部署需求' in x['variable'] for x in industry_links(irrelevant, {}, RULES))
    route = article(title='Attack closes Strait of Hormuz shipping route', content='Tankers reroute after disruption.')
    original = copy.deepcopy(route)
    links = industry_links(route, {}, RULES)
    gold = next(x for x in links if x['industry_id'] == 'gold')
    assert gold['relation'] == 'conditional' and gold['condition']
    assert gold['basis'] == 'rule_inference' and all(e['article_id'] == route['id'] for e in gold['evidence'])
    assert not any('confidence' in x for x in links)
    assert route == original and links == industry_links(route, {}, RULES)


def test_missing_publication_needs_actual_fresh_observation_not_feed_order():
    feature = {'exclusion_terms': [], 'editorial_exclusions': [], 'changes': [], 'price_recap': [],
               'importance': {'tier': 0, 'signals': [], 'mode': 'reported'},
               'attribution': {'exclusive': False, 'origin_keys': ['publisher:example']}}
    args = dict(now=NOW, fact_at=None, current_heads=1, rules=RULES, selections=set())
    a = article(published_at=None, title='Small supplier halts production of a critical semiconductor component',
                content='The semiconductor supply chain bottleneck halts production.')
    cv = 'test-catalog'
    args['association_snapshot'] = dict(status='complete', links=industry_association.associate([a], []),
        news_version=industry_association.binding([a], cv), catalog_version=cv, algorithm_version=industry_association.VERSION)
    assert not evaluate([feature], [a], [], **args)['eligible']
    observation = {'article_id': a['id'], 'observed_at': '2026-10-20T11:00:00Z', 'position': 1}
    result = evaluate([feature], [a], [observation], **args)
    assert result['eligible'] and result['time_basis'] == 'homepage_observation'
    # A new slot cannot revive an old known fact.
    assert not evaluate([feature], [a], [observation], **dict(args, fact_at='2026-10-01T00:00:00Z'))['eligible']


def test_diversity_never_promotes_filler_above_importance_and_does_not_mutate():
    def item(i, tier, score, story):
        return {'id': i, 'eligible': True, 'story': {'id': story}, 'articles': [{'attribution': {'publisher': 'Example'}}],
                'algorithm': {'importance_tier': tier, 'score': score, 'suppression': []}}
    candidates = [item('first', 3, 100, 'topic'), item('second', 3, 99, 'topic'), item('filler', 1, 1000, 'other')]
    before = copy.deepcopy(candidates)
    params = {'story_penalty': 4, 'publisher_penalty': 1, 'publisher_penalty_cap': 3, 'story_limit': 1}
    selected, deferred = diversify(candidates, 3, params)
    assert [i['id'] for i in selected] == ['first', 'second', 'filler']
    assert not deferred  # Distinct important updates precede lower-tier fillers even at the topic occupancy target.
    assert candidates == before
    assert (selected, deferred) == diversify(candidates, 3, params)


def test_story_background_is_not_same_fact_and_obeys_bounded_gap():
    a = article()
    feature = {'entities': {}, 'actions': {}}
    assert story_rule(a, feature, RULES)['rule_key'] == 'standalone:event:one'
    candidate = {'earliest': '2026-10-01T00:00:00Z', 'latest': '2026-10-10T00:00:00Z'}
    assert story_in_window('2026-10-12T00:00:00Z', candidate, 2)
    assert not story_in_window('2026-10-12T00:00:01Z', candidate, 2)


def test_industry_identity_helpers_preserve_hashes_without_source_dependencies(monkeypatch):
    for name in ('backend.industry_sources', 'backend.config', 'backend.db', 'backend.adapters'):
        monkeypatch.setitem(sys.modules, name, None)
    from backend import identities
    from backend.algorithms import industry_impact

    importlib.reload(industry_association)
    importlib.reload(industry_impact)
    assert industry_association.key is identities.key
    assert industry_association.version is industry_impact.version is identities.version
    assert identities.key('company-', 'abc') == 'company-ba7816bf8f01cfea414140de'
    assert identities.key('open-', '产业') == 'open-' + hashlib.sha256('产业'.encode()).hexdigest()[:24]
    value = {'z': '产业', 'a': [None, 1.5]}
    expected = hashlib.sha256('{"a": [null, 1.5], "z": "产业"}'.encode()).hexdigest()
    assert identities.version(value) == expected
    assert identities.version({'a': [None, 1.5], 'z': '产业'}) == expected


def test_discovery_versions_are_independent_defensive_copies():
    versions = algorithm_versions()
    versions['event_grouping'] = 'changed'
    assert algorithm_versions()['event_grouping'] == '1.1.0'
    assert {x['id'] for x in registry()['algorithms']} == set(algorithm_versions())
