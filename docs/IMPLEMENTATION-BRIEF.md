# ytrader 开源首版实施基线

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
中文浅色研究工作台，纸白背景、深墨字、青绿色强调、细线分隔。无营销 hero、无装饰大数字/卡片墙。桌面左导航 + 事件列表 + 宽证据详情；移动端可切换阅读。导航：事件、证券、产业链、任务、设置。真实空态引导同步/导入/配置；失败和陈旧状态可见。关系有图与文字替代，点击证据打开详情；不依赖外部字体。完整 loading/error/empty/keyboard/focus 状态。自有 AI 密钥仅密码输入与服务端保存。

## 交付与验证
可安装运行、后端行为测试、前端类型检查构建、真实公共来源烟测、浏览器桌面/移动操作验证。文档以实际代码为准。必要部署、备份、更新与密钥说明。开源许可由独立 LICENSE 说明；不混入第三方未经核实数据。所有测试由 Codex 执行，worker 不运行代码或递归委派。
