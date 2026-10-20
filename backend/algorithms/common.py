"""Text/time primitives shared by pure rules; never consult the current clock."""
import re
from datetime import datetime


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def matches(value, term):
    if re.search(r'[A-Za-z]', term):
        return re.search(r'(?<![A-Za-z0-9_])' + re.escape(term) + r'(?![A-Za-z0-9_])', value, re.I)
    return re.search(re.escape(term), value, re.I)


def hits(value, terms):
    return [term for term in terms if matches(value, term)]


def snippet(value, term):
    match = matches(value, term)
    return value[max(0, match.start() - 70):match.end() + 110].strip() if match else ''


def norm(value):
    return re.sub(r'\s+', ' ', value).strip().casefold()
