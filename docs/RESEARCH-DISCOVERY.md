# 独立候选调研与取舍

> 后续已按用户确认的“直接使用现成项目、数据源优先”收敛，最终接入取舍见[DATA-INTEGRATION.md](DATA-INTEGRATION.md)。本页保留独立候选证据，局部建议不作为当前开发指令。

核查日期：2026-10-17。范围：新闻事件归并、产业链关系与传导、独立个股分析。此次从需求检索新候选，不以用户提供的仓库作为候选边界。结论是源码及数据结构评估；没有安装或运行这些项目，也没有验证实时接口、分析准确率或产品体验。

## 结论

用户已认可这批新候选，并明确调研目的：**找到可以直接使用的项目，减少自行开发，同时借鉴已有项目的思路和方法；重点解决数据源。** 后续优先接入现成服务/API、运行上游项目或调用其SDK/CLI；只有具体需求无法满足时才做必要适配，不默认拆模块重写。下文的源码拆取意见保留为适配备选，不作为默认实施路线。

CapexGraph、KAG、SemHash、stockfinlens、ValueCell进入直接使用候选。接下来先比较上游项目如何取得数据、数据实际覆盖和更新、运行与凭据条件、输出/API是否可接入、维护及分发条件，再决定采用组合。用户认可候选不等于这些项目已经运行可用。

本轮仍未找到经核验、覆盖全市场、可直接接入且持续更新的 A 股公司—产品—上下游开源数据服务。这个结论只限本轮候选，不声称整个开源社区不存在，也不据此默认安排自建全套关系库；下一步应先追查这些项目依赖的现成数据源与持续获取方式。

产品范围保持事件→产业链→公司→可选策略，新闻和个股独立使用；不因候选有更多功能就加入工作台、选股器、回测、持仓或交易。现有 PRODUCT / ARCHITECTURE / PLAN 中的技术选型仍属前一版暂定方案，本页先交付比较依据。

## 候选比较

证据级别：**源码**表示读到关键实现；**样例**表示取得实际数据记录，未必是真实生产数据；**文档**表示只完成官方介绍/目录级核对。源码核对不代表运行通过。表中的许可仅记录仓库声明或文件，数据源条款另算。

| 新候选 | 核对到的能力及证据 | 取舍 |
|---|---|---|
| [CapexGraph](https://github.com/Mrjie7205/CapexGraph) | 源码＋样例；MIT。公司/产品/关系、证券代码、证据URL、日期与置信度；硅片样例有4条公司到需求环节的边 | **产业链优先复用来源**。抽领域模型、证据采集与校验；不搬七阶段研究工作台。样例不是全市场数据 |
| [KAG supplychain](https://github.com/OpenSPG/KAG/tree/master/kag/examples/supplychain) | 源码＋样例；Apache-2.0。产品上下游、公司经营产品、事件因果规则、11份CSV | **传导规则参考并改造**。已有业务实现；原导入/推理依赖OpenSPG，脱敏样例不能代替公司数据库 |
| [SemHash](https://github.com/MinishLab/semhash) | 源码；MIT。可配置编码模型、语义重复检测、保留重复关系与相似度 | **新闻预处理首选候选**。保留所有报道，利用重复关系减少重复分析；中文模型与阈值待验证，不等于完整事件聚类 |
| [WorldMonitor](https://github.com/koala73/worldmonitor) | 源码；AGPL-3.0。新闻聚类、来源保留、实体静态词表、可选语义合并 | **不直接采用当前聚类器**。分词过滤中文，实体匹配依赖英文边界；参考来源展示与覆盖状态，闭源服务集成边界未确认 |
| [Kairos](https://github.com/Leo-QJ-Justin/kairos) | 源码；所查HEAD未发现LICENSE。RSS→语义/实体/时间联合HAC→事件→股票关联 | **事件归并方案对照**。实现比简单摘要脚本完整；不复制未明确授权代码，不继承其持仓/跟踪流程 |
| [Kagi Kite](https://github.com/kagisearch/kite-public) | 源配置/前端级核查；代码MIT，托管数据另有非商业条款。事件卡片、来源展开 | **界面与源清单候选**。后端聚类生成管线未公开，不能当现成事件服务 |
| [OneKE](https://github.com/zjunlp/OneKE) | 关键管线源码；MIT。Schema、抽取、反思与案例库组织 | **结构化抽取对照**。可借助其Schema约束；暂不引入多轮多agent管线，收益/成本未测 |
| [NewsBucket](https://github.com/SegoCode/NewsBucket) / [easy-stock](https://github.com/jundizhou/easy-stock) | 文档、目录与许可核对。前者跨源聚类，后者A股快讯、题材/产业节点和个股分析 | 功能相关，许可含非商业限制；不作为当前代码迁入来源，具体文件授权仍须分别核对 |
| [stockfinlens](https://github.com/liusaipu/stockfinlens) | 源码；完整MIT文件。CalcTrace、ROE计算记录、多期RIM估值、React展示 | **个股计算与解释优先来源**。Go/Wails耦合需要裁剪；公式溯源尚不到原公告页码 |
| [ValueCell](https://github.com/ValueCell-ai/valuecell) | 源码；Apache-2.0。巨潮定期报告请求、PDF URL、知识库导入、多资产源切换 | **公告取数与数据容错候选**。不用整套多agent聊天/交易应用；不声称接口已实测可用 |
| [a-share-financials](https://github.com/alicexl/a-share-financials) | 源码；README写MIT，未发现独立许可文件。字典输入的财务指标/TTM、PDF数值解析 | **计算对照，暂不直接复制**。单位自动纠偏可能掩盖解析错误；行业主题表不作为上下游关系 |
| [InStock](https://github.com/myhhub/stock) | 源码；Apache-2.0。字段字典、指标、独立策略函数 | **技术信号候选**。所查“海龟”函数只判断区间最高收盘价；不能据策略名称声称完整交易系统或有效收益 |
| [strong-stock-screener](https://github.com/icekale/strong-stock-screener) | 路由及provider装配源码；仓库声明MIT。行情源、行业热力图、资金流与筛选页面 | **按缺口取provider**。装配依赖app状态及配置，不是独立一文件库；不采纳“迁入全工作台”建议 |
| [KGData](https://github.com/chriswangweb/KGData/tree/master/产业链) | CSV样例；仓库MIT。产品名、产品类型与父品类；另有未解包dump | **只作产品词表线索**。已读CSV没有证券代码、供需方向和逐边出处，不能宣称完整dump也没有这些字段 |
| [finance-kb](https://github.com/sunlujing/finance-kb) / [market_mind](https://github.com/nstrike2/market_mind) | 前者目录/数据样例，后者关键源码。分别为本体＋股票表、少量硬编码供应商演示 | **不作为生产底座**。没有证据支持其具备可持续供给的产业关系数据 |

FinRobot、FinceptTerminal 只完成官方介绍初筛，尚不足以决定整合；不将其功能数量或仓库规模计作本轮采用证据。Priberam聚类实现、金融股权图谱等也只作范围对照。

## 改变决定的源码事实

### 1. CapexGraph：产业链已有可抽取的领域实现

锁定 `effe3c18ec23983db0a37b5a03acae0040db00aa`（提交日期2026-08-04）。

- [`domain/models.py`](https://github.com/Mrjie7205/CapexGraph/blob/effe3c18ec23983db0a37b5a03acae0040db00aa/src/capexgraph/domain/models.py)中的 `SupplyChainEdge` 带 `relationship/product/basis/confidence/evidence_ids/as_of_date`；中/高置信度边必须有证据ID。`Evidence`保存URL、摘录、日期、哈希和复核状态。
- [`research/theme.py`](https://github.com/Mrjie7205/CapexGraph/blob/effe3c18ec23983db0a37b5a03acae0040db00aa/src/capexgraph/research/theme.py)检查节点/边/证据引用，并按证据复核情况调整关系置信度；不是只在提示词中要求“给出处”。[`tools/evidence.py`](https://github.com/Mrjie7205/CapexGraph/blob/effe3c18ec23983db0a37b5a03acae0040db00aa/src/capexgraph/tools/evidence.py)有HTML/PDF证据获取处理。
- [`theme_semiconductor_wafers_cn.json`](https://github.com/Mrjie7205/CapexGraph/blob/effe3c18ec23983db0a37b5a03acae0040db00aa/src/capexgraph/fixtures/theme_semiconductor_wafers_cn.json)包含沪硅产业、立昂微、有研硅、神工股份4家公司及需求环节；例如立昂微→晶圆厂，产品为6–12英寸硅抛光片与外延片，绑定2025-04-29年报摘要URL。它没有证明任意两家上市公司互为客户供应商。
- 披露provider的真实目录为 [`providers/sources/`](https://github.com/Mrjie7205/CapexGraph/tree/effe3c18ec23983db0a37b5a03acae0040db00aa/src/capexgraph/providers/sources)，中国市场在 `china.py`。研究者所报 `sources/cninfo.py` 等文件路径不成立，已剔除。该部分目前只确认文件与入口，尚未逐一检查或运行所有交易所请求。

采用范围是关系/证据模块和内容包模板。完整应用是alpha研究工作区，冻结fixture有日期缺失和主页级来源；数据需重新核验。维护信号是可追踪的2026提交，不是生产稳定性证明。

### 2. KAG：可以复用传导设计，不能把演示规则当投资结论

锁定 `fdab15b3929d2ee40dfcdd388f90233096a6afc9`（2026-01-28）。[`SupplyChain.schema`](https://github.com/OpenSPG/KAG/blob/fdab15b3929d2ee40dfcdd388f90233096a6afc9/kag/examples/supplychain/schema/SupplyChain.schema)定义产品、公司、行业、事件等11类对象；[`concept.rule`](https://github.com/OpenSPG/KAG/blob/fdab15b3929d2ee40dfcdd388f90233096a6afc9/kag/examples/supplychain/schema/concept.rule)确有“产品涨价→下游生产公司成本上涨→利润下降”。CSV含103条公司、78条产品等数据，能连通顺丁橡胶、斜交轮胎与脱敏公司。

规则缺少成本转嫁、库存、套保等条件；公司没有证券代码和逐边资料出处。移植时保留业务语义，改成带条件的分析；重写适合本项目存储的导入与查询。原 `indexer.py` / `ReasonerClient` 依赖OpenSPG，不能称为独立Python库。

### 3. 新闻：重复检测、事件归并、实体映射必须分别比较

SemHash锁定 `19f9c590913eac243cba2ab2c9a89e45082a16df`（2026-09-30）。[`from_records`](https://github.com/MinishLab/semhash/blob/19f9c590913eac243cba2ab2c9a89e45082a16df/semhash/semhash.py)可注入编码模型，默认 `minishlab/potion-base-8M`；[`selected_with_duplicates`](https://github.com/MinishLab/semhash/blob/19f9c590913eac243cba2ab2c9a89e45082a16df/semhash/datamodels.py)保留代表报道与重复报道/相似度。用于减少重复分析时，应保存这些关系，不能只拿 `selected` 丢掉其他来源。中文效果及模型许可尚待核对，不沿用研究者未经验证的复杂度、速度和节省比例。

WorldMonitor锁定 `856dc0fe74b10dc9fd7321e0ff0e2e803694b702`（2026-10-17）。[`text-analysis-core.js`](https://github.com/koala73/worldmonitor/blob/856dc0fe74b10dc9fd7321e0ff0e2e803694b702/shared/text-analysis-core.js)的分词仅保留拉丁字母/数字/空白；[`entity-extraction-core.js`](https://github.com/koala73/worldmonitor/blob/856dc0fe74b10dc9fd7321e0ff0e2e803694b702/shared/entity-extraction-core.js)跳过短于3字符的别名并使用英文词边界。其 `allItems` 保留报道明细是优点，但不能据此选为中文事件引擎。

Kairos锁定 `b63d2b6fd9754991aca249f82d267a61ac54876d`（2026-02-26）。[`clustering_hac.py`](https://github.com/Leo-QJ-Justin/kairos/blob/b63d2b6fd9754991aca249f82d267a61ac54876d/backend/kairos/pipelines/clustering_hac.py)实际组合语义相似度0.5、实体重叠0.3、时间接近度0.2，再做层次聚类；`Event`保留文章集合，`TickerAssociation`保存股票关联理由。它说明事件归并已有完整实现路线，但没有许可文件，且提示词要求避免保留语气，不适合照搬分析表达。

本轮结论：保留现成采集模块，将SemHash列为重复检测首选；事件归并仍是明确的适配缺口，不能用SemHash或行业关键词映射冒充已解决。

### 4. 股票：优先增加可解释计算，避免扩大产品范围

stockfinlens锁定 `fde4f8eab2ed9411638c96b76a0432885cda1a70`（2026-09-29）。[`CalcTrace`](https://github.com/liusaipu/stockfinlens/blob/fde4f8eab2ed9411638c96b76a0432885cda1a70/analyzer/types.go)记录公式、输入、步骤、结果；[`steps.go`](https://github.com/liusaipu/stockfinlens/blob/fde4f8eab2ed9411638c96b76a0432885cda1a70/analyzer/steps.go)计算ROE时确实生成记录，React页面也确实展示。来源粒度是报表科目/年份，仍需接入本产品的原公告证据。多期RIM有实际函数，本次未验证公式和估值结果。

ValueCell锁定 `9793e9c0563fbf56fc096757d8bb80e209ac7aab`（2026-02-11）。[`research_agent/sources.py`](https://github.com/ValueCell-ai/valuecell/blob/9793e9c0563fbf56fc096757d8bb80e209ac7aab/python/valuecell/agents/research_agent/sources.py)实现巨潮机构ID查询、公告列表和PDF URL提取，按年/季/报告类型筛选后导入知识库；不是只宣称支持A股。`adapters/assets/manager.py`已有交易所路由和失败回退，可减少数据层重复建设。拆出后仍需处理原Agno/知识库/工具依赖。

a-share-financials锁定 `d4b8e083957d1d4c0ee27ed0fdae650f9bb60784`（2026-09-21）。TTM实现接收字典，缺字段不强填；但年度合并仅凭跨期营收或总资产接近1000/10000倍，就整体放大一份报告的字段，返回值没有调整记录。不能把这种启发式当可靠纠错。应提示异常，核实原始单位后转换并记录依据。

## 对上一轮方案的具体影响

1. **改产业链实现来源**：从笼统“自建有来源关系包”，改为CapexGraph领域/证据模块优先，KAG补事件传导模型；内容仍需生产与维护。
2. **补新闻真实缺口**：采集、重复检测、事件归并分别验收。增加SemHash候选，拒绝直接拿WorldMonitor当前分词器处理中文。
3. **调整个股复用组合**：Vibe-Research仍是已有数据/计算候选，不因用户提供而自动胜出；stockfinlens的计算溯源与ValueCell公告取数进入优先比较。只在明确字段缺口时引入StockMaster/InStock模块，避免拼进多套应用框架。
4. **撤回过度判断**：不采纳研究者的“整个社区不存在”“完美契合”“无合规风险”“直接迁入全工作台”等结论；不把目录、README、样例当运行验收。

下一阶段先做“项目—实际数据源—覆盖—更新—访问条件—可用输出”的比较。以原项目最小运行路径取得真实输出为可用性依据；只有明确的接口缺口进入适配清单。尚未开始业务开发，不把候选认可解释为采购或部署授权。

## 研究留档

独立研究与源码快照：`/Users/Admin/.codex/research/ytrader-independent-discovery-20261017`。`reference-lock.json`保存上述8个本地仓库的提交和日期；外部研究报告、采用/拒绝意见与消耗另存该目录。发现阶段按“财经新闻事件聚类”“供应链关系及披露出处”“A股结构化财务分析”等需求词搜索，后续回到原作者仓库核查。旧名单仅在形成新候选后用于比较，没有计入新发现。
