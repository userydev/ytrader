# 本轮依赖研究与取舍

2026-10-18，本轮读取公开项目实际源码及数据，不沿用旧项目资料。源码可读、接口能返回和产品质量通过是三个不同结论。

| 方案 | 实际发现 | 本项目取舍 |
| --- | --- | --- |
| [Horizon](https://github.com/Thysrael/Horizon) | 编排先合 URL、重要性筛选、同事件去重、分类平衡，再扩充选中内容 | 采用处理顺序；保留所有来源及更新，避免合并后丢引用 |
| [ChainKnowledgeGraph](https://github.com/liuhuanyong/ChainKnowledgeGraph/tree/498a21293a7cf50a8438154c4351349c2732fe1e) | 静态 JSONL：4654 公司、511 行业、95559 产品；关系没有逐条来源 URL/日期，仓库未见许可文件 | 数据结构有研究价值；不分发原数据，不以此声称当前全 A 股产业链完整 |
| [KAG supplychain](https://github.com/OpenSPG/KAG/tree/fdab15b3929d2ee40dfcdd388f90233096a6afc9/kag/examples/supplychain) | 类型化 CSV 导入、公司链接、价格→成本→利润规则；示例公司脱敏 | 借鉴类型与条件传导，不当现成 A 股数据源；规则不等于确定盈利结果 |
| [supply-chain-kg](https://github.com/123qsa/supply-chain-kg/tree/6c12816aaff4604969763abfda43fd3bf84fb0f0) | 公司发现限定少数概念板块；失败有 mock 路径 | 不作为核心关系提供者，不继承模拟回退 |
| [financial_stock_knowledge_graph](https://github.com/kevin-meng/financial_stock_knowledge_graph/tree/d27e576975f91488479d6dfbf4311066400b47d0) | Tushare 公司/持股等数据与图更新；不是产品供应链 | 借鉴增量更新；不复用许可不明数据 |
| [apple-chain-graph](https://github.com/Coolgiserz/apple-chain-graph/tree/aa83b97f2416be58cb3beaea95c08a86c40dbedc) | 产品/部件/供应商与来源注册表；静态研究快照，部分来源仅主页 | 借鉴树和持续证据面板；来源必须能支持具体边，不照搬供应商结论 |
| [supplychain](https://github.com/eugenehp/supplychain/tree/9d9f62a4bff2b80979b07950b853bdf5dcca151d) | SEC/ASX 文档与主题图，部分权重手设；许可限制非商用 | 仅研究证据检索方法，不纳入代码或分发数据 |
| [industry-chain-mcp-server](https://github.com/handaas/industry-chain-mcp-server) | MIT 接口包装，实际数据需独立商业服务凭据 | 仅可选供应商接入思路，不当免费独立数据集 |
| [AKShare stock_info.py](https://github.com/akfamily/akshare/blob/main/akshare/stock/stock_info.py) | 对接交易所名单，沪、深、北独立获取 | 逐市场验证覆盖；不因单源失败批量退市 |
| [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) | 面向受限决策任务的模型路线 | 作为候选决策适配器；需中文校准/质量/延迟/成本评测，不默认替换规则 |

## 实际网络验证
- 华尔街见闻公开快讯接口返回正文、原文 URL 与 display_time；前端不能只消费标题。
- AKShare 1.19.1 交易所名单于 2026-10-18T09:38:57Z 获取：沪主板 1702、科创板 618、深圳 2906、北京 351，共 5577。此为该次获取结果，不代表永久固定数量。完整报告在本地验证产物中；后续应用同步还须按代码集合核对。
- 公开接口可用不等于获得数据再分发授权。程序接入与数据分发分别处理；不捆绑来源许可未核实的产业数据库。

## 评测边界
规则与模型按具体判断环节比较，不把大模型通用能力当推荐系统质量。事件样本以同事件组和时间段划分，覆盖转载、标题改写、旧闻重发、新增事实、辟谣与近似不同事件。真实模型未调用时，质量/校准/延迟/成本保持未验证。

## 覆盖冲突
同次核对中，东方财富沪 A 查询返回总数 2467，与交易所接口取得的沪主板+科创 2320 不一致。上海两张名单最新上市日期分别为 2026-09-17、2026-09-16，不能由获取时间直接推定源数据已更新至当日。需要按代码集合、证券类型及状态进一步对账。首版不得仅以 HTTP 成功或行数超过阈值宣称当前全 A 股覆盖完整。
