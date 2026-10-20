# 开放产业增量契约

研究范围开放；PANORAMA_CATALOG 只表示五份不可改的历史文档/初始跟踪项。目录 ID 与新闻关联不得校验为该常量集合。原文档的内部节点/证券引用校验仍保留。

`industry_associations` 是宽相关列表，relation=association，node_ids 可空；basis 为 source_match / ai_association / rule_inference。`industry_impacts` 是条件影响，包含 news_version / source_version / impact_version，basis 可为 ai_impact。兼容 `industry_links` 同时携入口，新闻页只展示去重的产业名称，产业页才显示条件机制与实际环节。

来源图允许无 relations（明确结构缺口），不为画布补边。CKG industry_industry 仅为独立 classifications（id/name/parent_id/parent/source_record）；company_product 为主营关联；product_product 仅识别上游材料/下游产品。来源纪录保留文件行号/索引，不提升为 reviewed。公司 symbol 可 null；非空须合法源证券代码，不能依相似名称匹配。

目录、跟踪、来源辅助生成、关联 POST、影响 GET/POST 接口与限制见 OPEN-INDUSTRY-IMPLEMENTATION.md；core-v1 schema 同步扩展为开放 industryId。
