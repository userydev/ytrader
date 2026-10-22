"""Broad many-to-many relevance. No causal edges or fixed taxonomy ceiling."""
import re
from functools import lru_cache

from .registry import VERSIONS
from .common import hits, snippet
from ..identities import key, version

VERSION = VERSIONS['industry_association']
# Directory aliases are candidate product names, not unrestricted entity cues.
NON_BUSINESS_TERMS = {
    'transformer', 'transformers', 'china', 'united states', 'us', 'u.s.', 'iran', 'israel',
    'russia', 'ukraine', 'sudan', 'india', 'japan', 'europe', 'saudi', 'yemen',
    '中国', '美国', '伊朗', '以色列', '俄罗斯', '乌克兰', '苏丹', '印度', '日本', '欧洲', '沙特', '也门',
    'nvidia', 'microsoft', 'amazon', 'alphabet', 'meta', 'openai', 'tsmc',
    '英伟达', '微软', '亚马逊', '谷歌', '台积电',
}
# Fast availability, not the semantic coverage boundary. The async model layer
# accepts names outside both these aliases and the current reference directory.
ALIASES = {
    '原油': ['oil', 'crude', 'petroleum', 'OPEC', '石油'],
    '汽车': ['automotive', 'electric vehicle', 'electric vehicles', 'EV policy', '新能源汽车', '汽车'],
    '新能源': ['renewable energy', 'clean energy', 'electric vehicle', '新能源', '可再生能源'],
    '半导体': ['semiconductor', 'semiconductors', '芯片'],
    'AI算力': ['GPU', 'data center', 'data centre', 'AI computing', 'AI accelerator', 'AI accelerators', '算力', '人工智能加速器'],
    '黄金': ['gold', 'bullion', 'gold mining', 'gold mine', 'gold reserves', '黄金开采', '金矿', '黄金储备'],
    '电网': ['power grid', 'electric grid', 'electricity grid', 'electrical grid', 'power transmission',
           'grid equipment', 'power transformer', 'power transformers', 'substation', 'substations',
           '输电', '配电', '变电站', '电力变压器', '电网设备'],
    '创新药': ['innovative drug', 'innovative drugs', 'drug discovery', 'drug approval', 'drug approvals',
            'clinical trial', 'clinical trials', 'phase 3 trial', 'phase III trial', 'FDA approval',
            'biopharmaceutical', 'biopharmaceuticals', '新药', '药品审批', '临床试验', '三期临床', '生物制药'],
}


def resolve(name, catalog):
    normalized = ''.join(name.split()).casefold()
    return next((i['id'] for i in catalog if ''.join(i['name'].split()).casefold() == normalized), key('open-', normalized))


def article_version(article):
    """Exact immutable proof, shared by producers and the recommendation gate."""
    return version({k: article.get(k) for k in ('id', 'title', 'content', 'published_at')})


def binding(articles, catalog_version):
    return version(dict(articles=[{k: a.get(k) for k in ('id', 'title', 'content', 'published_at')} for a in sorted(articles, key=lambda a: a['id'])],
                        catalog_version=catalog_version, algorithm=VERSION))


def link(name, catalog, evidence, *, basis='source_match', reason='新闻主题相关；尚未确认具体传导环节'):
    return dict(industry_id=resolve(name, catalog), name=name, industry_name=name,
                variable='主题关联', mechanism=reason, condition='关联不代表已发生影响，须进一步核对业务位置与事件条件。',
                node_ids=[], relation='association', evidence=evidence, basis=basis, rule_version=VERSION,
                association_version=VERSION)


@lru_cache(maxsize=4)
def _matchers(entries):
    # Hold compiled expressions outside re's small global cache. Preserve term
    # order and common.matches boundary semantics; this changes no ranking rule.
    return [(name, [(term, re.compile(
        r'(?<![A-Za-z0-9_])' + re.escape(term) + r'(?![A-Za-z0-9_])'
        if re.search(r'[A-Za-z]', term) else re.escape(term), re.I)) for term in terms])
        for name, terms in entries]


def associate(articles, catalog):
    names = list(dict.fromkeys([i['name'] for i in catalog] + list(ALIASES)))
    found = {}
    dynamic_aliases = {i['name']: i.get('aliases', []) for i in catalog}
    matchers = _matchers(tuple((name, tuple([name] + ALIASES.get(name, []) + dynamic_aliases.get(name, []))) for name in names))
    for article in articles:
        text = article['title'] + '\n' + article.get('content', '')[:8000]
        for name, patterns in matchers:
            # A bare ambiguous product word is not business context. Directory
            # aliases may include it, so apply this to dynamic aliases as well.
            term = next((term for term, pattern in patterns if term.strip().casefold() not in NON_BUSINESS_TERMS and pattern.search(text)), None)
            if term is None:
                continue
            proof = dict(article_id=article['id'], article_version=article_version(article),
                         trigger=term, quote=snippet(text, term))
            if name not in found or found[name]['basis'] == 'regional_security_theme':
                found[name] = link(name, catalog, [], reason='原文业务词“' + term + '”与' + name + '主题相关；未确认因果或影响量级')
            found[name]['evidence'].append(proof)
        regions = ['Middle East', 'Iran', 'Hormuz', 'Houthi', 'Houthis', 'Yemen', 'Saudi', '中东', '伊朗', '霍尔木兹', '胡塞', '也门', '沙特']
        security = ['war', 'military', 'missile', 'drone strike', 'airstrike', 'attack', 'attacks', 'attacking', 'blockade', 'ceasefire', 'conflict', '战争', '军事', '导弹', '空袭', '封锁', '停火', '冲突', '袭击']
        regional, actions = hits(text, regions), hits(text, security)
        unrelated = hits(article['title'], ['football', 'soccer', 'cricket', 'tennis', 'World Cup', 'sports', 'concert', 'film', '足球', '篮球', '世界杯', '网球', '演唱会', '电影', '体育', '娱乐'])
        physical_security = hits(article['title'], ['war', 'military', 'missile', 'airstrike', '战争', '军事', '导弹', '空袭', '封锁'])
        if regional and actions and (not unrelated or physical_security):
            proof = dict(article_id=article['id'], article_version=article_version(article),
                         trigger=regional[0] + ' / ' + actions[0], quote=text[:600])
            if '原油' not in found:
                found['原油'] = link('原油', catalog, [], basis='regional_security_theme',
                    reason='中东安全/政治冲突与原油供应、航运的宽主题关联；未确认发生断供或价格变化')
            if found['原油']['basis'] == 'regional_security_theme':
                found['原油']['evidence'].append(proof)
    return list(found.values())


def validate_model(value, articles, catalog):
    if not isinstance(value, dict) or not isinstance(value.get('industries'), list) or len(value['industries']) > 12:
        raise ValueError('association shape')
    by_id = {a['id']: a for a in articles}
    result = {}
    for item in value['industries']:
        if not isinstance(item, dict):
            raise ValueError('association item')
        name, aid, quote, reason = (item.get(k) for k in ('name', 'article_id', 'quote', 'reason'))
        if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 100 or
                aid not in by_id or not isinstance(quote, str) or not 1 <= len(quote) <= 600 or
                quote not in by_id[aid]['title'] + '\n' + by_id[aid].get('content', '') or
                not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 600):
            raise ValueError('association identity/evidence')
        name = name.strip()
        result[name] = link(name, catalog, [dict(article_id=aid, article_version=article_version(by_id[aid]), trigger='model_relevance', quote=quote)],
                            basis='ai_association', reason=reason)
    return list(result.values())
