<!-- AI-SYSTEM:PROJECT-RULES BEGIN -->
## 中央项目登记

- 项目 ID：`ytrader`
- 中央 manifest：`/Users/Admin/AI/system/projects/ytrader.json`
- 产品系列：`y`
- 生命周期：`incubating`
- 目标目录：`/Users/Admin/Code/y/ytrader`
- 项目入口：`/Users/Admin/Code/y/ytrader/ytrader-dev/README.md`
- 产品正文：`/Users/Admin/Code/y/ytrader/ytrader-dev/docs/PRODUCT.md`
- 用户职责：决定产品目标、开发文档、重大取舍、外部授权和最终体验验收。
- Codex 职责：负责目标判断、调度、集成、代码审查、体验验收和项目状态维护。
- 第三方 AI：仅提供建议；用途为按项目需要提供方案咨询；写回位置为 `未配置`。

本区块由 `/Users/Admin/AI/system` 生成。先修改中央 manifest，再同步本区块；项目独有的构建、测试与安全规则保留在区块外。
<!-- AI-SYSTEM:PROJECT-RULES END -->

## 重建基线

本项目于 2026-10-15 重新创建。当前需求以用户在重建后确认的开发文档和明确指令为准。
旧版同名项目的聊天、记忆、计划、架构、接口、部署、数据和验收结论均不自动继承；引用旧资料须由用户明确指定。
`dev` 为默认及主要开发分支，`main` 为稳定发布分支，稳定版本按 `dev → main` 集成。

## 当前阶段与文档协作

2026-10-20最新纠正：核心是所有产业链研究，固定五项仅持续跟踪；新闻关联多个产业，进入所选产业查看影响，首页不放传导模块。开放目录、Atlas/七证据包/可选CKG、任意产业生成与动态条件影响已集成到58730，保留原产业UI与新闻/产业链/个股三入口。Pi job 2b8a402bc08c4ff6b32b6f4e8a3d971c已apply并清理，不重新派已完成任务。恢复读docs/CHECKPOINT.md、HANDOFF.md、INDEX.md和OPEN-INDUSTRY-IMPLEMENTATION.md；实际可体验不等于用户最终认可。旧固定五产业研究范围与首页传导方案已被替换。

恢复Claude文档起草角色。按 external-collaboration Skill：关键产品文档起草用 `agy-opus`，已确认文档增量修订按需用 `agy-sonnet`；Codex负责需求判断、审查、集成、体验验收与状态维护，用户确认产品目标、文档和重大取舍。文档候选未经确认不得写成已生效需求；额度或工具失败如实报告，不静默换角色。此为项目分工，不修改全局模型配置。

工作区仍有重建删除和未跟踪文件；禁止借整理执行Git重置/清理或删除数据。最新新闻、产业、个股与原业务预览见 `docs/RUNTIME-INVENTORY.md`。后续按用户确认范围再更新文档和实施。
