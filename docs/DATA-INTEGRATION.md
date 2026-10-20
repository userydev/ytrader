# DATA-INTEGRATION：直接接入与统一公开契约

> 2026-10-20 最新纠正：研究范围为所有产业；五项仅持续跟踪。新闻通过多产业名称进入产业页看影响。开放目录、Atlas/七证据包/可选CKG实际适配及动态关联/影响见 [OPEN-INDUSTRY-IMPLEMENTATION](OPEN-INDUSTRY-IMPLEMENTATION.md)，当前状态与限制见 [CHECKPOINT](CHECKPOINT.md)。下文历史验证不代表全部服务已集成。

> 2026-10-17 产品收敛：本文的来源与运行证据继续有效；当前首版范围和落地顺序以[产品启动书](STARTUP.md)为准，后文旧阶段安排不覆盖启动书。

> 2026-10-17：初始化与开发设计定稿，默认组合已确定；现成服务样本已取得真实响应，业务尚未实现。成功、失败与配置见 [RUNTIME-VALIDATION.md](RUNTIME-VALIDATION.md)。ytrader须独立本地可用，默认免费新闻、股票、产业链；ycore提供持续数据维护、产业与公司证据库、托管事件传导和多产品隔离，具体职责见[YCORE-SERVICE.md](YCORE-SERVICE.md)。订阅后置。

## 1. 结论与组合表

原则：能直接运行的开源服务就直接运行，数据源优先。自研只做公共契约、必要的连接器和网关、事件与链匹配、产品界面和策略连接。订阅权益只留接口边界，当前不实现。

| 领域 | 主选 | 接入方式 | 状态与限制 |
|---|---|---|---|
| 新闻 | Miniflux + Postgres | 原生服务；`GET /v1/entries`、`GET /v1/feeds`，`X-Auth-Token`；OPML导入 | 2.3.3实测两个RSS共45条；长期更新与恢复待验证 |
| 无RSS站点 | RSSHub（按需） | 转RSS后交给Miniflux | 不保证路由有效，也不保证全文可分发 |
| 财经摘要 | Horizon CLI/MCP（后续按需） | 做摘要用 | 不部署第二个常驻抓取系统 |
| A股自配 | AKTools（AKShare包装） | HTTP，`python -m aktools` | 腾讯日K、财务摘要、主营成功；东财概况/日K失败，须按源启用能力 |
| 默认免费产业链 | **JiMoxiao/industry-chain-atlas（MIT）** | 原生FastAPI：`GET /api/chains/{slug}`、`GET /api/fusion`；固定版本YAML/JSON可离线随包 | 5链、58环节、66条环节边、197个去重股票代码已实测；范围为半导体及相关材料，结构静态维护，不当全市场实时数据 |
| 自带key产业链 | iFinD MCP可选 | 本地私有配置，直接或复用现有适配 | 图谱、树及新产品企业检索成功；旧节点名单404，产品匹配不能冒充节点成员 |
| 产业链补证 | CapexGraph可选 | 原生run API | 公告发现成功；正文抓取受本机DNS影响，完整链未跑通；非默认依赖 |
| 托管数据扩展 | ycore实现同一契约 | 向多个产品提供维护数据、AI和策略 | 全面性、准确性及更新为验收目标；订阅后置 |

investment-news 作为初始源目录和分类参考，选用的源逐个确认可用。不把 fetch.py/data.js 当主数据服务。它的静态输出时间和被删除的重复报道还原不了，Miniflux 因此省掉自研采集缓存API。SemHash 是去重库，不是数据源。语义相似只算重复候选，不等于事件同一性，也不删除报道来源。首版单篇事件就能工作。

## 默认免费产业链：已确定（2026-10-17）

选择 [JiMoxiao/industry-chain-atlas](https://github.com/JiMoxiao/industry-chain-atlas)，固定commit `06661655379f918564a78ac905c045b3e824a76e`。仓库MIT许可，保留其LICENSE与署名。使用现成数据、查询服务和图谱能力；不重新构建图数据库、不要求Neo4j、AI key、iFinD或ycore。

| 默认数据包 | API slug | 环节 | 环节关系 | 股票代码（链内去重） |
|---|---|---:|---:|---:|
| 半导体 | semiconductor | 26 | 36 | 136 |
| 电子化学品 | electronic_chemicals | 9 | 6 | 31 |
| 有色金属（半导体上游） | nonferrous_metals | 10 | 11 | 26 |
| 硅材料 | silicon_materials | 8 | 9 | 22 |
| PCB与覆铜板材料 | pcb_materials | 5 | 4 | 11 |

五链共58个环节、66条环节关系、197个去重股票代码。这里的五链是围绕半导体的相关产业，并非五个互不相关的全行业，也不代表完整A股覆盖。

**实际验收**：五个原生HTTP接口均成功；浏览器完成“半导体→搜索硅片→点击节点→Companies列表”，显示沪硅产业688126等7家公司。API保留硅片→晶圆制造边。另核验[沪硅产业2025年年报第7、15页](https://static.cninfo.com.cn/finalpage/2026-04-17/1225114274.PDF)：证券代码、硅片业务和下游客户含中芯国际得到披露支持；不推导具体型号供货量、份额或2026年实时关系。整包未逐条独立核实，不能统一标成confirmed。

### 直接接入方式

- 先将原项目作为本地独立服务运行，ytrader只增加一个公开v1适配器。上游已提供API和图谱页面，图谱交互可复用，不再自研采集/建图库。
- `nodes[].id`映射稳定环节ID；`companies[].code/name/role`映射公司定位（`company_node_association`）；描述不足时保留关联，不强行生成生产或使用关系；`edges[].from/to/product`映射环节关系。证券代码规范成交易所+六位字符串，不能按名称拼接。
- 原YAML/JSON随固定版本保存，可做无网络时的默认数据包；公开标准JSON/HTTP仍可替换。ycore与非订阅来源使用同一v1模型，不让页面直接依赖Atlas私有字段。
- 分开记录`source_version`、资料原日期、获取时间和核验状态。来源项目整理的关系可用于浏览，标为来源记录；有具体披露证据的关系才升级核验。环节公司定位、行业工艺上下游和具体企业供销分开。
- 新闻事件命中包内环节即可联动公司；未覆盖产业明确显示未覆盖，直接个股分析继续可用。扩链是同格式数据包增量，不能由LLM静默补成事实，也不因未覆盖而强制购买key。

### 默认启用与排除

采用产业结构、公司映射、来源字段和图谱能力。**不采用原项目旧行情热度、未核实产能估算/趋势及推定的“权威”标签**。行情和财务继续走已验证的AKTools/腾讯等来源。原`source_confidence`由关键词和作者分数推断，不等于外部核验。

结构数据随版本维护：检查上游数据diff，保留旧版，审阅公司新增/删除和关系变化后发布新数据包；无新资料就保持原日期。这是版本更新流程，当前未建自动更新服务。原项目`refresh`只更新行情缓存、复制现有产能快照、重新生成JSON，**不会抓取新产业链关系**，不能把生成日期写成关系更新日期。默认关闭其定时刷新；动态资料以后按需通过主营/公告补证，不把不稳定网站接口作为打开链页的前提。

### 为什么选择它

- 对比ChainKnowledgeGraph：有明确MIT许可、可直接运行的API/界面和2026年的结构快照，不再把2021历史库定为默认源。
- 对比apple-chain-graph：它是苹果型号供应链专门项目，存在模板/推断边；保留为可选垂直参考。Atlas同样要保留来源边界，但其环节与A股公司浏览更符合当前首版。
- `zhensherlock/industry-chain-graph`主要是图工具工程，不能替代数据底库；`ai-stock-pool`实际有137条A/美股研究池记录，适合作为AI专题补充，未提供本次所需的通用环节图。两者已读取实际仓库，不因名称相似就入选。
- 东方财富板块、概念与主营接口用于补充公司/业务信息，不能单独冒充产业链。研究建议的“最稳定”没有本轮执行证据，且前轮已有东财部分接口失败，因此不让它们成为默认链页的硬依赖。

本轮仅完成选型、原项目运行和验证；ytrader统一适配与页面整合尚未实现。未修改上游业务代码，未开发订阅、采购或发布远端。

原项目运行验证已结束，临时服务与预览已按用户要求关闭。证据保留在研究工作区，后续交付以整合后的ytrader为准。

## 2. 数据来源与直接入口

**新闻**：官方文档 [Miniflux API](https://miniflux.app/docs/api.html) ，Docker 部署见 [Miniflux Docker](https://miniflux.app/docs/docker.html) 。示例密码不复制。RSSHub 文档在 [RSSHub 文档](https://docs.rsshub.app) 。

**A股行情与基础数据（AKTools）**：官方文档 [AKTools 文档](https://aktools.akfamily.xyz/) 。本轮成功的日K请求为：
`GET /api/public/stock_zh_a_hist_tx?symbol=sh688396&start_date=20261001&end_date=20261016&adjust=`
财务与主营也已取得实际HTTP响应。上游 AKShare 文档（[AKShare 股票接口](https://akshare.akfamily.xyz/data/stock/stock.html) ）与运行状态如下：

| 函数 | 内容 | 注意点 |
|---|---|---|
| `stock_individual_info_em` | 东方财富概况（item/value） | 本轮上游断连失败 |
| `stock_zh_a_hist` | 东财日K | 本轮上游断连失败 |
| `stock_zh_a_hist_tx` | 腾讯日K | 本轮不复权样本成功；其他复权未测 |
| `stock_financial_abstract` | 新浪财务摘要宽表 | 成功；不是完整财报 |
| `stock_zygc_em` | 东财主营构成 | 成功；需映射期间和口径 |
| `stock_notice_report` | 东财按日期和类别的公告 | 不是单股接口，需按证券筛选 |

这些接口要做单位、字段、期间映射，不默认实时行情或历史时点财务成立。AKShare 有学术研究声明（[AKShare 数据说明](https://akshare.akfamily.xyz/introduction.html) ）。公开网站抓取有维护风险，开源代码不提供数据转售权。

**产业链（CapexGraph）**：仓库 [CapexGraph](https://github.com/Mrjie7205/CapexGraph) ，检查固定在 commit `effe3c18ec23983db0a37b5a03acae0040db00aa`。
- API：`POST /api/v1/runs/theme`（或 `anchor`）默认只建 run；`POST /api/v1/runs/{id}/execute` 支持 `{ "background": true }`；`GET /api/v1/runs/{id}` 读取状态与图，`/artifacts/{filename}` 读取 graph.json、evidence.json、coverage.json。后台使用 FastAPI BackgroundTasks，重启后可能需要 `/resume`；`needs_review` 是待核验状态，不能只等 `completed`。
- CLI：`capexgraph run <run-id> --provider openai --evidence-mode strict`。启动：`python -m capexgraph.cli serve`，源码已有 `docker compose up --build`。
- 真实流程需要官方材料的发现、抓取、证据核验，以及模型配置；fixture 只是冻结样例。
- CNINFO公告发现已成功，正文抓取被本机fake-IP触发的SSRF防护拦截，完整生成未运行。其他材料适配和长期稳定性未验证。它不提供连续关系数据库。
- 必要适配：直接调原API，映射 graph/evidence、证券身份与 run 版本，并处理轮询、失败恢复及防重复提交。证据状态包括 proposed/captured/agent_reviewed/reviewed/rejected；边本身没有独立审核状态，应结合证据与 verification_required 映射。跨主题长期浏览还需实体归并、关系更新与发布，单个 run 不自动提供这些能力。

**自带key与ycore边界**：用户可在独立ytrader中配置自己的iFinD等数据key，无需先接ycore。现有ycore iFinD collector的适配逻辑可按边界复用；当前账户的图谱、树目录和产品词企业检索已成功；旧节点企业名单接口仍返回内层404，产品词检索不等于精确节点成员，见CHAIN-PATH-VALIDATION.md。配置已私有持久化，不再重复索取。ycore另负责维护供多个项目复用的数据、AI和策略，数据授权范围在正式分发前确认。Tushare协议（[Tushare 数据服务协议](https://tushare.pro/document/1?doc_id=405)）不因token可用就允许转售。当前不采购、不计费、不实施订阅。

## 3. 现成能力与缺口

| 缺口 | 处理 |
|---|---|
| 新闻事件归并 | 自研：事件与链匹配，保留 `article_ids` 和引用 |
| 历史时点（point-in-time）财务 | 源不提供历史披露或修订则 `point_in_time=false`，拒绝假历史回测 |
| 复权基准 | 源没有则 `unknown`，不能宣称跨源等价 |
| 默认免费产业链 | 已选MIT Atlas五链包；版本更新、字段过滤与公开v1适配按本节落地，不依赖ycore/付费key |
| 商业订阅 | 后续扩展；功能和数据源稳定后再确定授权、套餐与计费 |
| 海外数据 | OpenBB V5 可选，定位海外宏观/SEC，不作A股主源 |

其他候选的取舍：
- **ValueCell**：有 HTTP 资产、行情、历史接口，底层是 AKShare/yfinance/Baostock。公告 Agent 含 CNINFO 查询和 PDF，但财务不是完整稳定的数据API，默认是用户模式，需要多租户隔离。保留为可选研究应用，不作基础数据层。
- **stockfinlens**：Wails 桌面 Go 应用，没有已核实的 headless API。只作独立使用和溯源参考，不移植 Go 计算器。
- **KAG**：供需例子是框架加演示数据，不是持续产业链源，暂不部署。
- **OpenBB V5**：官方已换 provider namespace（[OpenBB V5 Providers](https://docs.openbb.co/odp/python/extensions/providers) ），旧的 `obb.equity` 和 yfinance 用法不能照搬。

## 4. 统一公开契约（ytrader 设计，非上游现有）

实施时在开源 ytrader 建立 `contracts/data/v1`，包含 OpenAPI、JSONSchema、示例和小型兼容检查；当前尚未创建实现文件。ycore 引用同一版本，不能只在 ycore 放协议。ytrader薄网关采用FastAPI/Python，ycore保留现有TypeScript/Node；契约本身语言无关，不为统一语言重写现成服务。前端和策略只面对 v1，不认识上游字段。统一的是结构、语义与错误处理，不要求不同源数值相同或覆盖相同。兼容新增字段可小版本扩展；字段改义或删除必须升级主版本。

**最小API**：
- `GET /api/v1/capabilities`：市场、资源、字段、覆盖、更新、复权、财务口径、point-in-time、调用限制、可用状态。
- `GET /api/v1/news`、`/events`、`/events/{id}`、`/chains`、`/chains/{id}`、`/nodes/{id}`、`/search`、`/instruments`、`/stocks/{id}/profile|prices|financials|business|announcements`。
- `GET /api/v1/strategies`、`POST /api/v1/analyses`、`GET /api/v1/analyses/{id}`是独立分析契约；本地短计算200、托管202异步轮询，幂等、状态与引用规则见ARCHITECTURE和YCORE-SERVICE。基础数据不必连接闭源AI。

**响应**：`{schema_version, request_id, status, data, provenance[], gaps[], next_cursor?}`；status 为 ok/partial/stale/error。每个 provenance 包含 source_id、provider_record_id（如有）、source_url（如有）、source_as_of、retrieved_at、adapter_version、snapshot_id，字段/记录可引用它。缺口按资源和字段记录。错误采用稳定 error.code；认证失败401、无权限403、限流429、上游失败502/503。成功读取但部分字段缺失返回partial，不能整页500，也不能冒充空结果。

**身份**：`instrument_id` 用自有规范，例如 `CN:XSHE:000001`（仅为示例），market/exchange/code 独立，不把厂商代码当全球 id。`company_id` 与证券拆开，一家公司可多地上市。适配器维护 `provider_symbol` 映射，没有确定匹配就不猜。

**时间**：
- `published_at/disclosed_at/occurred_at/retrieved_at` 用 UTC RFC3339，来源不提供时留null并标缺口；不得用抓取时间冒充事件或披露时间。
- `trading_date` 带 exchange 时区。
- 财务带 `period_start/period_end` 和 annual/single_quarter/YTD/TTM。
- `source_as_of` 与 `retrieved_at` 分开。

**数值**：
- 保留 `raw_value/raw_unit/raw_currency`，再给 normalized 的 value/unit/currency。按字段元数据换算，未知单位不猜。
- 用 decimal 字符串和精度规则，避免 float 悄悄改数。
- 财务明确 consolidated/parent、original/restated/revision、单季/累计、币种。
- 价格标 none/qfq/hfq，带 `base_date/factor_version`。
- 单次派生计算固定复合数据快照和口径；各类资源可以来自不同provider并逐项标注，但同一计算输入集合不能半组失败后fallback混源。`snapshot_id` 引用 inputs，便于复现。

**关系**：节点有 type 和 id。边有 `edge_type`（upstream_of/company_node_association/produces/uses/supplies_to）、起止时点、evidence（原文/URL/披露日期）、provider 与 `review_status`（source_record/candidate/reviewed/rejected）。NewsEvent 保留 `article_ids` 和引用，模型推断与供应商数据分开。source_record表示可追溯的上游整理记录，candidate表示待确认匹配或推断，reviewed必须附具体核验依据，rejected不参与事实路径；任何provider记录都不自动升级reviewed。用途关系或概念分类不能冒充公司供应链。

**缺失原因**固定为 unsupported/not_configured/no_entitlement/empty/stale/failed。null 不是 0。空数组只表示成功但无结果，源故障不能冒充 empty。能力信息决定策略是可运行还是降级，并说明原因。

**自配方式**：
- 内置连接器配置。
- 遵守 v1 的 HTTP baseURL。
- 严格的 CSV/JSON 模板导入，不做任意 ETL 字段映射平台。
- 高级用户可新增 adapter，无需 fork 前端或依赖闭源代码。
- 用户可自建网关，也可直接接实现契约的服务。
- 第三方 key 只放在相关服务端。

**来源切换与隔离（订阅相关部分仅预留）**：
- 按资源选来源，但一个完整计算输入集固定同一快照。
- 缺数据只走已配置且许可的 fallback，没有自动购买或默认付费回退。
- 切源后新结果重算，旧结果保留来源。
- cache key 含租户或授权范围、provider、identity、period、basis、版本，不跨用户混私有数据。
- 供应商授权与 ycore 订阅权益分开。用户有券商 key，也不能共享到公共 cache。
- 用自配数据调用 ycore 托管AI，需明确授权发送本次选定输入，数据不自动上传。
- 高级策略先只用 ycore 自有数据，不默认支持上传全部用户源。

## 5. 实施顺序与交付边界

以[开发计划](PLAN.md)为唯一工作包顺序：契约与骨架 → 免费数据和产业链页 → 新闻联动及个股 → 四策略 → 本地安装和最终验收。公开v1接口的方法、目录和运行边界以[架构](ARCHITECTURE.md)为准。

先复用已取得样本的接口，按实际使用字段补齐公司概况、公告、股本/TTM及单季现金流。声明可运行的策略必须有足够输入和计算证据，缺失字段明确禁用相关计算；不能用缺口提示替代整个策略的交付。现有真实响应证明接入可行，不证明长期更新、故障恢复或产品完成。

当前完成初始化与设计定稿，未开始业务实现。后续业务实现、远端发布和商业数据采购各按相应授权推进；本轮没有生成可运行的ytrader产品。
