# 有界实现交接 · 2026-10-20

状态：下文保留worker交接时记录。Codex随后完成最终候选哈希绑定、124项检查、schema验证、实际路径与集成；最新证据见 [CORE-VALIDATION](../CORE-VALIDATION.md)。

## 实际变更
1. `backend/algorithms/`：四个纯算法模块、独立 registry/VERSION、共享文本/时间辅助、纯 features 组合。推荐重要性/排除/归因/score/diversity、研究排序、事件安全归并/进展/议题决策、industry_links 配方、证券字面匹配从 IO 分离。纯函数显式接收规则和时间；无 DB/network/页面或配置文件读取。
2. `backend/editorial.py`、`backend/research.py`：调用新模块，旧函数/导入签名兼容。保留原事件、新闻、议题、进展 ID 生成与历史绑定；算法版本摘要用于特征缓存重放，审计记录四算法版本。新增归并只收紧正文冲突与英文明确否认，不自动拆分历史数据。
3. `backend/panorama.py`、`backend/app.py`：新增三条只读全景接口；五行业固定白名单；context/catalog 先于动态路由；受控源目录/构建目录读取、大小/路径保护；旧 /industries AI 图接口不改。
4. `backend/core_contracts.py`、`backend/adapters.py`：核心成功响应必要结构/主体/引用检查，含全景内部与跨文档引用、新闻文章/进展引用与传导节点、证券身份、事件/图/证据。ycore 失败不转本地。保留来源隔离、Retry-After、有限时与既有缓存实现，没有新源、付费依赖或缓存平台。
5. `backend/app.py`、`backend/research.py`：可选 offset>=0；local symbol 稳定排序 LIMIT/OFFSET；远端同参转发，不传时不附加该参数。新增 /contracts/core 与 /algorithms 发现端点。
6. `backend/fundamentals.py`：按宿主增补加入七项可选字段；monetary_funds 标签为货币资金；EPS/百分值/原币元不混单位。旧远端缺字段归一 null；旧缓存按 schema_version=2 受控刷新，无删缓存或新 DB 迁移。既有身份/日期/币种/分表失败保护保留。另修正 Remote 对本地财务既有 period_end 日期元数据的兼容缺口。
7. `backend/analysis.py`：只给 Analyzer.local 的模型请求显式180秒预算；不改公共数据默认超时、模型选择、Gateway 安全边界或 AI 架构。
8. `tests/test_core_algorithms.py`、`tests/test_core_contracts.py`：离线边界、输入不变性、数字/否认/迟段修订、引用坏值、同契约四种 data×ai 组合、稳定分页、财务单位/旧远端/版本缓存与历史 ID 重放的测试候选。
9. `docs/algorithms/`：四份目标/输入输出/步骤/参数/证据/边界/局限/评估/更新说明，以及四份独立 CHANGELOG。`docs/contracts/`：机器 schema、七样例、接入附录与本回执。

未改前端、CORE 冻结文档、scripts、模型配置或用户数据；没有读取宿主证据文件、凭据或运行中的数据库。未创建服务、部署或发起模型调用。

## 验证来源与实际未测
- **worker 实际执行：仅允许的 read/write/edit；未运行测试、构建、shell、网络或浏览器。**
- 宿主消息报告：某次中间快照的 core_contracts/core_algorithms/fundamentals/research_symbols 为120 passed、1 skipped（当时仅缺 jsonschema）。这是宿主执行，不是 worker 执行，且不绑定最终候选。
- 宿主后续消息报告：使用证据目录独立安装的 jsonschema 4.26.0 检查七样例通过；真实三个 /panorama 端点200；恒瑞七新增值与来源一致；浏览器新闻→原全景→中国海油走通。worker 未独立查看这些现场或证据文件，不据此声称最终快照全部验证通过。
- 该120/1预检后继续完成了已开始的纯 features/attribution 迁移与交接文档；最终版本必须由宿主重新绑定哈希复验。worker 只做了必要引用核对：Editorial 显式导入 features 并委托 extract；features 仅依赖纯 common/recommendation/industry_transmission；recommendation.attribution 已存在，URL 策略仍在 Editorial；未见未完成 import。未进行可执行语法检查。

## 仍需集成方注意
- 历史误归并不会偷偷拆分；跨语种、语义否定和主体消歧仍有规则局限。没有真实准确率/收益预测结论。
- 原受限决策 provider、URL 复用身份存储和抓取/财务实现仍复用基线；未超出 writable_scope 改 decisions.py 或 AI 架构。
- 全景 context 交叉校验至多读取六个远端响应，新闻按关联行业核对远端图；未新增缓存。发布方需维护一致快照，混合版本坏引用明确失败。
- 原 static company-profiles 报告期/单位不变，不等同当前 fundamentals；没有使用 financials.json 回退。
- composition.share_ratio 原0..1保护未放宽，冻结文字与实际基线的差异已在接入附录说明。
- 契约发现端点发布时须带上 docs/contracts/core-v1.schema.json；显式 YTRADER_WEB_DIST 时须带上原 industry/data。
- 本轮不配置58730、Gateway模型、Gemini桥脚本或服务端口；这些由宿主和其他已授权 worker 集成。

后续动作：宿主锁定最终文件哈希并复验新增与既有保护；再执行真实 API/浏览器回归和集成。不得将中间快照结果复用为最终候选的通过证据。
