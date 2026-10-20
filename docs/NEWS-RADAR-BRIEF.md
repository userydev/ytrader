# 新闻数据与阅读雷达实现契约

用户2026-10-19恢复新闻数据与新闻产品开发，要求充分开源研究。此次只改新闻相关实现，保护现有runtime数据库/凭据与58700产业个股稿。新实例和新数据目录由Codex启动。不提交推送，不调用AI，不扩展商业源。

## 数据路径
新闻源 → 有界请求/结构校验 → 清洗与时间校验 → 来源内身份去重/修订 → 保守事件聚合 → 过滤/阅读。来源真实失败不得仅HTTP200记成功，不得以抓取时间替代缺失发布时间。用户RSS保留严格SSRF校验，重定向也校验；官方内置域可以沿用当前精确public-host设计，但只能精确内置ID+URL匹配，不能让同域自定义URL获得豁免。

已观察公开来源：华尔街见闻JSON100条；https://www.chinanews.com.cn/rss/finance.xml 官方财经RSS30条；https://www.ithome.com/rss/ RSS60条。36kr/feed和/feed-newsflash返回HTML，不启用。现有RSS解析失败根因未定，宿主证据含有效XML，最新Network因本机FakeIP拒绝。内置这3个有效源，保留用户enabled配置。不要把IT之家description简单标全文，它是来源摘要/源提供正文。来源status展示最近抓取结果及距今，不承诺永久稳定。

实现有界稳定UA、RSS/Atom根节点/内容类型校验、ETag/Last-Modified条件GET和304保持成功缓存、失败次数/下一重试时间的有界退避（可用户手动刷新但不疯狂重试），区分last_checked/last_success/latest_published。隔离来源失败。统计received/added/duplicates/rejected/revisions供来源界面使用。只暴露安全错误简述。

身份：保留feed GUID/Atom ID（源内）、canonical URL、文本指纹；相同身份相同内容重抓不插入，不依赖发布日期变动。正文/标题修订保留版本。不因内容一样直接丢掉其他来源。事件聚合保守：相同主体、时间窗、数字/动作不冲突；只有共同关键词不合并。保留不合并的误差，避免错误合并。保留可解释merge_reason、质量标记（缺发布时间、未来时间、标题/摘要级别）及原始来源。迁移必须追加兼容，不删除/重建旧表。修正详情默认旧稿，新增primary_article_id明确最新可读版本，同时保留articles历史；event标题/摘要须与选稿一致。

## 冻结接口（沿用v1 envelope）
GET /api/v1/events 扩展参数 q,limit(最多500),source(来源name),period=all|24h|7d,sort=latest|hot,content_level=all|full|summary|title,tag(可空)。默认latest，日期缺失排末。最新按源发布时间，hot仍规则评分但不能名为阅读量/全网热度。source/content_level应在同一article上满足，避免混合来源误筛。q查标题/正文；所有筛选交集。响应仍data数组，不改旧客户端。
每个事件增 source_count,latest_published_at,quality_flags（列表）,merge_reason（字符串可空）；保留source_names/article_count/tags/summary。
GET /api/v1/events/{id} 保留既有字段，增primary_article_id；articles按最新版本优先，增source_id/external_id/quality_flags/merge_reason如有。正文是安全纯文本/段落，不插入未经净化HTML。
GET /api/v1/news/overview 返回data={event_count,article_count,source_count,duplicate_count,revision_count,last_checked,latest_published_at,topics:[{name,count}],warnings:[]}，统计当前数据库，准确标口径。
GET /sources 保持数组，扩展上述健康/统计元数据。PATCH /sources/{id} enabled；POST /sources增加RSS仍原契约。POST /sync原kind news只刷新新闻。远端ycore模式明确新能力不支持或透传，不能静默本地回退。

## 展示方向（待Pi前端）
暖白、蓝色选择、标题在上→横线→内容，与58700风格接近。首屏完整新闻首页而非目录+默认打开第一条；主栏有标题/摘要/来源/源时间，右栏来源健康+主题分布，可点筛选。搜索、来源、时段、内容级别与最新/热点能组合且URL保存。详情独立舒适阅读栏，返回保持筛选/位置，显示摘要/全文边界、原文、来源/修订选择，无默认AI摘要。来源管理独立页。产业/个股入口可以链接已认可58700稿，不修改它。

## 阶段
数据质量明确授权可做有针对性回放/真实源检查；新UI先可体验版本，只基本入口检查，不建测试框架/全面回归。Codex运行全部命令和浏览器，Pi只生成隔离候选。
