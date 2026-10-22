"""Catalogue-scoped literal names and digit-bounded codes; no fuzzy identities."""
import re
from .registry import VERSIONS

VERSION = VERSIONS['security_matching']


def build_matcher(securities):
    return [(row['symbol'], row['name'], re.compile(r'(?<!\d)' + re.escape(row['code']) + r'(?!\d)'))
            for row in securities]


def match_symbols(body, matcher):
    return [symbol for symbol, name, code_pattern in matcher
            if (len(name) >= 2 and name in body) or code_pattern.search(body)]
