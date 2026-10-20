# 第一阶段审查记录

2026-10-20。Codex已采纳Grok六项条件，具体落点见PHASE1-DEVELOPMENT第8节。以下保留原审查结论；其中“首稿”指Claude第一版，不是已整合开发文档。

继续同一审核。我只读这三份授权快照，对照源码与计划给出完整结论。首稿已读完。接下来从 Codex 反馈和源码快照里核对契约、端点与导航实现。核对产业页契约、空库行为与基本面口径，确认是否还有 Codex 未覆盖的交付风险。**有条件通过。** 首稿不能按原文派工；Codex 的 8 条修订方向正确，按那些方向改完后可以执行。还剩几条会影响本阶段交付和数据正确性，修订稿必须写死。

首稿把未读到的 `app.py` / 产业主路径当成未知，因而规划了迁回 58720、重写产业契约、强制安装包、验收黄金。源码已经否定这些前提。

---

## 对 Codex 修订方向的判断

全部采纳。

1. Editorial 已在仓库：`backend/app.py` 引入 `Editorial`，并实现 `/news/editorial`、`/events/{id}`、`/stories/{id}`、`/diagnostics`。不要迁回或代理 58720。
2. 主导航产业页是 `IndustriesPage` → `IndustryStructure`；`RoleGraph` 的 3 层 / 16 家截断只在 `LegacyChainPage`。不要据此重画已认可产业图。
3. `GET /industries/{id}` 已是 `{base, results, job}`，图内是 `companies` + `participations`。不要改成草案 B 的扁平 `participants/verified/overlay`。
4. `backend/data/industries` 随软件读取，不等于向空库注入演示新闻或财务。
5. 缺画布时保留传导文字并标未收录；不要删 `industry_links`，也不为验收补黄金包。
6. `/jobs` 可留；来源进设置即可。
7. 基本面要有增长 / 盈利 / 现金流 / 负债 / 收入构成 / 带报告期趋势；8 期 5 年是建议；零值不是缺失。
8. 不要再做 Step 0 泛扫描。财务接口字段由 Codex 在实现时核对。

---

## 阻断问题

修订稿未写入下列关闭条件前，不要派产业契约改动、新闻关联过滤、或“空库必须先安装产业”。隔离启动和壳层可以先做。

### B1. 跨端口仍是成品路径

**证据：** `frontend/src/App.tsx` `Shell`：`VITE_INDUSTRY_PREVIEW_URL` 把“产业”做成外链；`VITE_EDITORIAL === '1'` 才渲染 `EditorialPage`，否则是带搜索的 `EventsPage`；editorial 下“设置”去 `/sources`。`Editorial.tsx` `industryUrl()` 默认 `http://127.0.0.1:58721/`。newsMode 导航没有“公司”。

**最小修正：** 去掉这两个 Vite 开关。四项导航固定为新闻 / 产业 / 公司 / 设置，全部 `NavLink`。`/events` 固定 `EditorialPage`。产业 CTA 改为应用内链接。检索产物中不得再出现 `58720` / `58721` 作为用户跳转。

**关闭：** 隔离端口上四页同壳；从新闻进产业不离开本应用。

### B2. 草案 A 会删掉有依据的产业关联

**证据：** 首稿契约 A：“无对应产业时整条不输出”；未知 `node_ids` 后端丢弃。这与 PRODUCT（重大新闻可无画布、关联要保留证据和条件）冲突。

**最小修正：** `industry_links` 照常输出。画布缺失或节点不在当前 `graph.nodes` 时，传导文字仍显示，落点写“本地未收录该产业/环节”，不进图。首页仍展示无关联新闻。

**关闭：** 无画布的关联新闻仍在首页和右栏；代码路径不再按画布过滤关联。

### B3. 草案 B 会拆掉现有产业详情

**证据：** `app.py` `industry_detail` → `industries.detail`；CONTRACTS 为 `{base, results, job}`。`IndustryStructure` / `IndustryExplorer` 使用 `graph.companies`、`graph.participations`、`structure`。`reading_graph` 只深拷贝、不改指纹。

**最小修正：** 不新增 `/industries/{id}?event_id=` overlay，不改成 `participants`。叠加：前端读 editorial 详情，用当前图校验 `node_ids`，写入已有 `industry_node`（及可选高亮），提供返回 `/events?event=…&progress=…&view=industry`。链接必须带 `industry_id`，禁用单独的 `event_id`（会走进 `LegacyChainPage`）。

**关闭：** 独立打开产业仍走现有详情；带新闻进入时高亮已有节点并能返回原新闻。

### B4. 空库产业空态写错了

**证据：** CONTRACTS：公共参考从 `backend/data/industries` 读取，不写入证券/新闻表。PRODUCT：空库不注入演示事实。首稿 U2/步骤 4/降级表要求“尚未安装产业 → 设置安装”，把旧 `/chain/packages` 门槛套到新产业库。

**最小修正：** 空 SQLite 仍列出公共参考，可直接阅读。安装/导入只针对旧主题包，不是产业页前置。不把 bundled JSON 当演示新闻或财务。

**关闭：** 新数据目录、未装 chain package 时，产业目录仍能打开至少一个公共参考图。

### B5. 基本面契约会把 0 当缺失、把不同口径排成趋势

**证据：** PRODUCT 要求增长、盈利、现金流、负债、收入构成、有报告期趋势，禁止模拟值。首稿契约 C 用可选字段 + “至少 8 期 5 年”，未区分 `null` 与 `0`，未限制同比口径。

**最小修正：** 新增 `GET /securities/{symbol}/fundamentals`，缓存模式照 `profiles.py`（身份核对、8s、24h TTL、60s 退避、last-good、`ok|stale|unavailable`）。字段最小集：

- `periods[]`：`report_period`、`report_type`（`annual|q1|half|q3`）、`currency`、`unit`；`revenue`、`net_profit_parent`、`operating_cash_flow`、`total_liabilities`；有则给 `debt_to_asset` / `gross_margin` / 来源同比。
- 缺测 = `null`（UI“未收录”）；真实 0 = `0`。
- 同比只比较相同 `report_type`；禁止 TTM 冒充报告期；禁止跨口径连成一条增长。
- `composition` 必须带 `report_period` 与 `basis`。
- 期数按来源能给的展示，不硬性 8/5。
- 公司总数不得写入环节/`participations`。
- `data_mode=ycore` 不回退本地。

**关闭：** 一家已同步 A 股能看到带报告期的表或明确未收录；断网有缓存标过期；检索无默认财务数字。

### B6. 启动隔离参数必须写进脚本，不能再“步骤 0 再查”

**证据：** `YTRADER_DATA_DIR` 默认 `~/.local/share/ytrader`；`YTRADER_WEB_DIST` 默认 `frontend/dist`；CORS 默认含 58720/58721。

**最小修正：** 启动脚本设置隔离目录 `.local/phase1/`，拒绝 `runtime-v1` 和 58720/58710 路径；不写 `frontend/dist`；不复制 `keys.json`；端口避开 8000/58700/58720/58721，占用则退出不 kill；把新 origin 加入 `YTRADER_WEB_ORIGINS`。单端口优先：`YTRADER_WEB_DIST=.local/phase1/web-dist`。

**关闭：** 启动后受保护端口 PID 不变；`frontend/dist` 与 `.local/runtime-v1` 未改。

---

## 可后置

- 推荐算法、跨语种合并、翻译、手机、交易、订阅、部署、iFinD、采购。
- 公司研究改接 editorial 表；`/events/:id` 旧页和 `LegacyChainPage` 删除。
- 把 PackageCatalog 搬进设置（设置已链到 `/chain#packages`）。
- 强制 `/jobs` 重定向。
- `node_labels` 后端字段；前端用 `graph.nodes` 名称，未知则显示 id + 未收录。
- 黄金画布入库；RoleGraph 重写。
- `profiles.as_of`、公司新闻切到 editorial、环节级财务。

---

## 可以先执行

**立即（不依赖修订段落）：** 隔离启动脚本（B6）；统一 `Shell` 与默认 Editorial（B1）；`Editorial.tsx` 去掉 `industryUrl` / `nodeNames` / 旧详情外链，空态改 `/settings#sources`；诊断放到设置折叠区，保留 `/jobs`。

**修订稿写明 B2–B5 后：** 新闻内链到 `/chain?industry_id=&event=&progress=`；产业页只加叠加层和返回新闻；公司页加基本面，并把 `topic_id` 旧链收到 `/chain?industry_id=`。

派工顺序：`1 → 2 → {3,4} → 5 → 6核对 409 → 7`。不要派：迁回 58720、新产业扁平 API、RoleGraph 重做、空库强制安装、验收用黄金包。

```json
{
  "model_identity": "Grok 4.6 (xAI); document review only, not runtime/CI metadata",
  "verdict": "有条件通过",
  "blocking_findings": [
    {
      "id": "B1",
      "issue": "新闻壳层仍跨端口，且默认不是 editorial",
      "evidence": ["frontend/src/App.tsx Shell newsMode/industryPreview/editorialMode", "frontend/src/Editorial.tsx industryUrl() default 127.0.0.1:58721"],
      "minimal_fix": "删除 VITE_EDITORIAL 与 VITE_INDUSTRY_PREVIEW_URL 分支；四项同导航；EditorialPage 为 /events；产业 CTA 改为应用内 Link",
      "close_when": "隔离端口上新闻→产业不离开本应用，导航含公司且无 58720/58721 href"
    },
    {
      "id": "B2",
      "issue": "无本地画布时删除 industry_links",
      "evidence": ["claude-candidate.md §4.1 A", "docs/PRODUCT.md 全球新闻不必硬绑产业"],
      "minimal_fix": "保留关联与证据；画布/节点缺失时标未收录，不删条目、不藏新闻",
      "close_when": "无画布关联新闻仍出现在首页和传导区"
    },
    {
      "id": "B3",
      "issue": "用扁平 overlay 契约替换现有产业详情",
      "evidence": ["backend/app.py GET /industries/{industry_id}", "docs/CONTRACTS.md {base,results,job}", "frontend/src/IndustryStructure.tsx companies/participations"],
      "minimal_fix": "不改详情 JSON；前端用 editorial + 现有 graph 节点做叠加；链接带 industry_id 而非单独 event_id",
      "close_when": "独立阅读与新闻进入都走 IndustriesPage/IndustryStructure"
    },
    {
      "id": "B4",
      "issue": "把公共产业参考当成必须安装的演示包",
      "evidence": ["docs/CONTRACTS.md backend/data/industries 随软件读取", "claude-candidate.md U2/§6 尚未安装产业"],
      "minimal_fix": "空库可读公共参考；安装只针对旧 chain packages",
      "close_when": "新数据目录未装主题包也能打开至少一个产业图"
    },
    {
      "id": "B5",
      "issue": "基本面契约未区分零值与缺失，未限制同比口径",
      "evidence": ["docs/PRODUCT.md 增长/盈利/现金流/负债/收入构成/报告期", "frontend/src/Securities.tsx 无财务区块", "backend/profiles.py 缓存模板"],
      "minimal_fix": "最小 fundamentals 端点；null≠0；同比仅同 report_type；禁止 TTM 冒充；期数按来源",
      "close_when": "一家 A 股有报告期表或明确未收录；断网标过期；无模拟值"
    },
    {
      "id": "B6",
      "issue": "隔离运行未钉死数据目录、产物目录和 CORS",
      "evidence": ["backend/app.py YTRADER_DATA_DIR / YTRADER_WEB_DIST / YTRADER_WEB_ORIGINS"],
      "minimal_fix": "phase1 脚本设置隔离目录与 origin；拒绝 runtime-v1；不写 frontend/dist；不 kill 受保护端口",
      "close_when": "8000/58700/58720/58721 PID 与 frontend/dist、runtime-v1 未变"
    }
  ],
  "deferred": [
    "算法调参、翻译、手机、交易、订阅、部署、iFinD、采购",
    "公司研究改接 editorial；删除 EventsPage/LegacyChainPage",
    "PackageCatalog 搬迁、/jobs 重定向、后端 node_labels",
    "黄金入库、RoleGraph 重写、环节级财务"
  ],
  "codex_revision_endorsement": "accept_all_eight",
  "can_execute_now": ["isolation script (B6)", "unified shell + default Editorial (B1)", "Editorial in-app industry CTA without dropping links"],
  "execute_after_spec_patch": ["industry overlay on existing graph (B2/B3/B4)", "fundamentals adapter (B5)"],
  "evidence": [
    "backend/app.py editorial and industries routes",
    "frontend/src/Chain.tsx IndustriesPage vs LegacyChainPage/RoleGraph",
    "frontend/src/IndustryStructure.tsx",
    "frontend/src/Editorial.tsx nodeNames/industryUrl",
    "frontend/src/Securities.tsx CompanyResearch",
    "backend/profiles.py TTL/identity cache",
    "backend/config.py 409 read-only AI",
    "docs/PRODUCT.md",
    "docs/CONTRACTS.md industry library"
  ]
}
```