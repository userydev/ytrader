"""Conservative event/progress/story decisions over supplied snapshots only."""
import re
from datetime import timedelta
from difflib import SequenceMatcher

from .common import hits, norm, timestamp
from .registry import VERSIONS

VERSION = VERSIONS['event_grouping']

DEFAULTS = {'merge_hours': 36, 'rewrite_hours': 12, 'rewrite_overlap': .6, 'similarity': .9}


def normalized(value):
    return re.sub(r'[^\w\u4e00-\u9fff]', '', value).lower()


def hours(a, b):
    if not a or not b:
        return None
    return abs((timestamp(a) - timestamp(b)).total_seconds()) / 3600


def merge_safe(article, candidate, names=(), *, parameters=None):
    p = DEFAULTS if parameters is None else dict(DEFAULTS, **parameters)
    age = hours(article['published_at'], candidate['published_at'])
    if age is None or age > p['merge_hours']:
        return False
    a, b = article['title'], candidate['title']
    body_a, body_b = a + '\n' + article['content'], b + '\n' + candidate['content']
    numbers = lambda s: re.findall(r'[+\-−]?\d+(?:[.,]\d+)*(?:%|％|亿元|万元|万吨|万股|元)?|[负正]?[零〇一二三四五六七八九十百千万亿两点]+(?:成|亿元|万元|万吨|万股|元)', s)
    if numbers(body_a) != numbers(body_b):
        return False
    actions = lambda s: {x for x in ('收购', '减持', '增持', '签约', '投产', '停产', '涨价', '降价', '上调', '下调', '澄清', '否认', '更正', '不实', '增长', '下降', '上涨', '下跌', '增加', '减少', '亏损', '盈利', '批准', '取消', '终止', '恢复', '暂停', '未', '不', '无', '拟', '已') if x in s}
    if actions(body_a) != actions(body_b):
        return False
    # English denial/direction was previously invisible to the Chinese gate.
    english = lambda s: {w.casefold() for w in re.findall(r'\b(?:not|no|never|denies|denied|denial|false|correction|corrected|increase|increases|decrease|decreases|approved|cancelled|canceled)\b', s, re.I)}
    if english(body_a) != english(body_b):
        return False
    matched = lambda title: {name for name in names if len(name) >= 2 and name in title}
    ea, eb = matched(a), matched(b)
    return not (ea or eb) or ea == eb


def same_event(article, candidate, names=(), *, parameters=None):
    p = DEFAULTS if parameters is None else dict(DEFAULTS, **parameters)
    age = hours(article['published_at'], candidate['published_at'])
    if not merge_safe(article, candidate, names, parameters=p):
        return False
    a, b = normalized(article['title']), normalized(candidate['title'])
    if len(a) >= 12 and a == b:
        return True
    entities = lambda s: set(re.findall(r'《([^》]+)》|【([^】]+)】|([\u4e00-\u9fff]{2,12}(?:公司|集团|银行))', s))
    ea, eb = entities(article['title']), entities(candidate['title'])
    named_a = {name for name in names if len(name) >= 2 and name in article['title']}
    named_b = {name for name in names if len(name) >= 2 and name in candidate['title']}
    concrete_actions = ('收购', '减持', '增持', '签约', '投产', '停产', '涨价', '降价', '发布', '推出', '批准', '取消', '终止', '增长', '下降', '上调', '下调', '否认', '澄清')
    if named_a and named_a == named_b and any(word in article['title'] and word in candidate['title'] for word in concrete_actions):
        stripped_a, stripped_b = a, b
        for name in named_a:
            stripped_a, stripped_b = stripped_a.replace(normalized(name), ''), stripped_b.replace(normalized(name), '')
        grams = lambda s: {s[i:i+2] for i in range(max(0, len(s)-1))}
        ga, gb = grams(stripped_a), grams(stripped_b)
        overlap = len(ga & gb) / max(1, min(len(ga), len(gb)))
        if age <= p['rewrite_hours'] and len(ga & gb) >= 5 and overlap >= p['rewrite_overlap']:
            return True
    numbers = lambda s: re.findall(r'\d+(?:\.\d+)?(?:%|亿元|万元|万吨|万股|元)?', s)
    actions = lambda s: {x for x in ('收购', '减持', '增持', '签约', '投产', '停产', '涨价', '降价', '业绩', '澄清', '否认', '更正', '不实') if x in s}
    return bool(age <= p['rewrite_hours'] and ea and ea == eb and numbers(a) == numbers(b)
                and actions(a) and actions(a) == actions(b)
                and min(len(a), len(b)) >= 15 and SequenceMatcher(None, a, b).ratio() >= p['similarity'])


def homepage_progress(article, candidate):
    if norm(candidate['title']) != norm(article['title']):
        return False
    if candidate['content_level'] != 'title' and article['content_level'] != 'title':
        return False
    return not (article['published_at'] and candidate['fact_at'] and hours(article['published_at'], candidate['fact_at']) > 36)


def signature_progress(article, candidate, exact, same_identity, prior_articles):
    fact_at = article['published_at']
    if fact_at and candidate['fact_at'] and hours(fact_at, candidate['fact_at']) > 36:
        return False
    if (not fact_at or not candidate['fact_at']) and candidate['event_id'] != article['event_id']:
        return False
    if candidate['exact_hash'] == exact:
        return True
    if same_identity:
        return False
    # Identical headline signatures must not hide body corrections or denials.
    # Require all substantive versions in the candidate progress to be safe.
    substantive = [a for a in prior_articles if a['content_level'] != 'title']
    return bool(substantive and all(merge_safe(article, a) for a in substantive))


def story_rule(article, feature, rules):
    result = dict(rule_key='standalone:' + article['event_id'], basis='同一入库新闻的独立进展；未推断更广议题', name=article['title'], max_gap_days=None)
    for rule in rules['stories']:
        entity = sorted(set(feature['entities']) & set(rule['entities_any']))
        action = sorted(set(feature['actions']) & set(rule['actions_any']))
        if not entity or not action or (rule.get('requires') and not hits(article['title'] + '\n' + article['content'], rule['requires'])):
            continue
        result.update(rule_key=rule['id'] + (':' + entity[0] if rule.get('anchor_entity') else ''),
                      name=rule['name'] + (' · ' + feature['entities'][entity[0]][0] if rule.get('anchor_entity') else ''),
                      basis='背景联系规则：主体 ' + ', '.join(entity) + '；动作 ' + ', '.join(action) + f'；进展间隔≤{rule["max_gap_days"]}天，不等于同一事实或独立验证',
                      max_gap_days=rule['max_gap_days'])
        break
    return result


def story_in_window(reference, candidate, max_gap_days):
    gap = timedelta(days=max_gap_days)
    return timestamp(candidate['earliest']) - gap <= timestamp(reference) <= timestamp(candidate['latest']) + gap


def story_phase(latest, *, now):
    return 'recently_updated' if latest and (now - timestamp(latest)).total_seconds() < 48 * 3600 else 'background'


def story_stage(title):
    terms = [('ceasefire', ['ceasefire', '停火']), ('negotiation', ['peace talks', 'negotiations', '谈判', '和谈']),
             ('implementation', ['takes effect', 'implemented', '生效', '实施']),
             ('disruption', ['blockade', 'outage', 'shutdown', '封锁', '停产', '中断']), ('revision', ['correction', '更正', '撤回'])]
    return next((dict(label=key, trigger=hits(title, words)[0], quote=title, basis='latest_headline_mentions_not_verified_stage')
                 for key, words in terms if hits(title, words)), None)
