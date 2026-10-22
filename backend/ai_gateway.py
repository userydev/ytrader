"""Single bounded AI transport. The ycore sync contract is a future boundary,
not an adapter for today's policy-controlled /ycore/v1/model-invocations API.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass
from urllib.parse import urlsplit

from pydantic import ValidationError

from .adapters import UpstreamError
from .ai_providers import request_model
from .config import UserError
from .models import AIChatRequest, iso

PURPOSES = ('connection_test', 'event_analysis', 'company_analysis', 'industry_structure',
            'industry_association', 'industry_impact', 'curated_candidate', 'restricted_decision')
MAX_INPUT_BYTES = 500000
MAX_OUTPUT_TOKENS = 8000


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def direct_headers(connection):
    headers = {'Content-Type': 'application/json'}
    if connection['key']:
        headers['Authorization'] = 'Bearer ' + connection['key']
    if urlsplit(connection['base_url']).hostname == 'gateway.ai.cloudflare.com':
        key = os.environ.get('YTRADER_CF_AIG_TOKEN', '')
        if key:
            headers['cf-aig-authorization'] = 'Bearer ' + key
    return headers


def model_headers(settings):
    """Compatibility export, exclusively for the direct model credential."""
    with settings.lock:
        return direct_headers(dict(base_url=settings.get().model_base_url, key=settings.key('model')))


def validate_request(value):
    try:
        request = value if isinstance(value, AIChatRequest) else AIChatRequest.model_validate(value)
        if len(canonical([m.model_dump() for m in request.messages]).encode('utf-8')) > MAX_INPUT_BYTES:
            raise UserError('AI 输入超过 500000 字节限制', 413)
        if request.model is not None and not request.model.strip():
            raise ValueError()
        return request
    except UserError:
        raise
    except (ValidationError, ValueError, TypeError):
        raise UserError('AI 请求不符合 v1 契约', 422) from None


@dataclass(frozen=True)
class ChatResult:
    request_id: str
    provider: str
    model: str
    content: str
    usage: dict | None = None

    def data(self):
        return dict(contract_version='1', request_id=self.request_id, provider=self.provider,
                    model=self.model, content=self.content, finish_reason='stop', usage=self.usage)


class AIGateway:
    def __init__(self, settings, network):
        self.settings, self.network = settings, network

    def capabilities(self):
        config = self.settings.get()
        configured = False
        if config.ai_mode == 'local':
            try:
                self.settings.local_analysis_ready()
                configured = True
            except UserError:
                pass
        return dict(contract_version='1', transport='sync', configured=configured,
                    chat_endpoint='/api/v1/ai/chat', purposes=list(PURPOSES), response_formats=['text', 'json'],
                    max_input_bytes=MAX_INPUT_BYTES, max_output_tokens=MAX_OUTPUT_TOKENS,
                    models=[config.model_name] if config.ai_mode == 'local' and config.model_name else [])

    def chat(self, purpose, messages, *, max_output_tokens, response_format='json', expected=None,
             request_id=None, model=None, direct_only=False, connection=None):
        # Job identity is stable across process recovery; hashes never enter durable payloads.
        if request_id is None and expected and expected.get('ai_job_id'):
            identity = canonical(dict(purpose=purpose, messages=messages, tokens=max_output_tokens,
                                      format=response_format, model=model))
            request_id = str(uuid.uuid5(uuid.UUID(expected['ai_job_id']), identity))
        request = validate_request(dict(contract_version='1', request_id=request_id or str(uuid.uuid4()),
            purpose=purpose, messages=messages, max_output_tokens=max_output_tokens,
            response_format=response_format, model=model))
        connection = connection or self.settings.capture_ai(expected, direct_only=direct_only)
        if direct_only and connection['provider'] != 'openai-compatible':
            raise UserError('参考 AI gateway 禁止转发 ycore gateway', 409)
        if connection['provider'] == 'ycore':
            result = self._ycore(connection, request)
        else:
            result = self._direct(connection, request)
        sensitive = connection['sensitive'] + (os.environ.get('YTRADER_CF_AIG_TOKEN', ''),)
        # Reject credential echoes before a service can persist prose or metadata.
        if any(key and key in canonical(result.data()) for key in sensitive):
            raise UpstreamError('AI 响应包含敏感配置；结果未保存')
        if expected is not None:
            with self.settings.lock:
                self.settings.check_ai_destination(expected)
        return result

    @staticmethod
    def _result(request, provider, model, content, usage):
        if (not isinstance(provider, str) or not provider.strip() or len(provider) > 200
                or not isinstance(model, str) or not model.strip() or len(model) > 200
                or not isinstance(content, str) or not content.strip()
                or len(content.encode('utf-8')) > 1000000
                or (usage is not None and not isinstance(usage, dict))):
            raise ValueError()
        canonical(usage)
        if request.response_format == 'json':
            canonical(json.loads(content))
        return ChatResult(request.request_id, provider, model, content, usage)

    def _direct(self, connection, request):
        headers = {k: v for k, v in direct_headers(connection).items() if k == 'cf-aig-authorization'}
        model, content, usage = request_model(self.network, connection, request, extra_headers=headers)
        try:
            return self._result(request, 'openai-compatible', model, content, usage)
        except (TypeError, ValueError, AttributeError, UnicodeError):
            raise UpstreamError('模型未返回完整有效回答（截断、拒答或工具输出已拒绝）') from None

    @staticmethod
    def _envelope(raw):
        try:
            meta = raw['meta']
            if (not isinstance(meta, dict) or meta.get('version') != '1' or meta.get('completeness') != 'complete'
                    or not isinstance(meta.get('source'), str) or not meta['source'].strip()
                    or 'as_of' not in meta or not isinstance(meta.get('warnings'), list)
                    or any(not isinstance(w, str) for w in meta['warnings'])):
                raise ValueError()
            iso(meta['as_of'])
            if not isinstance(raw['data'], dict):
                raise ValueError()
            return raw['data']
        except (KeyError, TypeError, ValueError, AttributeError):
            raise UpstreamError('ycore AI 响应元数据不符合 v1 契约；未回退本地') from None

    def _ycore(self, connection, request):
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
        if connection['key']:
            headers['Authorization'] = 'Bearer ' + connection['key']
        base = connection['base_url']
        try:
            raw = self.network.json('GET', base + '/api/v1/ai/capabilities', headers=headers)
        except UpstreamError as exc:
            if exc.http_status in (404, 405, 501):
                raise UserError('ycore 尚未提供同步 AI v1 gateway 能力；请升级服务，未回退本地', 501) from None
            raise
        cap = self._envelope(raw)
        try:
            if (set(cap) != {'contract_version', 'transport', 'configured', 'chat_endpoint', 'purposes',
                             'response_formats', 'max_input_bytes', 'max_output_tokens', 'models'}
                    or cap.get('contract_version') != '1' or cap.get('transport') != 'sync'
                    or type(cap.get('configured')) is not bool
                    or cap.get('chat_endpoint') != '/api/v1/ai/chat'
                    or not isinstance(cap.get('purposes'), list) or any(p not in PURPOSES for p in cap['purposes'])
                    or not isinstance(cap.get('response_formats'), list) or any(f not in ('text', 'json') for f in cap['response_formats'])
                    or type(cap.get('max_input_bytes')) is not int or not 1 <= cap['max_input_bytes'] <= MAX_INPUT_BYTES
                    or type(cap.get('max_output_tokens')) is not int or not 1 <= cap['max_output_tokens'] <= MAX_OUTPUT_TOKENS
                    or not isinstance(cap.get('models'), list)
                    or any(not isinstance(m, str) or not m.strip() or len(m) > 200 for m in cap['models'])):
                raise ValueError()
        except (TypeError, ValueError):
            raise UpstreamError('ycore AI capabilities 不符合 v1 契约；未回退本地') from None
        if not cap['configured']:
            raise UserError('ycore 尚未完成 AI 模型配置', 409)
        model = request.model or connection['model']
        if (request.purpose not in cap['purposes'] or request.response_format not in cap['response_formats']
                or request.max_output_tokens > cap['max_output_tokens']
                or len(canonical([m.model_dump() for m in request.messages]).encode('utf-8')) > cap['max_input_bytes']
                or (model and model not in cap['models'])):
            raise UserError('ycore 不支持所请求的 AI 用途、模型、格式或限额；未回退本地', 501)
        body = request.model_dump(exclude_none=True)
        if model:
            body['model'] = model
        headers['Idempotency-Key'] = request.request_id
        raw = self.network.json('POST', base + '/api/v1/ai/chat', headers=headers, body=body, timeout=180)
        data = self._envelope(raw)
        try:
            if (set(data) != {'contract_version', 'request_id', 'provider', 'model', 'content', 'finish_reason', 'usage'}
                    or data['contract_version'] != '1' or data['request_id'] != request.request_id
                    or data['finish_reason'] != 'stop'):
                raise ValueError()
            return self._result(request, data['provider'], data['model'], data['content'], data['usage'])
        except (KeyError, TypeError, ValueError, UnicodeError):
            raise UpstreamError('ycore AI 响应身份或完整性无效；未回退本地') from None

    def serve(self, request):
        request = validate_request(request)
        connection = self.settings.capture_ai(direct_only=True)
        if request.model is not None and request.model != connection['model']:
            raise UserError('参考 gateway 仅提供已配置的模型', 422)
        return self.chat(request.purpose, [m.model_dump() for m in request.messages],
            max_output_tokens=request.max_output_tokens, response_format=request.response_format,
            request_id=request.request_id, model=request.model, direct_only=True, connection=connection).data()

    def test(self):
        connection = self.settings.capture_ai()
        started = time.monotonic()
        result = self.chat('connection_test', [{'role': 'user', 'content': 'Reply only with the JSON object {"ok":true}.'}],
                           max_output_tokens=256, response_format='json', connection=connection)
        return dict(ok=True, provider=connection['provider'], model=result.model,
                    latency_ms=round((time.monotonic() - started) * 1000, 2), contract_version='1')
