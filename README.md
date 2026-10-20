# ytrader

以产业链为核心的中文投资研究工具：从重要新闻理解变量变化，沿产业关系找到公司，再核对业务与基本面。核心代码采用 MIT；第三方内容权利见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 当前阶段：核心功能可体验版

2026-10-20。按用户最新范围统一产业链视觉样式，侧栏汉堡菜单仅新闻、产业链、个股。新闻推荐、产业关联与传导、公司资料/财务详情已接通；四项算法独立并记录版本。Gemini 3.8 Flash已通过实际新闻与公司分析调用。用户最终体验尚待认可。

1. 新会话先读 [交接](docs/HANDOFF.md)、[当前检查点](docs/CHECKPOINT.md) 与 [文档目录](docs/INDEX.md)。
2. 当前实施依据为 [核心开发约定](docs/CORE-DEVELOPMENT.md) 与 [核心接口约定](docs/CORE-INTERFACES.md)。
3. 启动、验证与限制见 [核心交付记录](docs/CORE-VALIDATION.md)。ycore契约已准备，尚未实连；公共来源不承诺SLA。

Claude 恢复文档起草角色；Codex负责判断、审查、集成和体验验收。用户决定产品目标、开发文档和重大取舍。

## 保留的体验入口

| 入口 | 用途与状态 |
| --- | --- |
| [核心功能统一应用](http://127.0.0.1:58730/events) | 当前可体验版；新闻、产业链、个股同一端口；设置不进入主流程 |
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
