"""Read-only, fixed maintained monitoring snapshot; no live-market fallback."""
from __future__ import annotations

import json
import math
import re
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlencode

from .config import UserError, validate_url

DATA_FILE = Path(__file__).resolve().parent / 'data' / 'chain_monitor.json'
CHAIN_IDS = frozenset({'crude-oil', 'ai-compute', 'gold', 'grid', 'innovative-drugs'})
MAX_BYTES = 2_000_000


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _period(value):
    # Keep the source's actual fiscal/event/range label, never substitute as_of.
    if not _text(value) or not re.search(r'(?:19|20)\d{2}', value):
        raise ValueError('period须保留真实观察期，不能用待采集/最新代替')
    for stamp in re.findall(r'\d{4}-\d{2}-\d{2}', value):
        date.fromisoformat(stamp)
    for month in re.findall(r'\d{4}-(\d{2})(?!\d)', value):
        if not 1 <= int(month) <= 12:
            raise ValueError('period月份无效')
    if re.search(r'Q(?:[05-9]|\d{2})|H(?:[03-9]|\d{2})', value):
        raise ValueError('period季度/半年无效')


def validate_snapshot(data):
    """Validate without normalizing values, units, periods or provenance."""
    if not isinstance(data, dict) or data.get('schema') != 'five-chain-monitor-design-v2':
        raise ValueError('监控schema无效')
    if not _text(data.get('as_of')) or not isinstance(data.get('presentation'), dict):
        raise ValueError('监控缺少as_of/presentation')
    retrieved = data.get('retrieved_at_utc')
    if retrieved is not None:
        if not isinstance(retrieved, str) or datetime.fromisoformat(retrieved.replace('Z', '+00:00')).tzinfo is None:
            raise ValueError('监控retrieved_at_utc须为带时区的真实采集时间')
    warnings = []

    def finite(value):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError('监控包含非有限数值')
        if isinstance(value, dict):
            for child in value.values():
                finite(child)
        elif isinstance(value, list):
            for child in value:
                finite(child)
    finite(data)

    sources = data.get('sources')
    if not isinstance(sources, list) or not sources:
        raise ValueError('监控来源缺失')
    source_ids = set()
    for source in sources:
        if not isinstance(source, dict) or not _text(source.get('id')) or source['id'] in source_ids:
            raise ValueError('监控来源ID缺失或重复')
        source_ids.add(source['id'])
        if not all(_text(source.get(k)) for k in ('title', 'url', 'locator')):
            raise ValueError('监控来源定位不完整')
        validate_url(source['url'])
        if not _text(source.get('period')):
            raise ValueError('监控来源缺少原始period/试验范围')
        # A trial source may name its trial/scope here rather than a time window;
        # the metric itself must still carry a real dated observation period.
        if re.search(r'(?:19|20)\d{2}', source['period']):
            _period(source['period'])

    def provenance(record):
        if record.get('source') not in source_ids:
            raise ValueError('监控引用未知来源')
        refs = record.get('source_ids', [])
        if not isinstance(refs, list) or any(not isinstance(s, str) or s not in source_ids for s in refs):
            raise ValueError('监控source_ids引用无效')

    def number(record, path):
        value = record.get('value')
        if value is None:
            # A regulator's categorical approval is an event, not a missing quote.
            categorical = record.get('kind') == 'regulator' and record.get('unit') == '' and _text(record.get('display')) and 'value' in record
            if not categorical:
                warnings.append(path + '缺少数值；保留原始缺失状态，未补值')
        elif type(value) not in (int, float):
            raise ValueError(path + '数值类型无效')

    chains = data.get('chains')
    if not isinstance(chains, list) or not chains:
        raise ValueError('监控链列表缺失')
    seen, metrics = set(), set()
    chain_metrics = {}
    for chain in chains:
        if not isinstance(chain, dict) or chain.get('id') not in CHAIN_IDS or chain['id'] in seen:
            raise ValueError('监控产业ID未知或重复')
        iid = chain['id']
        seen.add(iid)
        if not _text(chain.get('name')) or not isinstance(chain.get('metrics'), list):
            raise ValueError('监控产业名称/指标列表无效')
        local_ids = set()
        for metric in chain['metrics']:
            if not isinstance(metric, dict) or not _text(metric.get('id')) or metric['id'] in metrics:
                raise ValueError('监控指标ID缺失或重复')
            mid = metric['id']
            metrics.add(mid)
            local_ids.add(mid)
            if not all(isinstance(metric.get(k), str) for k in ('label', 'display', 'unit', 'scope', 'kind')):
                raise ValueError(mid + '指标字段缺失')
            _period(metric.get('period'))
            provenance(metric)
            number(metric, mid)
            series = metric.get('series', [])
            if not isinstance(series, list):
                raise ValueError(mid + 'series须为数组')
            dates = set()
            for point in series:
                if not isinstance(point, dict):
                    raise ValueError(mid + 'series观察无效')
                stamp = point.get('date')
                if not isinstance(stamp, str) or date.fromisoformat(stamp).isoformat() != stamp or stamp in dates:
                    raise ValueError(mid + 'series日期无效或重复')
                dates.add(stamp)
                number(point, mid + '/' + stamp)
            change = metric.get('change')
            if change is not None and (not isinstance(change, dict) or not all(_text(change.get(k)) for k in ('display', 'type'))):
                raise ValueError(mid + 'change须保留原始口径')
        chain_metrics[iid] = local_ids
        if chain.get('headline_metric_id') not in local_ids:
            raise ValueError(iid + 'headline_metric_id引用无效')
        for event in chain.get('events', []):
            if not isinstance(event, dict):
                raise ValueError('监控事件无效')
            _period(event.get('date'))
            provenance(event)
            number(event, iid + '/event')
    for iid, records in data['presentation'].items():
        if iid not in seen or not isinstance(records, dict):
            raise ValueError('监控presentation产业引用无效')
        for record in records.values():
            if not isinstance(record, dict) or record.get('origin_metric') not in chain_metrics[iid]:
                raise ValueError('监控presentation指标引用无效')
            provenance(record)
            _period(record.get('period'))
            number(record, iid + '/presentation')
    if seen != CHAIN_IDS or len(metrics) != 72 or len(source_ids) != 37:
        warnings.append('监控快照部分缺失：实际%d链/%d指标/%d来源；未补造' % (len(seen), len(metrics), len(source_ids)))
    return warnings


def structure(curated, iid):
    """Exact available pointer; legacy static data is not a maintained draft."""
    state = curated.detail(iid) if curated else dict(current_release=None, drafts=[])
    rid = state['current_release']
    pid = state['drafts'][-1]['package_id'] if state['drafts'] else None
    href = None
    if rid:
        if not curated.graph(iid, rid):
            raise UserError('监控现用发布指针无可读结构；未回退旧图', 503)
        href = '/chain?' + urlencode(dict(industry=iid, published_release=rid))
    elif pid:
        curated.draft_graph(iid, pid)  # Fail explicitly if the saved draft cannot project.
        href = '/chain?' + urlencode(dict(industry=iid, draft_package=pid))
    return dict(status='published' if rid else 'draft' if pid else 'not_maintained',
                current_release=rid, draft_package=pid, href=href)


def snapshot(curated, mode='local'):
    if mode != 'local':
        raise UserError('ycore未声明chain-monitor能力；未读取本地快照', 501)
    try:
        with DATA_FILE.open('rb') as stream:
            raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError('监控文件超过大小限制')
        data = json.loads(raw.decode('utf-8'))
        warnings = validate_snapshot(data)
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, AttributeError, OverflowError, UserError):
        raise UserError('产业链监控不可用：固定快照缺失或结构、数值、期别、来源引用无效；未使用替代数据', 503) from None
    for chain in data['chains']:
        chain['structure'] = structure(curated, chain['id'])
    return {'data': data, 'meta': {'source': 'local/chain-monitor', 'as_of': data.get('retrieved_at_utc'),
        'version': '1', 'completeness': 'partial' if warnings else 'complete', 'warnings': warnings}}
