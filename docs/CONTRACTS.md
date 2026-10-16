# 数据与服务契约 v1

本文件是架构师方案经CEO整合的设计契约，尚未实现。产品行为见 [PRODUCT.md](PRODUCT.md)，任务/预算/故障规则见 [ARCHITECTURE.md](ARCHITECTURE.md)。公共schema首次实现时迁入ycore作为权威源，本项目固定兼容版本；破坏性修改升级v2，过渡窗口由发布计划确定，不能直接破坏运行中的客户端。

## 1. 通用类型与规则

- ID为string；对象版本为正整数；时间为ISO-8601 UTC，业务周期按Asia/Shanghai；缺失字段显式null。公司ID为`SSE.600519`等市场+代码。
- 列表返回`{data:array,next_cursor:string|null,has_more:boolean,snapshot_id:string}`；limit默认20、最大100。游标不透明、绑定查询和快照；失效返回410，客户端重新获取首页，不拼接两版排序。
- 错误为`{error:{code:string,message:string,retryable:boolean,retry_after_s:int|null,request_id:string,details:object}}`。错误不能用200空数组掩盖。
- 错误码：401 UNAUTHENTICATED；403 FORBIDDEN；404 NOT_FOUND；409 CONFLICT/IDEMPOTENCY_CONFLICT/BUDGET_EXHAUSTED/PENDING_VERIFICATION；410 CURSOR_INVALID/CURSOR_EXPIRED/CONTENT_REMOVED；422 VALIDATION_FAILED；429 RATE_LIMITED；503 MODEL_NOT_CONFIGURED/SOURCE_UNAVAILABLE；504 UPSTREAM_TIMEOUT；500 INTERNAL。是否可重试以受理状态为准，不能仅看HTTP码。
- 数据状态：`ok/partial/stale/empty/unavailable/not_configured`。empty仅表示来源取得成功且没有合格新增；历史内容仍可随其他状态返回。
- 产品任务状态：`queued/running/succeeded/failed/blocked/outcome_unknown/cancelled`；模型调用状态：`queued/dispatched/succeeded/failed/unknown/rejected`。
- 触发分析、受控计量调用和创建任务的POST要求Idempotency-Key。键绑定身份/动作/请求体指纹；重复返回同一任务，不多扣次数；不同内容复用键409。模型调用与未决记录持久去重，不能因短期HTTP缓存过期再计费。

## 2. 客户端 ↔ ytrader（/api/v1）

Web使用Secure/HttpOnly会话Cookie，写请求要求CSRF并校验Origin；iOS用Keychain中的不透明会话token作为Bearer。所有接口除登录外需认证，不向客户端返回数据供应方或ycore密钥。

| 方法 | 路径 | 输入 → 返回 |
| --- | --- | --- |
| POST | /auth/login | `{password:string,client:web/ios}` → Web设置Cookie并返回csrf_token/expires_at；iOS返回session_token/expires_at；应用层限速 |
| GET | /auth/session | → 认证状态、expires_at；Web所需csrf_token。无效会话401 |
| POST | /auth/logout | 撤销当前服务端会话 → 204；本机清理缓存认证信息 |
| GET | /digest | → `DigestResponse`，滚动24小时最新已提交快照 |
| GET | /digest/more?cursor= | 同一快照的剩余主列表事件，默认10条；不能改变前10条快照 |
| GET | /digests?before=&cursor= | 历史快照列表，用于回看 |
| GET | /events?q=&cursor= | 已发布历史事件检索；按最近实质更新及稳定ID分页；可解析合并后的canonical ID |
| GET | /events/{id}?version= | → `EventResponse`，默认当前；历史版本必须同时给当前撤回/更正提示 |
| GET | /events/{id}/versions | → 版本、change_kind、change_note、generated_at分页 |
| GET | /updates?cursor= | 已读事件之后的实质更新及未读更正，附canonical ID与版本 |
| PUT | /read-state/{id} | `{version:int}` → 204；只允许存在且已发布的版本，存MAX(已有,提交)，不能降版本或将未发布未来版本标读 |
| GET | /companies?q=&cursor= | → `{company_id,name,market,code}`列表 |
| GET | /companies/{company_id} | → 名称、主营、mappings及证据/有效时间、两种分析摘要 |
| GET | /companies/{id}/analyses/{method} | method=fundamental/event_impact → `AnalysisResponse`，纯读取，不创建任务 |
| POST | /companies/{id}/analyses/{method}/refresh | 幂等请求 → 202 `{job_id,status}`；已有相同活动任务返回200同任务，不重复扣额；超限429附下次时间；预算409；未配置模型503 |
| GET | /jobs/{id} | → job_id/kind/status/step/error_code/created_at/finished_at/result_ref，均限当前用户可访问对象 |
| GET | /system/status | → 来源状态和最后成功时间、业务水位、模型开关/预算状态、积压与最后错误类别；不暴露密钥或原始错误中的敏感内容 |

**DigestResponse**：`{snapshot_id:string,version:int,window_start:time,window_end:time,generated_at:time,data_cutoff_at:time|null,status:DataStatus,coverage:array,items:EventCard[],watch_items:EventCard[],more_cursor:string|null}`。

EventCard含`event_id,event_version,summary,importance:major/notable,importance_reason,evidence_state,change_kind:new/substantive/correction,change_note,occurred_at:time|null,last_verified_at:time|null,impact_coverage:explained/facts_only,unread:boolean,correction_for_reader:boolean`。items≤10、watch_items≤3，无最低数量。更正优先呈现但不能复制成无关新事件。

**EventResponse**：`{event_id,canonical_id,version,current_version,core_claim_ref:{claim_id:string,version:int},lifecycle:ongoing/ended/disproved,publication:published/merged,occurred_at?,first_seen_at,summary,claims:Claim[],paths:ImpactPath[],explanation_status:ready/pending/withdrawn/model_unavailable/failed,change_note,correction_notice?}`。core_claim_ref必须属于当前事件版本的claims，卡片证据状态取该断言；未核实内容不得通过其他断言的原始证据进入主列表。

Claim含`claim_id,version,content_type:fact/source_opinion/conditional_inference,evidence_state:primary/corroborated/unverified/conflicting/refuted,review_state:none/needs_review/reviewed,text,evidence:EvidenceRef[]`。EvidenceRef含`item_id,item_version,source,title,url?,published_at?,fetched_at,content_kind:full/snippet/none,availability:available/removed/unavailable,support_locator?,excerpt?`；摘录仅在许可允许时返回，locator标明对应支持位置，缺少可核对内容不能伪造支持。

ImpactPath含环节ID/名称、机制、成立条件、反向因素、conclusions及companies；每条Conclusion含ID、状态active/withdrawn/superseded、文本与具体claim版本依赖；每个公司落点含`company_id,mapping_id,exposure_id,mechanism_conclusion_ref,business_claim_refs[],event_link_conclusion_ref,valid_from?,valid_until?`。必须有本事件机制与公司业务暴露之间的有依据条件推断，静态成员或概念标签不能自动填成确定关系。

**AnalysisResponse**：`{status:ready/stale/refreshing/withdrawn/none/unavailable,reason?,report?:{report_id,version,method,generated_at,data_cutoff_at,sections,evidence,input_fingerprint},active_job_id?,next_refresh_at?}`。withdrawn不返回错误结论作为正常正文；历史查看可返回明确标记的撤回内容，且遵守内容使用条件。依赖仍有效的旧报告才可stale返回。

打开事件成功后客户端提交已读版本；失败不标读。实质版本高于已读版本提示更新，文字小修不强制重读。离线缓存显示最后核验时间及离线提示，不承诺获知期间的新更正。

合并后的旧事件ID仍可读取别名与canonical_id，首页只返回canonical一次；已读提交必须明确自己实际读到的事件和版本。不同事件的版本号不能直接比较或用MAX搬到合并目标；拆分/合并历史保留，新的实质内容由新版本触发更新。

## 3. ytrader ↔ ycore（/ycore/v1，仅服务间）

每产品服务凭据鉴权，按product隔离来源权限/预算；只在服务端保存并可轮换。读超时默认10秒，受控来源调用默认30秒；模型异步返回任务，不以同步HTTP等待完成。

| 方法 | 路径 | 契约 |
| --- | --- | --- |
| GET | /items/changes?cursor=&limit= | `{data:[{item_id,version,change:created/updated/retracted/removed,changed_at}],next_cursor,has_more}`，至少一次投递；业务事务成功后提交游标，按ID+版本去重；过期410 |
| GET | /items/{id}/versions/{v} | `{item_id,version,source,url?,title,published_at?,first_seen_at,fetched_at,content?,content_kind,item_type,language,license_scope,availability}`。不可变版本；被要求删除内容时返回墓碑，不伪称未曾存在 |
| PUT | /subscriptions/{key} | `{sources[],schedule,tz,filters:null}`，来源轮询受许可/限额约束；综合发现不依赖股票词过滤 |
| POST | /search | `{query,sources[],since?,limit}` → `{status,items[],provider_errors[]}`；只限授权补证来源 |
| POST | /provider-calls | `{provider,method,params}`+幂等键 → `{status,data?,error_code?,provider_raw_code?}`；白名单参数，不接受任意URL/代码；金融数据仍由ytrader解释 |
| GET | /sources/status | → 来源能力stream/bounded_search、当前状态、最后成功、覆盖起止和延迟 |
| POST | /model-invocations | 幂等键+`{purpose,model_policy,prompt_version,input_item_refs[],messages[],max_input_tokens,max_output_tokens,pool:auto/manual}` → 202 `{invocation_id,status}`；计费/权限未配置或预算不足直接拒绝，不发外部请求 |
| GET | /model-invocations/{id} | → `{status,output?,usage?:{provider,model,tokens_in,tokens_out,cost_settled},cost_reserved,error_class?,provider_request_id?}`；unknown不自动重发，费用未知不填0 |
| GET | /products/ytrader/budget | → `{enabled,currency,day:{limit,spent,reserved},month:{limit,spent,reserved},unknown_reserved,pool_policy}`；unknown_reserved是reserved子集，不能再次相加 |
| POST | /items/snapshots | → `{snapshot_id,as_of_cursor,expires_at,coverage}`，固定恢复水位H；不代表上游全网历史完整 |
| GET | /items/snapshots/{id}?cursor= | 固定H下的最新条目及删除墓碑分页；快照失效410必须重建 |
| POST | /items/versions:status | `{snapshot_id,refs:[{item_id,version}]}` → 在同一H下批量检查已引用版本是否更新/撤回/删除/不可核验 |

**游标过期恢复**：取得固定水位H；分页重建本产品有权访问的当前快照，同时核对所有已引用版本；恢复中的来源状态标stale。全部产品事务提交后，从H继续消费变化，不能用最后一页即时游标跳过扫描期间变化。权限/保留期使旧引用无法核实时保留缺口并使相关结论待复核，不声称完整恢复。周期性核对采用同一流程，不能用全量扫描代替实时更正消费。

## 4. 发布、删除与幂等边界

一个ytrader本地事务发布事件版本、依赖撤回、更正记录和首页指针。历史Digest读取叠加当前安全状态，不能返回已撤回推断为有效。跨服务以消费水位和可重放变更恢复，不使用跨库事务。

客户端操作的幂等缓存、业务任务唯一键、模型派发记录是不同层。模型已发出但结果未知时占用预算并阻止同输入重发；不能把请求重试解释成新业务意图。新的输入也受未决额和同对象运行限制约束。

本文只定义接口和状态，未验证任何provider。契约fixture不得用于宣称真实来源、真实分析或稳定产品已经完成。
