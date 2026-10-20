"""Offline only. No agy, credentials, daemon, network listener or real subprocesses.

Run explicitly: python -m pytest scripts/test_gemini_flash_gateway.py
"""
import asyncio
import errno
import importlib.util
import json
from pathlib import Path
import signal
import stat

import httpx
import pytest


spec = importlib.util.spec_from_file_location(
    "gemini_flash_gateway_under_test", Path(__file__).with_name("gemini_flash_gateway.py")
)
gw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gw)


def init(model=gw.MODEL):
    return {"event": "init", "conversation_id": "offline", "init": {"model": model}}


def result(response='{"sections":[],"evidence_ids":["news:1"]}', **extra):
    return {"event": "result", "result": {
        "conversation_id": "offline", "status": "SUCCESS", "response": response,
        "denied_actions": [], **extra,
    }}


def wire(*events):
    return b"".join((json.dumps(event, ensure_ascii=False) + "\n").encode() for event in events)


def payload():
    return {"model": gw.MODEL, "temperature": 0, "max_tokens": 6000,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": "Return six sections and evidence IDs."},
                         {"role": "user", "content": '{"news":"public-only"}'}]}


class FakeProcess:
    def __init__(self, output=b"", stderr=b"", exited=False):
        self.pid = 87654321  # never passed to the OS: killpg is always mocked
        self.stdin = None
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.returncode = None
        self.ended = asyncio.Event()
        if output:
            self.stdout.feed_data(output)
        if stderr:
            self.stderr.feed_data(stderr)
        if exited:
            self.finish(0)

    def finish(self, code):
        if not self.ended.is_set():
            self.stdout.feed_eof()
            self.stderr.feed_eof()
            self.returncode = code
            self.ended.set()

    async def wait(self):
        await self.ended.wait()
        return self.returncode


@pytest.fixture
def native(monkeypatch):
    class Harness:
        output = wire(init(), result())
        stderr = b""
        exited = False
        mark_tool = False

        def __init__(self):
            self.calls = []
            self.signals = []
            self.proc = None
            self.spawned = None

        async def spawn(self, *args, **kwargs):
            self.calls.append((args, kwargs))
            root = Path(kwargs["cwd"])
            # Assert isolation at the moment of spawn, before temp cleanup.
            assert stat.S_IMODE(root.stat().st_mode) == 0o700
            assert set(p.name for p in root.iterdir()) == {".git", ".agents"}
            assert (root / ".git/HEAD").read_text() == "ref: refs/heads/main\n"
            assert "repositoryformatversion = 0" in (root / ".git/config").read_text()
            assert "bare = false" in (root / ".git/config").read_text()
            assert (root / ".git/objects").is_dir()
            assert (root / ".git/refs/heads").is_dir()
            hooks = root / ".agents/hooks.json"
            assert stat.S_IMODE(hooks.stat().st_mode) == 0o600
            hook = json.loads(hooks.read_text())["ytrader-deny"]["PreToolUse"][0]
            assert hook["matcher"] == "*"
            assert "--deny-tools-hook" in hook["hooks"][0]["command"]
            assert "--attempt-marker" in hook["hooks"][0]["command"]
            assert kwargs["start_new_session"] is True
            assert kwargs["stdin"] == asyncio.subprocess.DEVNULL
            assert kwargs["env"]["PWD"] == str(root)
            assert not any(key.startswith("GIT_") for key in kwargs["env"])
            if self.mark_tool:
                gw.private_write(root / ".agents/tool-attempted", "denied\n")
            self.proc = FakeProcess(self.output, self.stderr, self.exited)
            if self.spawned:
                self.spawned.set()
            return self.proc

        def killpg(self, pid, sig):
            assert self.proc is not None and pid == self.proc.pid
            self.signals.append((pid, sig))
            self.proc.finish(-sig)

    harness = Harness()
    monkeypatch.setattr(gw.asyncio, "create_subprocess_exec", harness.spawn)
    monkeypatch.setattr(gw.os, "killpg", harness.killpg)
    return harness


def test_success_reclaims_still_running_cli_and_uses_verified_argv(native, monkeypatch):
    monkeypatch.setenv("GIT_WORK_TREE", "/not-the-request-workspace")
    native.output = wire(init(), result('```json\n{"ok":true}\n```'))
    content, usage = asyncio.run(gw.Gateway().invoke("public prompt"))
    assert json.loads(content) == {"ok": True}
    assert usage is None  # no synthesized zero tokens
    args, kwargs = native.calls[0]
    assert args[-2:] == ("-p", "public prompt")
    assert args[args.index("--model") + 1] == gw.MODEL
    assert "--disable-slash-commands" in args
    assert "--dangerously-skip-permissions" not in args
    assert "--add-dir" not in args
    assert args[args.index("--print-timeout") + 1] == "160s"
    assert native.proc.stdin is None
    assert [sig for _, sig in native.signals] == [signal.SIGTERM, signal.SIGKILL]
    assert not Path(kwargs["cwd"]).exists()


@pytest.mark.parametrize("events", [
    [init("other-model"), result()],
    [result()],
    [init(), result(model="other-model")],
    [init(), {"event": "step_update", "step_update": {
        "step_type": "tool", "tool_name": "read_file", "step_index": 1,
        "state": "SUCCESS", "tool_info": {"name": "read_file", "error": None, "output": ""}}}, result()],
    [init(), result(denied_actions=[{"tool": "browser"}])],
    [init(), {"event": "error", "error": "DO_NOT_LEAK_NATIVE_ERROR"}],
    [init(), result(status="ERROR")],
    [init(), result(status="success")],
    [init(), result(response="garbage {\"ok\":true}")],
    [init(), result(response='{"ok":true} trailing')],
    [init(), result(response='{"a":1,"a":2}')],
    [init(), result(response='{"a":NaN}')],
    [init(), result(response='{"a":1e999}')],
    [init(), result(response='[{"ok":true}]')],
    [init(), result(response='```json\n{}\n```\nextra')],
    [init(), result(response='```python\n{}\n```')],
    [init(), {"event": "result", "result": {"status": "SUCCESS"}}],
    [init(), result(), result()],
])
def test_native_protocol_fails_closed_and_cleans_own_group(native, events):
    native.output = wire(*events)
    with pytest.raises(gw.BridgeError):
        asyncio.run(gw.Gateway().invoke("public"))
    assert native.signals
    assert not Path(native.calls[0][1]["cwd"]).exists()


def test_eof_without_result_is_failure(native):
    native.output = wire(init(), {"event": "step_update", "step_update": {"step_type": "text"}})
    native.exited = True
    with pytest.raises(gw.BridgeError, match="native_missing_success"):
        asyncio.run(gw.Gateway().invoke("public"))
    assert native.signals


def test_timeout_cleans_process_group(native, monkeypatch):
    native.output = wire(init())
    monkeypatch.setattr(gw, "TOTAL_TIMEOUT", 0.01)
    with pytest.raises(gw.BridgeError, match="native_timeout") as exc:
        asyncio.run(gw.Gateway().invoke("public"))
    assert exc.value.status == 504
    assert native.signals


def test_hook_side_channel_rejects_even_success(native):
    native.mark_tool = True
    with pytest.raises(gw.BridgeError, match="tool_attempt_denied"):
        asyncio.run(gw.Gateway().invoke("public"))


@pytest.mark.parametrize("stderr", [False, True])
def test_combined_native_output_is_bounded(native, monkeypatch, stderr):
    monkeypatch.setattr(gw, "MAX_NATIVE", 1024)
    if stderr:
        native.output = wire(init())
        native.stderr = b"private stderr" * 200
    else:
        native.output = b"x" * 1025
    with pytest.raises(gw.BridgeError, match="native_output_limit"):
        asyncio.run(gw.Gateway().invoke("public"))
    assert native.signals


def test_response_json_limit(native, monkeypatch):
    monkeypatch.setattr(gw, "MAX_RESPONSE", 10)
    with pytest.raises(gw.BridgeError, match="invalid_model_json"):
        asyncio.run(gw.Gateway().invoke("public"))


def test_usage_does_not_invent_missing_fields(native):
    native.output = wire(init(), result(usage={"prompt_tokens": 12, "completion_tokens": True}))
    _, usage = asyncio.run(gw.Gateway().invoke("public"))
    assert usage == {"prompt_tokens": 12}


def test_argv_byte_cap_rejects_before_spawning(native):
    with pytest.raises(gw.BridgeError, match="prompt_too_large_for_argv") as exc:
        asyncio.run(gw.Gateway().invoke("中" * (gw.MAX_ARGV_PROMPT // 3 + 1)))
    assert exc.value.status == 413 and not native.calls


def test_e2big_is_bounded_safe_error(monkeypatch):
    async def too_big(*args, **kwargs):
        raise OSError(errno.E2BIG, "DO_NOT_LEAK_PROMPT")
    monkeypatch.setattr(gw.asyncio, "create_subprocess_exec", too_big)
    with pytest.raises(gw.BridgeError, match="cli_argument_limit") as exc:
        asyncio.run(gw.Gateway().invoke("public"))
    assert exc.value.status == 413
    assert "DO_NOT_LEAK" not in str(exc.value)


def client_for(app, peer="127.0.0.1"):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(peer, 45678)),
                             base_url="http://127.0.0.1:58732")


@pytest.mark.parametrize("change", [
    {"model": "gemini-fallback"}, {"stream": True}, {"stream": False}, {"tools": []},
    {"tool_choice": "none"}, {"temperature": 1}, {"temperature": False},
    {"max_tokens": True}, {"max_tokens": 6001}, {"response_format": {"type": "text"}},
    {"messages": []}, {"messages": [{"role": "assistant", "content": "hi"}]},
    {"messages": [{"role": "tool", "content": "hi"}]},
    {"messages": [{"role": "user", "content": [{"text": "hi"}]}]},
    {"messages": [{"role": "user", "content": "x", "tool_calls": []}]},
])
def test_invalid_http_requests_never_spawn(native, change):
    async def scenario():
        app = gw.create_app()
        body = {**payload(), **change}
        async with client_for(app) as client:
            response = await client.post("/v1/chat/completions", json=body)
        assert response.status_code == 400
        assert not app.state.gateway.busy
    asyncio.run(scenario())
    assert not native.calls


def test_invalid_json_and_body_size(native):
    async def scenario():
        async with client_for(gw.create_app()) as client:
            for body in (b"[]", b"{", b'{"model":1,"model":2}'):
                response = await client.post("/v1/chat/completions", content=body,
                                             headers={"Content-Type": "application/json"})
                assert response.status_code == 400
            response = await client.post("/v1/chat/completions", content=b"x" * (gw.MAX_BODY + 1),
                                         headers={"Content-Type": "application/json"})
            assert response.status_code == 413
            async def chunks():
                yield b"x" * (gw.MAX_BODY // 2)
                yield b"x" * (gw.MAX_BODY // 2 + 1)
            response = await client.post("/v1/chat/completions", content=chunks(),
                                         headers={"Content-Type": "application/json"})
            assert response.status_code == 413
    asyncio.run(scenario())
    assert not native.calls


@pytest.mark.parametrize("headers,status", [
    ({"Origin": "http://127.0.0.1:58732"}, 403),
    ({"Origin": "null"}, 403), ({"Host": "attacker.example:58732"}, 403),
    ({"Host": "127.0.0.1:8000"}, 403), ({"Content-Type": "text/plain"}, 415),
    ({"Content-Encoding": "gzip"}, 400),
])
def test_http_boundary(native, headers, status):
    async def scenario():
        async with client_for(gw.create_app()) as client:
            response = await client.post("/v1/chat/completions", json=payload(), headers=headers)
        assert response.status_code == status
        assert "access-control-allow-origin" not in response.headers
    asyncio.run(scenario())
    assert not native.calls


def test_non_loopback_peer_rejected(native):
    async def scenario():
        async with client_for(gw.create_app(), peer="192.0.2.10") as client:
            assert (await client.get("/health")).status_code == 403
    asyncio.run(scenario())
    assert not native.calls


def test_health_only_reports_executable_presence(tmp_path, monkeypatch):
    cli = tmp_path / "fake-agy"
    cli.write_text("not executed")
    cli.chmod(0o700)
    monkeypatch.setattr(gw, "CLI", cli)
    async def scenario():
        async with client_for(gw.create_app()) as client:
            health = (await client.get("/health")).json()
            assert health["cli_available"] is True
            assert health["authentication"] == "not_checked"
            models = (await client.get("/v1/models")).json()
            assert [item["id"] for item in models["data"]] == [gw.MODEL]
    asyncio.run(scenario())


def test_http_success_preserves_json_string_and_actual_model(native):
    async def scenario():
        async with client_for(gw.create_app()) as client:
            response = await client.post("/v1/chat/completions", json=payload())
            assert response.status_code == 200
            data = response.json()
            assert data["model"] == gw.MODEL and data["usage"] is None
            choice = data["choices"][0]
            assert choice["finish_reason"] == "stop"
            assert json.loads(choice["message"]["content"])["evidence_ids"] == ["news:1"]
    asyncio.run(scenario())


def test_429_has_no_queue_and_capacity_is_released():
    async def scenario():
        app = gw.create_app()
        started, release = asyncio.Event(), asyncio.Event()
        calls = 0
        async def invoke(prompt):
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return ('{"ok":true}', None)
        app.state.gateway.invoke = invoke
        async with client_for(app) as client:
            first = asyncio.create_task(client.post("/v1/chat/completions", json=payload()))
            await asyncio.wait_for(started.wait(), 1)
            busy = await client.post("/v1/chat/completions", json=payload())
            assert busy.status_code == 429 and calls == 1
            assert busy.headers["Retry-After"] == "1"
            release.set()
            assert (await first).status_code == 200
            assert (await client.post("/v1/chat/completions", json=payload())).status_code == 200
        assert calls == 2 and app.state.gateway.busy is False
    asyncio.run(scenario())


def test_parent_cancellation_reaps_process_and_releases_capacity(native):
    native.output = wire(init())
    async def scenario():
        native.spawned = asyncio.Event()
        app = gw.create_app()
        async with client_for(app) as client:
            first = asyncio.create_task(client.post("/v1/chat/completions", json=payload()))
            await asyncio.wait_for(native.spawned.wait(), 1)
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
        assert native.signals and app.state.gateway.busy is False
        assert not Path(native.calls[0][1]["cwd"]).exists()
    asyncio.run(scenario())


def test_failure_releases_capacity_and_never_leaks_native_output(native):
    native.output = wire(init(), {"event": "error", "error": "SECRET_NATIVE_OUTPUT"})
    native.stderr = b"SECRET_NATIVE_STDERR"
    async def scenario():
        app = gw.create_app()
        async with client_for(app) as client:
            response = await client.post("/v1/chat/completions", json=payload())
            assert response.status_code == 502
            assert "SECRET_NATIVE" not in response.text
            assert not app.state.gateway.busy
            native.output = wire(init(), result())
            native.stderr = b""
            assert (await client.post("/v1/chat/completions", json=payload())).status_code == 200
    asyncio.run(scenario())


def test_hook_always_denies_and_records_without_reading_input(tmp_path, capsys):
    marker = tmp_path / "attempted"
    gw.deny_tools_hook(str(marker))
    decision = json.loads(capsys.readouterr().out)
    assert decision["decision"] == "deny"
    assert decision["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert stat.S_IMODE(marker.stat().st_mode) == 0o600
    assert marker.read_text() == "denied\n"
    # Existing marker / inability to replace it does not switch to allowing tools.
    gw.deny_tools_hook(str(marker))
    assert json.loads(capsys.readouterr().out)["decision"] == "deny"


def test_message_and_total_prompt_limits():
    body = payload()
    body["messages"][1]["content"] = "中" * (gw.MAX_MESSAGE // 3 + 1)
    with pytest.raises(gw.BridgeError):
        gw.validate_request(json.dumps(body).encode())
    body = payload()
    body["messages"] = [{"role": "user", "content": "a" * gw.MAX_MESSAGE} for _ in range(5)]
    with pytest.raises(gw.BridgeError):
        gw.validate_request(json.dumps(body).encode())
