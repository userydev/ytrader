# 阅读 → 产业 → 公司：交互修订基线

> 状态更新（2026-10-18）：本文保留旧轮次的接口、流程或实施记录。产品核心已重定为产业链，当前方向以 [PRODUCT.md](PRODUCT.md) 与 [CHAIN-CORE-LOGIC.md](CHAIN-CORE-LOGIC.md) 为准；旧工程验收不代表产品价值通过，本轮不沿旧计划继续 UI 开发。
2026-10-18。依据用户最新反馈，当前版本把分析按钮、数据标签和技术状态放在主流程前面，验收结论不能替代用户体验。本轮优先修正交互和内容组织，保留现有配色和技术栈，不做与主线无关的装饰重设计。

## 用户路径与验收

- 首页是新闻/事件阅读。可以只读新闻；没有产业关联也正常。默认标题、正文、来源与时间，不展示数字评分、未分析徽章、API/证据版本等后台字段。首页未选文章时展示可读的第一条/阅读摘要，不以配置和研究操作面板作为主内容。
- 阅读事件后可直接看到“相关产业”入口，一个事件允许关联多个主题。每个入口说明简短关联依据，不把自动关联当成受益结论。点击进入该主题产业结构，并保留返回事件入口。模型分析是可选的后续功能，不作为事件默认主操作。
- 产业首页首先展示可浏览主题；原始行业分类收进“按行业查公司”。主题详情分组呈现产品/环节与相关公司，可查看关键上下游；不把同一个“业务分类（非供货）”写在每个节点/连线上。分类语义只在总图例说明一次。证据、日期、置信值、原始 ID、全量关系表与缺口细节按需展开。
- 图中的公司可直接进入公司页。公司页先回答：公司是谁、做什么、在哪些产业环节、最近相关事件；行情辅助，不占据全部内容。公司资料和业务必须来自真实来源，保留来源/更新时间但折叠冗余说明。个股研究可独立发起，不能假借某条事件冒充公司分析。
- 主导航以“资讯、产业、公司”为主。设置为辅助入口；“任务”从主导航移除，改为设置下的“数据更新”，解释更新新闻/证券资料的目的。任务日志作为次级展开，正常浏览不需理解队列、任务 ID。旧 /jobs 可继续访问但改名解释。
- 在真实数据上验收：普通新闻可独立阅读；盛和资源事件→稀土主题→盛和资源公司档案→公司研究；一个跨主题事件能列出多个产业入口（用本地测试数据证明多关联逻辑，不在真实预览伪造新闻）；沪深北各一家公司有真实档案，来源失败时保留其他功能与缓存。

## 冻结接口（前后端共同依据）

全部仍使用现有 `{data,meta}` envelope，旧接口保持兼容。data/AI 模式独立；不静默把 ycore 模式变成本地。新增远程契约未支持时明确报能力缺失。

### GET /api/v1/chain/topics?event_id=&symbol=

`data={items:[{id,name,description,company_count,product_count,relation_count,matched_by:string[],evidence_ids:string[]}],context:{event_id:string|null,symbol:string|null}}`。
全局返回已安装关系包主题（使用现有包内节点与关系，名称采用catalog映射或包元信息）；event_id/symbol过滤相关主题。事件按输入文本的产品/环节命中或明确公司所属业务关联，去重后可返回多个。不能仅因为共享“制造业”把所有主题都关联。没有匹配返回空items，不捏造。matched_by写产品/公司等可核对的短依据。未安装包不假装可浏览，可从管理入口安装。

### GET /api/v1/chain?topic_id=<topic.id>

增加可选topic_id，准确返回该已安装包的主题图（从DB读取节点/边），不向全市场共享行业扩散。现有node_id/symbol/event_id查询保持可用。topic_id不存在返回404。主题图不包含无关“制造业”节点；上/下游与分类关系语义不变。

### GET /api/v1/securities/{symbol}/profile

`data={symbol,name,full_name:string|null,introduction:string|null,business_scope:string|null,website:string|null,province:string|null,industry:string|null,listing_date:string|null,established_date:string|null,source:string,source_url:string|null,as_of:string|null,fetched_at:string|null,status:'ok'|'stale'|'unavailable',evidence_ids:string[],businesses:[{node_id,label,kind,evidence_ids:string[]}],topics:[{id,name}]}`。
基本资料公开源已实际验证：`https://emweb.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=SH600392|SZ300750|BJ920001` 返回HTTP200；另emweb.securities.eastmoney.com也可用。jbzl[0]含ORG_NAME/ORG_PROFILE/BUSINESS_SCOPE/ORG_WEB/PROVINCE/INDUSTRYCSRC1，fxxg[0]含FOUND_DATE/LISTING_DATE。不能把工商经营范围当收入构成。校验SECURITY_CODE/SECUCODE与请求一致，只保留白名单必要字段；无原文发布日期as_of=null，fetched_at另列。按symbol持久缓存24h；失败保留旧资料标stale，首次失败可返回基本主表+业务节点并标unavailable。单次上游请求<=8秒，不阻塞原证券详情或行情；原始公司简介不全市场打包分发。公开代理/Fake-IP保持现有精确内置主机机制，不扩大用户自填RSS信任范围。
将档案短摘要作为有source URL的证据保存，GET /evidence/{id}可读。无来源不制造摘要；原文公司宣传用来源归属标示，不替来源背书。

### GET /api/v1/securities/{symbol}/analysis

`data={analysis: Analysis|null,job:Job|null}`。Analysis沿用六类sections结构，可增加subject='company',symbol；event_id可留内部synthetic identifier但不写入新闻events表。证据版本包含公司档案、业务关系和所用近期事件；变更标stale。不得混入其他股票分析。

### POST /api/v1/securities/{symbol}/analyze

返回202 Job，kind='company_analyze'，异步执行并按symbol幂等隔离；只在用户点击后调用AI。模型使用已保存配置。输入限该公司档案、业务证据、近期相关事件与路径；独立公司研究视角（业务、相关环节、条件、风险、未知），不虚构财务、估值或供应关系。可复用Analyzer校验和6类输出；加强共有prompt：二手快讯只称来源报道，预测放条件/未知，不能把报表范围变化断言为净利润下降，集团与同名上市主体须区分。不能手改模型结果冒充生成。

Job可增加可选subject_label、target_url以便在数据更新页回到事件/公司结果（不返回payload密钥/地址）；旧Job字段保持。

## 实施边界

Codex负责接口决策、真实源验证、集成及浏览器体验。Pi后端与前端分离写范围；最新文档与当前未提交代码为基线。工作者不得读取runtime、keys、.env或调用真实模型；Codex主持必要调用。保留本机Gemini设置、现有新闻/证券/关系包和历史分析，不提交、不推送、不远程部署。
