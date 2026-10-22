"""Conditional impact on actual graph positions; never copy graph edges as causes."""
from .registry import VERSIONS
from .industry_association import binding
from ..identities import version

VERSION = VERSIONS['industry_impact']


def bind(links, news_version, source_versions):
    return [dict(link, news_version=news_version, source_version=source_versions.get(link['industry_id']),
                 impact_version=VERSION, verification='unverified_inference') for link in links]


def input_version(articles, graph):
    return version(dict(news=binding(articles, ''), graph=graph['version'], algorithm=VERSION,
                        industry_id=graph['industry']['id']))


def validate_model(value, articles, graph):
    if not isinstance(value, dict) or not isinstance(value.get('impacts'), list) or len(value['impacts']) > 6:
        raise ValueError('impact shape')
    ids = {n['id'] for n in graph['nodes']}
    by_id = {a['id']: a for a in articles}
    result = []
    for item in value['impacts']:
        if not isinstance(item, dict):
            raise ValueError('impact item')
        nodes = item.get('node_ids')
        if not isinstance(nodes, list) or not 1 <= len(nodes) <= 8 or not all(isinstance(n, str) for n in nodes) or not set(nodes) <= ids:
            raise ValueError('impact node identity')
        for field in ('variable', 'mechanism', 'condition'):
            if not isinstance(item.get(field), str) or not 1 <= len(item[field].strip()) <= 900:
                raise ValueError('impact condition')
        aid, quote = item.get('article_id'), item.get('quote')
        if (aid not in by_id or not isinstance(quote, str) or not 1 <= len(quote) <= 600 or
                quote not in by_id[aid]['title'] + '\n' + by_id[aid].get('content', '')):
            raise ValueError('impact news evidence')
        result.append(dict(industry_id=graph['industry']['id'], name=graph['industry']['name'], industry_name=graph['industry']['name'],
            variable=item['variable'], mechanism=item['mechanism'], condition=item['condition'], node_ids=list(dict.fromkeys(nodes)),
            relation='conditional', basis='ai_impact', rule_version=VERSION, impact_version=VERSION,
            evidence=[dict(article_id=aid, quote=quote, trigger='conditional_impact')], verification='unverified_inference',
            news_version=binding(articles, ''), source_version=graph['version']))
    return result
