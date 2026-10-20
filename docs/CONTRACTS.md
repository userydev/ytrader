# ytrader 开源首版实施基线

> 状态更新（2026-10-18）：本文保留旧轮次的接口、流程或实施记录。产品核心已重定为产业链，当前方向以 [PRODUCT.md](PRODUCT.md) 与 [CHAIN-CORE-LOGIC.md](CHAIN-CORE-LOGIC.md) 为准；旧工程验收不代表产品价值通过，本轮不沿旧计划继续 UI 开发。
2026-10-18。唯一需求来源为本轮用户确认的计划。不得读取或沿用旧项目文件、Git 历史或旧架构。

## 目标
独立运行的中文投资研究 Web：新闻事件 → 产业路径 → 公司 → 证据分析。覆盖沪深北全 A 股主表。React/TypeScript + FastAPI/Python 3.12 + SQLite/FTS5。Web first；不做交易、支付、订阅管理、iOS/macOS。

## 固定 API 契约 v1
统一 /api/v1；响应 {data:T,meta:{source:string,as_of:string|null,version:"1",completeness:"complete"|"partial"|"unavailable",warnings:string[]}}。错误 HTTP 合理状态码和 {detail:string}。ISO8601 UTC；无原始时间必须 null，不得拿抓取时间冒充。

- GET /health → {status:"ok",database:"ok"}
- GET /config、PUT /config → Config。Config: {data_mode:"local"|"ycore",ai_mode:"local"|"ycore",ycore_url:string,model_base_url:string,model_name:string,model_key_set:boolean,ycore_key_set:boolean,auto_analyze:boolean,sync_interval_minutes:number}。PUT 可额外 model_api_key、ycore_api_key；GET 不返回密钥，空密钥不覆盖，显式 clear_model_key/clear_ycore_key 清除。密钥服务端保存且权限 0600；配置校验、防错误远程 URL。
- GET /sources → Source[]: {id,name,url,coverage,content_level:"full"|"summary"|"title",enabled,status,last_success:string|null,last_error:string|null,capabilities:string[],paid:boolean}。提供 wallstreetcn 与自定义 RSS；iFinD 仅 disabled 能力声明。
- POST /sources → {name,url} 自定义 RSS；PATCH /sources/{id} → {enabled:boolean}。
- POST /sync → {kind:"news"|"securities"|"all"} 返回 Job，202；GET /jobs → Job[]: {id,kind,status:"queued"|"running"|"succeeded"|"failed",progress,message,created_at,updated_at}。
- GET /events?q=&limit=50 → Event[]: {id,title,summary,published_at:string|null,updated_at,importance:number,relevance:number,score:number,article_count:number,source_names:string[],symbols:string[],tags:string[],analysis_status:string}。
- GET /events/{id} → {event:Event,articles:Article[],analysis:Analysis|null,paths:Path[]}。Article:{id,title,content,url,source,published_at:string|null,fetched_at,content_level,revision_kind:"initial"|"update"|"correction"}。
- POST /events/{id}/analyze → Job，202；未配模型返回明确 409 配置提示而非假分析。
- GET /securities?q=&exchange=&limit=100 → Security[]；GET /securities/{symbol} → {security:Security,events:Event[],paths:Path[]}。Security:{symbol:"SH:600000"等,code,name,exchange:"SH"|"SZ"|"BJ",industry:string|null,status:"listed"|"delisted"|"unknown",as_of,source}。
- GET /coverage → {as_of,counts:{SH:number,SZ:number,BJ:number},status,source,missing_exchanges:string[],warnings:string[]}。同步不完整时不可把未获取的公司判成退市。
- GET /quotes/{symbol} → {symbol,price:number|null,change_percent:number|null,as_of:string|null,source,status}；失败返回 unavailable，不伪造行情。
- GET /watchlist → string[]；PUT /watchlist → {symbols:string[]} 返回 string[]。
- GET /chain?q=&symbol=&event_id= → {nodes:Node[],edges:Edge[],paths:Path[],gaps:string[]}。Node:{id,label,kind:"industry"|"product"|"segment"|"company",symbol?:string}。Edge:{id,from_id,to_id,relation:"upstream"|"classification"|"disclosed_supply"|"inferred",evidence_ids:string[],confidence:number|null,as_of,source_url}。
- POST /chain/import → ChainPackage:{id,version,license,source_url,as_of,nodes:Node[],edges:Edge[],evidence:Evidence[]}；必须验证许可字段/来源/时间/引用完整性/关系类别，事务导入；未知许可或缺事实证据拒绝。GET /evidence/{id} → Evidence:{id,title,url,excerpt,published_at:string|null,source}。
- Path:{id,node_ids:string[],edge_ids:string[],condition:string,evidence_ids:string[],kind:"classification"|"disclosed"|"inferred"}。
- Analysis:{id,event_id,status:"complete"|"stale",model,created_at,evidence_version:string,sections:{facts:Claim[],links:Claim[],companies:Claim[],conditions:Claim[],counter_evidence:Claim[],unknowns:Claim[]},warnings:string[]}。Claim:{text,evidence_ids:string[]}。模型输出仅引用当前给定 article/evidence ids；拒绝虚构 id，关键项无证据不得装成事实；提示注入隔离。不输出收益概率。

## 服务边界
data_mode 与 ai_mode 独立。ycore 是同契约远程 HTTP 服务；纯本地时无 ycore 依赖，用户自有模型直连 OpenAI compatible chat/completions。服务替换用 contract stub 验证四组合，不能宣称未部署 ycore 已上线。托管端必须声明 Cloudflare AI Gateway routing，不把 Gateway 密钥或供应商密钥交浏览器；用户鉴权/权益属于未来 ycore。不得向自有模型转发 ycore token。

## 质量实现
新闻 URL 规范化 + 正文指纹去重 + 保守中文同事件聚合；保留转载来源、更新、纠错，不混合无时间旧闻。重要性与关注相关性分别计算；时效/来源多样性排序。规则基线可用，无模型亦可阅读证据与关系。可配置决策模型作为插件接口和离线评测 CLI（Jev 不默认启用，不虚称评测过）。重点事件自动预分析可选，证据新增将原结果 stale。
来源故障隔离，限时网络请求，SQLite jobs 可恢复与有限重试，幂等同步；FTS 搜索。全 A 股接口优先实际公开来源，覆盖按交易所报告，未覆盖诚实标记。AKShare 可 optional，不依赖收费源。
产业数据不捆绑无授权 ChainKnowledgeGraph；提供原创、明确标注演示的 fixture 仅测试，不注入正式用户数据库。用户可通过 JSON 导入有来源许可的数据。关系分类不能显示成供应关系。

## 界面方向
中文浅色研究工作台，纸白背景、深墨字、青绿色强调、细线分隔。无营销 hero、无装饰大数字/卡片墙。桌面左导航 + 事件列表 + 宽证据详情；移动端可切换阅读。主导航：资讯、产业、公司；设置为辅助入口，数据更新位于设置下。真实空态引导同步/导入/配置；失败和陈旧状态可见。关系有图与文字替代，点击证据打开详情；不依赖外部字体。完整 loading/error/empty/keyboard/focus 状态。自有 AI 密钥仅密码输入与服务端保存。

## 交付与验证
可安装运行、后端行为测试、前端类型检查构建、真实公共来源烟测、浏览器桌面/移动操作验证。文档以实际代码为准。必要部署、备份、更新与密钥说明。开源许可由独立 LICENSE 说明；不混入第三方未经核实数据。所有测试由 Codex 执行，worker 不运行代码或递归委派。

## 托管 AI 快照边界
本地数据配 ycore AI 时，远程服务不拥有本地事件 ID。适配器必须通过 `POST /api/v1/analysis/snapshot` 发送 `{context:{event,articles,evidence,paths},evidence_version}`，并按 v1 envelope 返回结构化分析。上下文来自当前证据快照，浏览器不接触服务端模型密钥。接收方仍须验证六段结构和证据引用。此扩展用于服务能力替换，不能仅把本地 ID 发给远程事件接口。

## 数据时间说明
证券公开列表未声明全表更新时间时，证券 `as_of` 可为 null；`coverage.as_of` 记录该次核对/抓取完成时间，不代替源发布时间。来源观测细节应区分上游报告数、取得数、交叉来源数及对账状态。业务分类边是核读/观测时点的分类记录，证据发布日期仍可未知。

## 阅读、产业与公司接口扩展（2026-10-18）

已实现的请求和字段详见 [PRODUCT-FLOW-BRIEF.md](PRODUCT-FLOW-BRIEF.md)：主题关联查询 `/chain/topics`、精确主题图 `/chain?topic_id=`、公司 `/profile`、独立公司 `/analysis` 和 `/analyze`。主题只来自已安装数据包；空关联正常，不因共享制造业分类扩散。公司档案的源日期与抓取时间分开，缓存失效后上游故障返回旧数据并标 stale。

公司分析使用独立存储，不向新闻 events 表写入伪事件；同一证券任务去重，不同证券结果隔离。数据与 AI 的本地/ycore 四组合仍独立路由。Job 的 subject_label、target_url 是基线可选项，本轮未添加；数据更新页不提供该类任务的直达结果链接。

## 产业解释库与AI结构（2026-10-18）

此接口承载新轻量产业模型；旧 `/chain` 主题接口保留兼容。

| 方法/路径（前缀 `/api/v1`） | 用途 |
| --- | --- |
| `GET /industries?q=&symbol=` | 公共参考与个人AI初稿目录；可按证券查已收录角色 |
| `GET /industries/{id}` | `base`、AI `results` 历史及最近 `job` |
| `POST /industries/generate` | `{name}` 创建未收录产业的结构化初稿，返回202任务 |
| `POST /industries/{id}/supplement` | `{question}` 补充现有产业，返回202任务 |
| `GET /securities/{symbol}/industries` | 公司在已收录公共结构及有效AI补充中的参与位置 |
| `POST /industries/explain` | ycore所需快照能力；服务端须配置独立local模型，禁止递归转发 |

公共参考由 `backend/data/industries` 随软件读取，不向证券或新闻表注入样例。AI结果另存SQLite `industry_results`，不覆盖公共包。结构包括产业范围、节点、六类有向关系、公司、参与映射、来源和分步解释。AI可引用输入中的已有来源ID，不能创造URL或改写来源；无来源的一般知识保持AI身份。此校验只保证引用存在，不能证明语义蕴含。

证券代码不接受模型指定。AI建议公司在证券主表名称唯一精确匹配后获得代码；local模式另允许公共参考已核对的精确同名映射，但须确认该代码存在于当前主表。歧义和未匹配名称保持原名，避免误链。任务固定data/AI模式与目标模型地址，同一产业/问题/输入版本合并活跃任务，失败保留已有结果。结果保存实际模型、生成时间、问题和输入版本；公共基础更新后旧补充显示失效提示。任务公开信息含 `subject_label`、`target_url`，不含密钥或模型请求。

公共参考和个人AI结果保存在本地，不随新闻data_mode迁移。选择ycore AI时调用其`/industries/explain`能力，缺失即报错，无本地回退。真实ycore服务尚未验收。

### 统一解释结构 v1

`IndustryGraph.structure` 为可选字段，用于兼容历史；新local/ycore AI结果必须提供。字段：`version:1`、`organization:production|composition|development|mixed`、`thesis`、`groups[{id,title,role:core|support,purpose,node_ids}]`、`primary_relation_ids`、`reading_order`。全部节点恰属一组，组/主关系/阅读顺序引用完整且唯一，主关系两端为core，support须经真实关系连到core；不满足则不保存。归组不新增事实关系，阅读顺序不生成上下游。

读取旧图时返回只读归组及`structure_origin:compatibility`、`structure_notice`，原数据库记录和输入版本不重写。新完整结构返回`structure_origin:provided`。向模型传递快照时不把兼容归组伪装为已提供结构。当前远端服务也须支持新输出契约，否则明确失败，不降级保存旧格式。

前端通用布局按真实关系生成主干层次，组内节点/公司按需查看；同层分支、跨行/循环和支撑保持实际方向。不同产业通过JSON表达机制，不靠行业名称或专用坐标分支。已有API、来源边界、证券身份匹配、配置与数据库schema保持。
