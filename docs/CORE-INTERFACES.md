# ytrader 核心接口约定（v1）

开放目录、任意产业研究、多产业关联与条件影响见 [开放产业契约](contracts/open-industry.md)；以下保留基础v1字段约定。

## 1. 通用约定

**前缀与响应**
- 前缀统一为 `/api/v1`。
- 成功响应：`{data:T, meta:{source, as_of:string|null, version:"1", completeness:"complete"|"partial"|"unavailable", warnings:string[]}}`。
- 失败响应：合理的 HTTP 状态码加 `{detail:string}`。现有用法：404 未知 ID，422 参数不合法，409 未配置模型时调用分析。

**时间**
- ISO8601 UTC。
- 来源没有给出原始时间时填 `null`，不得拿抓取时间顶替。
- `published_at`（来源时间）和 `fetched_at`（抓取时间）分开存放。

**ID**

| 对象 | 格式 |
|---|---|
| 证券 `symbol` | `SH:600938`、`SZ:…`、`BJ:…`。不是 `600938.SH`；接口会校验格式 |
| `event_id`、`story.id`、`industry_id` | 不透明字符串，客户端不得解析 |
| 审计 `run_id` | `editorial-run:<digest>` |

旧 ID 一律保留，不重新编号。

**远端模式（ycore）**
- 路径与 local 相同，按必需字段校验。
- 校验失败返回错误，不静默回退本地。

## 2. 新闻推荐（已有）

`GET /news/editorial`

返回 `data`：
- `generated_at`
- `algorithm_version`
- `state`：`collecting | empty | ready | no_current_selection | sources_unavailable`
- `items[]`
- `default_event_id | null`
- `exclusive_available`
- `coverage_note`
- `collection{active_job_id, last_checked, warnings}`
- `run_id`

每个 item 至少包含：
- `id`
- `event_id`
- `story{id}`
- `articles[].attribution.publisher`
- `reasons`
- `exclusive_claims`
- `algorithm{score, importance_tier, rerank_score, suppression[], excluded[]}`

`meta.completeness` 的取值：
- `empty` → `unavailable`；
- 有警告或没有条目 → `partial`；
- 其余 → `complete`。

**边界**
- 一次固定最多返回 36 条，扫描最近 2000 条候选。
- 更早的事件仍可通过事件详情或议题接口访问。
- feed当前不提供分页。
- `score` 只解释排序，没有归一化，不是概率。

**扩展字段**
- 可选字段 `algorithm_versions:{recommendation, event_grouping, industry_transmission, security_matching}`。
- 保留 `algorithm_version` 字段，旧客户端不受影响。

## 3. 事件详情、议题与传导（已有）

**事件详情**

`GET /news/editorial/events/{eid}`

返回 `event, title, summary, articles, industry_links, current, progresses, story, generated_at, algorithm_version`。

`industry_links[]` 的字段：
- `industry_id`、`name`、`industry_name`
- `variable`（变量）、`mechanism`（机制）、`condition`（条件）
- `node_ids`
- `relation`：区分直接（direct）与条件成立才有影响（conditional）
- `evidence[{article_id, trigger, quote}]`
- `basis:"rule_inference"`
- `rule_version`

不提供置信度，也不预测涨跌。

**议题时间线**

`GET /news/editorial/stories/{sid}` 返回 `{id, progresses, basis}`。

**通用事件与产业链**
- `GET /events`、`GET /events/{id}`、`GET /chain` 沿用 CONTRACTS.md 的 v1 定义。
- `Path.kind` 取值：`classification | disclosed | inferred`。

**扩展字段**
- 详情里同样加 `algorithm_versions`。
- 跳转复用现有`industry_id`和`node_ids`，不建立重复映射字段；未知产业/节点明确提示，不猜测。

## 4. 产业全景（扩展）

**接口**
- `GET /panorama/catalog` → `{items:[{id, name}], schema_version:"1"}`。
- `GET /panorama/{industry_id}` → 原单行业 JSON，schema 不改。未知 ID 返回 404。
- `GET /panorama/context` → `{securities, context, observatory, profiles}`，四项分别是原同名 JSON 的内容。

**local 模式**
- 后端只读取白名单目录里的文件，拒绝路径穿越。
- `meta.source` 填 `local/panorama-static`。
- `as_of` 取文件里自带的时间；没有就填 `null`。

**ycore 模式**
- 同路径请求，校验身份引用和结构：`industry_id` 要和请求一致，节点引用要完整。
- 校验失败报错，不回退本地。

这三个接口就是以后 ycore 替换静态数据的边界。

## 5. 证券（已有为主）

**证券目录**

`GET /securities?q=&exchange=&limit=`
- `q` 最长 300 字符。
- `exchange` 取 `SH | SZ | BJ`，可为空。
- `limit` 取 1–10000，默认 100。
- `completeness` 按覆盖状态填写；覆盖不完整时，不得把没抓到的公司判为退市。

Security 字段：`{symbol, code, name, exchange, industry:string|null, status:"listed"|"delisted"|"unknown", as_of, source}`。

**扩展字段**
- 可选参数 `offset≥0`，用于分页查看全部 A 股。
- 不传时行为不变。

**证券详情**

`GET /securities/{symbol}` 返回 `{security, events, paths}`。
- `industry` 为空时，`completeness` 为 `partial`，并附警告“未猜测行业”。
- 没有行业时，基本面接口照样可用。

**公司资料**

`GET /securities/{symbol}/profile`
- `status` 为 `ok | stale | 其他`，对应 `completeness` 为 `complete | partial | unavailable`。
- 来源不可用时保留缓存，不编造简介。

**分析**

`POST /events/{id}/analyze`、`/securities/{symbol}/analyze` 返回 Job（202）。无调用通道时返回409；当前58730配置本地Gemini 3.8 Flash通道，调用失败不回退其他模型。

## 6. 财务（已有）

`GET /securities/{symbol}/fundamentals`

`data` 字段：
- `symbol`
- `status`：`ok | stale | unavailable`
- `periods[]`
- `tables{<key>:{status, fetched_at, source_urls}}`
- `composition`
- `fetched_at`：各分表抓取时间里最早的一个
- `warnings`

`meta.as_of` 取最新一期的 `period_end`。

**periods[] 单位**

| 字段 | 单位 |
|---|---|
| `revenue`、`net_profit_parent`、`operating_cash_flow`、`total_liabilities`、`total_assets` | 原币元 |
| `revenue_yoy_pct`、`net_profit_parent_yoy_pct`、`gross_margin_pct`、`debt_to_asset_pct` | 已经是百分数，前端不再乘 100 |
| `net_profit_excluding_nonrecurring`、`monetary_funds`、`accounts_receivable`、`inventories` | 原币元；货币资金不是现金等价物 |
| `net_profit_excluding_nonrecurring_yoy_pct`、`roe_weighted_pct` | 已为百分数，前端不再乘100 |
| `basic_eps` | 原币/股，不按亿元缩放 |
| `composition.items[].share_ratio` | 小数比例，当前只接受0..1；本地超界置null，远端超界拒绝 |
| `composition.items[].gross_margin_ratio` | 小数比例，展示时×100；负值或超过1保留来源原意 |

七个增补财务字段均可选，旧远端缺失归一为null，不跨报告期或币种补值。

**其他字段规则**
- `period_end` 格式为 `YYYY-MM-DD`；`period_type` 取 `Q1 | H1 | Q3 | FY`。
- `currency` 按期标注；不同币种的分表不合并，并给出警告。
- `debt_to_asset_basis`：`source`（来源直接给出）、`computed`（由负债和资产算出）或 `null`。

**展示规则**
- 接口空值使用 `null`；界面显示“未提供”或“—”，不代表0。
- 不同报告期不混用；趋势图只用 FY。
- 某张分表超过 TTL 时，该表标为 `stale`，并保留缓存。

## 7. 缓存与失败

**新闻**
- 按来源隔离 Retry-After 状态和缓存。
- 所有启用的来源都失败时，`state=sources_unavailable`。
- 失败信息放在 `collection.warnings`。

**财务、资料**
- 失败时返回 `stale` 加缓存，从未取到过则为 `unavailable`。
- 远端结果校验不过时返回 `unavailable`，并附警告“未回退本地”。

**状态统一**
- 界面统一显示三种状态：数据时间和来源、`stale`、不可用。
- 不得因为某个来源短时间可用，就把它展示成稳定来源。

## 8. 兼容与演进

- v1 只做加法：新增可选字段或参数；不删字段，不改语义或单位。破坏性改动需要另开 `/api/v2`。
- 客户端忽略不认识的字段。
- 扩展字段 `algorithm_versions`、`offset`、`/panorama/*` 都是可选或新路径。
- 机器可读 schema 放在 `docs/contracts/*.json`。远端契约样例 fixture 和 schema 一起维护。ycore 或其他数据源只要通过这些样例和 stub 四种组合的验证即可接入。通过验证不代表已经部署。

## 9. 契约和算法发现（已实现）

- `GET /contracts/core`：返回机器schema的标准envelope。发布时必须同时携带 `docs/contracts/core-v1.schema.json`。
- `GET /algorithms`：返回当前本地实现的只读registry与独立版本；不声称远端算法版本相同。
- 详细接入边界见 [契约附录](contracts/README.md)，四算法思路和CHANGELOG见 `docs/algorithms/`。
