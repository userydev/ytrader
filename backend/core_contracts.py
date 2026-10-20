"""v1 read-side validation. Additive fields are retained; malformed success bodies are rejected."""
from __future__ import annotations

import math
import re
from datetime import date
from urllib.parse import unquote, urlsplit

from .models import iso

PANORAMA_CATALOG = {'gold': '黄金', 'crude-oil': '原油', 'ai-compute': 'AI算力',
                    'innovative-drugs': '创新药', 'grid': '电网设备'}


def require(condition):
    if not condition:
        raise ValueError('v1 structure/identity/reference invalid')


def obj(value, keys=()):
    require(isinstance(value, dict) and set(keys) <= value.keys())
    return value


def string(value, *, empty=False):
    require(isinstance(value, str) and (empty or bool(value.strip())))
    return value


def array(value):
    require(isinstance(value, list))
    return value


def strings(value):
    for item in array(value):
        string(item)
    return value


def ids(items, key='id'):
    result = [string(obj(item, (key,))[key]) for item in array(items)]
    require(len(set(result)) == len(result))
    return set(result)


def refs(value, allowed):
    require(set(strings(value)) <= allowed)


def symbol(value):
    require(isinstance(value, str) and re.fullmatch(r'(SH|SZ|BJ):\d{6}', value) is not None)
    return value


def number(value):
    require(type(value) in (int, float) and math.isfinite(value))


def stamp(value):
    require(value is None or isinstance(value, str))
    iso(value)


def web_url(value):
    parsed = urlsplit(string(value))
    require(parsed.scheme in ('http', 'https') and bool(parsed.hostname) and not parsed.username and not parsed.password)


def validate_catalog(data):
    obj(data, ('items', 'schema_version'))
    require(data['schema_version'] == '1')
    ids(data['items'])
    for item in data['items']:
        string(item['name'])
    return data


def validate_panorama(data, industry_id, securities=None):
    string(industry_id)
    if securities is not None:
        validate_panorama_securities(securities)
    obj(data, ('format', 'status', 'industry', 'nodes', 'relations', 'companies', 'participations', 'sources', 'structure', 'scenarios', 'version'))
    industry = obj(data['industry'], ('id', 'name', 'summary', 'boundary', 'demand'))
    require(industry['id'] == industry_id)
    if 'industry_id' in data:
        require(data['industry_id'] == industry_id)
    for key in ('name', 'summary', 'boundary', 'demand'):
        string(industry[key])
    require(data['format'] in (1, 'industry-reference-v1') and type(data['format']) is not bool)
    string(data['status'])
    string(data['version'])
    nodes, relations, companies, sources = (ids(data[k]) for k in ('nodes', 'relations', 'companies', 'sources'))
    require(bool(nodes))
    for source in data['sources']:
        string(source['title'])
        web_url(source['url'])
    for node in data['nodes']:
        string(node['name'])
        string(node['description'])
        refs(node['sources'], sources)
    for edge in data['relations']:
        require(edge['from_id'] in nodes and edge['to_id'] in nodes)
        string(edge['kind'])
        string(edge['explanation'])
        refs(edge['sources'], sources)
    for company in data['companies']:
        string(company['name'])
        if company.get('symbol') is not None:
            symbol(company['symbol'])
            if securities is not None:
                require(company['symbol'] in securities)
        obj(company['profile'])
    for participation in array(data['participations']):
        require(participation['company_id'] in companies and participation['node_id'] in nodes)
        string(participation['role'])
        refs(participation['sources'], sources)
    if data.get('explanation') is not None:
        explanation = obj(data['explanation'], ('overview', 'steps', 'distinctions', 'questions', 'gaps'))
        string(explanation['overview'])
        for step in array(explanation['steps']):
            obj(step, ('title', 'text', 'node_ids', 'sources'))
            string(step['title'])
            string(step['text'])
            refs(step['node_ids'], nodes)
            refs(step['sources'], sources)
        for item in array(explanation['distinctions']):
            obj(item, ('title', 'text', 'sources'))
            string(item['title'])
            string(item['text'])
            refs(item['sources'], sources)
        strings(explanation['questions'])
        strings(explanation['gaps'])
    structure = obj(data['structure'], ('groups',))
    groups = ids(structure['groups'])
    for group in structure['groups']:
        string(group['title'])
        refs(group['node_ids'], nodes)
    if 'primary_relation_ids' in structure:
        refs(structure['primary_relation_ids'], relations)
    if 'reading_order' in structure:
        refs(structure['reading_order'], groups)
    if 'layout' in data:
        require(set(obj(data['layout'])) <= nodes)
        for position in data['layout'].values():
            require(isinstance(position, list) and len(position) == 2)
            for coordinate in position:
                number(coordinate)
    if data.get('default_company') is not None:
        require(data['default_company'] in companies)
    ids(data['scenarios'])
    for scenario in data['scenarios']:
        require(scenario['entry_node'] in nodes)
        refs(scenario['affected_nodes'], nodes)
        refs(scenario['relation_ids'], relations)
    return data


def validate_panorama_securities(securities):
    obj(securities)
    require(bool(securities))
    for key, security in securities.items():
        symbol(key)
        obj(security, ('name',))
        string(security['name'])
        for field, expected in (('symbol', key), ('exchange', key[:2]), ('code', key[3:])):
            if field in security:
                require(security[field] == expected)
    return securities


def validate_panorama_context(data, graphs=None):
    obj(data, ('securities', 'context', 'observatory', 'profiles'))
    securities = validate_panorama_securities(data['securities'])
    context = obj(data['context'], ('version', 'industries', 'news'))
    observatory = obj(data['observatory'], ('version', 'industries', 'as_of'))
    profiles = obj(data['profiles'], ('companies', 'period', 'as_of', 'market'))
    require(context['version'] == 1 and observatory['version'] == 1)
    require(set(PANORAMA_CATALOG) <= set(obj(context['industries'])))
    require(set(PANORAMA_CATALOG) <= set(obj(observatory['industries'])))
    for value in (observatory['as_of'], profiles['as_of']):
        require(isinstance(value, str) and date.fromisoformat(value).isoformat() == value)
    obj(profiles['market'], ('status',))
    string(profiles['period'])
    profile_companies = obj(profiles['companies'])
    for profile in profile_companies.values():
        obj(profile, ('metrics',))
        for metric in array(profile['metrics']):
            obj(metric, ('key', 'label', 'value', 'unit'))
            string(metric['key'])
            string(metric['label'])
            string(metric['unit'])
            if metric['value'] is not None:
                number(metric['value'])
    news = obj(context['news'])
    for entries in news.values():
        for entry in array(entries):
            obj(entry, ('title', 'url'))
            string(entry['title'])
            web_url(entry['url'])
    for iid in PANORAMA_CATALOG:
        c = obj(context['industries'][iid], ('summary', 'scenarios'))
        obj(c['summary'], ('text',))
        string(c['summary']['text'])
        obj(c['scenarios'])
        o = obj(observatory['industries'][iid], ('nodes', 'news'))
        obj(o['nodes'])
        array(o['news'])
    if graphs is None:
        return data
    require(set(PANORAMA_CATALOG) <= set(graphs))
    all_companies = set()
    for iid, graph in graphs.items():
        validate_panorama(graph, iid, securities)
        nodes, companies, scenarios = ids(graph['nodes']), ids(graph['companies']), ids(graph['scenarios'])
        all_companies |= companies
        c, o = context['industries'][iid], observatory['industries'][iid]
        require(set(c['scenarios']) <= scenarios and set(o['nodes']) <= nodes)
        for scenario in c['scenarios'].values():
            require(scenario['entry_node'] in nodes)
            require(set(obj(scenario['annotations'])) <= nodes)
        for entry in o['news']:
            obj(entry, ('id', 'title', 'url', 'node_ids', 'company_ids', 'impacts'))
            string(entry['id'])
            string(entry['title'])
            web_url(entry['url'])
            refs(entry['node_ids'], nodes)
            refs(entry['company_ids'], companies)
            for impact in array(entry['impacts']):
                require(impact['node_id'] in nodes)
                refs(impact['company_ids'], companies)
    require(set(profile_companies) <= all_companies and set(news) <= all_companies)
    return data


def validate_security(data, expected=None):
    obj(data, ('symbol', 'code', 'name', 'exchange', 'industry', 'status', 'as_of', 'source'))
    sym = symbol(data['symbol'])
    require(expected is None or sym == expected)
    require(data['code'] == sym[3:] and data['exchange'] == sym[:2])
    require(data['status'] in ('listed', 'delisted', 'unknown'))
    string(data['name'])
    string(data['source'])
    require(data['industry'] is None or isinstance(data['industry'], str))
    stamp(data['as_of'])


def validate_article(data):
    obj(data, ('id', 'title', 'content', 'url', 'source', 'published_at'))
    string(data['id'])
    string(data['title'])
    string(data['content'], empty=True)
    string(data['source'])
    web_url(data['url'])
    stamp(data['published_at'])


def validate_links(links, article_ids):
    for link in array(links):
        obj(link, ('industry_id', 'name', 'industry_name', 'variable', 'mechanism', 'condition', 'node_ids', 'relation', 'evidence', 'basis', 'rule_version'))
        string(link['industry_id'])
        for key in ('name', 'industry_name', 'variable', 'mechanism', 'condition', 'rule_version'):
            string(link[key])
        strings(link['node_ids'])
        require(link['relation'] in ('direct', 'conditional', 'association'))
        require(link['basis'] in ('rule_inference', 'source_match', 'ai_association', 'ai_impact'))
        require(bool(array(link['evidence'])))
        for evidence in link['evidence']:
            require(evidence['article_id'] in article_ids)
            string(evidence['trigger'])
            string(evidence['quote'])


def validate_editorial_item(item, *, ranked=False):
    obj(item, ('id', 'event_id', 'story', 'articles', 'reasons', 'exclusive_claims', 'algorithm', 'industry_links'))
    string(item['id'])
    string(item['event_id'])
    string(obj(item['story'], ('id',))['id'])
    article_ids = ids(item['articles'])
    require(bool(article_ids))
    for article in item['articles']:
        validate_article(article)
        string(obj(article['attribution'], ('publisher',))['publisher'])
    array(item['reasons'])
    array(item['exclusive_claims'])
    alg = obj(item['algorithm'], ('score', 'importance_tier', 'suppression', 'excluded'))
    number(alg['score'])
    number(alg['importance_tier'])
    strings(alg['suppression'])
    strings(alg['excluded'])
    if ranked:
        number(alg['rerank_score'])
    validate_links(item['industry_links'], article_ids)
    return item


def validate_versions(data):
    if 'algorithm_versions' in data:
        versions = obj(data['algorithm_versions'])
        for key, version in versions.items():
            string(key)
            string(version)


def validate_event(event):
    obj(event, ('id', 'title', 'summary', 'published_at', 'source_count', 'latest_published_at', 'quality_flags', 'merge_reason'))
    string(event['id'])
    string(event['title'])
    string(event['summary'], empty=True)
    stamp(event['published_at'])
    stamp(event['latest_published_at'])
    require(type(event['source_count']) is int and event['source_count'] >= 0)
    strings(event['quality_flags'])
    require(event['merge_reason'] is None or isinstance(event['merge_reason'], str))
    if 'symbols' in event:
        for item in array(event['symbols']):
            symbol(item)


def transmission_links(data):
    """Collect nested links without guessing a second industry/node mapping."""
    links = list(data.get('industry_links', []))
    for key in ('items', 'progresses'):
        for item in data.get(key, []):
            links.extend(item.get('industry_links', []))
    if isinstance(data.get('current'), dict):
        links.extend(data['current'].get('industry_links', []))
    return links


def validate_transmission_references(data, graphs):
    for link in transmission_links(data):
        graph = graphs[link['industry_id']]
        refs(link['node_ids'], ids(graph['nodes']))


def validate_core_response(path, data):
    """Selected stable core reads, centrally applied by Remote before returning any 200."""
    path = unquote(path)
    if path == '/panorama/catalog':
        validate_catalog(data)
    elif path == '/panorama/context':
        validate_panorama_context(data)
    elif path.startswith('/panorama/'):
        validate_panorama(data, path[len('/panorama/'):])
    elif path == '/securities':
        ids(data, 'symbol')
        for security in data:
            validate_security(security)
    elif path.startswith('/securities/'):
        parts = path.split('/')
        expected = symbol(parts[2])
        if len(parts) == 3:
            obj(data, ('security', 'events', 'paths'))
            validate_security(data['security'], expected)
            for event in array(data['events']):
                validate_event(event)
                require(expected in event.get('symbols', []))
            for item in array(data['paths']):
                require(item['kind'] in ('classification', 'disclosed', 'inferred'))
                strings(item['node_ids'])
                strings(item['evidence_ids'])
        elif parts[3] == 'profile':
            from .models import CompanyProfile
            require(CompanyProfile.model_validate(data).symbol == expected)
        elif parts[3] == 'fundamentals':
            from .fundamentals import validate_remote
            validate_remote(data, expected)
    elif path == '/news/editorial':
        obj(data, ('generated_at', 'algorithm_version', 'state', 'items', 'default_event_id', 'exclusive_available', 'coverage_note', 'collection', 'run_id'))
        stamp(data['generated_at'])
        string(data['algorithm_version'])
        string(data['run_id'])
        require(data['state'] in ('collecting', 'empty', 'ready', 'no_current_selection', 'sources_unavailable'))
        require(type(data['exclusive_available']) is bool)
        string(data['coverage_note'])
        collection = obj(data['collection'], ('active_job_id', 'last_checked', 'warnings'))
        strings(collection['warnings'])
        stamp(collection['last_checked'])
        ids(data['items'])
        require(len(data['items']) <= 36)
        for item in data['items']:
            validate_editorial_item(item, ranked=True)
        require(data['default_event_id'] is None or data['default_event_id'] in {i['event_id'] for i in data['items']})
        validate_versions(data)
    elif path.startswith('/news/editorial/events/'):
        expected = path[len('/news/editorial/events/'):]
        obj(data, ('event', 'title', 'summary', 'articles', 'industry_links', 'current', 'progresses', 'story', 'generated_at', 'algorithm_version'))
        require(obj(data['event'], ('id',))['id'] == expected)
        string(data['title'])
        string(data['summary'], empty=True)
        article_ids = ids(data['articles'])
        for article in data['articles']:
            validate_article(article)
        validate_links(data['industry_links'], article_ids)
        validate_editorial_item(data['current'])
        require(data['current']['event_id'] == expected or expected in data['current'].get('event_ids', []))
        require({a['id'] for a in data['current']['articles']} <= article_ids)
        ids(data['progresses'])
        for item in data['progresses']:
            validate_editorial_item(item)
        require(data['current']['id'] in {i['id'] for i in data['progresses']})
        require(obj(data['story'], ('id', 'progresses', 'basis'))['id'] == data['current']['story']['id'])
        stamp(data['generated_at'])
        string(data['algorithm_version'])
        validate_versions(data)
    elif path.startswith('/news/editorial/stories/'):
        obj(data, ('id', 'basis', 'progresses'))
        require(data['id'] == path[len('/news/editorial/stories/'):])
        string(data['basis'])
        ids(data['progresses'])
        for progress in data['progresses']:
            string(progress['event_id'])
            string(progress['title'])
    elif path == '/events':
        ids(data)
        for event in data:
            validate_event(event)
    elif path == '/chain':
        obj(data, ('nodes', 'edges', 'paths'))
        nodes, edges = ids(data['nodes']), ids(data['edges'])
        evidence = set()
        for node in data['nodes']:
            string(node['label'])
            require(node['kind'] in ('industry', 'product', 'segment', 'company'))
            if node.get('symbol') is not None:
                symbol(node['symbol'])
        for edge in data['edges']:
            require(edge['from_id'] in nodes and edge['to_id'] in nodes)
            require(edge['relation'] in ('upstream', 'classification', 'disclosed_supply', 'inferred'))
            require(bool(strings(edge['evidence_ids'])))
            evidence.update(edge['evidence_ids'])
        for item in array(data['paths']):
            require(item['kind'] in ('classification', 'disclosed', 'inferred'))
            refs(item['node_ids'], nodes)
            refs(item['evidence_ids'], evidence)
    elif path.startswith('/evidence/'):
        from .models import Evidence
        require(Evidence.model_validate(data).id == path[len('/evidence/'):])
    elif path.startswith('/events/'):
        obj(data, ('event', 'articles', 'paths', 'primary_article_id'))
        require(obj(data['event'], ('id', 'title'))['id'] == path[len('/events/'):])
        validate_event(data['event'])
        article_ids = ids(data['articles'])
        for article in data['articles']:
            validate_article(article)
            require(article.get('event_id') == data['event']['id'])
        require(data['primary_article_id'] is None or data['primary_article_id'] in article_ids)
        array(data['paths'])
    return data
