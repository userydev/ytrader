"""Text/time primitives shared by pure rules; never consult the current clock."""
import re
from datetime import datetime
from functools import lru_cache


_ASCII_LETTER = re.compile(r'[A-Za-z]')


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


@lru_cache(maxsize=8192)
def _rule_pattern(term):
    """Retain bounded compiled rules, never article text or match results."""
    pattern = re.escape(term)
    if _ASCII_LETTER.search(term):
        pattern = r'(?<![A-Za-z0-9_])' + pattern + r'(?![A-Za-z0-9_])'
    return re.compile(pattern, re.I)


def matches(value, term):
    return _rule_pattern(term).search(value)


def hits(value, terms):
    return [term for term in terms if matches(value, term)]


def snippet(value, term):
    match = matches(value, term)
    return value[max(0, match.start() - 70):match.end() + 110].strip() if match else ''


def norm(value):
    return re.sub(r'\s+', ' ', value).strip().casefold()
