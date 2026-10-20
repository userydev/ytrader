# recommendation · 1.1.2

## 目标与边界
把有限公开来源中的经济变化、真实首页观察、首页精选和明确独家声明转成可解释推荐；不是全球热度、新闻真实性、市场影响或收益概率。核心在 `backend/algorithms/recommendation.py`；`features.py` 组合特征与传导算法。Editorial 只负责读取、URL 安全校验、存储、审计和返回投影；Research 的本地 relevance/score 与 hot 重排也调用本模块。

## 输入与输出
- `importance(article, rules)`：标题、正文、文章 ID、显式规则 → tier、带证据的 signals、reported/proposal/analysis 模式。
- `editorial_exclusions(article, meta, rules)`：URL、标题/导语、RSS categories → 排除原因。
- `attribution(article, meta, publishers, origin_url=...)`：报道措辞、来源元数据、显式出版商表与已通过调用方 URL 策略的可选原始链接 → 出版商、归因线索、独家声明。仅记录链接，绝不抓取原文。
- `evaluate(features, articles, observations, now=..., fact_at=..., current_heads=..., rules=..., selections=...)` → eligibility、channels、reasons、score/parts、suppression/excluded 等。`now` 由服务提供；模块不读时钟。
- `diversify(items, limit, diversity)` → 新的 selected/deferred，不改输入。
- `research_score(..., now=...)`、`research_hot(items, limit)` 保留普通事件流原有规则排序，不把它伪装成 Editorial 的第二种实现。

## 思路与步骤
1. 标题锚定：标题命中经济/政策等规则后，再检验有界导语、主体、必要量级。数字本身不构成重要性。
2. 先执行质量门、栏目/例行发行/纯价格回顾排除；历史修订不能给当前稿件提供被撤回的标题或证据。
3. 区分报道、计划和分析。计划不取得已发生变化加分，分析有降权。
4. 首页观察最多新鲜六小时；来源事实时间超过七天的稿件不能被新首页版位复活。无来源时间且无真实新鲜观察时不能推荐。
5. 分数解释组成，不归一化。出处数只有有界关注范围加分，不声称独立确认。
6. 先比较重要性 tier，再在同层内执行有界议题/出版商多样性惩罚和议题条数上限；按稳定 ID 破同分。

## 参数与证据条件
规则文件仍为 `backend/editorial_rules.json`，在服务边界读取并显式传入，纯模块没有配置文件 IO。
- 本模块拥有 `importance_rules`、`weights`、`diversity`、栏目/排除/价格/评论相关节。
- `entities/actions/changes` 为特征投影共享字典；出版商表与精选来源集合由服务显式传入。
- 标题/导语窗口、时间窗口、Research 的原有加权系数是版本化代码常量，并非远端可写配置。
- reasons 和重要性信号保留 article_id、trigger、quote 或真实版位观察。媒体自称独家不等于本系统独立核实。

## 有用边界例
- 球员薪资即使含 billion/contract，也不因此越过体育栏目质量门；转播权/所有权交易须是标题主题。
- 没有经济主题的新闻，正文尾部提及大型科技公司不能把它提升为经济重大事件。
- 来源发布时间为十天前、今天重新上首页：仍不能当作近期变化。
- 同一媒体连续提供高重要性稿件：低 tier 填充稿不能凭出版商多样性越级。
- 两家媒体都转述 Reuters：不是两份独立确认；归因不明也不擅自认定独立。

## 局限与评估
语言规则不是语义理解；跨语种重复、未标注转载、复杂否定/语气可能漏识别。Research 的一般事件分数与 Editorial 分层推荐面向不同入口，不应跨入口比较分值。仅有源提供摘要，不补抓付费全文。

候选测试：`tests/test_core_algorithms.py` 的数字无关重要性、栏目门、时效/观察、多样性不变性；`tests/test_core_contracts.py` 的四种 data×ai 只读组合、历史 ID 重放。应另做有时间切分的人工样本评估，记录误召回/漏召回与来源集中度；本轮没有声称真实准确率。

## 更新方法
先写反例和期望解释，再改本模块或所属规则节，增加 registry 中 recommendation 版本并写独立 CHANGELOG。服务的投影缓存版本包含四算法版本摘要，重算特征但不重建新闻、event、story、progress ID；审计也记录版本映射。规则文件兼容标识 `algorithm_version` 继续保留。

见 [CHANGELOG](recommendation.CHANGELOG.md)。
