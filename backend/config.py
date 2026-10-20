from __future__ import annotations

import ipaddress
import json
import os
import socket
from pathlib import Path
from threading import RLock
from urllib.parse import urlsplit, urlunsplit

from .models import Config, ConfigUpdate


class UserError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def validate_url(value: str, *, public=False, base=False, resolve=False) -> str:
    value = value.strip()
    try:
        u = urlsplit(value)
        port = u.port
        if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or u.fragment:
            raise ValueError()
        if base and u.query:
            raise ValueError()
        host = u.hostname.lower()
        if host in ('metadata.google.internal', 'metadata', '169.254.169.254'):
            raise ValueError()
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            ip = None
        if ip and (ip.is_link_local or ip.is_unspecified or ip.is_multicast or (public and not ip.is_global)):
            raise ValueError()
        if public and (host == 'localhost' or host.endswith(('.localhost', '.local', '.internal'))):
            raise ValueError()
        if public and resolve:
            addresses = socket.getaddrinfo(host, port or (443 if u.scheme == 'https' else 80), type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                raise ValueError()
        return urlunsplit((u.scheme, u.netloc, u.path.rstrip('/') if base else u.path, u.query, ''))
    except (ValueError, OSError):
        raise UserError('URL 必须为无凭据的 HTTP(S) 地址；不允许元数据地址或私网 RSS') from None


class Settings:
    def __init__(self, db, directory: Path):
        self.db = db
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / 'keys.json'
        self.lock = RLock()
        if not self.path.exists():
            self._write_secrets({})
        os.chmod(self.path, 0o600)

    def _secrets(self):
        with self.path.open(encoding='utf-8') as f:
            return json.load(f)

    def _write_secrets(self, values):
        temporary = self.directory / 'keys.json.tmp'
        fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(values, f)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.path)

    def get(self) -> Config:
        with self.lock:
            data = self.db.get('config', {})
            secrets = self._secrets()
            data['model_key_set'] = bool(secrets.get('model_api_key'))
            data['ycore_key_set'] = bool(secrets.get('ycore_api_key'))
            return Config.model_validate(data)

    def key(self, kind):
        with self.lock:
            return self._secrets().get(kind + '_api_key', '')

    def update(self, update: ConfigUpdate):
        with self.lock:
            data = self.get().model_dump()
            fields = update.model_dump(exclude_none=True, exclude={'model_api_key', 'ycore_api_key', 'clear_model_key', 'clear_ycore_key', 'model_key_set', 'ycore_key_set'})
            data.update(fields)
            if data['ycore_url']:
                data['ycore_url'] = validate_url(data['ycore_url'], base=True)
                # Store service root; Remote adds /api/v1 exactly once.
                data['ycore_url'] = data['ycore_url'].removesuffix('/api/v1')
            data['model_base_url'] = validate_url(data['model_base_url'], base=True)
            if (data['data_mode'] == 'ycore' or data['ai_mode'] == 'ycore') and not data['ycore_url']:
                raise UserError('ycore 模式需要设置 ycore_url')
            config = Config.model_validate(data)
            secrets = self._secrets()
            for kind in ('model', 'ycore'):
                if getattr(update, 'clear_' + kind + '_key'):
                    secrets.pop(kind + '_api_key', None)
                elif getattr(update, kind + '_api_key'):
                    key = getattr(update, kind + '_api_key').strip()
                    if '\n' in key or '\r' in key or any(ord(x) < 32 for x in key):
                        raise UserError('密钥格式无效')
                    if key:
                        secrets[kind + '_api_key'] = key
            self._write_secrets(secrets)
            self.db.put('config', config.model_dump(exclude={'model_key_set', 'ycore_key_set'}))
            return self.get()

    def local_analysis_ready(self):
        config = self.get()
        host = urlsplit(config.model_base_url).hostname
        if os.environ.get('YTRADER_HOSTED') == '1' and host != 'gateway.ai.cloudflare.com':
            raise UserError('托管端必须配置 Cloudflare AI Gateway routing 的模型 URL', 409)
        try:
            loopback = host == 'localhost' or ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = False
        if not config.model_name or (not config.model_key_set and not loopback):
            raise UserError('请先配置模型名称与远程模型 model_api_key；loopback 本地模型可免密钥。未配置时仅阅读证据。', 409)
        return config

    def analysis_ready(self):
        config = self.get()
        if config.ai_mode == 'ycore':
            if not config.ycore_url:
                raise UserError('请先配置 ycore 服务 URL', 409)
            return config
        return self.local_analysis_ready()
