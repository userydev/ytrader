# 文档目录与效力

2026-10-20。当前阶段为用户最新授权的核心产品统一与接口/算法独立化，Gemini 3.8 Flash首期接入；Claude起草约定，Codex审查后Pi实施，用户最终体验仍待验收。文档存在、代码可运行、测试通过均不自动表示用户确认。

## 阅读顺序

| 文件 | 效力与用途 |
| --- | --- |
| [HANDOFF](HANDOFF.md) | 新会话的目标、边界与下一步 |
| [CHECKPOINT](CHECKPOINT.md) | 当前状态、负责人/job、恢复位置 |
| [右侧面板修订](RIGHT-PANEL-STATUS.md) | 当前用户批注及job状态 |
| [开放产业质量修复](CHAIN-QUALITY-STATUS.md) | 最新用户反馈修复、job、运行和真实模型验证 |
| [核心开发约定](CORE-DEVELOPMENT.md) | 最新用户范围内的实施边界、工作包与交付条件 |
| [核心交付记录](CORE-VALIDATION.md) | 已集成状态、实际检查及明确限制 |
| [开放产业实现](OPEN-INDUSTRY-IMPLEMENTATION.md) | 最新产品纠正：开放研究、来源适配、跟踪、新闻入口与条件影响 |
| [完整产品闭环](PRODUCT-CLOSURE-IMPLEMENTATION.md) | 公司反查、产业解释、保存追问与复用、新闻增强性能；最新交付见CHECKPOINT |
| [前轮传导UX修订](TRANSMISSION-UX.md) | 历史实现；首页传导方向已被最新用户纠正覆盖 |
| [核心接口约定](CORE-INTERFACES.md) | v1数据格式、local/ycore边界与算法版本契约 |
| [PRODUCT](PRODUCT.md) | 用户已明确的产品约束；正文整合尚在讨论 |
| [产品讨论稿](drafts/PRODUCT-vNext.md) | Claude起草、Codex审阅的候选正文，未生效 |
| [讨论提纲](drafts/DISCUSSION.md) | 本阶段讨论顺序与待决定问题 |
| [第一阶段开发文档](PHASE1-DEVELOPMENT.md) | 第一阶段历史实施依据；新增核心范围以CORE文档为准 |
| [第一阶段来源核对](PHASE1-SOURCES.md) | 公开财务接口样本、字段单位与局限 |
| [第一阶段审查](PHASE1-REVIEW.md) | Grok首稿审核与Codex关闭条件记录 |
| [第一阶段交付记录](PHASE1-VALIDATION.md) | 统一应用启动、实际路径、数据保护检查及剩余限制 |
| [PLAN](PLAN.md) | 本轮范围、交付条件与用户体验认可 |

优先级：用户最新明确指令 → 已确认的产品约束/决定 → 对应范围内已确认的合同与计划。草案、实现记录和历史文件不能覆盖用户指令。若没有明确确认记录，按待讨论处理，不能推断整份草案已获批准。

## 当前实现与研究证据

| 主题 | 文件 | 使用边界 |
| --- | --- | --- |
| 最新新闻稿 | [NEWS-SELECTION](NEWS-SELECTION.md)、[EDITORIAL-BRIEF](EDITORIAL-BRIEF.md)、[EDITORIAL-VALIDATION](EDITORIAL-VALIDATION.md)、[页面契约](surfaces/news-radar.md) | 解释已实现规则、取舍和验证；不固定未来只能用规则 |
| 产业定义与研究 | [CHAIN-CORE-LOGIC](CHAIN-CORE-LOGIC.md)、[INDUSTRY-STRUCTURE-STUDY](INDUSTRY-STRUCTURE-STUDY.md)、`examples/industry-structure/` | 可复用的内容定义与证据，按新正文核对 |
| 数据与服务 | [DATA-INTEGRATION](DATA-INTEGRATION.md)、[DATA-PACKS](DATA-PACKS.md)、[YCORE-SERVICE](YCORE-SERVICE.md) | 既有设计和能力边界，未上线服务不能算已实现 |
| 工程参考 | [ARCHITECTURE](ARCHITECTURE.md)、[CONTRACTS](CONTRACTS.md)、[STARTUP](STARTUP.md)、[DEPLOYMENT](DEPLOYMENT.md) | 已有工程参考；待按确认产品重新校准 |
| 运行资源 | [RUNTIME-INVENTORY](RUNTIME-INVENTORY.md) | 当前保留/停止的服务和恢复方式 |
| 当前统一UI | [DESIGN](../DESIGN.md)、[UI-CORE](UI-CORE.md)、[核心页面契约](surfaces/core-product.md) | 本轮原产业链风格和三入口规范；旧workbench不覆盖当前约定 |
| 算法与机器契约 | `algorithms/`、[接入附录](contracts/README.md) | 四项独立思路与CHANGELOG、schema及七样例 |
| Gemini本机桥 | [AI-LOCAL-GEMINI](AI-LOCAL-GEMINI.md) | 当前启动、边界与恢复方式 |

## 历史资料：按需读取，不驱动新开发

以下文件保留原路径，以免破坏引用；统一归为阶段历史资料：

- 旧实施 brief：`IMPLEMENTATION-BRIEF.md`、`RECOVERY-BRIEF.md`、`PRODUCT-FLOW-BRIEF.md`、`INDUSTRY-EXPLANATION-BRIEF.md`、`INDUSTRY-EXPLORER-BRIEF.md`、`INDUSTRY-IMPLEMENTATION-BRIEF.md`、`INDUSTRY-PIPELINE-BRIEF.md`、`NEWS-RADAR-BRIEF.md`、`NEWS-UI-BRIEF.md`。
- 历史验证：`VALIDATION.md`、`PRODUCT-VALIDATION.md`、`RUNTIME-VALIDATION.md`、`CHAIN-PATH-VALIDATION.md`、`NEWS-VALIDATION.md`。每份只对所记版本和范围有效。
- 历史研究：`RESEARCH.md`、`RESEARCH-DISCOVERY.md`、`NEWS-RESEARCH.md`。保留来源与取舍，不把当时“下一步”当当前任务。
- 整理前 `README/PRODUCT/PLAN/CHECKPOINT` 完整保存在 [2026-10-20快照目录](archive/2026-10-20-pre-handoff/)。

2026-10-15重建前的同名项目资料不纳入本目录，也不自动继承。

## 维护方式

确认产品决定时修改正文，不在顶端反复追加互相矛盾的“最新状态”。过程证据进入对应验证文档；当前阶段与job进入CHECKPOINT；重大已确认取舍可附在正文的决定记录中。草案转为有效文档前，保留来源、未决项和用户确认范围。
