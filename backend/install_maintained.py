"""Explicit, atomic installation of the five maintained research drafts.

Host invocation only: python -m backend.install_maintained --data-dir ABS
    --manifest ABS --report ABS
No Settings/Database initialization, demo seeding, activation or publication.
"""
from __future__ import annotations

import argparse
from contextlib import closing, contextmanager
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sqlite3

from .chain_monitor import CHAIN_IDS
from .config import UserError
from .curated_chains import CuratedChains, PREFIX, SCHEMA, digest


class _StagingDatabase:
    """The existing CuratedChains API over an isolated SQLite backup."""
    def __init__(self, connection):
        self.connection = connection

    @contextmanager
    def connect(self):
        yield self.connection

    @contextmanager
    def transaction(self):
        self.connection.execute('SAVEPOINT maintained_save')
        try:
            yield self.connection
            self.connection.execute('RELEASE maintained_save')
        except BaseException:
            self.connection.execute('ROLLBACK TO maintained_save')
            self.connection.execute('RELEASE maintained_save')
            raise


def _rows(c):
    return dict(c.execute('SELECT key,value FROM kv WHERE substr(key,1,?)=? ORDER BY key', (len(PREFIX), PREFIX)))


def _json_file(path, limit):
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('文件超过大小限制')
    return raw, json.loads(raw.decode('utf-8'))


def _packages(manifest_path):
    _, manifest = _json_file(manifest_path, 100_000)
    if not isinstance(manifest, dict) or manifest.get('schema_version') != SCHEMA or not isinstance(manifest.get('items'), list):
        raise ValueError('manifest schema/items无效')
    items = manifest['items']
    ids = [i.get('industry_id') if isinstance(i, dict) else None for i in items]
    if len(ids) != 5 or any(not isinstance(iid, str) for iid in ids) or set(ids) != CHAIN_IDS:
        raise ValueError('manifest必须恰好包含维护五链且ID不重复')
    # project_file is repository-relative, not relative to cwd or an external preview.
    root = manifest_path.parent.parent.parent
    directory = manifest_path.parent.resolve()
    loaded, results = [], []
    for item in items:
        result = dict(industry_id=item['industry_id'], status='not_installed', package_id=None)
        results.append(result)
        try:
            name, expected = item.get('project_file'), item.get('project_sha256')
            if not isinstance(name, str) or '\\' in name:
                raise ValueError('project_file须为受限相对路径')
            relative = PurePosixPath(name)
            if relative.is_absolute() or '..' in relative.parts or not relative.parts or ':' in name:
                raise ValueError('project_file不得为绝对路径或包含上级路径')
            path = (root / name).resolve()
            if not path.is_relative_to(directory) or path == manifest_path:
                raise ValueError('project_file必须位于manifest所在受控包目录内')
            if not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected):
                raise ValueError('project_sha256无效')
            raw, package = _json_file(path, 4_000_000)
            if hashlib.sha256(raw).hexdigest() != expected:
                raise ValueError('project_sha256不匹配')
            if not isinstance(package, dict) or package.get('industry', {}).get('industry_id') != item['industry_id']:
                raise ValueError('包产业身份与manifest不一致')
            result['project_sha256'] = expected
            loaded.append((item['industry_id'], package, result))
        except (OSError, UnicodeError, ValueError, TypeError, AttributeError) as exc:
            result.update(status='failed', error=str(exc))
    return loaded, results


def install(data_dir, manifest, report):
    """Return/write a truthful report; failed preflight never writes the target DB.

    Only curated-v02 rows are copied back, under one write lock after checking
    the backup baseline has not changed. Unrelated tables/keys are never copied,
    deleted, migrated or read by the installer. Concurrent curated edits abort.
    """
    data_dir, manifest, report = map(Path, (data_dir, manifest, report))
    if not all(p.is_absolute() for p in (data_dir, manifest, report)):
        raise ValueError('data-dir、manifest、report必须为绝对路径')
    target = data_dir / 'ytrader.sqlite3'
    protected = {target.resolve(), manifest.resolve(), Path(str(target) + '-wal').resolve(), Path(str(target) + '-shm').resolve()}
    if report.resolve() in protected or report.resolve().is_relative_to(manifest.parent.resolve()):
        raise ValueError('report不得覆盖数据库、manifest或输入包目录')
    outcome = dict(status='failed', published=False, items=[])
    staging = sqlite3.connect(':memory:', isolation_level=None)
    target_connection = None
    try:
        loaded, outcome['items'] = _packages(manifest.resolve())
        # mode=rw/r/o: SQLite must never create a missing target or seed an empty DB.
        if not target.is_file():
            raise ValueError('目标数据库不存在；拒绝首次空库注入')
        with closing(sqlite3.connect(target.resolve().as_uri() + '?mode=ro', uri=True, timeout=15)) as source:
            if not source.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kv'").fetchone():
                raise ValueError('目标不是已初始化的ytrader数据库')
            source.backup(staging)
        baseline = _rows(staging)
        curated = CuratedChains(_StagingDatabase(staging))
        for iid, package, item in loaded:
            try:
                checked = curated.validate(iid, package)
                item.update(validation={k: checked[k] for k in ('valid', 'publishable', 'errors', 'blockers')})
                if not checked['valid']:
                    item.update(status='failed', error='CuratedChains.validate未通过')
                    continue
                pid = digest(package)
                existed = curated.get(staging, 'package:' + iid + ':' + pid) is not None
                saved = curated.save(iid, package)
                # Check projection too, but never publish a structurally readable draft.
                curated.draft_graph(iid, saved['package_id'])
                item.update(status='preflight_ok', package_id=saved['package_id'], saved_at=saved['saved_at'],
                            action='unchanged' if existed else 'saved', state='draft')
            except (UserError, ValueError, TypeError, KeyError, AttributeError) as exc:
                item.update(status='failed', package_id=None, error=str(exc))
        if len(loaded) != 5 or any(i['status'] != 'preflight_ok' for i in outcome['items']):
            raise ValueError('预检失败；五链均未安装到目标库')
        prepared = _rows(staging)
        if not baseline.keys() <= prepared.keys():
            raise ValueError('预检意外删除对象；拒绝安装')
        changes = [(key, value) for key, value in prepared.items() if baseline.get(key) != value]
        if any(key in baseline and not key.startswith(PREFIX + 'chain:') for key, _ in changes):
            raise ValueError('预检意外覆盖immutable对象；拒绝安装')
        target_connection = sqlite3.connect(target.resolve().as_uri() + '?mode=rw', uri=True, timeout=15, isolation_level=None)
        target_connection.execute('BEGIN IMMEDIATE')
        if _rows(target_connection) != baseline:
            raise ValueError('预检期间维护资料发生变化；未安装，请重新运行')
        target_connection.executemany('INSERT INTO kv(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', changes)
        target_connection.commit()
        for item in outcome['items']:
            item['status'] = 'unchanged' if item['action'] == 'unchanged' else 'installed'
        outcome['status'] = 'ok'
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, AttributeError, sqlite3.Error, UserError) as exc:
        if target_connection is not None:
            target_connection.rollback()
        outcome['error'] = str(exc)
        for item in outcome['items']:
            if item['status'] != 'failed':
                item['status'] = 'not_installed'
                item['package_id'] = None
                item['saved_at'] = None
    finally:
        if target_connection is not None:
            target_connection.close()
        staging.close()
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(outcome, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    return outcome


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args(argv)
    try:
        result = install(args.data_dir, args.manifest, args.report)
    except ValueError as exc:
        parser.error(str(exc))
    return 0 if result['status'] == 'ok' else 1


if __name__ == '__main__':
    raise SystemExit(main())
