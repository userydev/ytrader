from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def iso(value: str | None) -> str | None:
    if value is None:
        return None
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('时间必须包含时区')
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Config(Strict):
    data_mode: Literal['local', 'ycore'] = 'local'
    ai_mode: Literal['local', 'ycore'] = 'local'
    ycore_url: str = ''
    model_base_url: str = 'https://api.openai.com/v1'
    model_name: str = ''
    model_key_set: bool = False
    ycore_key_set: bool = False
    auto_analyze: bool = False
    sync_interval_minutes: int = Field(default=30, ge=0, le=10080)


class ConfigUpdate(Strict):
    data_mode: Literal['local', 'ycore'] | None = None
    ai_mode: Literal['local', 'ycore'] | None = None
    ycore_url: str | None = None
    model_base_url: str | None = None
    model_name: str | None = Field(default=None, max_length=200)
    model_key_set: bool | None = None
    ycore_key_set: bool | None = None
    auto_analyze: bool | None = None
    sync_interval_minutes: int | None = Field(default=None, ge=0, le=10080)
    model_api_key: str | None = Field(default=None, max_length=8192)
    ycore_api_key: str | None = Field(default=None, max_length=8192)
    clear_model_key: bool = False
    clear_ycore_key: bool = False


class SourceCreate(Strict):
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=2048)


class SourcePatch(Strict):
    enabled: bool


class SyncRequest(Strict):
    kind: Literal['news', 'securities', 'all']


class Watchlist(Strict):
    symbols: list[str] = Field(max_length=1000)

    @field_validator('symbols')
    @classmethod
    def symbols_valid(cls, values):
        import re
        if any(not re.fullmatch(r'(SH|SZ|BJ):\d{6}', x) for x in values):
            raise ValueError('证券代码格式为 SH:600000 / SZ:000001 / BJ:920001')
        return list(dict.fromkeys(values))


class Node(Strict):
    id: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=500)
    kind: Literal['industry', 'product', 'segment', 'company']
    symbol: str | None = Field(default=None, pattern=r'^(SH|SZ|BJ):\d{6}$')


class Evidence(Strict):
    id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=1000)
    url: str
    excerpt: str = Field(min_length=1, max_length=30000)
    published_at: str | None
    source: str = Field(min_length=1, max_length=500)

    @field_validator('published_at')
    @classmethod
    def time_valid(cls, value):
        return iso(value)


class Edge(Strict):
    id: str = Field(min_length=1, max_length=200)
    from_id: str
    to_id: str
    relation: Literal['upstream', 'classification', 'disclosed_supply', 'inferred']
    evidence_ids: list[str] = Field(min_length=1)
    confidence: float | None = Field(default=None, ge=0, le=1)
    as_of: str | None
    source_url: str

    @field_validator('as_of')
    @classmethod
    def time_valid(cls, value):
        return iso(value)


class ChainPackage(Strict):
    id: str = Field(min_length=1, max_length=200)
    version: str = Field(min_length=1, max_length=100)
    license: str
    source_url: str
    as_of: str
    nodes: list[Node] = Field(max_length=10000)
    edges: list[Edge] = Field(max_length=20000)
    evidence: list[Evidence] = Field(max_length=20000)

    @field_validator('as_of')
    @classmethod
    def time_valid(cls, value):
        return iso(value)


class CompanyBusiness(Strict):
    node_id: str
    label: str
    kind: Literal['industry', 'product', 'segment']
    evidence_ids: list[str]


class CompanyTopic(Strict):
    id: str
    name: str


class CompanyProfile(Strict):
    symbol: str = Field(pattern=r'^(SH|SZ|BJ):\d{6}$')
    name: str
    full_name: str | None
    introduction: str | None
    business_scope: str | None
    website: str | None
    province: str | None
    industry: str | None
    listing_date: str | None
    established_date: str | None
    source: str
    source_url: str | None
    as_of: str | None
    fetched_at: str | None
    status: Literal['ok', 'stale', 'unavailable']
    evidence_ids: list[str]
    businesses: list[CompanyBusiness]
    topics: list[CompanyTopic]

    @field_validator('as_of', 'fetched_at')
    @classmethod
    def time_valid(cls, value):
        return iso(value)


class Claim(Strict):
    text: str = Field(min_length=1, max_length=10000)
    evidence_ids: list[str]


class Sections(Strict):
    facts: list[Claim]
    links: list[Claim]
    companies: list[Claim]
    conditions: list[Claim]
    counter_evidence: list[Claim]
    unknowns: list[Claim]


class ModelResult(Strict):
    sections: Sections
    warnings: list[str] = Field(default_factory=list)
