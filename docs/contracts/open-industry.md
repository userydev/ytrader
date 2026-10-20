# 开放产业增量契约

研究范围开放；PANORAMA_CATALOG 只表示五份不可改的历史文档/初始跟踪项。目录 ID 与新闻关联不得校验为该常量集合。原文档的内部节点/证券引用校验仍保留。

`industry_associations` 是宽相关列表，relation=association，node_ids 可空；basis 为 source_match / ai_association / rule_inference。`industry_impacts` 是条件影响，包含 news_version / source_version / impact_version，basis 可为 ai_impact。兼容 `industry_links` 同时携入口，新闻页只展示去重的产业名称，产业页才显示条件机制与实际环节。

来源图允许无 relations（明确结构缺口），不为画布补边。CKG industry_industry 仅为独立 classifications（id/name/parent_id/parent/source_record）；company_product 为主营关联；product_product 仅识别上游材料/下游产品。来源纪录保留文件行号/索引，不提升为 reviewed。公司 symbol 可 null；非空须合法源证券代码，不能依相似名称匹配。

机器schema使用开放industryId。

## 真正接入的资料
1. **Atlas 五份 MIT 快照**：动态读取现有 JSON；环节、公司位置及明确供应记录中无歧义的公司位置连接。连接标为 source_record，附原记录索引，不推导环节内所有公司的交易。不使用描述中的宣传、排名、份额、热度、产能或行情数字。保留 JiMoxiao/industry-chain-atlas MIT 署名及固定 commit 链接，原快照/LICENSE 不改。
2. **现有七种证据包**：从 nodes / edges / evidence 适配，不做破坏性安装。公司分类转为主营/业务参与；只有已有 upstream 产品关系进入结构边；保留原证据、日期与 URL。
3. **可选外部 CKG JSONL**：`YTRADER_CHAIN_REFERENCE_DIR`。读取行业、产品、行业分类、公司所属、公司主营、产品上下游、公司主表七种文件。目录包含真实行业/产品记录，不预造全库图。行业查询沿上级分类收集子行业成员，再按证券代码接主营产品及真实产品上下游；分类单列、有稳定 ID 可导航。产品可展开邻居；公司有源证券代码才链接详情，不做相似名称匹配。保留 2021-10-26、commit、文件行号和原关系名；公司 time 不是关系日期，历史权重不当当前收入占比，industry_up 未当供销事实。目录只读，不复制全库。

CKG 未配置不影响包内资料或开放研究。脚本只额外透传这一个受控目录变量，没有恢复其他全局 AI/ycore 环境。

## 关联和影响独立
- `industry_association`：动态目录名称、实际产品别名、有限快速规则，多对多宽关联；中东安全冲突与原油的主题关联不要求已有传导路径，不把地域体育/娱乐新闻一律关联原油。可轻量缓存 CKG 行业目录，不把全部产品放入模型 prompt。
- 用户选择阅读具体新闻时，客户端 **POST** 按版本缺失补充关联，手动更新可重试；模型允许目录外产业名。不会在 feed/同步 GET 中调用模型，不启动全列表批量付费。
- `industry_impact`：进入所选产业后按需 POST 后台研究。输入该新闻稿件版本和真实图节点/结构/资料版本；输出只能引用实际 node_ids 和逐字新闻片段，必须有条件机制。原结构边不是新闻因果边；并列定位不冒充确定传导路径。
- 两类模型结果分别使用版本哈希缓存和 Jobs active_key 去重。已有完成结果不重复付费；自动失败尝试不会随轮询反复提交；用户可重试。现有单 worker 串行执行，入口有小队列限制。失败保留新闻、已知关联和来源结构。条件影响标为未核实推断，并显示实际模型/生成时间。

## 接口
- `GET /industry-research/catalog?q=&offset=&limit=`：统一目录（默认40，上限100）。
- `GET/PUT /industry-research/tracking`：独立个人跟踪。
- `GET /panorama/catalog`：包内及已保存结构目录（非研究白名单）。
- `GET /panorama/{id}?offset=`：原结构或统一适配结构；额外 view_context / view_observatory、分类、来源记录及分页信息。
- `POST /industry-research/generate {name, source_id?}`：复用现有产业生成/保存 job，可携真实来源上下文。
- `POST /news/editorial/events/{eid}/associate?progress=&automatic=`：有界关联补充；缓存或任务。
- `GET /industry-research/{id}/impact?news=&progress=&offset=`：只读版本匹配缓存。
- `POST` 同影响地址，附 automatic 参数：准备动态条件影响任务。
- 新闻投影保留兼容 industry_links，另列 industry_associations、industry_impacts、news_version、catalog_version。

## 当前限制
- 这是开放研究及已有资料接入，不声明全产业已核实供需覆盖；CKG/Atlas 均仅来源记录。缺失结构须开展研究；AI 产物不是已审阅事实。
- CKG 目录/选中图做进程内缓存（图最多16份）；外部快照变更需重启刷新。产品图最多60节点，行业每页24主营产品、最多80家公司；某产品的其余公司可进入产品页按40条分页查询。邻居有界展示，可从实际产品继续展开。目录本身分页。
- 新增关联/动态影响及来源上下文生成使用现有 **local OpenAI-compatible 配置/固定 Gemini 桥**；未新增桥、地址或模型配置。旧 ycore 无此能力时明确返回不支持，不偷偷改服务。非原五 ID 的全景在 data_mode=ycore 时明确返回501，不回退本地开放来源。
- 自动补充覆盖用户明确选择阅读的新闻，以及用户进入的所选产业；未做启动时全 feed 模型批处理。队列繁忙时保留快速层，允许稍后重试。
