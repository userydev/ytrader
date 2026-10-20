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

当前版本已按用户要求保留并推送，项目清理移除过期文档、不可达前端和临时产物。保留原产业UI、新闻/产业链/个股三入口；开放产业不限定五个主题。具体产品范围见 `docs/PRODUCT.md`。

恢复时先读 `docs/CHECKPOINT.md` 和 `docs/INDEX.md`，核对目标、授权、有效job与下一步。当前运行资源见 `docs/RUNTIME-INVENTORY.md`。不要重新派已完成任务，也不要从Git历史恢复已废弃约定作为新需求。

按 external-collaboration Skill：关键产品文档起草用 `agy-opus`，已确认文档复杂增量修订按需用 `agy-sonnet`；Codex负责需求判断、审查、集成、体验验收与状态维护。用户确认产品目标、文档和重大取舍。候选未经确认不得写成已生效需求；额度或工具失败如实报告，不静默换角色。此分工不修改全局模型配置。

保护运行数据库、凭据、有效测试和第三方许可。后续整理先核对用途与引用，不执行无差别Git重置或清理，不因文件被忽略就认定可以删除。
