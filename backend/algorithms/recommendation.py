"""Evidence-linked selection, scoring and bounded diversity; not probabilities."""
import math
import re
from collections import Counter
from copy import deepcopy
from urllib.parse import urlsplit

from .common import hits, norm, timestamp, snippet
from .registry import VERSIONS
from .industry_association import article_version, binding, VERSION as ASSOCIATION_VERSION

VERSION = VERSIONS['recommendation']


def attribution(article, meta, publishers, *, origin_url=None):
    """A publisher count is never an independent-confirmation claim.

    URL policy is enforced by the caller; this function only records a validated
    optional origin URL and reporting-language evidence.
    """
    value = article['title'] + '\n' + article['content']
    publisher = publishers.get(article['source_id'], article['source'])
    origins = []
    agencies = {'Reuters': ['Reuters', '路透社', '路透'], 'Bloomberg': ['Bloomberg', '彭博社', '彭博'],
                'Associated Press': ['Associated Press', '美联社'], 'AFP': ['Agence France-Presse', 'AFP', '法新社'],
                '新华社': ['新华社', 'Xinhua'], 'Financial Times': ['Financial Times', 'FT', '金融时报'],
                'The Wall Street Journal': ['The Wall Street Journal', 'Wall Street Journal', 'WSJ', '华尔街日报'],
                'The New York Times': ['The New York Times', 'New York Times', 'NYT', '纽约时报']}
    for name, aliases in agencies.items():
        for alias in aliases:
            pattern = (r'(?:(?<![A-Za-z])(?:according to|reported by|reports? from|reporting by|source:|by)|据|援引|来源[：:]?)\s*[《“\"]?' + re.escape(alias)
                       + r'(?![A-Za-z])|(?<![A-Za-z])' + re.escape(alias) + r'[》”\"]?\s*(?:(?:exclusively\s+)?reported|reports|报道|消息|电)'
                       + r'|[（(]\s*' + re.escape(alias) + r'\s*[）)]')
            match = re.search(pattern, value, re.I)
            if alias.casefold() == str(meta.get('origin_name', '')).casefold() or match:
                origins.append(dict(name=name, evidence=match[0] if match else meta['origin_name']))
                break
    if meta.get('origin_name') and not origins:
        origins.append(dict(name=meta['origin_name'], evidence='RSS source: ' + meta['origin_name']))
    claim = re.search(r'^\s*(?:exclusive\s*[:：—-]|exclusive\s+(?:report|interview|investigation))'
                      r'|(?<![A-Za-z])exclusively\s+(?:reported|obtained|learned|revealed)'
                      r'|(?<![A-Za-z])(?:exclusive\s+(?:report|interview|investigation))\b'
                      r'|独家(?:报道|获悉|消息|采访)|(?:本报|本刊|记者)独家(?:了解|得知|获得)', value, re.I)
    reported = re.search(r'(?:according to|据|援引)\s*([^\n,，。:：]{1,55}?)\s*(?:exclusive\s+(?:report|interview)|独家报道|独家获悉)', value, re.I)
    keys = [o['name'].casefold() for o in origins] or ['publisher:' + publisher.casefold()]
    return dict(publisher=publisher, origin_keys=keys, origins=origins,
                identity='attributed_relay' if origins or reported else 'publisher_report_origin_unverified',
                exclusive=bool(claim), exclusive_evidence=snippet(value, claim[0]) if claim else None,
                exclusive_status=('relayed_claim' if origins or reported else 'publisher_claim') if claim else None,
                original_url=origin_url, original_content_fetched=False,
                origin_link_status='provided_not_fetched' if origin_url else 'not_provided',
                reported_exclusive=reported[0] if reported else None)


def importance(article, rules):
    title, lead = article['title'], article['content'][:550]
    focus = title + '\n' + lead
    entities = {key for key, terms in rules['entities'].items() if hits(title, terms)}
    major = entities & {'nvidia', 'microsoft', 'amazon', 'alphabet', 'meta', 'openai', 'tsmc', 'opec'}
    large = bool(re.search(r'(?:\$|US\$|€|£|USD\s*|EUR\s*|GBP\s*)\s*\d+(?:\.\d+)?\s*(?:bn\b|billion\b)'
                           r'|\b\d+(?:\.\d+)?\s*billion\s*(?:dollars|euros|pounds)\b'
                           r'|(?:百亿|千亿|万亿)|\d{3,}(?:\.\d+)?\s*亿元', focus, re.I))
    signals = []
    for rule in rules['importance_rules']:
        headline = hits(title, rule['headline_any'])
        if not headline or any(not hits(focus, group) for group in rule.get('groups', [])):
            continue
        if any(not hits(title, group) for group in rule.get('headline_groups', [])):
            continue
        if rule.get('entities_min', 0) > len(entities - {'nvidia', 'microsoft', 'amazon', 'alphabet', 'meta', 'openai', 'tsmc'}):
            continue
        if rule.get('requires_scale_or_major_entity') and not (major or large):
            continue
        terms = headline[:1] + [hits(focus, group)[0] for group in rule.get('groups', [])]
        signals.append(dict(key=rule['id'], tier=rule['tier'], label=rule['label'],
                            evidence=dict(article_id=article['id'], trigger=' / '.join(dict.fromkeys(terms)), quote=focus[:850]),
                            basis='headline_and_lead_rule'))
    signals.sort(key=lambda signal: -signal['tier'])
    commentary = hits(title, rules['commentary']) or hits(title, rules['analysis_frame'])
    prospective = re.search(r'\b(?:may|might|could|plans? to|planned|proposes?|proposed|expected to|considers?|considering|seeks? to|push for)\b'
                            r'|计划|拟(?:将|投|收购|建)|考虑|预计|可能|或将|提议|寻求', title, re.I)
    mode = 'analysis' if commentary else 'proposal' if prospective else 'reported'
    return dict(tier=signals[0]['tier'] if signals else 0, signals=signals, mode=mode,
                mode_evidence=prospective[0] if prospective else (commentary[0] if commentary else None))


def editorial_exclusions(article, meta, rules):
    title, lead = article['title'], article['content'][:350]
    focus = title + '\n' + lead
    sections = set(filter(None, urlsplit(article['url']).path.casefold().split('/')))
    non_news = sorted(sections & set(rules['non_news_sections']))
    non_news += hits(title, rules['low_relevance'])
    for category in meta.get('categories', []):
        if isinstance(category, str) and (norm(category).replace(' ', '') in {'lifeandstyle', 'artanddesign'} or hits(category, rules['non_news_sections'])):
            non_news.append('RSS category: ' + category)
    exception = hits(title, rules['commercial_exception'])
    reasons = []
    if non_news and not exception:
        reasons.append('体育/文化/生活栏目或内容：' + ', '.join(non_news[:3]))
    routine = next((m[0] for pattern in rules['routine_issuance_patterns'] if (m := re.search(pattern, focus, re.I))), None)
    if routine and not hits(title, rules['issuance_exception']):
        reasons.append('例行债券发行/招标结果，无异常融资事件：' + routine)
    price = next((m[0] for pattern in rules['price_only_patterns'] if (m := re.search(pattern, title, re.I))), None)
    if (price or hits(title, rules['price_recap'])) and not hits(focus, rules['price_fundamental_terms']):
        reasons.append('仅盘中/收盘价格变化，未见新增基本面变量：' + (price or title[:80]))
    return reasons


def association_gate(articles, snapshot, important_article_ids):
    """Consume a caller-owned projection, never infer proof from impact words.

    Both the snapshot and each quotation must bind to exactly these immutable
    current articles. An association ID, graph, node or completed AI essay is
    neither required nor sufficient.
    """
    pending, accepted = [], []
    if not isinstance(snapshot, dict) or snapshot.get('status') != 'complete':
        return dict(status='pending_review', links=[], missing=['产业关联缺失或投影失败'])
    cv = snapshot.get('catalog_version')
    if (not isinstance(cv, str) or not cv or snapshot.get('news_version') != binding(articles, cv)
            or snapshot.get('algorithm_version') != ASSOCIATION_VERSION):
        return dict(status='pending_review', links=[], missing=['产业关联快照版本与当前稿件不符'])
    links = snapshot.get('links')
    if not isinstance(links, list):
        return dict(status='pending_review', links=[], missing=['产业关联列表格式不合格'])
    by_id = {a['id']: a for a in articles}
    generic = {'产业', '行业', '其他', '未知', '经济', '市场', 'industry', 'other', 'unknown', 'economy', 'market'}
    for link in links:
        if not isinstance(link, dict):
            pending.append('产业关联格式不合格')
            continue
        name = link.get('industry_name') or link.get('name')
        reason = link.get('reason') or link.get('mechanism')
        if (not isinstance(link.get('industry_id'), str) or not link['industry_id'].strip()
                or not isinstance(name, str) or not name.strip() or name.strip().casefold() in generic
                or not isinstance(reason, str) or not reason.strip()):
            pending.append('产业身份或关联理由缺失')
            continue
        # Regional/security recall is a thematic hint, not business evidence.
        # Legacy impact/keyword projections must not qualify as associations.
        if (link.get('relation') != 'association'
                or link.get('basis') not in {'source_match', 'ai_association'}
                or (link.get('association_algorithm_version') or link.get('association_version')) != ASSOCIATION_VERSION):
            pending.append('只有旧影响词条/间接主题线索，尚缺可靠产业关联')
            continue
        proof = []
        evidence_items = link.get('evidence')
        if not isinstance(evidence_items, list):
            pending.append('产业关联原文证据格式不合格')
            continue
        for evidence in evidence_items:
            if not isinstance(evidence, dict):
                continue
            article = by_id.get(evidence.get('article_id'))
            quote = evidence.get('quote')
            if (article and article['id'] in important_article_ids
                    and evidence.get('article_version') == article_version(article)
                    and isinstance(quote, str) and quote.strip()
                    and quote in article['title'] + '\n' + article.get('content', '')):
                proof.append(deepcopy(evidence))
        if proof:
            accepted.append(dict(deepcopy(link), evidence=proof))
        else:
            pending.append('关联引文缺失、错引、旧稿或未绑定当前重要事实稿件')
    if not accepted and not pending:
        pending.append('尚无具备原文证据的具体产业关联')
    return dict(status='complete' if accepted else 'pending_review', links=accepted,
                missing=[] if accepted else list(dict.fromkeys(pending)))


def evaluate(features, articles, observations, *, now, fact_at, current_heads, rules, selections,
             association_snapshot=None, previous_recommendations=(), progress_id=None):
    """Quality → substantive importance → current proof → ranking, all explicit."""
    current_ids = {a['id'] for a in articles}
    current_observations = [o for o in observations if o.get('article_id') in current_ids
                            and 0 <= (now - timestamp(o['observed_at'])).total_seconds() <= 6 * 3600]
    age = (now - timestamp(fact_at)).total_seconds() / 3600 if fact_at else None
    blocked = []
    if any(f['exclusion_terms'] for f in features):
        blocked.append('广告/购物/荐股榜单质量门')
    if age is not None and (age < 0 or age > 168):
        blocked.append('来源事实时间不在近7天')
    if age is None and not current_observations:
        blocked.append('缺少可用来源发布时间或新鲜首页观察')
    blocked.extend(dict.fromkeys(reason for f in features for reason in f.get('editorial_exclusions', [])))
    if not current_heads:
        blocked.append('历史稿件已被后续修订取代，保留在持续事件与版本中')
    changes = list(dict.fromkeys(t for f in features for t in f['changes']))
    exclusive = [dict(f['attribution'], article_id=r['id']) for r, f in zip(articles, features) if f['attribution']['exclusive']]
    origins = sorted({key for f in features for key in f['attribution']['origin_keys']})
    channels, reasons, suppression = [], [], []
    # Recheck importance on the supplied immutable text, not stale feature or
    # impact entries. Features still carry explicit quality/attribution facts.
    importance_by_article = {a['id']: importance(a, rules) for a in articles}
    significance = max(importance_by_article.values(), key=lambda i: i['tier'],
                       default=dict(tier=0, signals=[], mode='reported', mode_evidence=None))
    tier = significance['tier']
    catalyst = tier > 0
    if catalyst:
        channels.append('catalyst')
        signal = significance['signals'][0]
        qualifier = {'analysis': '（分析/解读，不当作新发生事实）', 'proposal': '（计划/预期/主张，未确认实施）', 'reported': '（据来源报道，非独立确认）'}[significance['mode']]
        reasons.append(dict(label=signal['label'] + qualifier, evidence=signal['evidence'], basis=signal['basis']))
    selected_feeds = [dict(article_id=r['id'], source_id=r['source_id'], url=r['url']) for r in articles if r['source_id'] in selections]
    if current_observations:
        channels.append('homepage')
        reasons.append(dict(label='媒体首页主区观察', evidence=current_observations[0], basis='observed_layout'))
    elif selected_feeds:
        channels.append('homepage_selection')
        reasons.append(dict(label='媒体首页精选（非版位）', evidence=selected_feeds[0], basis='source_feed_identity'))
    if exclusive:
        channels.append('exclusive')
        reasons.append(dict(label='来源明确独家声明' + ('（二手转述）' if exclusive[0]['exclusive_status'] == 'relayed_claim' else '（未独立核实）'), evidence=exclusive[0], basis='source_claim'))
    if not tier:
        blocked.append('未见实质产业研究重要性；首页/精选/独家不能替代重要事实')
    if not channels:
        blocked.append('未进入重大变化/首页/明确独家任一召回路径')
    quality_blocked = list(blocked)
    gate = association_gate(articles, association_snapshot,
                            {aid for aid, value in importance_by_article.items() if value['tier'] == tier and tier > 0})
    if tier and gate['status'] != 'complete':
        blocked.extend(gate['missing'])
    admission = 'excluded' if quality_blocked else 'pending_review' if gate['status'] != 'complete' else 'selected_candidate'
    for link in gate['links']:
        proof = link['evidence'][0]
        reasons.append(dict(label='产业关联：' + (link.get('industry_name') or link['name']) + '；' +
                                 (link.get('reason') or link['mechanism']),
                            evidence=dict(deepcopy(proof), industry_id=link['industry_id'],
                                          industry_name=link.get('industry_name') or link['name']),
                            basis='current_article_association'))
    article_versions = {a['id']: article_version(a) for a in articles}
    previous = next((record for record in previous_recommendations if progress_id and record.get('id') == progress_id), None)
    correction = any(re.search(r'\b(?:correction|corrects|corrected|retraction)\b|更正|纠正|撤回', a['title'], re.I) for a in articles)
    increment = dict(status=('unchanged' if previous and previous.get('article_versions') == article_versions
                             else 'revised_articles' if previous else 'new_to_selection'),
                     correction=correction, article_versions=article_versions,
                     basis='与调用方提供的此前推荐稿件版本比较；新收录/新版本不等于已核实事实新增')
    w = rules['weights']
    parts = dict(importance=tier * w['importance'], change=w['change'] if catalyst and changes and significance['mode'] == 'reported' else 0,
                 freshness=round(w['freshness'] * math.exp(-max(0, age) / 48), 2) if age is not None else 0,
                 homepage=round(w['homepage'] / math.sqrt(current_observations[0]['position']), 2) if current_observations else 0,
                 selection=w['selection'] if selected_feeds and not current_observations else 0,
                 exclusive=w['exclusive'] if exclusive else 0, origin=min(2, max(0, len(origins) - 1)) * w['origin'])
    if len(origins) > 1:
        suppression.append('多出处只作关注范围信号，不等于独立证实；未归因转载仍可能未识别')
    if significance['mode'] == 'analysis':
        parts['commentary'] = -w['commentary_penalty']
        suppression.append('评论/解读/结构分析降权；不当作新发生冲突')
    if any(f['price_recap'] for f in features):
        parts['price_recap'] = -w['price_penalty']
        suppression.append('纯价格回顾降权')
    return dict(channels=channels, reasons=reasons, exclusive_claims=exclusive, origin_keys=origins,
                homepage_selections=selected_feeds, importance=significance, eligible=not blocked,
                admission_status=admission, association_gate=gate, information_increment=increment,
                time_basis='source_publication' if fact_at else 'homepage_observation' if current_observations else 'unknown',
                algorithm=dict(version=VERSION, rules_version=rules['version'], importance_tier=tier, score=round(sum(parts.values()), 2), parts=parts,
                               excluded=blocked, suppression=suppression, meaning='v1 heuristic; not impact probability'))


def diversify(items, limit, diversity):
    candidates = sorted((deepcopy(i) for i in items if i and i['eligible']), key=lambda i: (-i['algorithm']['score'], i['id']))
    selected, story_counts, publisher_counts, deferred = [], Counter(), Counter(), []
    seen_reports = set()
    while candidates and len(selected) < limit:
        def rerank(item):
            publisher = item['articles'][0]['attribution']['publisher']
            return (item['algorithm']['score'] - diversity['story_penalty'] * min(2, story_counts[item['story']['id']])
                    - min(diversity['publisher_penalty_cap'], diversity['publisher_penalty'] * publisher_counts[publisher]))
        # A story occupancy target only reorders within a tier. It must never
        # replace a significant new update with a lower-tier diversity filler.
        candidates.sort(key=lambda i: (-i['algorithm']['importance_tier'],
                                       story_counts[i['story']['id']] >= diversity['story_limit'],
                                       i.get('information_increment', {}).get('status') == 'unchanged', -rerank(i), i['id']))
        item = candidates.pop(0)
        primary = next((a for a in item['articles'] if a.get('id') == item.get('primary_article_id')), item['articles'][0])
        report = (norm(primary.get('title', item.get('title', ''))),
                  norm(primary.get('content', item.get('summary', ''))))
        if any(report) and report in seen_reports:
            deferred.append(dict(id=item['id'], reason='相同原文的重复转载不重复占位；原稿与修订仍可阅读'))
            continue
        if story_counts[item['story']['id']] >= diversity['story_limit']:
            item['algorithm']['suppression'].append('同层议题分散后保留实质进展，不以低重要性稿替换')
        if any(report):
            seen_reports.add(report)
        item['algorithm']['rerank_score'] = round(rerank(item), 2)
        if story_counts[item['story']['id']]:
            item['algorithm']['suppression'].append('同议题重复占位重排降权')
        selected.append(item)
        story_counts[item['story']['id']] += 1
        publisher_counts[item['articles'][0]['attribution']['publisher']] += 1
    return selected, deferred


def research_score(event, symbols, watch, nodes, industry_by_symbol, adjacency, sources, *, now):
    direct = len(set(symbols) & set(watch))
    watch_industries = {i for s in watch for i in industry_by_symbol.get(s, set())}
    related = sum(bool(industry_by_symbol.get(s, set()) & watch_industries) for s in symbols if s not in watch)
    neighborhood = watch_industries | {n for i in watch_industries for n in adjacency.get(i, set())}
    event_text = event['title'] + '\n' + event['summary']
    mentioned = any(nid in neighborhood and n['kind'] in ('industry', 'product', 'segment') and len(n['label']) >= 2 and n['label'] in event_text for nid, n in nodes.items())
    relevance = min(100, 50 * direct + 20 * related + (15 if mentioned and not direct and not related else 0))
    age = abs((timestamp(now) - timestamp(event['published_at'])).total_seconds()) / 3600 if event['published_at'] else None
    freshness = 0 if age is None else 20 * math.exp(-age / 36)
    return relevance, round(event['importance'] * .55 + relevance * .3 + freshness + min(len(sources), 4) * 2, 2)


def research_hot(items, limit):
    ordered, selected, counts = sorted(items, key=lambda e: (e['score'], e['id']), reverse=True), [], {}
    while ordered and len(selected) < limit:
        best = max(range(len(ordered)), key=lambda i: ordered[i]['score'] - 8 * min((counts.get(s, 0) for s in ordered[i]['source_names']), default=0))
        item = ordered.pop(best)
        selected.append(item)
        for name in item['source_names']:
            counts[name] = counts.get(name, 0) + 1
    return deepcopy(selected)
