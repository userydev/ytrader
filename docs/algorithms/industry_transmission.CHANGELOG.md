# industry_transmission CHANGELOG

## 1.2.1 · 2026-10-20
- 补齐 `cuts oil production` / `cuts production` 等明确英文生产调整词序，匹配原始动作短语作为来源触发证据。
- 保留同句油品/OPEC 约束、储备句段排除及 conditional 语义；不恢复泛 supply 触发。

## 1.2.0 · 2026-10-20
- 区分储备释放安排与生产调整：同句油品/储备/释放门，实际投放作为必要条件；柴油对应燃料而非新增开采产能。
- IEA释放时机由成员国决定不等于已经释放，不命中 extraction；泛“供应”不再命中生产，生产要求明确动作并排除储备句段。
- 保留旧字段、rule_version 与来源片段；复用既有可选 mechanism_summary/condition_summary，无新 API 或行业 ID。独立算法版本触发既有特征重放，不改新闻/进展历史身份。
- 未扩宽战争→黄金、泛AI→采购或外国电厂→国内电网订单。UI 将候选环节并列展示，关系/公司另从原图核对。

## 1.1.2 · 2026-10-20
- 从 editorial-rules-v1.1.2 原样提取 industry_links 配方，规则、输入和证据时间由调用方显式提供；模块无 DB/network/文件读取。
- 保留原产业/节点 ID、direct/conditional 区分、AI 局部主体/订单门、黄金跨产业条件文案与既有 rule_version。
- 增加独立 registry 版本和文档；Editorial 旧位置只委托，不保留第二份配方。
- 输出影响：此次模块迁移不有意扩大或新增产业关联；新顶层 algorithm_versions 是向后兼容元数据。
- 本记录承接既有规则版本，并不声称新模块此前独立发布。
