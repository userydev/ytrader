# ytrader 后端

产品范围见 `docs/PRODUCT.md`，当前接口见 `docs/CORE-INTERFACES.md`。Python 3.12，SQLite/FTS5；不读取历史项目或收费数据。

## 安装与运行

```sh
uv sync --extra test
uv run ytrader serve
# 或：uv run uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

使用单进程/单 worker。API 为 `/api/v1`，交互契约 `/docs`。`frontend/dist` 存在时提供同源静态文件及 SPA fallback；未知 API 和缺失静态资源始终 404。默认仅监听 loopback，未实现公网用户鉴权/权益，不应直接暴露在不可信网络。

首次启动为空数据库：同步新闻与证券、配置模型、或导入有授权关系 JSON。无模型也可阅读新闻、证据、证券、行业分类和路径；远程模型未配名称/密钥返回 409，loopback 本地兼容模型有名称即可免密钥。网络失败不产生假行情或假分析。

## 配置与密钥

非密钥配置及用户关注保存在 SQLite；密钥独立保存在数据目录 `keys.json`，原子写入、0600。GET config 只给 `*_key_set`，空值不覆盖，`clear_*_key` 显式清除。数据库文件也设为 0600；目录新建权限 0700。PUT config 为部分更新；`sync_interval_minutes=0` 关闭定时同步。首次启动不自动抓取，首次周期从启动时计算。

环境配置名（不含任何真实凭据）：

| 名称 | 用途 |
| --- | --- |
| `YTRADER_DATA_DIR` | 默认用户数据目录，可挂载持久卷 |
| `YTRADER_WEB_DIST` | 可选 Web 构建输出目录 |
| `YTRADER_WEB_ORIGINS` | 开发模式允许的浏览器来源，逗号分隔 |
| `YTRADER_DECISION_PROVIDER` | 默认 `rules`；可显式选择 `openai-compatible` |
| `YTRADER_DECISION_MODEL` | 可选独立决策模型名称，仍使用服务端模型适配器 |
| `YTRADER_HOSTED` | 设置为 `1` 时强制模型经 Cloudflare AI Gateway routing |
| `YTRADER_CF_AIG_TOKEN` | 可选托管端 Gateway 服务端凭据，仅发送到精确 Gateway 主机 |

供应商模型 key 仅送模型地址；ycore token 仅送 ycore。同一请求客户端不会跨服务复用或向重定向目标转发凭据。公开内置数据源可用系统 HTTP 代理；模型/ycore 客户端不继承系统代理。TLS 验证不关闭。

托管模式要求 `model_base_url` 指向 Cloudflare AI Gateway 的 OpenAI-compatible 路由前缀。API 不返回 Gateway/供应商凭据。此交付只实现可替换适配器，**不代表任何 ycore 托管服务已经部署**。

## 独立服务组合与快照扩展

`data_mode` 与 `ai_mode` 独立，四组合均有 contract stub 测试。ycore 数据使用相同 v1 envelope。用户 config、watchlist、客户端任务留在本地。跨数据/AI模式使用以下扩展：

`POST /api/v1/analysis/snapshot`

输入 `{context:{event,articles,evidence,paths},evidence_version}`，输出 v1 envelope 包装的 Analysis。该端点只允许使用服务端自身配置的 local AI 适配器，不递归转发。调用方不转发模型 key；返回后再次校验证据 ID，并重读当前证据版本以判断 stale。远端无需预先拥有调用方的事件数据库。快照分析本身不写入远端用户事件主表。

## 来源、覆盖与图谱

新闻：华尔街见闻公开快讯 API、自定义 RSS/Atom。iFinD 仅 disabled 能力声明，不能启用。URL 规范化、正文指纹和来源保留，更新/纠错保存为独立历史证据。时间未知的不同 URL 不做同事件合并，旧闻/事实数字/动作冲突保守拒绝。重要性、用户相关性和排序分开；列表按来源去拥挤。插件模型可否决规则候选，不能绕过合并安全门。

证券按沪深北分别获取：SSE 主板及科创板官方列表、SZSE 官方 XLSX、BSE 官方分页表单；失败时使用明确标记的东方财富备用源。官方 XSLX 错误 dimension 会重置，ZIP 解压及响应大小受限；BSE 的受限 cookie 重定向链使用同一隔离客户端。仅固定内置公共主机允许兼容 Fake-IP DNS，不放宽任意 RSS。源报告总数、实际取数、交叉源总数/冲突及原始日粒度报告日期记录在覆盖观测和 warnings；计数一致也不声称完成逐代码全市场对账。冲突/未验证只降低 coverage，不重复同步；网络/结构错误有限重试。未出现的证券不自动判退市。源未给发布时间时 `as_of` 为 null，不拿抓取时间冒充。内部观测时间与源发布时间分开。

来源确实提供行业时建立 company→industry **classification**，原文证据与实际官方/备用来源 URL 关联；行业未知时明确 gaps，绝不猜测。只按事件原文明示的产品/环节/行业标签或证券名称/代码匹配图谱。分类可反向定位业务相关公司，但不显示成供货；upstream/inferred 传播是带条件的研究假设。

关系 JSON 必须有受支持的 SPDX 许可、HTTP(S) 来源、包时间、完整节点与原文证据引用。证据发布时间及边源时间允许 null，包时间必须有时区且非未来。事务导入；未知许可、虚构引用和冲突 ID 拒绝。更新事实使用新版本化 ID，避免偷偷改写其他包的证据。演示数据只在 tests，不注入正式数据库。

## 后台任务、备份与更新

SQLite 持久化队列；同类活跃任务幂等；运行中任务重启后恢复，最多三次尝试。远程同步保存远程 job ID，恢复时只查询原任务。来源故障隔离，成功数据照常落库，失败和部分覆盖可见。模型输出必须符合六段结构，事实类条目必须带当前给定 ID，虚构引用/禁止的收益概率输出被拒绝；新闻正文只作为不可信数据而非指令。

备份前停止单进程服务，复制整个数据目录（包含数据库、可能存在的 WAL/SHM 和 0600 密钥文件）；备份应同样限制访问。恢复到新目录后设置数据目录并重启，未完成任务恢复。更新前备份；本首版仅定义新建 v1 schema，未声称提供旧系统数据库迁移。

## 验证与离线评测

```sh
uv run pytest
uv run ytrader evaluate --provider rules --split test
```

测试覆盖聚合/纠错/错合并、来源隔离、不完整覆盖不退市、关系事务/证据、四服务组合快照、模型故障/虚构引用、陈旧状态、任务恢复、配置/关注持久化、官方解析与静态 fallback。

评测样本为原创中文合成示例，按时间划分 train/validation/test；不是市场效果或真实模型测评。报告 accuracy、Brier、latency、cost 和未测字段。`confidence` 明确定义为 `P(same_event=true)`，不是对已选标签的确信程度。规则 monetary cost 为 0；模型计费成本未知时为 null。真实模型评测必须显式 `--provider openai-compatible --allow-network` 且已配置；Jev 仅未实现/未验证的能力入口，不默认启用、不虚称通过。
