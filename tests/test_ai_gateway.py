"""Focused offline gateway/config contracts. No live ycore compatibility claim."""
import json
import uuid
from copy import deepcopy

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.adapters import Network, UpstreamError
from backend.ai_gateway import AIGateway, PURPOSES, validate_request
from backend.app import create_app, envelope
from backend.config import UserError
from backend.models import AIConfigUpdate, ConfigUpdate


def direct(**changes):
    return dict(provider='openai-compatible', base_url='http://127.0.0.1:58732/v1',
                model='custom-model', **changes)


def request_data(**changes):
    value = dict(contract_version='1', request_id=str(uuid.uuid4()), purpose='event_analysis',
                 messages=[dict(role='user', content='Synthetic bounded input')],
                 max_output_tokens=6000, response_format='json')
    value.update(changes)
    return value


def completion(content='{"ok":true}', **changes):
    value = dict(id='chatcmpl-synthetic', object='chat.completion', created=1700000000,
                 model='actual-model', choices=[dict(index=0, finish_reason='stop',
                 message=dict(role='assistant', content=content))], usage=None)
    value.update(changes)
    return value


def capabilities():
    return dict(contract_version='1', transport='sync', configured=True,
                chat_endpoint='/api/v1/ai/chat', purposes=list(PURPOSES), response_formats=['text', 'json'],
                max_input_bytes=500000, max_output_tokens=8000, models=['remote-model'])


def make_app(tmp_path, handler):
    return create_app(tmp_path / 'gateway-data', network=Network(httpx.MockTransport(handler)), start_worker=False)


def test_scoped_config_and_profiles_never_probe_or_expose_secrets(tmp_path):
    calls = []
    app = make_app(tmp_path, lambda r: calls.append(r))
    settings = app.state.settings
    settings.update(ConfigUpdate(data_mode='ycore', ycore_url='https://data.example',
                                ycore_api_key='private-data-key', auto_analyze=True, sync_interval_minutes=71))
    with TestClient(app) as client:
        initial = client.get('/api/v1/ai/config').json()['data']
        assert initial['revision'] == 0
        result = client.put('/api/v1/ai/config', json=direct(api_key='private-model-key'))
        assert result.status_code == 200
        data = result.json()['data']
        assert data['provider'] == 'openai-compatible' and data['revision'] == 1
        assert data['profiles']['openai-compatible']['key_set'] is True
        assert data['profiles']['openai-compatible']['api_format'] == 'openai'
        assert data['profiles']['openai-compatible']['options'] == dict(
            token_limit_field='max_tokens', send_temperature=True, json_mode=True)
        config = settings.get()
        assert (config.data_mode, config.ycore_url, config.auto_analyze, config.sync_interval_minutes) == (
            'ycore', 'https://data.example', True, 71)
        assert settings.key('ycore') == 'private-data-key'
        assert 'private-model-key' not in result.text and 'private-data-key' not in result.text
        assert client.put('/api/v1/ai/config', json=dict(direct(), data_mode='local')).status_code == 422
        assert client.put('/api/v1/ai/config', json=dict(direct(), revision=100)).status_code == 422
        assert client.put('/api/v1/config', json={'ai_config_revision': 100}).status_code == 422
        assert client.get('/api/v1/ai/capabilities').json()['data']['configured'] is True
    assert calls == []


def test_destination_normalization_key_binding_and_effective_revision(app):
    settings = app.state.settings
    save = lambda **kw: settings.update_ai(AIConfigUpdate(**kw))
    first = save(**direct(api_key='bound-model-key'))
    assert first['revision'] == 1
    same = direct(api_key='')
    same['base_url'] += '/chat/completions/'
    assert save(**same)['revision'] == 1
    assert settings.key('model') == 'bound-model-key'
    changed = direct()
    changed['base_url'] = 'https://different.example/prefix/v1'
    assert not save(**changed)['profiles']['openai-compatible']['key_set']
    assert settings.key('model') == ''
    changed['api_key'] = 'new-destination-key'
    assert save(**changed)['revision'] == 3
    before = settings.get().ai_config_revision
    with pytest.raises(UserError):
        save(**dict(changed, clear_api_key=True))
    assert settings.get().ai_config_revision == before
    assert settings.key('model') == 'new-destination-key'
    assert save(**dict(changed, api_key='', clear_api_key=True))['revision'] == before + 1
    # Other settings never increment the AI revision.
    settings.update(ConfigUpdate(sync_interval_minutes=90, auto_analyze=True))
    assert settings.get().ai_config_revision == before + 1


def test_legacy_read_only_fallback_never_copies_data_key(app):
    settings = app.state.settings
    settings.update(ConfigUpdate(ai_mode='ycore', ycore_url='https://legacy.example/api/v1', ycore_api_key='legacy-data-secret'))
    legacy = settings.ai_config()['profiles']['ycore']
    assert legacy == dict(base_url='https://legacy.example', model='', key_set=True, legacy_connection=True)
    assert settings.capture_ai()['key'] == 'legacy-data-secret'
    with pytest.raises(UserError, match='独立 AI gateway'):
        settings.update(ConfigUpdate(ycore_url='https://other-data.example'))
    assert settings.get().ycore_url == 'https://legacy.example'
    settings.update_ai(AIConfigUpdate(provider='ycore', base_url='https://legacy.example/api/v1/', model='remote-model'))
    independent = settings.ai_config()['profiles']['ycore']
    assert independent == dict(base_url='https://legacy.example', model='remote-model', key_set=False, legacy_connection=False)
    assert settings.capture_ai()['key'] == ''
    assert settings.key('ycore') == 'legacy-data-secret'
    settings.update_ai(AIConfigUpdate(provider='ycore', base_url='https://ai.example', model='remote-model', api_key='ai-only-secret'))
    assert settings.capture_ai()['key'] == 'ai-only-secret'
    settings.update_ai(AIConfigUpdate(**direct(api_key='direct-only-secret')))
    assert settings.capture_ai()['key'] == 'direct-only-secret'
    assert settings.key('ai_gateway') == 'ai-only-secret'
    assert settings.key('ycore') == 'legacy-data-secret'
    settings.update(ConfigUpdate(ycore_url='https://new-data.example'))
    assert settings.get().model_base_url == 'http://127.0.0.1:58732/v1'
    assert settings.get().ai_gateway_url == 'https://ai.example'
    assert settings.key('ycore') == ''


@pytest.mark.parametrize('options', [None, dict(token_limit_field='max_completion_tokens', send_temperature=False, json_mode=False)])
def test_direct_payload_options_actual_model_and_stable_job_id(tmp_path, options):
    calls = []
    def upstream(request):
        calls.append(request)
        return httpx.Response(200, json=completion())
    app = make_app(tmp_path, upstream)
    fields = direct(api_key='direct-secret')
    fields['base_url'] = 'https://model.example/custom/v1/chat/completions'
    if options is not None:
        fields['options'] = options
    settings = app.state.settings
    settings.update_ai(AIConfigUpdate(**fields))
    settings.update(ConfigUpdate(ycore_url='https://data.example', ycore_api_key='data-secret'))
    gateway = AIGateway(settings, app.state.network)
    job = dict(ai_job_id=str(uuid.uuid4()), ai_config_revision=settings.get().ai_config_revision)
    for _ in range(2):  # Explicit same-job reuse, not automatic retry.
        result = gateway.chat('event_analysis', [dict(role='user', content='Synthetic input')],
                              max_output_tokens=6000, expected=job)
        assert result.model == 'actual-model'
    assert len(calls) == 2
    assert calls[0].headers['Idempotency-Key'] == calls[1].headers['Idempotency-Key']
    body = json.loads(calls[0].content)
    assert str(calls[0].url) == 'https://model.example/custom/v1/chat/completions'
    assert calls[0].headers['authorization'] == 'Bearer direct-secret'
    assert 'data-secret' not in str(calls[0].headers)
    if options is None:
        assert body['max_tokens'] == 6000 and body['temperature'] == 0
        assert body['response_format'] == {'type': 'json_object'}
    else:
        assert body['max_completion_tokens'] == 6000
        assert not {'max_tokens', 'temperature', 'response_format'} & body.keys()


@pytest.mark.parametrize('bad', ['length', 'missing_finish', 'refusal', 'tool', 'empty', 'invalid_json', 'bad_usage'])
def test_direct_incomplete_outputs_rejected_without_retry(tmp_path, bad):
    calls = []
    raw = completion()
    choice = raw['choices'][0]
    if bad == 'length':
        choice['finish_reason'] = 'length'
    elif bad == 'missing_finish':
        choice.pop('finish_reason')
    elif bad == 'refusal':
        choice['message']['refusal'] = 'not allowed'
    elif bad == 'tool':
        choice['message']['tool_calls'] = [{'id': 'tool'}]
    elif bad == 'empty':
        choice['message']['content'] = ' '
    elif bad == 'invalid_json':
        choice['message']['content'] = '{'
    else:
        raw['usage'] = []
    def upstream(request):
        calls.append(request)
        return httpx.Response(200, json=raw)
    app = make_app(tmp_path, upstream)
    app.state.settings.update_ai(AIConfigUpdate(**direct()))
    with pytest.raises(UpstreamError):
        AIGateway(app.state.settings, app.state.network).chat('event_analysis', [dict(role='user', content='x')], max_output_tokens=6000)
    assert len(calls) == 1


@pytest.mark.parametrize('status', [404, 405, 501])
def test_ycore_missing_capability_is_explicit_501_and_no_fallback(tmp_path, status):
    calls = []
    def upstream(request):
        calls.append(request)
        return httpx.Response(status)
    app = make_app(tmp_path, upstream)
    app.state.settings.update_ai(AIConfigUpdate(provider='ycore', base_url='https://future.example/api/v1', model='remote-model', api_key='ai-secret'))
    with TestClient(app) as client:
        response = client.post('/api/v1/ai/test')
    assert response.status_code == 501
    assert 'ai-secret' not in response.text
    assert len(calls) == 1 and calls[0].url.path == '/api/v1/ai/capabilities'


@pytest.mark.parametrize('bad', [None, 'version', 'meta', 'id', 'empty_model', 'long_model', 'finish', 'format', 'limit', 'purpose', 'request_model'])
def test_ycore_strict_contract_and_identity(tmp_path, bad):
    calls = []
    cap = capabilities()
    if bad == 'version':
        cap['contract_version'] = '2'
    if bad == 'format':
        cap['response_formats'] = ['text']
    if bad == 'limit':
        cap['max_output_tokens'] = 256
    if bad == 'purpose':
        cap['purposes'] = ['connection_test']
    if bad == 'request_model':
        cap['models'] = ['different-alias']
    def upstream(request):
        calls.append(request)
        assert request.url.host == 'future.example'
        assert request.headers['authorization'] == 'Bearer ai-secret'
        assert 'cf-aig-authorization' not in request.headers
        if request.method == 'GET':
            result = envelope(deepcopy(cap), 'future-ai')
            if bad == 'meta':
                result['meta']['as_of'] = 'not-a-date'
            return httpx.Response(200, json=result)
        assert request.url.path == '/api/v1/ai/chat'
        body = json.loads(request.content)
        assert body['model'] == 'remote-model' and body['contract_version'] == '1'
        assert body['request_id'] == request.headers['Idempotency-Key']
        data = dict(contract_version='1', request_id=body['request_id'], provider='future-provider',
                    model='remote-model', content='{"ok":true}', finish_reason='stop', usage={})
        if bad == 'id':
            data['request_id'] = str(uuid.uuid4())
        if bad == 'empty_model':
            data['model'] = ' '
        if bad == 'long_model':
            data['model'] = 'm' * 201
        if bad == 'finish':
            data['finish_reason'] = 'length'
        return httpx.Response(200, json=envelope(data, 'future-ai'))
    app = make_app(tmp_path, upstream)
    app.state.settings.update(ConfigUpdate(model_api_key='never-forward-model-secret', ycore_api_key='never-forward-data-secret'))
    app.state.settings.update_ai(AIConfigUpdate(provider='ycore', base_url='https://future.example', model='remote-model', api_key='ai-secret'))
    gateway = AIGateway(app.state.settings, app.state.network)
    if bad is None:
        result = gateway.chat('event_analysis', [dict(role='user', content='synthetic')], max_output_tokens=6000)
        assert result.model == 'remote-model' and result.provider == 'future-provider'
    else:
        with pytest.raises((UserError, UpstreamError)):
            gateway.chat('event_analysis', [dict(role='user', content='synthetic')], max_output_tokens=6000)
    assert len(calls) == (1 if bad in ('version', 'meta', 'format', 'limit', 'purpose', 'request_model') else 2)
    assert all('never-forward' not in str(r.headers) for r in calls)


def test_reference_api_contract_limits_and_no_recursion(tmp_path):
    calls = []
    def upstream(request):
        calls.append(request)
        return httpx.Response(200, json=completion())
    app = make_app(tmp_path, upstream)
    app.state.settings.update_ai(AIConfigUpdate(**direct()))
    with TestClient(app) as client:
        cap = client.get('/api/v1/ai/capabilities').json()['data']
        assert set(cap['purposes']) == set(PURPOSES)
        assert cap['max_input_bytes'] == 500000 and cap['max_output_tokens'] == 8000
        schema = client.get('/api/v1/contracts/ai').json()['data']
        assert schema['$id'] == 'urn:ytrader:ai:v1'
        body = request_data()
        response = client.post('/api/v1/ai/chat', json=body, headers={'Idempotency-Key': body['request_id']})
        assert response.status_code == 200
        assert response.json()['data']['request_id'] == body['request_id']
        assert response.json()['data']['model'] == 'actual-model'
        assert client.post('/api/v1/ai/chat', json=dict(body, contract_version='2')).status_code == 422
        assert client.post('/api/v1/ai/chat', json=dict(body, max_output_tokens=8001)).status_code == 422
        assert client.post('/api/v1/ai/chat', json=dict(body, messages=body['messages'] * 101)).status_code == 422
        assert client.post('/api/v1/ai/chat', json=body, headers={'Idempotency-Key': str(uuid.uuid4())}).status_code == 422
        oversized = dict(body, messages=[dict(role='user', content='中' * 180000)])
        assert client.post('/api/v1/ai/chat', json=oversized).status_code == 413
        assert len(calls) == 1
        app.state.settings.update_ai(AIConfigUpdate(provider='ycore', base_url='https://future.example', model='remote-model'))
        assert client.get('/api/v1/ai/capabilities').json()['data']['configured'] is False
        assert client.post('/api/v1/ai/chat', json=body).status_code == 409
        assert len(calls) == 1


@pytest.mark.parametrize('actual_model', ['remote-model', 'remote-model-2026-10-21'])
def test_reference_gateway_is_executable_via_mock_transport(tmp_path, actual_model):
    def direct_transport(request):
        assert json.loads(request.content)['model'] == 'remote-model'
        return httpx.Response(200, json=completion(model=actual_model))
    server = create_app(tmp_path / 'reference', start_worker=False,
        network=Network(httpx.MockTransport(direct_transport)))
    server.state.settings.update_ai(AIConfigUpdate(provider='openai-compatible', base_url='http://127.0.0.1/v1', model='remote-model'))
    with TestClient(server) as reference:
        def transport(request):
            if request.method == 'POST':
                assert json.loads(request.content)['model'] == 'remote-model'
            reply = reference.request(request.method, request.url.path, content=request.content, headers=dict(request.headers))
            if request.method == 'GET':
                assert reply.json()['data']['models'] == ['remote-model']
            return httpx.Response(reply.status_code, json=reply.json())
        client = create_app(tmp_path / 'consumer', start_worker=False, network=Network(httpx.MockTransport(transport)))
        client.state.settings.update_ai(AIConfigUpdate(provider='ycore', base_url='https://future.example', model='remote-model'))
        result = AIGateway(client.state.settings, client.state.network).test()
        assert result['ok'] and result['provider'] == 'ycore' and result['contract_version'] == '1'
        assert result['model'] == actual_model


@pytest.mark.parametrize('endpoint', ['/api/v1/ai/test', '/api/v1/config/test-model'])
def test_saved_custom_probe_uses_small_json_request(tmp_path, endpoint):
    calls = []
    def upstream(request):
        calls.append(request)
        assert str(request.url) == 'http://127.0.0.1:58732/v1/chat/completions'
        body = json.loads(request.content)
        assert body == dict(model='custom-model', stream=False, temperature=0, max_tokens=256,
                          response_format={'type': 'json_object'}, messages=[dict(
                              role='user', content='Reply only with the JSON object {"ok":true}.')])
        return httpx.Response(200, json=completion(model='custom-model'))
    app = make_app(tmp_path, upstream)
    with TestClient(app) as client:
        assert client.put('/api/v1/ai/config', json=direct()).status_code == 200
        assert client.get('/api/v1/ai/config').status_code == 200
        assert calls == []
        result = client.post(endpoint)
    assert result.status_code == 200 and result.json()['data']['ok'] is True
    assert len(calls) == 1


def test_captured_destination_and_revision_prevent_midflight_switch(tmp_path):
    calls = []
    app = None
    def upstream(request):
        calls.append(request)
        assert request.url.host == 'old.example'
        assert request.headers['authorization'] == 'Bearer old-secret'
        app.state.settings.update_ai(AIConfigUpdate(provider='openai-compatible', base_url='https://new.example/v1', model='new-model', api_key='new-secret'))
        return httpx.Response(200, json=completion())
    app = make_app(tmp_path, upstream)
    app.state.settings.update_ai(AIConfigUpdate(provider='openai-compatible', base_url='https://old.example/v1', model='old-model', api_key='old-secret'))
    expected = dict(ai_job_id=str(uuid.uuid4()), ai_config_revision=app.state.settings.get().ai_config_revision)
    gateway = AIGateway(app.state.settings, app.state.network)
    for _ in range(2):
        with pytest.raises(UserError, match='AI 配置已更改'):
            gateway.chat('event_analysis', [dict(role='user', content='synthetic')], max_output_tokens=6000, expected=expected)
    assert len(calls) == 1


@pytest.mark.parametrize('redirect', [False, True])
def test_secret_echo_and_redirect_are_rejected(tmp_path, redirect):
    calls = []
    def upstream(request):
        calls.append(request)
        if redirect:
            return httpx.Response(307, headers={'Location': 'https://untrusted.example/v1'})
        return httpx.Response(200, json=completion(content='private-model-secret'))
    app = make_app(tmp_path, upstream)
    app.state.settings.update_ai(AIConfigUpdate(**direct(api_key='private-model-secret')))
    with TestClient(app) as client:
        result = client.post('/api/v1/ai/test')
    assert result.status_code == 502
    assert 'private-model-secret' not in result.text
    assert len(calls) == 1


@pytest.mark.parametrize('host,expected', [('gateway.ai.cloudflare.com', True), ('other.example', False)])
def test_cloudflare_token_isolation(tmp_path, monkeypatch, host, expected):
    monkeypatch.setenv('YTRADER_CF_AIG_TOKEN', 'cf-only-secret')
    def upstream(request):
        assert ('cf-aig-authorization' in request.headers) is expected
        assert request.url.path == '/v1/account/gateway/compat/chat/completions'
        assert json.loads(request.content)['model'] == 'google-ai-studio/gemini-synthetic'
        return httpx.Response(200, json=completion())
    app = make_app(tmp_path, upstream)
    app.state.settings.update_ai(AIConfigUpdate(provider='openai-compatible', api_format='openai',
        base_url='https://' + host + '/v1/account/gateway/compat',
        model='google-ai-studio/gemini-synthetic', api_key='model-secret'))
    assert AIGateway(app.state.settings, app.state.network).test()['ok']


def test_ai_jobs_pin_revision_no_secrets_and_never_retry_billed_failure(app):
    settings, jobs = app.state.settings, app.state.jobs
    settings.update_ai(AIConfigUpdate(**direct(api_key='private-not-in-job')))
    calls = []
    def fail(jid, payload, update):
        calls.append(payload)
        raise UpstreamError('上游网络请求失败或超时')
    jobs.industry_research.run_association = fail
    job = jobs.enqueue('industry_associate', dict(input_version='synthetic-version'))
    with app.state.db.connect() as c:
        stored = c.execute('SELECT payload FROM jobs WHERE id=?', (job['id'],)).fetchone()[0]
    assert 'private-not-in-job' not in stored
    payload = json.loads(stored)
    assert payload['ai_config_revision'] == settings.get().ai_config_revision
    assert payload['ai_job_id'] == job['id']
    assert 'ai_gateway_url' in payload and 'ai_gateway_model' in payload
    assert jobs.run_one()
    assert app.state.db.job(job['id'])['status'] == 'failed'
    assert not jobs.run_one() and len(calls) == 1
    stale = jobs.enqueue('industry_associate', dict(input_version='another-version'))
    settings.update_ai(AIConfigUpdate(**direct(api_key='rotated-secret')))
    assert jobs.run_one()
    assert app.state.db.job(stale['id'])['status'] == 'failed'
    assert len(calls) == 1


def native_config(api_format, **changes):
    value = dict(provider='openai-compatible', api_format=api_format,
                 base_url='https://generativelanguage.googleapis.com' if api_format == 'gemini' else 'https://api.anthropic.com',
                 model='gemini-synthetic' if api_format == 'gemini' else 'claude-synthetic', api_key='native-only-key')
    value.update(changes)
    return value


def native_response(api_format, bad=None):
    if api_format == 'gemini':
        parts = [{'text': '{"ok":true}'}]
        finish = {'length': 'MAX_TOKENS', 'refusal': 'SAFETY'}.get(bad, 'STOP')
        if bad == 'tool':
            parts.append({'functionCall': {'name': 'not_allowed', 'args': {}}})
        if bad == 'thinking':
            parts.insert(0, {'text': 'Internal thought, not final JSON', 'thought': True})
        return dict(candidates=[dict(content=dict(role='model', parts=parts), finishReason=finish)],
                    modelVersion='gemini-actual', responseId='synthetic-google-response',
                    usageMetadata=dict(promptTokenCount=12, candidatesTokenCount=4, totalTokenCount=16))
    content = [{'type': 'text', 'text': '{"ok":true}'}]
    if bad == 'tool':
        content.append(dict(type='tool_use', id='toolu_synthetic', name='not_allowed', input={}))
    return dict(id='msg_synthetic', type='message', role='assistant', model='claude-actual', content=content,
                stop_reason={'length': 'max_tokens', 'refusal': 'refusal'}.get(bad, 'end_turn'), stop_sequence=None,
                usage=dict(input_tokens=12, output_tokens=4))


@pytest.mark.parametrize('api_format', ['gemini', 'anthropic'])
def test_native_sdk_protocol_json_actual_model_and_no_automatic_call(tmp_path, monkeypatch, api_format):
    monkeypatch.setenv('YTRADER_HOSTED', '1')
    monkeypatch.setenv('ANTHROPIC_AUTH_TOKEN', 'environment-token-must-not-be-used')
    calls = []
    def upstream(request):
        calls.append(request)
        body = json.loads(request.content)
        assert request.headers['Idempotency-Key']
        assert 'authorization' not in request.headers
        assert 'cf-aig-authorization' not in request.headers
        if api_format == 'gemini':
            assert str(request.url) == 'https://generativelanguage.googleapis.com/v1beta/models/gemini-synthetic:generateContent'
            assert request.headers['x-goog-api-key'] == 'native-only-key'
            assert 'x-api-key' not in request.headers
            assert body['generationConfig']['maxOutputTokens'] == 256
            assert body['generationConfig']['responseMimeType'] == 'application/json'
            assert body['contents'][0]['parts'][0]['text'] == 'Reply only with the JSON object {"ok":true}.'
            assert not {'messages', 'max_tokens', 'response_format'} & body.keys()
        else:
            assert str(request.url) == 'https://api.anthropic.com/v1/messages?beta=true'
            assert request.headers['x-api-key'] == 'native-only-key'
            assert 'x-goog-api-key' not in request.headers
            assert body['model'] == 'claude-synthetic' and body['max_tokens'] == 256
            assert body['messages'][0]['role'] == 'user'
            assert not {'response_format', 'max_completion_tokens', 'temperature'} & body.keys()
        return httpx.Response(200, json=native_response(api_format))
    app = make_app(tmp_path, upstream)
    with TestClient(app) as client:
        assert client.put('/api/v1/ai/config', json=native_config(api_format)).status_code == 200
        assert client.get('/api/v1/ai/config').json()['data']['profiles']['openai-compatible']['api_format'] == api_format
        assert calls == []
        result = client.post('/api/v1/ai/test')
    assert result.status_code == 200
    assert result.json()['data']['model'] == ('gemini-actual' if api_format == 'gemini' else 'claude-actual')
    assert len(calls) == 1


@pytest.mark.parametrize('api_format', ['gemini', 'anthropic'])
@pytest.mark.parametrize('bad', ['length', 'tool', 'refusal'])
def test_native_sdk_rejects_incomplete_or_tool_answers(tmp_path, api_format, bad):
    calls = []
    def upstream(request):
        calls.append(request)
        return httpx.Response(200, json=native_response(api_format, bad))
    app = make_app(tmp_path, upstream)
    app.state.settings.update_ai(AIConfigUpdate(**native_config(api_format)))
    with pytest.raises(UpstreamError):
        AIGateway(app.state.settings, app.state.network).test()
    assert len(calls) == 1


def test_sdk_thinking_is_not_final_json_and_usage_is_retained(tmp_path):
    app = make_app(tmp_path, lambda r: httpx.Response(200, json=native_response('gemini', 'thinking')))
    app.state.settings.update_ai(AIConfigUpdate(**native_config('gemini')))
    result = AIGateway(app.state.settings, app.state.network).serve(request_data())
    assert result['content'] == '{"ok":true}'
    assert result['usage']['input_tokens'] == 12 and result['usage']['output_tokens'] == 4


@pytest.mark.parametrize('api_format', ['openai', 'gemini', 'anthropic'])
@pytest.mark.parametrize('status', [429, 500])
def test_real_sdk_never_retries_http_errors_or_leaks_upstream_body(tmp_path, api_format, status):
    calls = []
    def upstream(request):
        calls.append(request)
        return httpx.Response(status, json={'error': {'message': 'native-only-key upstream-secret-body'}},
                              headers={'Retry-After': '0'})
    app = make_app(tmp_path, upstream)
    fields = native_config(api_format)
    if api_format == 'openai':
        fields['base_url'] = 'https://api.openai.com/v1'
    app.state.settings.update_ai(AIConfigUpdate(**fields))
    with TestClient(app) as client:
        result = client.post('/api/v1/ai/test')
    assert result.status_code in (status, 502, 503)
    assert 'native-only-key' not in result.text and 'upstream-secret-body' not in result.text
    assert len(calls) == 1


def test_protocol_change_clears_key_binds_revision_and_legacy_put_preserves_format(app):
    settings = app.state.settings
    fields = native_config('gemini')
    first = settings.update_ai(AIConfigUpdate(**fields))
    assert settings.capture_ai()['api_format'] == 'gemini'
    # An old client cannot silently switch an already saved native protocol.
    legacy = dict(fields)
    legacy.pop('api_format')
    legacy.pop('api_key')
    assert settings.update_ai(AIConfigUpdate(**legacy))['revision'] == first['revision']
    assert settings.key('model') == 'native-only-key'
    changed = dict(legacy, api_format='anthropic')  # Same URL, different protocol.
    result = settings.update_ai(AIConfigUpdate(**changed))
    assert result['revision'] == first['revision'] + 1
    assert settings.key('model') == ''
    with pytest.raises(UserError):
        settings.check_ai_destination({'ai_config_revision': first['revision']})
    with pytest.raises(UserError, match='API Key'):
        settings.capture_ai()
    assert settings.update_ai(AIConfigUpdate(**dict(changed, api_key='replacement-key')))['revision'] == first['revision'] + 2
    assert settings.key('model') == 'replacement-key'
    with pytest.raises(UserError, match='旧任务'):
        settings.check_ai_destination({'model_base_url': fields['base_url'], 'model_name': fields['model']})
    settings.update_ai(AIConfigUpdate(**dict(changed, api_format='gemini', api_key='same-save-new-key')))
    assert settings.key('model') == 'same-save-new-key'
    settings.update(ConfigUpdate(model_api_format='openai'))
    assert settings.key('model') == ''


@pytest.mark.parametrize('api_format', ['gemini', 'anthropic'])
def test_native_requires_saved_key_and_ignores_environment(tmp_path, monkeypatch, api_format):
    for name in ('GOOGLE_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY'):
        monkeypatch.setenv(name, 'environment-must-not-be-used')
    monkeypatch.setenv('YTRADER_HOSTED', '1')
    calls = []
    app = make_app(tmp_path, lambda r: calls.append(r))
    fields = native_config(api_format, api_key='')
    app.state.settings.update_ai(AIConfigUpdate(**fields))
    with TestClient(app) as client:
        assert client.post('/api/v1/ai/test').status_code == 409
    assert calls == []


def test_data_jobs_keep_retry_behavior(app):
    jobs = app.state.jobs
    def fail(_):
        raise UpstreamError('上游网络请求失败或超时')
    jobs.sync_securities = fail
    job = jobs.enqueue('securities')
    assert jobs.run_one()
    assert app.state.db.job(job['id'])['status'] == 'queued'


def test_recovery_does_not_repeat_unknown_running_ai_calls(app):
    jobs = app.state.jobs
    ai = jobs.enqueue('industry_associate', dict(input_version='interrupted-ai'))
    data = jobs.enqueue('securities')
    with app.state.db.transaction() as c:
        c.execute("UPDATE jobs SET status='running',attempts=1 WHERE id IN (?,?)", (ai['id'], data['id']))
    jobs.recover()
    assert app.state.db.job(ai['id'])['status'] == 'failed'
    assert app.state.db.job(data['id'])['status'] == 'queued'


@pytest.mark.parametrize('changes', [dict(purpose='unknown'), dict(response_format='xml'), dict(request_id='not-a-uuid'), dict(max_output_tokens=True)])
def test_request_boundary_rejects_unknown_identity_or_limits(changes):
    with pytest.raises(UserError):
        validate_request(request_data(**changes))
