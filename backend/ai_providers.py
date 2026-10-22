"""Direct model requests only: SDK protocol mapping over the bounded app Network."""
from __future__ import annotations

import asyncio
import json
from dataclasses import asdict
from urllib.parse import unquote, urlsplit

import httpx2 as httpx
from anthropic import AsyncAnthropic
from google.genai.types import HttpRetryOptions
from openai import AsyncOpenAI
from pydantic_ai.direct import model_request
from pydantic_ai.messages import (
    ModelRequest, ModelResponse, SystemPromptPart, TextPart, ThinkingPart, UserPromptPart,
)
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.profiles.openai import OpenAIModelProfile
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.openai import OpenAIProvider

from .adapters import UpstreamError

INVALID_OUTPUT = '模型未返回完整有效回答（截断、拒答或工具输出已拒绝）'


class NetworkTransport(httpx.AsyncBaseTransport):
    """No sockets here. Even SDK traffic uses the injected Network and its limits."""
    def __init__(self, network, connection, request_id, extra_headers):
        self.network = network
        self.connection = connection
        self.base = urlsplit(connection['base_url'])
        self.request_id = request_id
        self.extra_headers = extra_headers
        self.calls = 0
        self.error = None
        self.response_body = None

    async def handle_async_request(self, request):
        try:
            target = urlsplit(str(request.url))
            base_path = unquote(self.base.path).rstrip('/')
            path = unquote(target.path)
            def origin(url):
                return url.scheme, url.hostname, url.port or (443 if url.scheme == 'https' else 80)
            if (self.calls or request.method != 'POST'
                    or origin(target) != origin(self.base)
                    or not path.startswith(base_path + '/')
                    or any(part in ('.', '..') for part in path.split('/'))
                    or target.username or target.password or target.fragment):
                raise UpstreamError('SDK 请求超出已保存的 AI 服务范围或尝试重复请求')
            self.calls += 1
            content = await request.aread()
            if len(content) > 1000000:
                raise UpstreamError('AI 请求大小超过限制')
            # Keep protocol headers, but never SDK environment org/project or credentials.
            auth_header = {'openai': 'authorization', 'gemini': 'x-goog-api-key',
                           'anthropic': 'x-api-key'}[self.connection.get('api_format', 'openai')]
            allowed = {'content-type', 'accept', 'anthropic-version', 'anthropic-beta', auth_header}
            headers = {k: v for k, v in request.headers.items() if k in allowed}
            key = self.connection['key']
            if not key:
                headers.pop(auth_header, None)
            elif auth_header in headers and headers[auth_header] not in (key, 'Bearer ' + key):
                raise UpstreamError('SDK 认证配置不符合已保存的 AI 连接')
            headers.update(self.extra_headers)
            headers['Idempotency-Key'] = self.request_id
            raw = self.network.request('POST', str(request.url), headers=headers,
                                       body=json.loads(content), timeout=180, with_response=True)
            self.response_body = raw['body']
            # Network already decoded transfer/content encodings. Do not decode twice.
            return httpx.Response(raw['status'], content=raw['body'], request=request,
                                  headers={'content-type': raw['headers'].get('content-type', 'application/json')})
        except UpstreamError as exc:
            self.error = exc
            raise


def sdk_messages(messages):
    result = []
    for message in messages:
        if message.role == 'assistant':
            result.append(ModelResponse(parts=[TextPart(message.content)]))
        else:
            part = SystemPromptPart(message.content) if message.role == 'system' else UserPromptPart(message.content)
            result.append(ModelRequest(parts=[part]))
    return result


async def _request(connection, request, transport):
    async with httpx.AsyncClient(transport=transport, follow_redirects=False, trust_env=False, timeout=180) as client:
        name = request.model or connection['model']
        api_format = connection.get('api_format', 'openai')
        settings = {'max_tokens': request.max_output_tokens}
        json_output = request.response_format == 'json'
        if api_format == 'gemini':
            provider = GoogleProvider(api_key=connection['key'], base_url=connection['base_url'],
                                      http_client=client, retry_options=HttpRetryOptions(attempts=1))
            model = GoogleModel(name, provider=provider)
        elif api_format == 'anthropic':
            sdk = AsyncAnthropic(api_key=connection['key'], auth_token='', base_url=connection['base_url'],
                                 http_client=client, max_retries=0)
            model = AnthropicModel(name, provider=AnthropicProvider(anthropic_client=sdk))
        else:
            options = connection['options']
            sdk = AsyncOpenAI(api_key=connection['key'] or 'unused-loopback-key',
                              base_url=connection['base_url'], organization='', project='',
                              http_client=client, max_retries=0)
            profile = OpenAIModelProfile(
                openai_chat_supports_max_completion_tokens=options['token_limit_field'] == 'max_completion_tokens',
                supports_json_object_output=options['json_mode'])
            model = OpenAIChatModel(name, provider=OpenAIProvider(openai_client=sdk), profile=profile)
            if options['send_temperature']:
                settings['temperature'] = 0
            json_output = json_output and options['json_mode']
        return await model_request(model, sdk_messages(request.messages), model_settings=settings,
                                   model_request_parameters=ModelRequestParameters(
                                       output_mode='prompted' if json_output else 'text'), instrument=False)


def request_model(network, connection, request, *, extra_headers=None):
    transport = NetworkTransport(network, connection, request.request_id, extra_headers or {})
    try:
        response = asyncio.run(_request(connection, request, transport))
        # Retain legacy integrity checks for markers the SDK may omit from its
        # normalized parts (notably refusal alongside text). No protocol mapping.
        if connection.get('api_format', 'openai') == 'openai':
            value = json.loads(transport.response_body)
            choices = value.get('choices', [])
            if (len(choices) != 1 or choices[0].get('finish_reason') != 'stop'
                    or (value.get('usage') is not None and not isinstance(value['usage'], dict))):
                raise ValueError()
            message = choices[0].get('message', {})
            if (message.get('role', 'assistant') != 'assistant' or message.get('refusal')
                    or message.get('tool_calls') or message.get('function_call')):
                raise ValueError()
        if (response.finish_reason != 'stop'
                or any(not isinstance(part, (TextPart, ThinkingPart)) for part in response.parts)
                or (response.provider_details or {}).get('refusal')):
            raise UpstreamError(INVALID_OUTPUT)
        content = ''.join(part.content for part in response.parts if isinstance(part, TextPart))
        model = response.model_name if response.model_name is not None else request.model or connection['model']
        return model, content, asdict(response.usage)
    except Exception:
        # SDK exceptions can contain request URLs, keys and response bodies. Only
        # our local Network classifications are safe to expose or persist.
        if transport.error is not None:
            raise transport.error from None
        raise UpstreamError(INVALID_OUTPUT) from None
