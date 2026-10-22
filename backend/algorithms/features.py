"""Pure feature projection composing independently versioned algorithms."""
import re
from .common import hits, matches, snippet
from .recommendation import importance, editorial_exclusions
from .industry_transmission import industry_links


def extract(article, meta, rules, attribution):
    value = article['title'] + '\n' + article['content'][:550]
    entities = {key: hits(value, aliases) for key, aliases in rules['entities'].items() if hits(value, aliases)}
    actions = {key: hits(value, terms) for key, terms in rules['actions'].items() if hits(value, terms)}
    changes = hits(value, rules['changes'])
    excluded = hits(article['title'] + '\n' + article['content'][:350], rules['exclude'])
    facts = [dict(kind='entity', key=key, trigger=terms[0], quote=snippet(value, terms[0]),
                  location='title' if matches(article['title'], terms[0]) else 'body') for key, terms in entities.items()]
    facts += [dict(kind='action', key=key, trigger=terms[0], quote=snippet(value, terms[0]),
                   location='title' if matches(article['title'], terms[0]) else 'body') for key, terms in actions.items()]
    feature = dict(entities=entities, actions=actions, changes=changes, triggers=facts,
                   importance=importance(article, rules), editorial_exclusions=editorial_exclusions(article, meta, rules),
                   exclusion_terms=excluded, commentary=hits(article['title'], rules['commentary']),
                   low_relevance=hits(article['title'], rules.get('low_relevance', [])),
                   analysis_frame=hits(article['title'], rules.get('analysis_frame', [])),
                   title_economic=hits(article['title'], rules.get('economic_context', [])),
                   title_actions=[key for key, terms in rules['actions'].items() if hits(article['title'], terms)],
                   price_recap=hits(article['title'], rules['price_recap']),
                   numeric_facts=re.findall(r'\d+(?:[.,]\d+)*(?:%|％|bn|million|billion|亿|万)?', value),
                   language=meta.get('language') or ('zh' if re.search(r'[\u4e00-\u9fff]', value) else 'en' if re.search(r'[A-Za-z]', value) else 'und'),
                   language_basis='source_metadata' if meta.get('language') else 'script_heuristic', attribution=attribution)
    feature['industry_links'] = industry_links(article, feature, rules)
    return feature
