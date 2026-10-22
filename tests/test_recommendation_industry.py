"""Host-run offline boundaries for recommendation 1.2.0 / association 1.1.0.

No test invokes a model, remote API, graph generation or a live service.
"""
import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend.algorithms import algorithm_versions
from backend.algorithms import industry_association as association
from backend.algorithms import recommendation
from backend.algorithms.features import extract

RULES = json.loads((Path(__file__).resolve().parents[1] / 'backend/editorial_rules.json').read_text())
NOW = datetime(2026, 10, 21, 12, tzinfo=timezone.utc)
STAMP = '2026-10-21T11:00:00Z'
CATALOG = [{'id': 'semiconductors', 'name': '半导体'}, {'id': 'gold', 'name': '黄金'},
           {'id': 'grid', 'name': '电网'}, {'id': 'drugs', 'name': '创新药'}]


def article(**changes):
    value = dict(id='article:current', event_id='event:stable', source_id='single-source',
                 source='Original disclosure', identity_key='stable-guid', external_id='stable-guid',
                 title='Small supplier halts production of a critical component',
                 content='The sole supplier reports a semiconductor supply chain bottleneck. No market share was disclosed.',
                 url='https://example.com/news/disclosure', canonical_url='https://example.com/news/disclosure',
                 content_level='summary', published_at=STAMP, fetched_at=STAMP)
    return dict(value, **changes)


def feature(a):
    attribution = recommendation.attribution(a, {}, {})
    return extract(a, {}, RULES, attribution)


def snapshot(articles, links=None, catalog=CATALOG):
    cv = 'test-catalog-v1'
    return dict(status='complete', catalog_version=cv, news_version=association.binding(articles, cv),
                algorithm_version=association.VERSION,
                links=association.associate(articles, catalog) if links is None else links)


def evaluate(a=None, proof=None, observations=(), **changes):
    a = article() if a is None else a
    args = dict(now=NOW, fact_at=a['published_at'], current_heads=1, rules=RULES,
                selections=set(), association_snapshot=snapshot([a]) if proof is None else proof)
    args.update(changes)
    return recommendation.evaluate([feature(a)], [a], observations, **args)


def test_current_rules_proof_admits_small_single_source_negative_news():
    a = article()
    result = evaluate(a)
    assert result['eligible'] and result['admission_status'] == 'selected_candidate'
    assert result['algorithm']['importance_tier'] == 3
    assert len(result['origin_keys']) == 1
    proof = result['association_gate']['links'][0]
    assert proof['industry_id'] == 'semiconductors'
    assert proof['node_ids'] == [] and proof['relation'] == 'association'
    reason = next(r for r in result['reasons'] if r['basis'] == 'current_article_association')
    assert reason['evidence']['industry_name'] == '半导体'
    assert reason['evidence']['quote'] in a['title'] + '\n' + a['content']
    assert reason['evidence']['article_version'] == association.article_version(a)
    assert 'market share' in a['content']  # Unknown scale is not replaced with an invented estimate.


@pytest.mark.parametrize('defect', ['missing', 'failed', 'snapshot', 'algorithm', 'article_version',
                                    'wrong_article', 'wrong_quote', 'blank_reason', 'generic', 'legacy_impact'])
def test_major_candidates_without_current_exact_proof_are_pending(defect):
    a = article()
    proof = snapshot([a])
    link = proof['links'][0]
    if defect == 'missing':
        proof['links'] = []
    elif defect == 'failed':
        proof['status'] = 'failed'
    elif defect == 'snapshot':
        proof['news_version'] = 'old-snapshot'
    elif defect == 'algorithm':
        link['association_version'] = '1.0.0'
    elif defect == 'article_version':
        link['evidence'][0]['article_version'] = 'old-article'
    elif defect == 'wrong_article':
        link['evidence'][0]['article_id'] = 'article:superseded'
    elif defect == 'wrong_quote':
        link['evidence'][0]['quote'] = 'This claim does not occur in the immutable article.'
    elif defect == 'blank_reason':
        link['mechanism'] = ' '
    elif defect == 'generic':
        link['industry_name'] = link['name'] = '市场'
    else:
        link['basis'] = 'rule_inference'
        link['relation'] = 'conditional'
    f = feature(a)
    # An attractive old impact feature must never provide an admission fallback.
    f['industry_links'] = [{'industry_id': 'gold', 'name': '黄金', 'variable': '旧影响词条'}]
    result = recommendation.evaluate([f], [a], [], now=NOW, fact_at=STAMP, current_heads=1,
                                     rules=RULES, selections=set(), association_snapshot=proof)
    assert not result['eligible']
    assert result['admission_status'] == 'pending_review'
    assert result['importance']['tier'] == 3
    assert result['association_gate']['status'] == 'pending_review'
    assert result['algorithm']['excluded']


def test_quote_that_survives_a_revision_does_not_revive_old_proof():
    old = article()
    revised = dict(old, content=old['content'] + ' Correction: the affected product has not been verified.')
    proof = snapshot([revised], snapshot([old])['links'])
    # Even the same ID and still-literal quote cannot bypass the content hash.
    assert proof['links'][0]['evidence'][0]['quote'] in revised['title'] + '\n' + revised['content']
    assert evaluate(revised, proof)['admission_status'] == 'pending_review'
    assert not evaluate(revised, snapshot([old]))['eligible']


def test_proof_cannot_be_borrowed_from_an_unrelated_current_article():
    important = article(content='The sole supplier confirms a supply chain bottleneck without naming a product.')
    unrelated = article(id='article:other', title='Semiconductor glossary', content='An introductory definition of semiconductor.')
    result = recommendation.evaluate([feature(important), feature(unrelated)], [important, unrelated], [],
        now=NOW, fact_at=STAMP, current_heads=2, rules=RULES, selections=set(),
        association_snapshot=snapshot([important, unrelated]))
    assert result['admission_status'] == 'pending_review'


@pytest.mark.parametrize('title', ['Political candidate confronts critics as attacks ramp up',
                                  'Exclusive: politician explains a personal dispute'])
def test_homepage_first_selection_and_exclusive_cannot_create_importance(title):
    a = article(title=title, content='The interview mentions gold as a colour, without an economic change.')
    observation = dict(article_id=a['id'], observed_at=STAMP, position=1)
    result = evaluate(a, observations=[observation], selections={a['source_id']})
    assert result['importance']['tier'] == result['algorithm']['importance_tier'] == 0
    assert 'homepage' in result['channels']
    assert not result['eligible'] and result['admission_status'] == 'excluded'


def test_country_company_and_ambiguous_transformer_do_not_create_business_proof():
    catalog = [{'id': 'grid', 'name': '电网', 'aliases': ['transformer', 'China', 'Nvidia']}]
    a = article(title='China and Nvidia discuss a transformer architecture', content='A conversation, no power equipment business.')
    assert association.associate([a], catalog) == []
    political_risk = article(title='Iran military missile attack kills civilians', content='Officials describe a military attack.')
    links = association.associate([political_risk], [])
    assert links and all(i['basis'] == 'regional_security_theme' for i in links)
    assert evaluate(political_risk, snapshot([political_risk], links))['admission_status'] == 'pending_review'
    sudan = article(title='Sudan military drone attack kills civilians at market', content='Military officials report an attack.')
    assert not evaluate(sudan)['eligible']  # Not a ban on risk; no business proof was provided.


@pytest.mark.parametrize(('term', 'name'), [('gold mine', '黄金'), ('金矿', '黄金'),
    ('power transformers', '电网'), ('变电站', '电网'), ('clinical trial', '创新药'), ('三期临床', '创新药')])
def test_fixed_focus_bilingual_business_vocabulary(term, name):
    a = article(title='Business update', content='The disclosure concerns ' + term + '.')
    links = association.associate([a], CATALOG)
    link = next(i for i in links if i['name'] == name)
    assert link['relation'] == 'association' and link['node_ids'] == []
    assert link['evidence'][0]['article_version'] == association.article_version(a)
    assert link['evidence'][0]['quote'] in a['title'] + '\n' + a['content']


def test_unmaintained_open_industry_and_drug_failure_are_not_disfavoured():
    enzyme = article(content='The sole supplier reports an industrial enzyme supply chain bottleneck.')
    links = association.validate_model({'industries': [dict(name='工业酶', article_id=enzyme['id'],
        quote=enzyme['content'], reason='关键工业酶供给中断；具体份额未知，尚无维护图。')]}, [enzyme], [])
    assert links[0]['industry_id'].startswith('open-')
    assert evaluate(enzyme, snapshot([enzyme], links))['eligible']
    assert links[0]['industry_id'] == association.resolve('工业酶', [])
    # A directory outside the five maintained chains also qualifies by rules.
    custom = [{'id': 'enzymes-unmaintained', 'name': '工业酶', 'aliases': ['industrial enzyme']}]
    assert evaluate(enzyme, snapshot([enzyme], catalog=custom))['eligible']
    drug = article(title='Small biotech drug fails pivotal clinical trial',
                   content='The phase III clinical trial failed its primary endpoint. No revenue estimate was disclosed.')
    assert evaluate(drug)['eligible']
    assert evaluate(drug)['importance']['tier'] == 3


def test_proposal_implementation_analysis_and_correction_remain_distinct():
    plan = article(title='Microsoft plans to invest $10 billion in GPU data center capex',
                   content='The proposed spending remains subject to approval.')
    implemented = article(title='Microsoft invests $10 billion in GPU data center capex',
                          content='The company signed the contract and announced spending.')
    analysis = article(title='Analysis: Microsoft invests $10 billion in GPU data center capex',
                       content='An analysis of the announced spending, not another completed investment.')
    correction = article(title='Correction: power grid production capacity data revised',
                         content='The operator corrects the previously reported capacity; the plant is not in service.')
    p, i, a, c = [evaluate(x) for x in (plan, implemented, analysis, correction)]
    assert all(x['eligible'] for x in (p, i, a, c))
    assert [x['importance']['mode'] for x in (p, i, a)] == ['proposal', 'reported', 'analysis']
    assert p['algorithm']['parts']['change'] == a['algorithm']['parts']['change'] == 0
    assert i['algorithm']['parts']['change'] > 0
    assert a['algorithm']['parts']['commentary'] < 0
    assert c['importance']['signals'][0]['key'] == 'industrial-correction'


def selection_item(a, identity, tier, score, story='topic'):
    a = dict(a, attribution=dict(publisher=a['source']))
    return dict(id=identity, eligible=True, primary_article_id=a['id'], articles=[a], story=dict(id=story),
                algorithm=dict(importance_tier=tier, score=score, suppression=[]))


def test_reprints_do_not_take_slots_and_diversity_never_crosses_tiers():
    a = article()
    reprint = article(id='article:relay', source='Same original via relay')
    corrected = article(id='article:correction', title='Correction: critical component supply interruption',
                        content='The sole supplier corrected the semiconductor output figure.')
    candidates = [selection_item(a, 'a', 3, 90), selection_item(reprint, 'b', 3, 89),
                  selection_item(corrected, 'c', 3, 88),
                  selection_item(article(id='article:filler', title='Gold production data', content='New data.'),
                                 'z', 1, 1000, 'other')]
    before = copy.deepcopy(candidates)
    diversity = dict(story_penalty=4, publisher_penalty=1, publisher_penalty_cap=3, story_limit=1)
    selected, deferred = recommendation.diversify(candidates, 3, diversity)
    assert [i['id'] for i in selected] == ['a', 'c', 'z']
    assert [i['id'] for i in deferred] == ['b']
    assert candidates == before
    assert recommendation.diversify(candidates, 3, diversity) == (selected, deferred)


def test_pure_explicit_inputs_stable_id_and_defensive_outputs(monkeypatch):
    a = article()
    proof = snapshot([a])
    proof['links'][0]['association_id'] = 'association:historical-identity'
    before = copy.deepcopy((a, proof))

    def forbidden(*args, **kwargs):
        raise AssertionError('Pure recommendation must not perform IO or consult a clock')

    import builtins
    import socket
    monkeypatch.setattr(builtins, 'open', forbidden)
    monkeypatch.setattr(socket, 'socket', forbidden)
    result = evaluate(a, proof)
    assert result == evaluate(a, proof)
    assert (a, proof) == before
    assert result['association_gate']['links'][0]['association_id'] == 'association:historical-identity'
    result['association_gate']['links'][0]['evidence'][0]['quote'] = 'mutated output'
    assert (a, proof) == before
    assert algorithm_versions()['recommendation'] == '1.2.0'
    assert algorithm_versions()['industry_association'] == '1.1.0'
    assert association.binding([a], 'catalog') != association.binding([dict(a, content='revision')], 'catalog')


@pytest.fixture
def editorial_store(tmp_path, monkeypatch):
    from backend.db import Database
    from backend.editorial import Editorial
    from backend.research import Research
    monkeypatch.setattr('backend.editorial.utcnow', lambda: '2026-10-21T12:00:00Z')
    monkeypatch.setattr('backend.news.utcnow', lambda: STAMP)
    db = Database(tmp_path / 'disposable.sqlite')
    return db, Research(db), Editorial(db)


class Projection:
    """Read-only stand-in: only the projection capability is permitted."""
    def __init__(self, links=None, failure=False):
        self.links, self.failure, self.calls = links, failure, []

    def projection(self, articles, impacts):
        self.calls.append(copy.deepcopy(articles))
        if self.failure:
            raise RuntimeError('provider failure must not escape or become admission')
        proof = snapshot(articles, self.links)
        return proof['links'], impacts, proof['news_version'], proof['catalog_version']


def test_feed_projects_before_selection_rules_complete_without_long_analysis(editorial_store, monkeypatch):
    db, research, editorial = editorial_store
    eid = research.ingest(article())
    provider = Projection()
    editorial.industry_research = provider
    original = recommendation.diversify

    def checked(items, limit, diversity):
        assert provider.calls  # Projection happened before ranking, not only for displayed items.
        assert all(i['association_status'] == 'complete' for i in items if i['eligible'])
        return original(items, limit, diversity)

    monkeypatch.setattr(recommendation, 'diversify', checked)
    feed = editorial.feed()
    assert len(feed['items']) == 1
    item = feed['items'][0]
    assert item['event_id'] == eid
    assert item['association_status'] == 'complete'
    assert item['analysis_status'] == 'not_analyzed'
    assert item['association_gate']['links']
    assert db.get('industry_tracking') is None
    with db.connect() as c:
        assert c.execute('SELECT count(*) FROM jobs').fetchone()[0] == 0
        assert c.execute('SELECT count(*) FROM analyses').fetchone()[0] == 0


def test_projection_failure_retains_major_pending_audit_and_readable_history(editorial_store):
    db, research, editorial = editorial_store
    eid = research.ingest(article())
    editorial.industry_research = Projection(failure=True)
    feed = editorial.feed()
    assert feed['items'] == []
    audit = editorial.diagnostics()['latest_run']['data']
    assert len(audit['pending']) == 1 and audit['excluded'] == []
    pending = audit['pending'][0]
    assert pending['event_id'] == eid and pending['importance']['tier'] == 3
    assert pending['association_gate']['projection_status'] == 'failed'
    detail = editorial.detail(eid)
    assert detail['articles'] and detail['current']['association_status'] == 'pending_review'
    assert detail['current']['analysis_status'] != 'complete'


def test_revision_rejects_old_quote_and_reprojection_preserves_identities(editorial_store):
    db, research, editorial = editorial_store
    old_input = article()
    eid = research.ingest(old_input)
    first = editorial.feed()['items'][0]
    old_links = copy.deepcopy(first['industry_associations'])
    old_article_id = first['primary_article_id']
    revised = article(content='Correction: the sole supplier halted production of a critical component. Product identity remains unknown.')
    assert research.ingest(revised) == eid
    provider = Projection(links=old_links)
    editorial.industry_research = provider
    assert editorial.feed()['items'] == []
    assert all(old_article_id not in {a['id'] for a in call} for call in provider.calls)
    assert editorial.diagnostics()['latest_run']['data']['pending']
    detail = editorial.detail(eid)
    assert old_article_id in {a['id'] for a in detail['articles']}
    assert detail['current']['primary_article_id'] != old_article_id

    def identities():
        with db.connect() as c:
            return {table: [tuple(r) for r in c.execute(query)] for table, query in {
                'events': 'SELECT id FROM events ORDER BY id',
                'articles': 'SELECT id,event_id FROM articles ORDER BY id',
                'stories': 'SELECT id FROM editorial_stories ORDER BY id',
                'progress': 'SELECT id,story_id,event_id FROM editorial_progress ORDER BY id',
                'membership': 'SELECT article_id,progress_id FROM editorial_articles ORDER BY article_id',
            }.items()}

    before = identities()
    with db.transaction() as c:
        c.execute("UPDATE editorial_articles SET version='old-projection-version'")
    editorial.project()
    assert identities() == before
    assert editorial.feed()['items'] == []


@pytest.mark.parametrize('excluded_kind', ['unimportant', 'expired', 'quality'])
def test_feed_cheap_exclusions_never_invoke_directory_projection(editorial_store, excluded_kind):
    _, research, editorial = editorial_store
    if excluded_kind == 'unimportant':
        incoming = article(title='Semiconductor terminology overview',
                           content='A glossary of semiconductor terminology, without a reported change.',
                           homepage=dict(observed_at=STAMP, position=1, page_url='https://example.com/',
                                         edition='test edition', kind='homepage'))
    elif excluded_kind == 'expired':
        # Substantive importance and business terms do not override the age gate.
        incoming = article(published_at='2026-10-01T11:00:00Z')
    else:
        # Both important and industry-related, but explicitly promotional.
        incoming = article(title='Best stocks to buy: small supplier halts production of a critical component')
    research.ingest(incoming)
    provider = Projection(failure=True)
    editorial.industry_research = provider
    feed = editorial.feed()
    assert provider.calls == []  # Neither directory scanning nor projection is needed.
    assert feed['items'] == []
    audit = editorial.diagnostics()['latest_run']['data']
    assert audit['pending'] == []
    assert len(audit['excluded']) == 1
    assert audit['scanned'] == 1


def test_feed_projects_all_important_candidates_before_limit_and_keeps_missing_pending(editorial_store, monkeypatch):
    _, research, editorial = editorial_store
    for index in range(3):
        content = ('The sole supplier reports a semiconductor supply chain bottleneck.' if index < 2
                   else 'The sole supplier reports a supply chain bottleneck; the product identity is unknown.')
        research.ingest(article(source_id=f'disclosure-{index}', external_id=f'guid-{index}',
                               url=f'https://example.com/news/disclosure-{index}',
                               content=content + f' Reported output is {index + 10} units.'))
    provider = Projection()
    editorial.industry_research = provider
    original = recommendation.diversify

    def checked(items, limit, diversity):
        # Not "select one, then project": even unselected important candidates
        # must be checked, and the one without proof must survive in pending.
        assert limit == 1
        assert len(provider.calls) == 3
        assert sum(i['eligible'] for i in items) == 2
        assert sum(i['admission_status'] == 'pending_review' for i in items) == 1
        return original(items, limit, diversity)

    monkeypatch.setattr(recommendation, 'diversify', checked)
    feed = editorial.feed(limit=1)
    assert len(feed['items']) == 1
    assert feed['items'][0]['association_status'] == 'complete'
    audit = editorial.diagnostics()['latest_run']['data']
    assert len(audit['pending']) == 1
    assert audit['pending'][0]['importance']['tier'] == 3
    assert audit['pending'][0]['association_gate']['projection_status'] == 'complete'
    assert audit['pending'][0]['association_gate']['status'] == 'pending_review'
    assert audit['excluded'] == []


def test_feed_skips_superseded_progress_projection_but_retains_readable_history(editorial_store):
    db, research, editorial = editorial_store
    old = article(content='The sole supplier reports a semiconductor supply chain bottleneck; output is 10 units.')
    eid = research.ingest(old)
    editorial.project()
    with db.connect() as c:
        old_article_id = c.execute('SELECT id FROM articles WHERE event_id=?', (eid,)).fetchone()[0]
        old_progress_id = c.execute('SELECT progress_id FROM editorial_articles WHERE article_id=?',
                                    (old_article_id,)).fetchone()[0]
    assert research.ingest(dict(old, content=old['content'].replace('10 units', '11 units'))) == eid
    provider = Projection()
    editorial.industry_research = provider
    feed = editorial.feed()
    assert len(provider.calls) == 1
    assert all(a['id'] != old_article_id for call in provider.calls for a in call)
    assert len(feed['items']) == 1
    audit = editorial.diagnostics()['latest_run']['data']
    assert any(item['id'] == old_progress_id for item in audit['excluded'])
    assert audit['pending'] == []
    assert old_article_id in {a['id'] for a in editorial.detail(eid)['articles']}
