# 动态产业链传导与可插拔个股策略系统设计方案

状态：经总调度（Antigravity）结合《A股选股与个股分析策略系统研究报告》全文及现有 `ycore`/`ytrader` 代码库审核修订后的正式工程设计基线。

## 0. 核心定位与全局硬约束

1. **核心用户主路径**：
   - **新闻事件** → **动态关联并生成/补全对应产业链**（展示上中下游结构、各环节运行逻辑与利润分配、关键壁垒、事件在链条上的传导路径） → **落点到具体 A 股公司** → **独立、可插拔的个股分析算法策略工作台**（依托扎实的数据源指标底座）。
2. **反对黑箱总分与荐股措辞（报告第 20 页 & PRODUCT §1）**：
   - 严禁输出“综合分 83，所以应该买”或任何“建议买入/卖出/持有/目标价”。
   - 界面按各独立策略模块输出**分层定性/定量档位**（如：`价值：便宜 / 中性 / 昂贵`、`质量：强 / 中 / 弱`、`现金与财务风险：正常 / 需关注 / 高风险`、`市场防御：低波 / 中性 / 高波`、`股东回报：稳健 / 中性 / 存疑或稀释`）、具体指标证据、成立条件、**主要反证（导致评分失真的具体因素）**及**数据缺项**。
3. **四层时点防未来函数（报告第 17 页）**：
   - 所有财务与事件指标必须显式区分四层时间字段：`report_period`（报告期）→ `announcement_datetime`（公告实际发布时点）→ `usable_trade_date`（可执行交易日，盘后公告下一交易日生效）→ `restatement_datetime`（财务重述生效时点）。缺失时点必须标注 `unknown`，严禁用当前名单或事后修订值回填历史。
4. **避免同质因子重复叠加（报告第 15 页）**：
   - 不把 GP/A、F-Score、QMJ、应计质量当作四个独立 alpha 简单相加，而是拆分为“盈利能力”“财务改善”“现金含量”“安全性”子维度；
   - 把高股息、回购注销、净股份发行统一纳入“股东回报（分红+注销回购−融资稀释）”视角；
   - 最强互补组合为：**估值（E/P）+ 企业质量（F-Score/GP/A/QMJ）+ 现金真实性与财务红旗（Sloan应计+A股红旗）+ 市场风险（低波/低Beta）+ 股东回报（红利与净发行）+ 产业链信息扩散（客户-供应商传导）**。

---

## 第一部分：个股分析数据指标全景与数据源建设

### 1.1 四层时点与指标元数据结构

```ts
export interface PointInTime {
  report_period: string | null;          // 报告期，如 "2026Q3"、"2026-06-30"；行情类为 null
  announcement_datetime: string | null;  // 首次公告实际发布日/时间；未知为 null
  usable_trade_date: string | null;      // 信号可用交易日（盘后披露顺延下一交易日）
  restatement_datetime: string | null;   // 若发生财务重述/更正，记录重述公告时点
  observed_at: string;                   // 采集入库时间（绝不冒充发布或报告期）
}

export type IndicatorState = 'ok' | 'stale' | 'unknown' | 'not_applicable' | 'insufficient';

export interface CompanyIndicator {
  key: string;                           // 标准指标键名，见 1.2
  label: string;                         // 中文名称
  category: 'valuation' | 'quality' | 'cash_risk' | 'shareholder' | 'market_risk' | 'chain_segment';
  value: number | string | boolean | null;
  unit: string | null;                   // "%", "元", "亿元", "倍", "天" 等
  state: IndicatorState;
  pit: PointInTime;
  formula?: string;
  peer_percentile?: number | null;       // 同行业分位 (0~1)
  evidence: Evidence[];                  // 关联不可变来源证据
}
```

### 1.2 核心数据指标字典（支撑报告首批推荐引擎及后续扩展）

| 指标模块 | 标准字段 Key | 中文名称与计算定义 | 报告依据与用途 | 数据源优先级 |
| --- | --- | --- | --- | --- |
| **A. 估值与壳修正** (`valuation`) | `total_mv` | 总市值（当日收盘价 × 总股本） | E/P 分母、市值分位过滤 | iFinD / 东财行情 |
| | `ep_ttm` | 盈利收益率 `E/P = 归母净利润(TTM) / 总市值` | Liu-Stambaugh-Yuan (2019) 中国价值因子核心 | 派生 (`net_profit_parent_ttm / total_mv`) |
| | `ep_deduct_ttm` | 扣非盈利收益率 `扣非归母净利润(TTM) / 总市值` | 剔除资产处置、补贴等一次性利润造成的虚假低 PE | iFinD / 东财 F10 |
| | `bp_mrq` | 账面市值比 `B/P = 归母净资产 / 总市值` (即 `1/PB`) | 价值辅助确认、周期底部参考 | iFinD / 东财行情 |
| | `is_st_risk` | 是否处于 ST / \*ST / 退市风险警示状态 | A 股硬过滤（按当日已知状态） | iFinD / 交易状态 |
| | `shell_size_flag` | 是否落入全市场最小市值 30% 区间（壳价值污染区） | 中国规模因子必做壳价值修正（排除最小 30%） | 派生 |
| **B. 盈利质量与 F-Score** (`quality`) | `roe_ttm` / `roa_ttm` | 净资产收益率 ROE / 总资产报酬率 ROA | 盈利能力核心 | iFinD / 东财 F10 |
| | `gross_margin` | 销售毛利率 `(营业收入 - 营业成本) / 营业收入` | 毛利水平与趋势 | iFinD / 东财 F10 |
| | `gpa` | 毛利资产比 `Gross Profit / Total Assets` | Novy-Marx (2013) 质量核心变量 | 派生 / 东财 F10 |
| | `rev_yoy` | 营业收入同比增长率 (%) | 成长与景气确认 | iFinD (`营业收入(同比增长率)`) / 东财 F10 |
| | `np_parent_yoy` | 归母净利润同比增长率 (%) | 盈利趋势与 SUE 辅助 | iFinD (`归属母公司股东的净利润(同比增长率)`) |
| | `fscore_roa_pos` | F1: 当期 `ROA > 0` | Piotroski F-Score (盈利性) | 派生 |
| | `fscore_cfo_pos` | F2: 当期经营现金流净额 `CFO > 0` | Piotroski F-Score (盈利性) | iFinD / 东财 F10 |
| | `fscore_delta_roa` | F3: `ROA` 同比改善 (`ΔROA > 0`) | Piotroski F-Score (盈利性) | 派生（当期 vs 上年同期） |
| | `fscore_cfo_gt_np` | F4: `CFO > 归母净利润`（应计为负） | Piotroski F-Score (现金含量) | 派生 |
| | `fscore_delta_lever` | F5: 资产负债率或有息负债率同比下降 | Piotroski F-Score (杠杆改善) | iFinD / 东财 F10 |
| | `fscore_delta_curr` | F6: 流动比率同比改善 (`ΔCurrentRatio > 0`) | Piotroski F-Score (流动性改善) | iFinD / 东财 F10 |
| | `fscore_no_eq_iss` | F7: 无新增股权融资稀释（剔除送转股后总股本未增） | Piotroski F-Score (防稀释) | iFinD / 股本结构 |
| | `fscore_delta_gm` | F8: 销售毛利率同比提升 (`ΔGrossMargin > 0`) | Piotroski F-Score (效率改善) | 派生 |
| | `fscore_delta_turn` | F9: 总资产周转率同比提升 (`ΔAssetTurnover > 0`) | Piotroski F-Score (周转改善) | iFinD / 东财 F10 |
| **C. 应计与财务红旗** (`cash_risk`) | `sloan_accrual` | Sloan 应计比率 `(净利润 - CFO) / 平均总资产` | Sloan (1996) 识别纸面富贵 | 派生 |
| | `cfo_to_np` | 净现比 `经营活动现金流净额 / 归母净利润` | 现金转化真实性 | iFinD / 东财 F10 |
| | `ar_vs_rev_gap` | 应收账款同比增速 − 营业收入同比增速 (pp) | Beneish / A股红旗：激进确认收入 | iFinD / 东财 F10 |
| | `inv_vs_cost_gap` | 存货同比增速 − 营业成本同比增速 (pp) | A股红旗：存货积压或虚增 | iFinD / 东财 F10 |
| | `debt_ratio` | 资产负债率 (%) | 财务安全性 | iFinD / 东财 F10 |
| | `goodwill_to_eq` | 商誉占归母净资产比例 (%) | A股并购后商誉减值暴雷红旗 | iFinD / 东财 F10 |
| | `audit_opinion_flag` | 审计意见是否非标（保留/无法表示/带强调事项） | Dechow / A股核心造假排雷 | 公告 / iFinD |
| | `pledge_ratio` | 第一大股东/实控人质押比例 (%) | A股特有治理与强平风险红旗 | iFinD / 东财 F10 |
| **D. 股东回报** (`shareholder`) | `dividend_yield_ttm` | 股息率 TTM (%) | 上证红利/中证红利核心指标 | iFinD / 东财行情 |
| | `dividend_streak_3y` | 过去三年是否连续现金分红 | 上交所 2022 上证红利修订规则 | iFinD / 分红历史 |
| | `payout_ratio` | 股利支付率 `现金分红总额 / 归母净利润` (%) | 验证分红可持续性 | iFinD / 分红历史 |
| | `shareholder_yield` | 综合股东收益率 `(现金分红 + 注销回购 - 股权融资) / 总市值` | Pontiff-Woodgate 净发行修正 | 派生 |
| **E. 市场风险与动量** (`market_risk`) | `vol_252d` | 252 交易日年化波动率 (%) | Frazzini-Pedersen 低波防御 | 行情计算 / iFinD |
| | `beta_252d` | 252 交易日 Beta 系数（相对沪深300） | Betting Against Beta (BAB) | 行情计算 / iFinD |
| | `downside_vol_252d` | 252 交易日下行年化波动率 (%) | 下行风险度量 | 行情计算 |
| | `adv_20d` | 近 20 交易日日均成交额（亿元） | 流动性与冲击成本硬过滤 | 行情计算 / iFinD |
| | `ret_12m_skip_1m` | 过去 12 个月剔除最近 1 个月收益率 (`12-1` 动量) | Jegadeesh-Titman 动量观察（A股防月度反转） | 行情计算 |
| **F. 主营与产业链** (`chain_segment`) | `segment_products` | 按产品/行业拆分的收入、成本、毛利、占比、毛利率 | Cohen-Frazzini 产业链信息扩散与主营暴露 | `akshare.ts` (`stockZygcEm`) + iFinD |

### 1.3 数据源落地改造（`ycore` + `ytrader`）

1. **修复 `ycore/src/content/normalize.ts` 的过度过滤**：
   - 放开第 161 行仅保留 `营业收入|净利润|主营构成-项目(收入|成本|毛利)` 的限制，将 `content_raw_records` 中已有的 `营业收入(同比增长率)`、`归属母公司股东的净利润(同比增长率)`、`单季度.营业收入`、`单季度.归属于母公司所有者的净利润`、`主营构成-项目毛利率`、以及后续采集的资产负债率、ROE、ROA、经营现金流、总市值、PE/PB、波动率等指标全部结构化映射进 `Company.financials`，并保留精确的 `period` 与 `unit`。
2. **扩展 `ycore/src/content/akshare.ts` 与 `ytrader` 指标归一化器**：
   - 在已有的东方财富主营构成接口（`PC_HSF10/BusinessAnalysis/PageAjax`）基础上，增加：
     - **财务关键指标适配器**：解析公司多期 ROE、ROA、毛利率、净利率、营收/净利同比、资产负债率、流动比率、每股经营现金流/净现比、应收/存货周转等（支持从已有 iFinD 原始记录 + 东财公开 F10 数据双路提取并标注 `provider` 与四层时点）；
     - **指标计算引擎（`server/content/indicators.ts`）**：从 `Company.financials`、主营构成与行情记录中确定性计算出上述标准 `CompanyIndicator[]` 快照，任何缺失字段显式标记 `state: 'unknown'` 及缺失原因，绝不静默伪造为 0。

---

## 第二部分：独立可插拔的个股分析策略模块

### 2.1 架构设计（支持动态追加、删除、启停）

个股分析策略模块完全独立于新闻列表，位于 `server/content/strategies.ts`（及持久化表 `content_strategy_plugins`），具备：
1. **统一插件契约 (`StrategyPlugin`)**：
   - **内置核心插件（`builtin: true`）**：不可物理删除，但支持随时**启用 / 禁用（Toggle）**。首批内置报告推荐的 **5 大互补引擎 + 1 个产业链扩散引擎**：
     1. `value_ep`：**A股 E/P 盈利收益率价值**（评估 `便宜 / 中性 / 昂贵 / 不适用`）
     2. `quality_fscore_gpa`：**Piotroski F-Score + GP/A 企业质量**（评估 `强 / 中 / 弱 / 数据不足`）
     3. `accrual_redflag`：**Sloan 应计现金质量与 A 股财务红旗**（评估 `正常 / 需关注 / 高风险 / 待核验`）
     4. `dividend_shareholder`：**上证红利高股息质量与股东收益率**（评估 `稳健回报 / 中性 / 分红存疑或稀释`）
     5. `lowvol_defense`：**低波动 / 低 Beta 防御风险**（评估 `低风险 / 中性 / 高波动`）
     6. `chain_diffusion`：**产业链信息扩散与主营暴露**（评估 `正面催化 / 中性 / 负面冲击 / 待核验`）
   - **用户自定义可追加/可删除策略插件（`builtin: false`, `kind: 'custom_rule'`）**：
     - 用户可通过 API 或前端策略管理面板**随时新增（追加）**自定义策略插件（基于标准指标 Key 组合阈值条件、档位标签、成立前提与反证说明），也可**随时删除**或**启停**。

### 2.2 统一非黑箱输出结构（`StrategyEvaluation`）

```ts
export interface StrategyEvaluation {
  plugin_id: string;
  plugin_name: string;
  category: string;
  source_citation: string;               // 如 "Liu, Stambaugh & Yuan (2019) Size and Value in China"
  verdict: {
    tier: 'favorable' | 'neutral' | 'cautionary' | 'insufficient_data' | 'not_applicable';
    label: string;                       // 如 "价值：便宜"、"质量：强"、"现金质量：需关注"、"数据待补齐"
    summary: string;                     // 一句话定性逻辑说明（严禁买卖建议）
  };
  indicator_checks: {
    key: string;
    label: string;
    formatted_value: string;
    state: IndicatorState;
    pit_label: string;                   // 如 "报告期 2026Q3 · 公告 2026-10-15" 或 "报告期未知(MRQ)"
    passed: boolean | 'unknown';
    note: string;
  }[];
  conditions: string[];                  // 该策略结论成立的前提条件
  counter_evidence: string[];            // 主要反证：导致该策略评分失真的具体因素（必填，非空）
  missing_indicators: {                  // 尚缺的数据指标清单（指导数据源补齐）
    key: string;
    label: string;
    reason: string;
  }[];
}
```

### 2.3 REST API 契约（`/api/v1/content`）

- `GET /api/v1/content/strategies`：获取所有已注册策略插件列表（含内置与自定义、启用状态、所需指标清单、学术出处、数据就绪度统计）。
- `POST /api/v1/content/strategies`：追加一个新的自定义策略插件（校验指标 Key 合法性与反黑箱措辞规则，持久化入库）。
- `PUT /api/v1/content/strategies/:id/toggle`：切换任意策略插件（内置或自定义）的 `enabled` 状态。
- `DELETE /api/v1/content/strategies/:id`：删除指定的自定义策略插件（内置插件返回 403 保护，仅允许停用）。
- `GET /api/v1/content/companies/:code/strategies`：对指定个股运行所有已启用策略插件，返回：
  1. **五层综合看板摘要**（`价值`、`质量`、`现金与红旗`、`市场防御`、`产业链催化` 五维档位及头号反证，对应报告第 20 页设计）；
  2. **各策略插件详细评估卡 (`StrategyEvaluation[]`)**；
  3. **该个股的底层数据指标完备度矩阵 (`CompanyIndicator[]`)**（一目了然看到哪些指标已有值、哪些指标待数据源补齐）。

---

## 第三部分：事件驱动的动态产业链结构、运行逻辑与传导视图

### 3.1 动态产业链构建机制（AI + 现有图谱融合）

当新闻事件进入系统时，不局限于静态分类表，而是执行**“图谱召回 + AI 动态补全”**双层构建：
1. **图谱底座召回**：从 `content_nodes` 和 `content_edges` 召回事件关联节点及其上下游 1–2 跳生产关系（`input` 原材料/核心部件、`equipment` 生产设备、`service` 配套服务、`output` 下游应用）及已映射的 A 股公司（`content_exposures`）。
2. **AI 动态补全产业链结构与运行逻辑**：
   - 在事件解读生成阶段（`EditorialDraft` 扩展 `industry_chain` 字段，同时支持对存量事件按图谱与事件机制实时合成结构化 `ChainView`），输出该事件所属产业链的完整结构：
     - **链条名称与核心运行逻辑 (`chain_summary` & `operating_logic`)**：这条产业链靠什么驱动（如资本开支周期、技术代际切换、大宗原料价差、政策配额）？全链条利润池集中在哪个环节、为什么？
     - **上中下游环节节点 (`stages`: `upstream` / `midstream` / `downstream`)**：
       - 环节名称、角色定位、数据来源标识（`graph_backed` 图谱已收录 vs `ai_inferred` AI 动态补全）；
       - **环节运行与定价逻辑 (`pricing_and_margin_logic`)**：该环节的议价权高低、核心成本项、关键技术/产能壁垒；
       - **本次事件对该环节的传导冲击 (`event_impact`)**：冲击顺序（`step_order`）、方向（`positive` 偏正面 / `negative` 偏负面 / `mixed_or_uncertain` 分化或不确定）、具体传导机制、成立条件与反向抵消因素；
       - **环节对应 A 股个股 (`companies`)**：区分“有明确主营业务证据支撑的核心暴露公司”与“仅行业/概念候选公司”，点击直接跳转个股页查看其**事件暴露 + 独立个股策略分析**。

### 3.2 修复现有事件生成校验误杀（`editorial-schema.ts`）

- 修正 [`validateDraft`](file:///Users/Admin/Code/y/ytrader/ytrader-dev/server/content/editorial-schema.ts#L36-L58) 中导致已付费调用（如 `edjob_07795f05`）被误杀的机械限制：
  1. 允许短词主营引文（将 `quote` 最小长度从 `8` 放宽至 `2`，只要逐字存在于输入 `source.text` 中即可）；
  2. 放宽单字段 `citations` 数量上限至 `8`，忽略未知附加字段（去掉不必要的 `.strict()` 误杀）；
  3. `transmission` 机制允许引用或当模型未附重复引文时自动回退绑定 `change`/`why` 的已验证引文；
  4. 当引文中仅有月日（如 `"10月15日"`）而模型补全了当年年份 `"2026-10-15"` 时，若不匹配完整年份字符串则自动将 `occurred_on` 安全降级为 `null`（而非整篇抛错丢弃），同时支持将数据库中已成功返回但状态为 `rejected` 的有效模型结果重新校验发布。

### 3.3 Web 前端体验闭环（`EditorialReader.tsx` & `ContentReader.tsx`）

1. **事件简报与详情页（`#/events/:id`）**：
   - 新增醒目的**「产业链结构、运行逻辑与事件传导图」**可视化模块：
     - 顶部展示该产业链的**整体运行逻辑与利润分配特征**；
     - 中部以**上游 → 中游 → 下游横向/流式链条图**展示各环节卡片，清晰标注每个环节的**壁垒/议价权**、**事件冲击顺序与方向标签**、**图谱实证 vs AI 补全标记**；
     - 环节内直接展示关联 A 股公司及一句话业务暴露，点击即进入个股深度页。
2. **产业详情页（`#/industries/:id`）**：
   - 升级为可视化上下游链条结构视图（上游供应环节 → 当前核心环节 → 下游应用环节），并关联相关事件传导与环节内公司。
3. **个股深度分析页（`#/companies/:code`）与策略管理页（`#/strategies`）**：
   - 个股页顶部呈现**报告第 20 页五层结论总览条**（价值、质量、现金与红旗、市场防御、产业链催化 + 头号反证）；
   - **独立可插拔个股策略分析区**：展示所有当前启用策略的详细评估卡（档位、指标逐项核对与四层时点、成立条件、主要反证、缺失指标提示）；
   - **数据指标底座面板**：按 6 大模块展示该公司的标准指标库及数据源完备状态；
   - **策略插件管理面板（可追加 / 可删除 / 可启停）**：支持一键开关内置策略、通过表单/JSON 动态追加新策略算法、以及删除自定义策略，修改后个股页实时生效。
