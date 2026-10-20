# 本机 Gemini Flash 最小桥

当前只接 **`gemini-3.8-flash-medium`**，不做多模型平台，也没有模型 fallback。链路：已有 ytrader Chat Completions 客户端 → `127.0.0.1:58732/v1` → `/Users/Admin/.local/bin/agy` → 现有登录订阅。

## 启动、停止、登录

在项目根目录，使用已有安装了项目依赖的 Python 3.12+ 环境：

```sh
python scripts/gemini_flash_gateway.py
```

复用项目已有 FastAPI/uvicorn，不增加依赖。不自动启动、登录、扫描项目或改配置。只监听 **127.0.0.1:58732**，一个 worker；没有公网 host 参数。不要用多 worker、反向代理、公网转发或修改 bind 地址，否则会破坏本机边界/单并发约束。

前台 **Ctrl-C** 正常停止，或由宿主进程管理器向这个桥的 PID 发 SIGTERM；不要按进程名批量 kill agy，更不要杀共享 daemon。正常取消会回收本次创建的进程组。SIGKILL/断电不能保证任何 Python 清理逻辑执行。

登录由同一 macOS 用户的现有 `agy` 官方登录流程管理。若认证失效，由用户在可信终端按 CLI 提示重新登录；桥不读取、复制密钥或认证文件，不创建 `.env`，不改全局配置。**订阅额度、限流、模型可用性均由服务提供方决定，不承诺免费或无限调用。**

```sh
curl --noproxy '*' http://127.0.0.1:58732/health
curl --noproxy '*' http://127.0.0.1:58732/v1/models
```

`/health` 只检查固定 CLI 文件是否存在且可执行；`authentication: "not_checked"` 不是鉴权成功，也不检查额度或联网。`/v1/models` 只是固定协议声明，不是实时模型探测。

## 只更新已有 58730 实例的配置

由宿主操作，桥本身不改应用配置：

1. 进入**当前运行在 `127.0.0.1:58730` 的实例**已有的 AI 配置入口，先读取/备份当前配置；继续使用它原有的配置读写 API 或界面，不新建配置平台、不搜索其他实例/配置文件。
2. 仅把该实例已有的 **Chat Completions/local backend** 对应值更新为下表。保存时保留原有无关字段；如果原有 API 是整体替换，先读后只改这些值，不能用最小 JSON 覆盖整份配置。当前接入仅需配置 `ai_mode=local`、`model_base_url=http://127.0.0.1:58732/v1`、`model_name=gemini-3.8-flash-medium`；其他配置读前后相同。
3. 在该实例发起一次已有公司/新闻分析，确认请求到本桥及实际模型、six-sections 和证据 ID。长上下文若收到 413，必须在应用原有公共研究上下文裁剪层缩短，不能删除安全上限或悄悄截断 JSON。

| 已有配置的含义 | 目标值 |
| --- | --- |
| Chat Completions base URL | `http://127.0.0.1:58732/v1` |
| 如果字段要求完整 endpoint 而非 base URL | `http://127.0.0.1:58732/v1/chat/completions`，不要重复拼 `/v1` |
| model | `gemini-3.8-flash-medium` |
| 响应格式 | `json_object` |
| stream / tools | 不发送这些字段，包括 `stream: false` |
| 应用本机推理超时 | 180 秒，由应用侧独立实现 |

桥不需要 API key；若原有客户端 schema 必填，使用不含秘密的本机占位值即可，桥不据此宣称认证。不要把 Gemini 凭据填进应用配置。不自动发现或修改其他实例配置。

## 请求/响应与限制

```json
{
  "model": "gemini-3.8-flash-medium",
  "temperature": 0,
  "max_tokens": 6000,
  "response_format": {"type": "json_object"},
  "messages": [
    {"role": "system", "content": "应用现有 six-sections 与证据 ID 合约"},
    {"role": "user", "content": "应用序列化后的公共研究上下文 JSON"}
  ]
}
```

只接受这些顶层字段；`model`、`messages`、`response_format` 必填。只收文本 system/user 消息（1–16 条；system 至多一条且必须第一条；至少一条 user），拒绝 assistant/tool、附件、多模态、额外消息字段、空文本、重复 JSON key、NaN。拒绝 `stream`、`tools`、`tool_choice` 和未知参数。`temperature` 缺省 0 且只接受 0，`max_tokens` 缺省 6000 且只接受整数 1–6000。

**CLI 没有已确认的 temperature/max_tokens 精确控制：这两个字段只是兼容性验证，不会透传，也不保证 temperature=0 的确定性或严格的 token 截断。** JSON 输出由提示约束和最终严格解析保证；不合格就失败，不修补、提取垃圾中的 `{...}` 或伪造成功。

成功响应的 `model` 来自已核对的 init，`choices[0].finish_reason` 固定为 `stop`，`message.content` 是完整 JSON 对象的 JSON **字符串**。原生 usage 缺失时返回 `usage: null`；仅保留原生提供的有效标准 token 字段，不猜测统计、不补零/推算总数。桥只保证 JSON 对象语法，six-sections、证据 ID 等业务语义继续由应用已有验证器负责。

| 限制 | 数值/行为 |
| --- | --- |
| HTTP body | 1 MiB，流式累计；声明长度超限也立即拒绝；收 body 最长 5 秒 |
| 单条消息 | UTF-8 128 KiB |
| 序列化完整 prompt（含固定边界说明） | UTF-8 **100 KiB** argv 硬上限 |
| 原生 stdout + stderr | 合计最多 16 MiB；不落盘、不回传 |
| 最终 response JSON | UTF-8 256 KiB；只接受完整对象或完整单个 `json` 围栏 |
| 并发 | 一次原生调用；其他有效请求立即 429 + `Retry-After: 1`，不排推理队列 |
| 原生 CLI timeout | `--print-timeout 160s` |
| 桥推理 deadline | 162 秒，超时/取消后清理最多约 1.15 秒；含 5 秒收 body 仍低于 170 秒预算 |

错误只含固定码：400 参数/JSON 不合法，403 来源/Host/peer，413 body/prompt/argv 超限，415 Content-Type，429 忙，502 原生协议/工具/模型/JSON 失败，503 CLI 不可用，504 超时。客户端断开会取消调用；错误不含新闻正文、原生 stdout/stderr 或异常详情。关闭 access log，不记录 prompt、响应、认证信息。

### 已验证的 argv 与 100 KiB 上限

只采用宿主**已实测**的 argv `-p prompt`。完整 prompt 按 UTF-8 字节强制 **≤100 KiB**（包括消息 JSON 的转义与固定说明），不按中文字符数计。macOS argv 还有环境大小等约束；`E2BIG` 统一返回有限的 `413 cli_argument_limit`，不重试、不换模型、不截正文。argv 可能被同用户进程列表看到，所以只传公共研究上下文，严禁秘密/私有资料。

现有公司/新闻上下文可能超过 100 KiB，将明确返回 `413 prompt_too_large_for_argv`，需由应用原有裁剪层处理。宿主已额外探测无 prompt 参数的 `-p` + stdin：0.28 秒退出且没有 init/result，**未验证可用**。因此本桥不暴露 stdin 启动选项，不使用 `-p '-'`，不假设 stdin 能传上下文，也不为未来通道扩大当前实现。

## 安全边界与原生协议

- peer 必须 loopback，Host 必须精确为 `127.0.0.1:58732` 或 `localhost:58732`；忽略转发来源（uvicorn 关闭 proxy headers）。所有带 Origin 的请求（含同源/null）均拒绝，无 CORS；POST 只收 `application/json`（可带 UTF-8 charset），拒绝压缩 body。
- 每次创建全新 0700 临时目录；只预置有效的空 `.git` 边界（unborn main、objects、refs/heads、non-bare config）及私有 `.agents/hooks.json`。不 `--add-dir` 用户项目；修正 PWD 并去掉继承的 `GIT_*` 路径/配置覆盖，不触碰用户全局设置。
- hooks 使用 `ytrader-deny.PreToolUse`、`matcher: "*"`，以 `shlex.join` 构造固定 Python hook 命令。同脚本 `--deny-tools-hook` 总是输出 JSON deny，同时在本次私有目录写拒绝标记；即使原生流没报告 deny，也不能把结果当成功。该命令是 CLI hook 接口要求的命令字符串；**模型调用本身使用 argv 数组，绝不使用 shell**。
- 固定 `--model`、`--disable-slash-commands`、`--output-format stream-json`、`--print-timeout 160s`；不使用 `--dangerously-skip-permissions` 或 plan 模式。slash/skill 命令禁用；任何 skill/file/shell/browser/MCP 等工具执行还受统一 PreToolUse deny 约束，提示也明确禁止。该边界不冒充 OS 沙箱；CLI 自己读取认证/初始化服务不等于授权模型读文件或调用工具。宿主应验证实际版本加载了本地 hooks 并确实执行 deny。
- system 与 user 原文被 JSON 编码进明确标为 DATA 的消息封装，publicResearchContext 不是 CLI 指令。工具授权不能由任何输入正文改变。

按宿主提供的真实原生事件形状解析 JSONL：

```json
{"event":"init","init":{"model":"gemini-3.8-flash-medium"}}
{"event":"step_update","step_update":{"step_type":"text"}}
{"event":"result","result":{"status":"SUCCESS","response":"{\"ok\":true}","denied_actions":[]}}
```

必须先取得 init 且实际 model 精确相等，再取得 `result.status == "SUCCESS"` 和完整对象。任何 `step_type: "tool"`（不管 state 成功/失败）、工具结构、错误、非空 `denied_actions`、模型不符、缺少 result、坏 JSON 都失败；不拿中间文本或正常 exit code 代替 SUCCESS。

**完整 result 是完成条件，不是 CLI 退出。** 宿主观察过 SUCCESS 后 CLI 超过 60 秒不退出；桥验证完整 result 后立即 TERM 自己通过 `start_new_session=True` 创建的进程组，短暂宽限后 KILL，限时 reap。超时、输出超限、父取消、断连也走相同清理，完成清理才释放并发位/删除临时目录。不扫描进程、不 kill 共享 daemon 或其他会话。

## 离线测试与宿主验收

离线检查命令：

```sh
python -m pytest scripts/test_gemini_flash_gateway.py
```

测试显式指定路径（项目默认 testpaths 不含 scripts）；只 mock 子进程/进程组和 ASGI，不启动监听器、不调用真实 agy。覆盖请求校验、Host/Origin/Content-Type/peer、body/消息/输出上限、模型不符、工具尝试/deny、坏 JSON、失败/无 result、超时、SUCCESS 后仍运行的进程回收、父取消、429 和失败后的容量释放、缺失 usage。

宿主还需验证：实际 hook deny 生效；argv 的真实 HTTP 请求；超过 100 KiB 时应用裁剪/413；真实新闻/公司 six-sections + 证据 ID；SUCCESS 后自有进程确实消失；停止桥不影响共享 daemon/其他会话。健康 200 不能替代以上验收。

## 后续替换边界

现在只固定这个 Gemini 模型。未来可以用原生 API 或本地服务替换桥内部的 `Gateway.invoke`，保持已有 Chat Completions 合约；业务验证继续留在应用。**ycore 是未来统一 Gateway**，届时由 ycore 接管认证、模型/服务路由、计费和策略，本轮不建设多模型配置平台、不实现 ycore 服务，不分散复制凭据。
