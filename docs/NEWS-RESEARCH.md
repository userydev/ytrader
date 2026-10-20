# 开源研究采用记录（宿主核读）

证据日期：2026-10-20 UTC；GitHub API元数据与固定commit源码在repos，均只读未执行。已真实浏览Horizon日报及NewsNow首页。源码片段证明对应机制，不代表整项目验收。

| 项目 | 核读位置与发现 | 本轮决定 |
|---|---|---|
| [Horizon](https://github.com/Thysrael/Horizon) | src/ai/prompting/deduplication.py明确只合并同一事件，不确定保留；RSS以feed+entry id身份，缺发布时间直接跳过；日报有摘要/背景/影响与来源 | 采用来源/日期/阅读层次、同主题不等于同事件；不照搬AI评分与过滤，不丢弃未知时间条目，未知时间单独标记 |
| [TrendRadar](https://github.com/sansan0/TrendRadar) | rss_schema.sql中(feed_id,url)、非空(feed_id,guid)唯一索引；源抓取状态和抓取历史独立；fetcher有重试资格判断 | 采用源内身份与抓取/发布时间分离，不复制GPL源码 |
| [NewsNow](https://github.com/newsnext/newsnow) | database/cache.ts保存每源items与更新时间；真实UI为来源排行榜卡片，每源有刷新时间 | 采用每源状态与缓存时间；拒绝来源卡片墙作为阅读主界面，避免把聚合热榜当独立证据 |
| [Miniflux](https://github.com/miniflux/v2) | reader/rss/adapter.go区分GUID permalink；缺失/无效时间回退time.Now；http/client.go有连接时地址校验 | 采用GUID不必为URL与内容清洗；不采用缺失发布时间补当前时间。自定义RSS保留私网拒绝，不改变本机代理配置 |
| [FreshRSS](https://github.com/FreshRSS/FreshRSS) | Entry.php分离GUID和内容hash，hash保留原始正文与标题等；http-conditional.php条件请求 | 采用身份/修订分层与条件请求，不复制AGPL源码 |
| [RSSHub](https://github.com/DIYgod/RSSHub) | cache middleware区分缓存命中、请求claim、失败finally释放 | 采用缓存与去重采集理念；本轮直接连接官方源，不引入公共RSSHub节点作为稳定性保证或运行其服务 |
| [Feedbin](https://github.com/feedbin/feedbin) | EntryFilter区分new/updated/unchanged；public_id与fingerprint分离，EntryUpdate保留原始内容及更新通知 | 采用明确采集计数与内容修订记录，不加入未请求的推送 |
| [NewsBlur](https://github.com/samuelclay/NewsBlur) | feed_fetcher.py条件请求；304为未变化而非空源；429不立刻换UA重试 | 采用304保持已有数据/健康，失败有界退避，不伪装请求突破限制 |

许可证以本次GitHub metadata为线索：Horizon MIT，TrendRadar GPL-3.0，NewsNow MIT，Miniflux Apache-2.0，FreshRSS AGPL-3.0，RSSHub AGPL-3.0，Feedbin MIT，NewsBlur MIT。仅借鉴机制，未复制代码、未运行第三方仓库，后续如复用源码仍需逐文件审查许可证。

## 数据根因
现有新闻去重将所有标点删除再hash，1.2/12、-5/5可能冲突。指纹改为仅规范Unicode与空白，保留数值符号；相似匹配独立。现有RSS的ValueError捕获吞掉UserError(Fake-IP校验拒绝)，误报XML失败；已向Pi反馈精确内置端点和严格用户RSS边界。原文摘要/完整正文、源发布日期/抓取时间必须分别标注。

## 不宣称的能力
未有全网新闻覆盖，未有热度流量数据，未有长期SLA；三家直接源只能说明本轮可用。中文同事件聚合保守规则仍会漏合并，不使用无验证的相似度分数充当准确率。UI首先可体验，全面浏览器回归后置。

## 外部研究报告审查
agy-research 4cb4c8404ed94709a3df3acb92f7738e因本地read_file工具权限不匹配为BLOCKED。其输出只作为待核对线索：未采用其固定SimHash/Jaccard/聚类分数阈值、未经校准的来源权威权重、三栏默认打开阅读器、同稿多源即独立确认等建议。报告还出现Horizon不存在的src/horizon路径、未实测Demo地址、RSSHub许可证与当前GitHub元数据不一致。以宿主固定commit源码和实际浏览证据为准，不能将外部报告标为PASS。

宿主已独立核对实际Horizon上游为Thysrael/Horizon，实际日报站点thysrael.github.io/Horizon；日期2026-10-20日报已浏览。不将日报新闻叙述当成ytrader已验证事实或导入数据库。
