"""Deterministic identity primitives shared by algorithms and source adapters."""
import hashlib
import json


def key(prefix, name):
    return prefix + hashlib.sha256(name.encode()).hexdigest()[:24]


def version(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
