"""Discover distributable local packages, never paths supplied by an API caller."""
from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from .config import UserError
from .models import ChainPackage

PACKS_DIRECTORY = Path(__file__).resolve().parent / 'data' / 'packs'
MAX_PACKAGE_BYTES = 8_000_000
PACKAGE_NAMES = {
    'rare-earth': '稀土材料',
    'semiconductor-computing': '半导体与算力',
    'semiconductor-equipment': '半导体设备',
    'photovoltaic': '光伏',
    'industrial-automation': '工业自动化',
    'medical-devices': '医疗器械',
    'lithium-battery-business-map': '锂电池',
}


class PackageCatalog:
    def __init__(self, db, research):
        self.db, self.research = db, research
        self.directory = PACKS_DIRECTORY

    def discover(self):
        packages, duplicates, warnings = {}, set(), []
        root = self.directory
        if not root.exists():
            return packages, warnings
        if root.is_symlink() or not root.is_dir():
            return packages, ['内置关系包目录不可用']
        try:
            for path in sorted(root.glob('*.json')):
                try:
                    # No symlink files, subdirectories or caller-controlled path resolution.
                    if path.is_symlink() or not path.is_file() or path.resolve().parent != root.resolve():
                        raise ValueError()
                    if path.stat().st_size > MAX_PACKAGE_BYTES:
                        raise ValueError()
                    with path.open('rb') as stream:
                        raw = stream.read(MAX_PACKAGE_BYTES + 1)
                    if len(raw) > MAX_PACKAGE_BYTES:
                        raise ValueError()
                    value = json.loads(raw)
                    if not isinstance(value, dict):
                        raise ValueError()
                    # Optional display metadata is not part of the imported factual package.
                    name = value.pop('name', None)
                    description = value.pop('description', '')
                    if name is not None and (not isinstance(name, str) or not name.strip() or len(name) > 500):
                        raise ValueError()
                    if not isinstance(description, str) or len(description) > 4000:
                        raise ValueError()
                    package = ChainPackage.model_validate(value)
                    self.research.validate_chain(package)
                    if not self.valid_id(package.id):
                        raise ValueError()
                    if package.id in packages or package.id in duplicates:
                        packages.pop(package.id, None)
                        duplicates.add(package.id)
                        raise ValueError()
                    packages[package.id] = (package, name or PACKAGE_NAMES.get(package.id)
                                            or package.id.replace('-', ' ').replace('_', ' '), description)
                except (OSError, ValueError, TypeError, ValidationError):
                    warnings.append('部分内置关系包无效或 ID 重复，已跳过')
        except OSError:
            warnings.append('内置关系包目录暂时无法读取')
        return packages, sorted(set(warnings))

    @staticmethod
    def valid_id(value):
        return bool(value and len(value) <= 200 and value not in ('.', '..')
                    and not any(c in value for c in ('/', '\\'))
                    and not any(ord(c) < 32 or ord(c) == 127 for c in value))

    def items(self):
        packages, warnings = self.discover()
        with self.db.connect() as c:
            installed = {r[0]: (r[1], json.loads(r[2])) for r in c.execute('SELECT id,version,data FROM packages')}
        items = []
        for pid, (package, name, description) in sorted(packages.items()):
            data = package.model_dump()
            data['nodes'] = [node.model_dump(exclude_none=True) for node in package.nodes]
            urls = {package.source_url, *(e.url for e in package.evidence), *(e.source_url for e in package.edges)}
            items.append(dict(id=pid, name=name, description=description, version=package.version,
                              installed=installed.get(pid) == (package.version, data),
                              node_count=len(package.nodes), edge_count=len(package.edges), source_urls=sorted(urls)))
        return items, warnings

    def install(self, pid):
        if not self.valid_id(pid):
            raise UserError('内置关系包不存在', 404)
        packages, _ = self.discover()
        if pid not in packages:
            raise UserError('内置关系包不存在或无法读取', 404)
        self.research.import_chain(packages[pid][0])
        return dict(id=pid, installed=True)
