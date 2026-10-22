from __future__ import annotations

import ipaddress
import json
import os
import socket
from pathlib import Path
from threading import RLock
from urllib.parse import urlsplit, urlunsplit

from .models import AIConfigUpdate, Config, ConfigUpdate


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


def model_base(value):
    return validate_url(value, base=True).removesuffix('/chat/completions')


def gateway_base(value):
    return validate_url(value, base=True).removesuffix('/api/v1')


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
            data['ai_gateway_key_set'] = bool(secrets.get('ai_gateway_api_key'))
            return Config.model_validate(data)

    def key(self, kind):
        with self.lock:
            return self._secrets().get(kind + '_api_key', '')

    @staticmethod
    def _ai_identity(config, secrets):
        legacy = not config.ai_gateway_url
        return (config.ai_mode, model_base(config.model_base_url), config.model_api_format, config.model_name,
                config.ai_options.model_dump(), secrets.get('model_api_key', ''),
                config.ai_gateway_url, config.ai_gateway_model, secrets.get('ai_gateway_api_key', ''),
                (config.ycore_url, secrets.get('ycore_api_key', '')) if legacy and config.ai_mode == 'ycore' else None)

    def update(self, update: ConfigUpdate):
        # Destination, revision and credentials are captured/updated under one lock.
        with self.lock:
            before = self.get()
            secrets = self._secrets()
            previous_identity = self._ai_identity(before, secrets)
            excluded = {'model_key_set', 'ycore_key_set', 'ai_gateway_key_set'}
            private = {kind + '_api_key' for kind in ('model', 'ycore', 'ai_gateway')}
            private |= {'clear_' + kind + '_key' for kind in ('model', 'ycore', 'ai_gateway')}
            data = before.model_dump()
            data.update(update.model_dump(exclude_none=True, exclude=excluded | private))
            data['model_base_url'] = model_base(data['model_base_url'])
            for field in ('ycore_url', 'ai_gateway_url'):
                if data[field]:
                    data[field] = gateway_base(data[field])
            data['model_name'] = data['model_name'].strip()
            data['ai_gateway_model'] = data['ai_gateway_model'].strip()
            if (before.ai_mode == 'ycore' and not before.ai_gateway_url and data['ai_mode'] == 'ycore'
                    and not data['ai_gateway_url'] and before.ycore_url
                    and data['ycore_url'] != gateway_base(before.ycore_url)):
                raise UserError('旧 AI 连接仍使用 ycore 地址；请先保存独立 AI gateway，再更改数据地址', 409)
            if data['data_mode'] == 'ycore' and not data['ycore_url']:
                raise UserError('ycore 数据模式需要设置 ycore_url')
            if data['ai_mode'] == 'ycore' and not (data['ai_gateway_url'] or data['ycore_url']):
                raise UserError('请先配置独立 AI gateway URL')
            for kind, field in (('model', 'model_base_url'), ('ycore', 'ycore_url'), ('ai_gateway', 'ai_gateway_url')):
                supplied = getattr(update, kind + '_api_key')
                key = supplied.strip() if supplied else ''
                clear = getattr(update, 'clear_' + kind + '_key')
                if clear and key:
                    raise UserError('不能同时清除和设置密钥', 422)
                if any(ord(x) < 32 or ord(x) == 127 for x in key):
                    raise UserError('密钥格式无效', 422)
                old_url = getattr(before, field)
                if old_url:
                    old_url = model_base(old_url) if kind == 'model' else gateway_base(old_url)
                if (clear or data[field] != old_url
                        or (kind == 'model' and data['model_api_format'] != before.model_api_format)):
                    secrets.pop(kind + '_api_key', None)
                if key:
                    secrets[kind + '_api_key'] = key
            config = Config.model_validate(data)
            if self._ai_identity(config, secrets) != previous_identity:
                config.ai_config_revision = before.ai_config_revision + 1
            self._write_secrets(secrets)
            self.db.put('config', config.model_dump(exclude=excluded))
            return self.get()

    def ai_config(self):
        with self.lock:
            config = self.get()
            legacy = config.ai_mode == 'ycore' and not bool(config.ai_gateway_url)
            return dict(contract_version='1', provider='ycore' if config.ai_mode == 'ycore' else 'openai-compatible',
                        revision=config.ai_config_revision, profiles={
                'openai-compatible': dict(base_url=model_base(config.model_base_url), model=config.model_name,
                    api_format=config.model_api_format, key_set=config.model_key_set, options=config.ai_options.model_dump()),
                'ycore': dict(base_url=gateway_base(config.ai_gateway_url or (config.ycore_url if legacy else '')) if (config.ai_gateway_url or legacy and config.ycore_url) else '',
                    model=config.ai_gateway_model, key_set=config.ycore_key_set if legacy else config.ai_gateway_key_set,
                    legacy_connection=legacy and bool(config.ycore_url))})

    def update_ai(self, update: AIConfigUpdate):
        if not update.base_url.strip():
            raise UserError('请填写 AI Base URL', 422)
        with self.lock:
            if update.provider == 'openai-compatible':
                fields = dict(ai_mode='local', model_base_url=update.base_url, model_name=update.model,
                              model_api_key=update.api_key, clear_model_key=update.clear_api_key)
                if update.options is not None:
                    fields['ai_options'] = update.options
                if update.api_format is not None:
                    fields['model_api_format'] = update.api_format
            else:
                fields = dict(ai_mode='ycore', ai_gateway_url=update.base_url, ai_gateway_model=update.model,
                              ai_gateway_api_key=update.api_key, clear_ai_gateway_key=update.clear_api_key)
            self.update(ConfigUpdate(**fields))
            return self.ai_config()

    def local_analysis_ready(self):
        config = self.get()
        host = urlsplit(config.model_base_url).hostname
        try:
            loopback = host == 'localhost' or ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = False
        if not config.model_name or (not config.model_key_set and (not loopback or config.model_api_format != 'openai')):
            raise UserError('请先配置模型名称与 API Key；仅 OpenAI 兼容的 loopback 自定义服务可免密钥。未配置时仅阅读证据。', 409)
        return config

    def analysis_ready(self):
        config = self.get()
        if config.ai_mode == 'ycore':
            if not (config.ai_gateway_url or config.ycore_url):
                raise UserError('请先配置 AI gateway URL', 409)
            return config
        return self.local_analysis_ready()

    def check_ai_destination(self, expected):
        config = self.get()
        if expected.get('data_mode', config.data_mode) != config.data_mode or expected.get('ai_mode', config.ai_mode) != config.ai_mode:
            raise UserError('服务模式已更改，请重新提交任务', 409)
        for field in ('ai_config_revision', 'model_base_url', 'model_api_format', 'model_name', 'ai_gateway_url', 'ai_gateway_model'):
            if field in expected and expected[field] != getattr(config, field):
                raise UserError('AI 配置已更改，请重新提交任务', 409)
        if ('ai_config_revision' not in expected and 'model_api_format' not in expected
                and config.ai_mode == 'local' and config.model_api_format != 'openai'):
            raise UserError('旧任务未绑定原生 API 协议，请重新提交任务', 409)
        # A legacy job cannot silently adopt a newly introduced independent gateway.
        if 'ai_config_revision' not in expected and config.ai_mode == 'ycore' and config.ai_gateway_url and 'ai_gateway_url' not in expected:
            raise UserError('旧任务未绑定独立 AI gateway，请重新提交任务', 409)
        # Old jobs retain conservative legacy destination checks.
        if (config.data_mode == 'ycore' or (config.ai_mode == 'ycore' and not config.ai_gateway_url)) and expected.get('ycore_url', config.ycore_url) != config.ycore_url:
            raise UserError('ycore 地址已更改，请重新提交任务', 409)
        return config

    def capture_ai(self, expected=None, *, direct_only=False):
        with self.lock:
            config = self.check_ai_destination(expected) if expected is not None else self.get()
            if direct_only and config.ai_mode != 'local':
                raise UserError('参考 AI gateway 仅使用独立直连模型；禁止转发 ycore gateway', 409)
            self.analysis_ready()
            secrets = self._secrets()
            remote = config.ai_mode == 'ycore'
            legacy = remote and not config.ai_gateway_url
            return dict(provider='ycore' if remote else 'openai-compatible',
                        base_url=gateway_base(config.ai_gateway_url or config.ycore_url) if remote else model_base(config.model_base_url),
                        model=config.ai_gateway_model if remote else config.model_name,
                        key=secrets.get(('ycore' if legacy else 'ai_gateway' if remote else 'model') + '_api_key', ''),
                        api_format=config.model_api_format,
                        options=config.ai_options.model_dump(), revision=config.ai_config_revision,
                        sensitive=tuple(v for v in secrets.values() if isinstance(v, str) and v))
