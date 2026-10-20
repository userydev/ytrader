# ytrader

以产业链为核心的中文投资研究工具：从重要新闻理解变量变化，沿产业关系找到公司，再核对业务与基本面。核心代码采用 MIT；第三方内容权利见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 当前阶段：第一阶段本地基本功能

2026-10-20最新指令：第一阶段交付ytrader本地可运行基本功能。Claude已检查项目并起草具体开发文档，Codex与Grok完成审查，已完成统一本地入口、新闻到产业路径及真实公司基本面。启动与验证见 [第一阶段交付记录](docs/PHASE1-VALIDATION.md)。已运行和技术检查不等于用户体验认可。

1. 新会话先读 [交接](docs/HANDOFF.md) 与 [当前检查点](docs/CHECKPOINT.md)。
2. 按 [文档目录与效力](docs/INDEX.md) 区分用户约束、讨论草案、实现证据和历史记录。
3. 当前实施依据为 [第一阶段开发文档](docs/PHASE1-DEVELOPMENT.md)、[数据源核对](docs/PHASE1-SOURCES.md)和[实施计划](docs/PLAN.md)。此前产品讨论稿中未纳入本轮范围的建议仍未生效。

Claude 恢复文档起草角色；Codex负责判断、审查、集成和体验验收。用户决定产品目标、开发文档和重大取舍。

## 保留的体验入口

| 入口 | 用途与状态 |
| --- | --- |
| [第一阶段统一应用](http://127.0.0.1:58730/events) | 当前可体验版；新闻、产业、公司与设置同一端口 |
| [新闻推荐](http://127.0.0.1:58720/events) | 算法推荐、持续事件、媒体报道与产业传导；待用户体验认可 |
| [产业桥接](http://127.0.0.1:58721/) | 携新闻进入多产业，含黄金结构；与新闻服务配合 |
| [产业与个股稿](http://127.0.0.1:58700/?industry=ai-compute&company=ieit) | 保留的桌面基本面样稿，数据有来源与报告期 |
| [原业务服务](http://127.0.0.1:8000) | 已有 React/FastAPI 业务与设置；不代表最新设计已全部整合 |

58730是本轮统一可体验版本；其余入口保留作历史对照，均不代表生产发布。产业方向被用户认为基本可用；个股稿和最新新闻稿尚待体验认可。运行清单见 [运行资源](docs/RUNTIME-INVENTORY.md)。

## 工程与证据

当前代码为 React/TypeScript、FastAPI、SQLite。开发分支 `dev`，稳定分支 `main`。工作区包含大量重建删除和未跟踪文件，不能执行 `git clean`、重置或按“无用文件”删除。

[新闻算法](docs/NEWS-SELECTION.md) · [最新验证范围](docs/EDITORIAL-VALIDATION.md) · [新闻页面契约](docs/surfaces/news-radar.md) · [产业内容定义](docs/CHAIN-CORE-LOGIC.md)

[启动参考](docs/STARTUP.md)、[架构](docs/ARCHITECTURE.md)、[接口](docs/CONTRACTS.md)、[部署](docs/DEPLOYMENT.md)描述已有实现，后续须按确认后的产品文档校准。不要为了阅读文档重建 `frontend/dist`、改动现用数据库或重启8000服务。

本轮不提交、推送、部署、采购或开发交易执行。旧入口说明保存在 [整理前快照](docs/archive/2026-10-20-pre-handoff/README.md)。
