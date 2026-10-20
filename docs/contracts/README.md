# Core v1 接入附录

总接口见 [CORE-INTERFACES](../CORE-INTERFACES.md)，开放目录与研究扩展见 [开放产业契约](open-industry.md)。

## 机器契约与样例
- `core-v1.schema.json`：JSON Schema draft 2020-12。成功响应 envelope，按 `x-endpoints` 选择对应 `$defs`；顶层 anyOf 仅用于一组核心成功响应的共同发现，不代替按路由选型。
- `core-v1.examples.json`：七个离线响应样例。新闻/简化全景是明确标识的合成样例；财务样例保留来源口径。
- 原全景完整样例直接复用未改动的 `frontend/public/industry/data`；context 的四项分别是 securities.json、context.json、observatory.json、company-profiles.json，不是 financials.json。
- JSON Schema 不能表达所有跨文档关系。还须通过 `backend/core_contracts.py` 的身份/引用/重复 ID 检查和 Panorama 的完整 cross-document 检查。
- `GET /api/v1/contracts/core` 返回提交的 schema envelope；发布此发现接口须把 `docs/contracts/core-v1.schema.json` 一起打包。
- `GET /api/v1/algorithms` 为当前后端实现的只读版本 registry，不宣称远端算法与本地相同；远端新闻自身的可选 algorithm_versions 才描述远端结果。

## local / ycore 全景
路径 `/api/v1/panorama/catalog`、`/context`、`/{industry_id}`；静态路径注册在动态路由之前。基础静态全景保留五个原行业ID；local目录还可返回来源适配及已保存研究结构。未收录ID返回404，不接受文件路径。远端开放能力限制见开放产业契约。

未设置 YTRADER_WEB_DIST 时，local 使用仓库固定 frontend/public/industry/data；显式设置时只读取该构建目录下 industry/data。无第二目录 fallback；缺失、格式错误或越出根目录的文件被拒绝。文件读取有大小上限。原结构不补造时间、版本或来源；local带研究服务时附加source_kind及可用研究信息。meta.source=local/panorama-static，当前这些聚合文档无单一 as_of 时返回 null，各来源原有 checked_at/基础版本保留。

context 返回四份 JSON 的原内容，保留静态公司资料的原报告期、金额单位和说明；它不是现时 fundamentals。未读取或回退旧 financials 静态文件。

ycore 使用同一路径，不读取本地全景作替代。单行业校验内部节点/关系/来源/参与公司/分组/情景引用，并用远端 context 的证券登记核对 symbol；context 为验证全部交叉引用读取远端五行业。远端新闻关联的 node_ids 也以远端全景核对，不建立第二份本地节点映射。相应代价是 context 一次逻辑读取至多六次远端请求，新闻按实际关联行业读取至多五份图；复用原 Network 的响应大小、请求时限、凭据与重定向安全边界，不另建缓存系统。发布方应提供一致版本快照；若更新中间出现混合版本引用错误，将明确失败而不是猜测。

结构/身份/引用错误的 200 不会直接交页面：返回 502；远端缺少新能力沿用 501 提示，均无静默本地 fallback。财务既有 remote_get 则保持自身 unavailable 语义与“未回退本地”警告。

## 新闻与算法
feed/detail 保留 algorithm_version，并新增可选 algorithm_versions；旧 ID 与百分数含义不变。分数只解释排序。详情的传导是 rule_inference，direct/conditional 不代表真实性核验或证券收益。

四算法文档和独立 CHANGELOG 见 `docs/algorithms/{recommendation,event_grouping,industry_transmission,security_matching}.md`。纯模块只接收显式输入、规则和 now。Editorial 旧函数委托新模块；Research 旧 merge_safe/same_event 导入位置兼容。特征组合在纯 features.py；来源 URL 安全校验仍在服务层。

## 新闻传导消费约定
无新 endpoint 或必填字段，v1 envelope、industry_links 和原图保持兼容。

- `node_ids` 是候选环节集合，顺序不表达因果；消费端以同源 `/panorama/{industry_id}` 的节点引用核对。业务边只可使用真实 `relations.{id,from_id,to_id,kind,explanation,sources}`，且不得将静态业务边称为本次已证实的影响。
- 公司由关联节点的 `participations.{company_id,node_id,role,sources}` 与 `companies` 身份组成，证券以真实 symbol 进入原公司详情；无参与记录不补公司，不做名称匹配。
- 原有可选 `mechanism_summary` / `condition_summary` 只压缩展示；完整机制、条件与 evidence 仍保存在来源详情。IEA释放安排属于 conditional，实际投放的品种、时间和数量是条件，不代表生产或已经到货。
- 独立产业入口只从当前 `/news/editorial.items[].industry_links` 筛选当前推荐事件；保留 item.event_id/id（progress），不得用静态 observatory 样本替代当前新闻。
- 路由沿用 news/progress/industry/node/return，证券入口使用 symbol。return 只允许原有同源产品路由；返回还原所选新闻/进展。未知行业不回退默认产业。

## 证券分页
`GET /securities?q=&exchange=&limit=&offset=`；offset 可选且非负。不传时不新增远端参数，保留旧行为；传入时原样转发。local 按 symbol 稳定排序，再 LIMIT/OFFSET。分页跨证券主表更新不保证快照隔离；目录覆盖不完整仍不能推断退市。

## 财务增补与单位
在原 periods 中新增七个可选数值；旧远端缺失时规范化为 null，不新增端点：

| 字段 | 源字段 | 单位/边界 |
|---|---|---|
| net_profit_excluding_nonrecurring | KCFJCXSYJLR | 年初累计原币元 |
| net_profit_excluding_nonrecurring_yoy_pct | KCFJCXSYJLRTZ | 原百分值，不再乘100 |
| roe_weighted_pct | ROEJQ | 原百分值 |
| basic_eps | EPSJB | 原币/股，绝不能除1e8 |
| monetary_funds | MONETARYFUNDS | 期末原币元；货币资金，不等于现金等价物/可用现金 |
| accounts_receivable | ACCOUNTS_RECE | 期末原币元 |
| inventories | INVENTORY | 期末原币元 |

只在展示金额为亿元时除1e8，API 不换单位；未推算 R&D。源缺失/null 保持 null。身份、报告期、币种、generic companyType 门、分表 TTL/backoff、缓存保留不变；新增指标不跨币种或期间填补。

缓存 schema_version=2 仅使旧 recent/annual/balance 缓存做一次受控版本刷新；新源仍缺字段并不触发每次重抓。失败继续按原失败节流/正常 TTL 重试，保留旧值，不删除旧缓存。不是数据库 schema 迁移。

保留本地财务 meta.as_of=period_end 的既有日期形式；Remote 仅对 fundamentals 接受合法 YYYY-MM-DD，不伪造成发布时间，其余核心元数据时间仍按有时区时间检查。

已知基线限制：构成表 share_ratio 既有保护仅接受0..1；gross_margin_ratio 保留负值及超1。本轮未放宽该保护；CORE-INTERFACES已同步实际边界，schema也给出实现说明。
