# industry_transmission · 1.2.1

## 目标与输入输出
`backend/algorithms/industry_transmission.py::industry_links(article, feature, rules)` 接收标准化标题、源提供正文、文章 ID 与显式规则，返回原有 industry_links 列表。当前规则保留 feature 参数以兼容已有签名，尚不依赖其内容。

每条含 industry_id/name/industry_name、variable、mechanism、condition、node_ids、direct/conditional、evidence[{article_id,trigger,quote}]、basis=rule_inference、rule_version。可附简述与机制参考来源；机制参考不是该新闻的事实证据。无命中返回 []，不猜测公司、订单、股价方向或置信度。

## 思路与步骤
1. 每条规则定义一个窄变量/机制，而不是把“产业被提到”当作统一利好。
2. 普通触发组必须出现在同一 480 字符局部窗口，步长 240；相隔很远的正文片段不能拼成因果。
3. AI 扩容/订单有更窄的句段与主体邻域门：算力主体附近必须有投资/订单语义；“应用包括 AI”等泛用途不能当成算力订单。
4. 航运扰动区分实物油运与黄金风险配置的条件联系；央行利率分支须有明确决策措辞，而不是任意 rate 或预测。
5. 输出证据触发词与局部引文，同时列出需要核对的执行、资金流、替代供给、订单/交付等条件。direct 只表示本规则变量的直接产业关联，不代表独立核实或必然收益。

## 参数与证据条件
- 本模块使用显式传入的 `editorial_rules.json.actions.capex/orders` 和央行 entities 字典，文件读取留在服务。生产分支不再使用泛 supply 动作组。
- 局部窗口、AI 邻域（主体两侧最多 90 字符）、触发组、变量/机制文案、产业/节点引用均为本算法版本化配方。更新这些配方必须升 industry_transmission 版本。
- `rule_version` 保留既有 editorial 规则版本字段；新增顶层 algorithm_versions 给出本模块独立版本，不替换旧字段。
- 产业节点继续使用原全景 IDs。grid/innovative-drugs 的既有规则无已定义节点映射，返回空 node_ids，不凭空映射。

## 1.2.0 储备/生产边界
- 标题及正文按句段核对储备、释放动作与油品主体；非油品的战略储备/stockpile 不关联原油。
- 储备释放安排只给 conditional：可动用库存/投放节奏，须实际投放后才可能改变市场可得性。即使标题或正文提到已宣布释放，也不宣称桶数已到市场。
- 当前 IEA“石油储备的释放时机由各成员国自行决定”不命中生产分支；库存不是开采产能。关联 logistics，原油/混合油品可关联 crude/refining，明确柴油/成品油可关联 fuels；不从释放推 extraction。
- 生产分支须同句有原油/OPEC 主体和明确减增产/产能等词组，排除储备句段；不再将“供应”当作产量动作。独立生产句仍可保留另一条件关联。
- 1.2.1 补齐英文动词—宾语词序，如 `OPEC cuts oil production`、`OPEC cuts production`、`OPEC raises crude oil output`；允许明确动词、可选 its/their、可选油品修饰词，再接 production/output。匹配的原始短语进入 evidence，仍须同句油品/OPEC 门与储备句段排除，不使用任意 supply 触发。
- 不新增路径数组：消费端从真实全景 relations 和 participations 校验业务关系；node_ids 是并列候选环节集合，不是有序因果链。

## 有用边界例
- PC 内存长约正文末尾列出 AI 应用，不推出 AI 数据中心订单。
- 红海/霍尔木兹明确袭击可以给出黄金条件传导；不需要新闻原文提及黄金，但必须明确标为规则推断，并列美元、实际利率与资金流可能抵消的条件。
- 名义降息不等于实际利率下降；央行讨论“可能降息”不能假装已执行决策。
- 黄金出口增加是跨境流量，不直接等于矿山增产或终端需求增加。
- 供电约束影响部署条件，不意味着所有散热或设备企业同时获得新增订单。

## 局限与评估
这是词组与局部上下文规则，不能完整理解否定、引用范围、时态或多主体复杂关系。不会从机制产生受益证券列表，也不验证新闻是否真实发生。英文缩写采用词边界，中文仍依赖明确词组。既有黄金机制参考只作框架，不是实时价格证据。

候选测试检查远隔词段、泛 AI 用途、明确航道冲击、证据 ID 和输入不变性；契约测试拒收不存在的远端 node_ids。人工评估应分别记直接关联、条件联系和完全无关的误触发，重点审查“标题缺证据、正文仅提及用途”的反例。本轮没有真实准确率或行情回测结论。

## 更新方法
针对误关联增加能解释为什么应当不关联的样例，再收紧/增加配方；单独升 registry 版本并记 CHANGELOG。重放仅刷新特征和推荐解释，原始新闻与历史进展绑定不变。新增行业/节点应先通过全景契约，不创建第二套 ID 映射。

见 [CHANGELOG](industry_transmission.CHANGELOG.md)。
