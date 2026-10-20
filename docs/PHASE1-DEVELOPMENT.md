# ytrader 第一阶段开发文档：本地可运行的基本功能

状态：第一阶段实施依据。Claude Opus起草三轮，Codex整合；Grok有条件通过，Codex已将六项条件落实到本文。用户已授权审查后执行；实现结果仍待用户体验认可。
依据：用户 2026-10-20 的最新指令"第一阶段交付 ytrader 本地可运行基本功能"，以及 `docs/PRODUCT.md`。本文不代表 vNext 草案全部获批，也不限定首批产业或公司的数量。旧 ARCHITECTURE/STARTUP 中与上述依据冲突的产品选择不再适用。

## 0. 目标与原则

- 目标：仓库内的 React + FastAPI + SQLite 用**一个本地端口**提供一个应用。导航只有新闻 / 产业 / 公司 / 设置一套，数据只有一个目录。用户能走通"新闻 → 产业 → 公司 → 回到产业或新闻"，也能不经新闻直接读产业。
- 不重写：editorial 后端、产业库（`Industries` + `reading_graph`）、正式产业页（`IndustryStructure`）、配置与密钥、公司资料和研究都已经存在，原样复用。
- 第一阶段新增的只有三类：统一壳层与设置归位、新闻到产业的应用内桥接、公司基本面。
- 不伪造：新闻和财务不使用模拟值。内置产业 JSON 是有来源的公共参考（`origin='public_reference'`），读取它不等于向空库注入演示事实。
- 保护：8000、58700、58720、58721 的进程、数据、设置和 `frontend/dist` 一律不碰。

## 1. 用户可用标准（验收以此为准）

全部在隔离数据目录、端口 58730（单端口同时提供 API 和页面）上，由 Codex 实际操作验收。

| # | 用户能做到 | 不算通过的情况 |
|---|---|---|
| U1 | 任意页面顶部都是同一套导航：新闻 / 产业 / 公司 / 设置，切换不离开 58730 | 构建产物中出现指向 58720 或 58721 的 href；新闻页使用另一套导航 |
| U2 | 首次空库启动：产业页能直接阅读内置公共参考产业；新闻和公司显示真实空状态，并链接到"设置"里的具体操作 | 出现示例新闻或示例财务；产业需要先"安装"才能阅读 |
| U3 | 在"设置 → 新闻来源"更新后，首页按 editorial 规则推荐。全球重大新闻即使没有产业关联也照常显示 | 首页出现搜索、筛选、来源健康或统计；没有产业关联的新闻被隐藏 |
| U4 | 右栏四个视图（阅读 / 持续事件 / 各媒体报道 / 产业传导）可用。每个产业关联都显示变量、机制、条件和原文触发片段 | 环节名来自前端硬编码；画布缺失时把整条关联删掉 |
| U5 | 若关联产业在本地有画布：点击后进入 `/chain?industry_id=…&event=…`，图中高亮进入环节，可以"返回新闻"并恢复原先选中的新闻。若没有画布：关联解释保留，并注明"本地未收录该产业画布" | 跨端口跳转；画布缺失导致报错或空白 |
| U6 | 不带新闻打开产业时，可阅读摘要、主干和配套、环节、参与公司及其角色依据（现有 IndustryStructure 行为不退化） | 叠加层改变结构，或在没有新闻时显示预设情景 |
| U7 | 公司页能看到来源标注的介绍、所在产业及角色，以及**带报告期**的基本面：增长、盈利、现金流、负债，有数据时还有收入构成和历史趋势 | 缺失值被补成数字；0 被显示为"缺失"；公司整体指标被标成某个环节的指标；同比的口径不可比 |
| U8 | 不配置模型、也不选 ycore 时，U1–U7 的阅读全部可用。AI 按钮在被拒绝（409）时显示后端给出的原因，并链接到"设置 → 模型" | 阅读需要模型或 ycore；页面报错 |
| U9 | 断网时：有缓存的内容照常显示并标"过期"和获取时间；没有缓存的标"未收录：获取失败"。其他区块不受影响 | 白屏、无限加载，或用旧数据冒充新数据 |
| U10 | 证据（标题、URL、日期、摘录、报告期）和判断（规则或 AI 推断、条件）分区显示，AI 结果带模型标识和日期 | 推断混入来源区 |

## 2. 现状诊断（源码证据）

### 2.1 已具备，可直接复用

- **editorial 后端已在仓库内**：`backend/app.py` 有 `/api/v1/news/editorial`、`/events/{eid}`、`/stories/{sid}`、`/diagnostics`，由 `Editorial(db)` 提供；ycore 模式下按能力探测，不回退本地。**不需要迁回或代理 58720。**
- **editorial 来源需要显式开启**：`backend/db.py` 只在 `YTRADER_EDITORIAL=1` 时把 `editorial_sources()` 以 `INSERT OR IGNORE` 方式写入新库。
  - 这个开关在建库时生效，所以第一阶段的启动脚本必须设置它。
  - 不要改成默认开启：否则 8000 下次重启时，会向它的库追加来源。
- **产业库**：`backend/industries.py` 的 `Industries.references()` 读取 `backend/data/industries/*.json`，校验后标记 `origin='public_reference'` 并经 `reading_graph`。
  - `GET /api/v1/industries` 列出产业；`GET /api/v1/industries/{id}` 返回 `{base, results, job}`。
  - `base` 包含 `industry / nodes / relations / companies / participations / sources / explanation / structure / structure_origin`。
  - `GET /api/v1/securities/{symbol}/industries` 返回该公司在各产业中的 `roles[{node, role, origin}]`。
  - 空库也能阅读，无需安装。
- **正式产业页**：`ChainPage` 在带 `industry_id` 或不带 legacy 参数时渲染 `IndustriesPage`（`IndustryStructure` / `reading_graph`）。旧 `RoleGraph` 只服务 legacy 参数，**不是主路径**，不改。
- **配置**：`Config` 中 `data_mode` 与 `ai_mode` 相互独立；`Settings.local_analysis_ready` 在未配置时返回 409 并提示"未配置时仅阅读证据"；loopback 本地模型免密钥。
- **公司资料**：`profiles.py` 已有东方财富 F10 简介的身份双重核对、8s 超时、24h TTL、60s 失败退避和最近一次成功的缓存。新的基本面模块照这个模式写。
- **单端口能力**：`create_app` 读取 `YTRADER_DATA_DIR`、`YTRADER_WEB_DIST`、`YTRADER_WEB_ORIGINS`；`web()` 用 SPA 方式提供 `YTRADER_WEB_DIST`。
- **测试注入**：`create_app(data_dir, network=..., start_worker=False)` 可以注入假网络，测试不需要联网。

### 2.2 需要修的问题

| # | 症状 | 位置 | 影响 |
|---|---|---|---|
| D1 | 不设 `YTRADER_DATA_DIR` 时默认使用 `~/.local/share/ytrader` | `app.py` `create_app` | 裸启动可能写入一个共享的默认库。启动脚本必须显式指定，并拒绝已知的生产目录 |
| D2 | 新闻页和其他页使用两套导航（`newsMode` 分叉） | `App.tsx` `Shell` | 违反 U1 |
| D3 | 新闻模式下"产业"在设置了 `VITE_INDUSTRY_PREVIEW_URL` 时渲染为跨端口 `<a>` | `App.tsx` | 违反 U1、U5 |
| D4 | `/events` 渲染 editorial 还是旧 `EventsPage`，取决于构建期开关 `VITE_EDITORIAL` | `App.tsx` | 第一阶段应固定使用 editorial |
| D5 | 来源管理是顶层 `/sources` 路由（`NewsSourcesPage` + `EditorialDiagnostics`）；editorial 模式下"设置"链接也指向 `/sources` | `App.tsx` | 来源应归入设置 |
| D6 | `industryUrl()` 默认 `http://127.0.0.1:58721/`，产业 CTA 用 `<a href>` 离开应用 | `Editorial.tsx` | 违反 U5 |
| D7 | `nodeNames` 只为 gold、crude-oil、ai-compute 硬编码环节名，其他产业一律显示"相关产业环节" | `Editorial.tsx` | 违反 U4 |
| D8 | editorial 空状态链接到 `/sources` | `Editorial.tsx` | 跟随 D5 修改 |
| D9 | 公司页没有任何财务或报告期数据；后端没有对应端点或表 | `Securities.tsx`、`app.py`、`db.py` | 违反 U7，这是第一阶段唯一的新数据能力 |
| D10 | 公司页"相关产业"优先用 `profile.topics` 跳旧版 `/chain?topic_id=`；新产业的 `RelatedIndustries` 只在 `CompanyPage` 外层显示 | `Securities.tsx`、`App.tsx` | 公司 → 产业有两个入口，主入口指向旧页 |
| D11 | `YTRADER_WEB_ORIGINS` 默认包含 58720 和 58721 | `app.py` | 隔离实例应只允许自身来源 |

不作为缺陷：`RoleGraph` 的截断（legacy 专用）；`/jobs` 页（保留兼容）；`EventsPage`（保留给"事件研究（可选 AI）"和公司页的旧新闻链接）。

## 3. 范围

**做：** 隔离启动；统一壳层；来源归入设置；新闻 → 产业的应用内桥接及叠加高亮；公司"所在产业"统一；公司基本面（后端适配器、端点、前端区块）。

**不做：** 重写 editorial 算法或产业图；新增强制安装环节；为验收补做黄金等新产业画布；改公司研究的输入；手机端；部署；付费数据；交易或订阅。

首批产业数量：以 `backend/data/industries/*.json` 实际收录为准，不新增。若 editorial 关联的产业没有画布（例如黄金目前只有静态稿），按 U5 如实标注"未收录"。

## 4. 数据契约

### 4.1 新闻 → 产业（不改后端契约）

沿用 editorial 现有的 `IndustryLink{industry_id, name, variable, mechanism, condition, node_ids, relation, evidence[], mechanism_reference?}`。解析放在前端完成：

1. 打开产业传导视图时，对每个不同的 `industry_id` 请求 `GET /api/v1/industries/{industry_id}`。
2. 请求成功：在 `base.nodes` 中查找 `node_ids`。找到的显示 `node.name`，找不到的单独列为"未在本地画布定位：N 个"，不猜名称。
3. 返回 404："本地未收录该产业画布"。变量、机制、条件和证据照常显示，不显示进入画布的按钮。
4. 结果按 `industry_id` 在组件内缓存，不另建全局状态。

### 4.2 产业叠加层（不扩展后端）

- URL 为 `/chain?industry_id=X&event=E[&progress=P]`。
- `IndustriesPage` 在带 `event` 参数时请求 `GET /api/v1/news/editorial/events/E`，取 `current`（`progress` 匹配时取该进展）中 `industry_id === X` 的关联。
- 高亮节点 = `link.node_ids ∩ base.nodes.id`。
- 叠加面板显示新闻标题、变量、机制、条件和触发片段，以及"返回新闻"（`/events?event=E&progress=P&view=industry&industry=X`）。
- 叠加层可以关闭，关闭后与无新闻时完全一致。结构数据和 `input_version` 不变。
- event 请求失败或没有匹配关联时，提示"该新闻未关联本产业或已不可读"，产业照常阅读。

### 4.3 公司基本面契约

`GET /api/v1/securities/{symbol}/fundamentals` 返回 `envelope(data, source, as_of, completeness, warnings)`：

```text
data = {
  symbol, status: 'ok'|'stale'|'unavailable', source, source_url,
  fetched_at,              // 最近一次成功获取的时间（取各表中最早的一张）
  periods: [{              // 按 period_end 降序；年报来自 type=1，近期报告来自 type=0，按日期去重合并
    period_end: 'YYYY-MM-DD', period_type: 'Q1'|'H1'|'Q3'|'FY',   // 由 REPORT_DATE 的月日推出，为年初至今累计口径
    currency: str|null,
    revenue, net_profit_parent, operating_cash_flow,               // 单位：元
    total_liabilities, total_assets,                               // 单位：元
    revenue_yoy_pct, net_profit_parent_yoy_pct,                    // 百分数（例如 12.3 表示 12.3%）
    gross_margin_pct, debt_to_asset_pct,                           // 百分数
    debt_to_asset_basis: 'source'|'computed'|null
  }],
  composition: null | {
    period_end, basis: 'product'|'region',                         // MAINOP_TYPE 为 2 时取 product，为 3 时取 region
    items: [{ name, revenue, share_ratio, gross_margin_ratio }]    // 两个 ratio 字段为 0..1 小数
  },
  tables: { indicators, balance, cashflow, composition: {status, fetched_at} },  // 各分表的状态与获取时间
  evidence_ids: [...], warnings: [...]
}
```

**规则：**

1. **零值与缺失**：`0` 是真实值；缺失只能是 `null`。`--`、空串、非数值和非有限数一律转成 `null`。前端判断缺失只用 `== null`。
2. **单位分离**：指标接口给的是百分数，统一用 `_pct` 后缀；收入构成接口给的是 0..1 小数，统一用 `_ratio` 后缀。前端只在展示 `_ratio` 时乘以 100，两类字段不能混算。
3. **同比**：使用来源的 `TOTALOPERATEREVETZ` 和 `PARENTNETPROFITTZ`，不在本地重算；来源缺失时保持 `null`。不从累计数推算单季度。
4. **资产负债率**：优先使用来源的 `ZCFZL`（`basis='source'`）。来源缺失时，只在 `total_liabilities` 和 `total_assets` 都是有限数、且 `total_assets > 0` 时计算（`basis='computed'`）。其他情况为 `null`。
5. **期数**：只呈现来源可得的期数，不设最低数量；不足时不补值。
6. **口径**：所有字段都是公司合并口径，不写入任何产业环节或参与关系。
7. **ycore 模式**：调用 `remote.capability('GET', '/securities/{symbol}/fundamentals', required=('symbol','status','periods'))`。不符合契约或不可达时返回 `unavailable` 和原因，**不回退本地**。
8. **前置条件**：证券不在 `securities` 表时返回 404"请先同步证券主表"。

## 5. 实施步骤（可直接派给 Pi）

依赖关系：导航与产业桥接（P1–P4）和公司基本面（P5）可在不重叠文件范围内并行实现，再由Codex统一集成并执行P6。接口核对见 [数据源证据](PHASE1-SOURCES.md)。

### P1 隔离启动脚本

新增 `scripts/run-phase1.sh`，默认端口58730，固定隔离目录 `.local/phase1-20261020/`。路径及端口的具体安全检查可按现有工具实现。

- **构建**：只用以下命令，**不运行 `npm run build`**，因为它会写 `frontend/dist`：

```bash
ABS_ROOT="$(cd "$(dirname "$0")/.." && pwd)/.local/phase1-20261020"
ABS_WEB="$ABS_ROOT/web-dist"
(cd frontend && npm exec -- vite build --outDir "$ABS_WEB" --emptyOutDir)
```

- `outDir` 必须是绝对路径。Vite 构建到项目根目录之外时需要 `--emptyOutDir`。
- 写法 `npm exec -- vite build …` 与 Codex 提出的 `npm exec vite build -- --outDir …` 目的相同。推荐前一种，因为它能确保 `--outDir` 不被 npm 当作自身参数。
- **类型检查**单独执行：`(cd frontend && npm exec -- tsc --noEmit -p <应用 tsconfig>)`。如果项目使用 project references，就选应用层的 tsconfig，具体由 Pi 按现有配置确定。
- **启动**（在仓库根目录执行，所有路径都用绝对路径）：

```bash
YTRADER_DATA_DIR="$ABS_ROOT/data" YTRADER_WEB_DIST="$ABS_WEB" YTRADER_EDITORIAL=1 \
YTRADER_WEB_ORIGINS="http://127.0.0.1:$PORT" \
python -m uvicorn backend.app:app --host 127.0.0.1 --port "$PORT"
```

- **注意事项**：
  - 必须显式设置 `YTRADER_DATA_DIR`。规范化路径后，如果它等于或位于 `.local/runtime-v1`、`~/.local/share/ytrader`、`ytrader-editorial-radar` 或 `ytrader-news-radar` 下，直接拒绝启动。
  - `YTRADER_EDITORIAL=1` 只对这个新库生效，不改成全局默认值，也就不会影响 8000 下次重启。
  - 端口为 8000/58700/58720/58721 时拒绝启动；端口已被占用时退出，不 kill 任何进程。
- **DoD**：
  - `/api/v1/health` 返回 ok，`/` 能打开页面。
  - 受保护端口的 PID 与启动前一致。
  - `frontend/dist` 和 `.local/runtime-v1` 的修改时间不变。

### P2 统一壳层与设置归位（`App.tsx`、`Settings.tsx`、`Editorial.tsx` 链接）

- `Shell`：
  - 删除 `newsMode` 分叉和 `industryPreview`，所有路由使用同一顶部导航（新闻 / 产业 / 公司 / 设置）。新闻页可以保留宽版阅读布局的 CSS 类，但导航组件相同。
  - `/events` 固定渲染 `EditorialPage`，删除 `VITE_EDITORIAL` 判断。
  - `/events/:id` 保留旧 `EventsPage`。
  - `/sources` 改为 `<Navigate to="/settings#sources" replace />`。
  - `/jobs` 保留。
- `Settings.tsx` 新增 `#sources` 区：嵌入 `NewsSourcesPage`，下方折叠嵌入 `EditorialDiagnostics`。若 `NewsSourcesPage` 的页面级标题或布局与设置页冲突，只做最小的 props 或样式调整。
- `Editorial.tsx` 中所有 `/sources` 链接改为 `/settings#sources`；"打开旧版完整详情与研究"改名为"事件研究（可选 AI）→"，链接不变。
- **DoD**：
  - `grep -rn "5872\|5870\|VITE_INDUSTRY_PREVIEW_URL\|VITE_EDITORIAL" frontend/src` 结果为 0。
  - 构建产物中检索 `5872` 结果为 0。
  - 新闻首页和产业页都没有来源管理或统计内容。
  - 访问 `/sources` 时跳转到设置的来源区。
  - 隔离目录构建与类型检查通过，不覆盖 `frontend/dist`。

### P3 新闻 → 产业桥接（`Editorial.tsx`）

- 删除 `industryUrl` 和 `nodeNames`。
- 产业传导视图按P4恢复的实际原稿数据解析环节名和画布是否存在。
- CTA进入同源原产业全景，携带产业、新闻事件、选中进展和原新闻返回路径，**只在实际画布存在时显示**。`/chain`保留兼容入口。
- 列表项中的产业按钮保留，即使画布缺失也照常显示。
- **DoD**：
  - 没有产业关联的新闻：首页正常显示，传导区显示"此条新闻没有足够依据映射到具体产业"。
  - 关联产业有画布时：环节名来自原稿实际数据的 `nodes`，点击后进入应用内原产业全景。
  - 关联产业没有画布时：关联解释完整，显示"本地未收录该产业画布"，没有跳转按钮，没有报错。

### P4 产业视图恢复（用户反馈后修正）

- 原方案误将较早React组件当成用户已认可产业全景。用户明确要求恢复，故本节取代原P4；§4.1/§4.2和P3中依据较早backend三产业判断画布存在的实现选择也不再适用。
- 恢复基线为`/Users/Admin/Documents/Codex/2026-10-20/ytrader-editorial-radar/industry-site`。原样保留布局、图层、环节详情、公司对照、个股展开和有日期/来源的快照数据。
- 将原稿复制到项目`frontend/public/industry`，只适配同源入口、新闻API、指定进展与返回路径。`/chain`进入该原稿，新闻画布可用性按实际原稿五产业核对。
- 原稿已收录原油、黄金、创新药、AI算力、电网设备，不得再把黄金/电网描述为未收录。其他未收录产业继续保留解释并说明缺口。
- **DoD**：
  - 原稿样式和数据字节不变；实际浏览核对原图、图层和详情/公司交互。
  - 新闻进入原油/黄金，保留对应进展；返回原新闻。新闻失效时产业仍可用。
  - 原58700/58721及其他服务保持不变；不把快照标为实时数据。

### P5 公司基本面与所在产业统一

**数据源**：都在 `https://emweb.eastmoney.com/PC_HSF10/` 下。完整路径和参数以 Codex 留给 Pi 的实际响应快照为准，下表只列名称和字段映射。

| 分表 | 接口 | 取用字段 → 契约字段 |
|---|---|---|
| indicators | `ZYZBAjaxNew?type=0&code=SH600276`（近期累计报告），`type=1`（历史年报） | `REPORT_DATE`→`period_end`；`CURRENCY`→`currency`；`TOTALOPERATEREVE`→`revenue`；`PARENTNETPROFIT`→`net_profit_parent`；`TOTALOPERATEREVETZ`→`revenue_yoy_pct`；`PARENTNETPROFITTZ`→`net_profit_parent_yoy_pct`；`XSMLL`→`gross_margin_pct`；`ZCFZL`→`debt_to_asset_pct` |
| balance | `zcfzbAjaxNew`（`companyType=4`，按日期列表请求多期） | `TOTAL_LIABILITIES`、`TOTAL_ASSETS` |
| cashflow | `xjllbAjaxNew`（`companyType=4`，按日期列表请求多期） | `NETCASH_OPERATE`→`operating_cash_flow` |
| composition | `BusinessAnalysis/PageAjax` 中的 `zygcfx` | 取最新报告期；`MAINOP_TYPE` 为 2 时 basis 为 product、为 3 时为 region（product 优先，没有再用 region）；`MAIN_BUSINESS_INCOME`→`revenue`（元）；`MBI_RATIO`→`share_ratio`；`GROSS_RPOFIT_RATIO`（上游字段名原样拼写）→`gross_margin_ratio` |

**校验与合并：**

- **身份**：每一行都要满足 `SECURITY_CODE == code` 且 `SECUCODE.upper() == code + '.' + exchange`。任何一行不符，整张分表本次作废，**不写缓存、不覆盖旧值**，并记 warning"身份不一致，已拒收"。
- **企业类型**：`companyType=4` 只在通用类企业上验证过。若 `ORG_TYPE` 显示为金融类，balance 和 cashflow 分表不请求或不采用，对应字段为 `null`，并记 warning"金融类报表口径未接入"；indicators 照常使用。
- **合并**：以 `(symbol, REPORT_DATE)` 为键合并。指标、资产负债表和现金流量表各自只填自己的字段；日期对不上的期不补值。

**部分失败与缓存：**

- 新表 `company_fundamentals(symbol TEXT PRIMARY KEY, data TEXT NOT NULL)`，追加到 `db.py` 的 `SCHEMA`，只增不改。`data` 中按分表分别保存最近一次成功的原始映射结果及其获取时间。
- 每次刷新时逐表请求：每个请求超时 8s，顺序执行，每家公司 24h TTL；失败后 60s 内不重试，并参照 profile 的退避方式写入 `fundamentals-retry:{symbol}`。
- 某张分表失败时，沿用这张表的上一份成功结果，`tables.X.status` 标 `stale`，并记 warning；其他表正常更新。
- 整体状态：所有表都是新鲜的为 `ok`；任何一张表来自缓存或缺失为 `stale`；没有任何一张表有数据为 `unavailable`。
- 只缓存经本地映射的字段和本地生成的时间戳，不缓存上游原文。
- **证据**：证据 ID 为 `'company-fundamentals:' + identity(symbol, dump(periods, composition))`，写入 `evidence` 表。摘录写明来源、报告期范围、各分表状态，并注明"公开数据源表述，未经独立核验，不代表授权再分发"。

**后端改动**：新增 `backend/fundamentals.py`（结构仿照 `Profiles`）；在 `create_app` 中实例化并添加路由，路由先执行 `valid_symbol`；completeness 的映射方式与 profile 端点一致。

**前端改动（按用户最新指令修正）**：
- 将现有真实接口接入原产业全景的公司侧栏及展开的“总览／财务／业务／新闻与公告”四Tab。沿用原模块、类名、图层、详情和布局，不跳到另一套React公司界面。
- 只在选中/打开公司时按证券代码加载，校验主体、日期、币种和有限数值；切换公司后旧请求不得覆盖当前公司。保留原新闻、进展、环节、图层及返回路径。
- 核心指标/财务分组显示实际最新报告期及年初累计/期末口径；金额换算为亿原币，百分数与小数占比分别处理，零值和负值保留，空缺不补零。
- 原三年趋势模块取最近三个同币种FY，缺失按实际展示。业务构成单独说明自身报告期、币种和分类；不套用固定2025分母或税口径。
- 来源、获取时间、分表状态与warnings进入原有来源/口径模块；旧年度经营观察不可当成当前报告解释。接口无数据或ycore失败不得用固定财务快照假装成功。
- 原后端适配与较早React基本面实现保留；本轮以原全景内的真实数据流程作为交付，不借此迁移整个界面。

**必要检查**（用 fixture 和假网络，`create_app(tmp, network=Fake, start_worker=False)`），只覆盖财务数据保护：
1. 身份不一致的分表被拒收，旧缓存不被覆盖。
2. 一张分表失败时，其他表的数据保留，并产生 warning。
3. `0` 原样保留，不变成 `null`。
4. `_pct` 和 `_ratio` 字段各自保持原单位。
5. 资产负债率在 `total_assets <= 0` 或字段非有限时为 `null`。
6. ycore 契约不符时不回退本地。

**DoD**：
- 上述 6 项检查通过。
- 在隔离实例中打开 SH600276，能看到真实数据，且每个值都有报告期和来源；报告中写明实际得到的期数和缺失字段（不设期数门槛）。
- 断网后刷新，显示缓存并标"过期"；从未获取过的公司断网打开时显示"未收录：获取失败"，其他区块正常。

### P6 降级与 AI 路径核对，以及文档

- 不改契约，只核对：新闻、事件研究、公司研究、产业 AI 补充的按钮在 409 时显示后端消息并链接到 `/settings#model`；`data_mode=ycore` 且 ycore 不可用时，各区块显示"ycore 不可用，未回退本地"。
- 在 `docs/STARTUP.md` 增加"第一阶段本地运行"一段，指向 `scripts/run-phase1.sh` 和本文 §6。
- **DoD**：在"无模型、无 ycore、空库"的状态下，Codex 按 §1 逐条验收通过；然后同步证券、采集新闻，再走一遍完整路径。

## 6. 本地运行、隔离与降级

| 项目 | 规则 |
|---|---|
| 受保护 | 8000、58700、58720、58721：不监听、不停止、不重启、不作为成品入口；不读写 `.local/runtime-v1`、58720/58710 的库、任何现有 `keys.json`、`frontend/dist` |
| 端口 | 58730 单端口（API 与页面）；被占用时退出 |
| 数据 | `.local/phase1-20261020/data`，必须显式设置 `YTRADER_DATA_DIR` |
| 来源 | 只在隔离库中通过 `YTRADER_EDITORIAL=1` 写入 editorial 来源 |
| 默认设置 | `data_mode=local`、`ai_mode=local`，不配置模型，即仅阅读 |
| 后台采集 | worker 按 `sync_interval_minutes`（默认 30）联网采集；验证"空库"时可在设置中把间隔设为 0 |

| 场景 | 新闻 | 产业 | 公司 |
|---|---|---|---|
| 空库 | "还没有收录新闻 → 设置·新闻来源" | 内置公共参考可读；没有参考时显示"尚未收录产业" | "证券主表尚无数据 → 同步证券" |
| 无模型 | 规则推荐与传导照常；AI 按钮显示 409 原因 | 照常；AI 补充显示 409 原因 | 资料与基本面照常；研究按钮显示 409 原因 |
| 断网，有缓存 | 显示已收录内容和最后检查时间；`sources_unavailable` 有提示 | 不受影响 | 资料和基本面标"过期"及获取时间 |
| 断网，无缓存 | 空状态"公开来源暂不可用" | 不受影响 | 介绍和基本面标"未收录：获取失败"，其他区块照常 |
| ycore 不可用 | 不回退本地，显示原因 | 内置产业照常（产业库独立于数据服务） | 不回退本地，显示原因 |
| 画布缺失 | 关联保留，标"本地未收录该产业画布" | — | 所在产业只列有画布的产业 |

## 7. 后置事项

- 推荐算法调参、跨语种合并、持续议题去噪、翻译。
- 原稿五产业之外的新产业画布制作与核验。
- 单季度拆分、重述数据的版本保留、估值、分部（环节级）财务、深度行情。
- 公司研究改用 editorial 新闻作输入；公司独立策略。
- 删除旧 `EventsPage`、`LegacyChainPage` 和旧主题。
- 手机端、部署、托管、订阅、交易、iFinD 及任何付费数据源。

## 8. 核实边界与审查记录

财务API、字段和单位见 [PHASE1-SOURCES](PHASE1-SOURCES.md)。此前Codex未把仓库较早组件与用户认可的静态全景区分清楚，导致错误替换视图；现按P4恢复原稿，事件落点只与实际显示图匹配。

仍未证实：公开源全市场稳定性、金融类特殊报表、再分发许可、长期算法质量。发布和采购不在本阶段范围。未知产业和环节如实显示；验证使用当前空闲新端口。既有公司研究与旧新闻详情保留兼容，不新增独立策略能力。

| Grok条件 | 本文处理 |
| --- | --- |
| B1 本地导航与默认Editorial | P1、P2，全部站内导航 |
| B2 无画布仍保留关联 | §4.1、P3，标未收录而不删关联 |
| B3 产业契约不重写 | §4.2、P4，前端叠加、不改变结构或指纹 |
| B4 空库可读公共产业参考 | U2、P4，不强制安装旧主题包 |
| B5 财务口径与缺失 | §4.3、P5，null/0、百分数/比例、日期与身份逐表核对 |
| B6 运行隔离 | P1、§6，不占原端口、不写原产物或数据库 |

文档证据：Claude job `5b9af960190b477e8fb37fcbac497e29` 第三轮PASS，零工具错误；前两轮限制保留在任务记录中。Grok session `0c748ad1-adde-418d-b55f-977cb1bfb952` 已完成只读审查，运行返回模型为grok-4.6-build；第一次调用未完成不算审查。Codex按实际源码关闭文档前提缺口，并保留各项实现检查。

结果分别报告：本地可运行、实际真实数据样本、用户体验待确认。只做基本启动、完整路径和必要财务数据保护检查；不做全面回归或像素级验收。
