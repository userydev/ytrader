# event_grouping · 1.1.0

## 目标与输入输出
优先避免错误合并，而不是最大化去重率。核心 `backend/algorithms/event_grouping.py` 不访问 DB、网络或当前时钟。
- `merge_safe(article, candidate, names=(), parameters=None)` → 是否无明显事实冲突。
- `same_event(...)` → 同一具体事件的保守布尔判断。Research 的旧导入位置兼容 reexport，NewsStore 继续通过该位置调用；没有更换事件 ID 算法。
- `homepage_progress(article, candidate)` → 在调用方已限定同 canonical URL 的候选中，是否可关联标题观察。
- `signature_progress(article, candidate, exact, same_identity, prior_articles)` → 已有相同历史签名候选能否复用。候选资料/身份检查结果、精确哈希都由调用方显式提供。
- `story_rule(article, feature, rules)`、`story_in_window(reference, candidate, max_gap_days)` → 背景议题规则与有界时间联系；不声称同一事实。
- `story_stage(title)`、`story_phase(latest, now=...)` → 标题所提阶段/近期状态；不是核实后的进程。

## 思路与步骤
1. 同一事件须有可核对来源时间，时间不明不能靠抓取时间补齐；普通归并窗口 36 小时。
2. 比较标题加全部来源正文的数字序列、中文动作/方向/否定标记，并检查英文明确否认/更正/方向词集合；相互冲突则拒绝。
3. 标题完全一致且足够长时才可直接归并。改写标题须有共享明确主体、动作、较短时间窗和高文本重叠；不同标题的模板正文不提供捷径。
4. 进展保持原签名和精确哈希计算。相同 URL 的 title-only 首页观察仍按原标题和时间条件关联；无来源时间的首页观察不是新事实。
5. 跨来源相同标题签名不再自动越过正文冲突：非精确正文须与候选全部实质稿件通过 merge_safe。修订同一来源身份但正文不同，不因此算另一来源的确认。
6. 找不到可复用进展时，按 `stories` 的主体/动作/必要词规则选择背景议题，限定最早到最新进展两侧的时间间隔；不匹配则独立议题。插入/ID 生成/事务仍在 Editorial。

## 参数与证据条件
- `DEFAULTS` 暴露 merge_hours=36、rewrite_hours=12、rewrite_overlap=0.6、similarity=0.9；调用方可显式覆盖，不提供用户写接口。
- `editorial_rules.json.stories` 由本模块拥有，含 entities_any/actions_any/requires/anchor_entity/max_gap_days；entities/actions 来自纯特征抽取。
- 进展 36 小时保护和阶段词表是版本化代码常量。
- 新闻身份（GUID、canonical URL、源内 identity_key）、append-only 修订入库及 URL 复用历史查找仍由原 NewsStore 处理，不因抽取而重写。既有受限决策 provider 的实验/计时外壳位于不可写基线 `decisions.py`，不是本轮的新网络路径。

## 边界例
- 同一标题正文把 10 亿元改成 11 亿元，或把已批准改为否认/未批准：不能跨来源误合并；即使变化出现在导语窗口外也须拒绝。
- 英文标题完全相同，正文多出 not/denied：不能走“同标题”捷径。
- 两家公司发布同一格式业绩稿：模板相同不代表同一主体。
- 同 URL 的旧标题观察与 RSS 标题一致，可以联系；标题改变不能被仅 URL 相同覆盖。
- 同一俄乌背景议题可包含谈判与袭击两个不同事实，不据 story ID 把两条事实合并。

## 局限与评估
保守数字顺序/用词匹配会漏并同义表达和跨语种报道；有限否定词表不等于完整否定理解。不会自动拆分以前已误合并的进展，也不删除新闻或重建 event/progress/story IDs。源内修订保留同事件并不表示旧事实与新事实都有效，当前投影只用身份头版本。

候选测试覆盖正文数字/否定、英文否认、未知时间、迟段正文修订、议题时间边界和历史 ID 不变性。实际评估应把错误合并单独列为高成本错误，用跨主体/更正/旧闻反例与时间切分样本测漏并率；未宣称模型语义去重能力。

## 更新方法
增加具体误合并/漏合并样例，先固定必要安全门，再改匹配条件；修改行为必须升本算法独立版本和 CHANGELOG。投影只重放 feature，历史绑定不重算。需要修复历史归并时须另行设计显式、可审计的迁移，不可借版本刷新偷偷重建 ID。

见 [CHANGELOG](event_grouping.CHANGELOG.md)。
