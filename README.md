# ytrader

个人自用的每日大事影响解释产品，面向桌面 Web 与 iOS，最终关联 A 股产业与公司。

核心目标：用户打开就看懂今天有哪些值得关注的变化、通过什么机制影响哪些产业和公司、为什么。产品主动完成关联与解释，产业链随事件展开；产业和个股新闻、独立个股分析作为补充。事实、观点与条件性判断分开。

当前阶段为**内容系统本地可运行版**。新闻采集、产业关系、公司业务与条件分析已入库，并接通新的内容首页。当前收录 61 条新闻、16 家公司、63 条上下游关系和 3751 个分类及产业节点；分类目录不等于完整产业链。新闻与公司资料仍有时间、原报告及变化核实缺口，目前仅一条政策形成两条条件机制，尚未完成每日重要事件的广泛自动分析。

本地预览：[打开 ytrader](http://127.0.0.1:5173/)。已启动限额、串行的定时采集；进度、验证、剩余缺口和停止方式见 [检查点](docs/CHECKPOINT.md)。本轮依据与开工盘点见 [内容建设记录](docs/CONTENT-BASELINE.md)。原 FIRST-LOOP 与 IMPLEMENTATION 仅为历史实施记录。

## 阅读顺序

1. [开工决策报告](docs/KICKOFF.md)、[条件核验与用户事项](docs/READINESS.md)、[角色与责任](docs/TEAM.md)。
2. [产品需求](docs/PRODUCT.md)：用户路径、行为和状态规则、需求验收。
3. [系统设计](docs/ARCHITECTURE.md)、[接口契约](docs/CONTRACTS.md)、[交付门槛](docs/DELIVERY.md)。
4. [复用决策](docs/REUSE.md)、[新闻方案](docs/NEWS.md)、[部署](docs/DEPLOYMENT.md)、[数据研究](docs/RESEARCH.md)、[iFinD 实查](docs/IFIND-VALIDATION.md)。

状态与接续约束见 [检查点](docs/CHECKPOINT.md)及[开发阶段说明](docs/DEVELOPMENT.md)。`dev` 为主要开发分支，`main` 为稳定发布分支。尚未部署线上服务；本地验收预览见检查点。
