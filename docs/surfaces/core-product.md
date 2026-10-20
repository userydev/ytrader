# Surface: CORE product

## Authority

原产业 `frontend/public/industry/styles.css`、原全景布局与原个股四 Tab 是唯一视觉 / 阅读结构 authority。产品统一到它们，不是只给旧工作台换色，也不额外引入新审美。

共享 `public/shared/core.js` / `core.css` 提供同一个汉堡侧栏与内嵌研究组件；React 与原独立文档都使用。主项严格为新闻 / 产业链 / 个股。没有设置、用户管理或独立任务导航；不删除保存的配置。

## Read

- 新闻推荐 → 阅读详情、出处、持续事件 → 有证据触发的产业变量 / 机制 / 条件。
- 携带 event/progress/return 进入原产业图 → 关联环节高亮 → 按环节或公司阅读 → canonical symbol 原四 Tab 详情 → 返回原流程。
- 证券目录直接访问全 A 股主表，名称 / 代码、交易所、分页；不是只有已映射公司的静态目录。
- 无映射证券独立读取真实 security/profile/fundamentals 与关联新闻，不选默认原油、不借其他公司资料。缺失不是0，也不是退市。
- 标题 → 横线 → 正文；暖白 / 深蓝 / 蓝动作 / 细线，连续阅读层级。无 iframe、双层壳或双重纵向视口。窄窗图与对照可横向平移，原几何不重画。

## Operate

- 新闻正文更新新闻；目录折叠来源内更新证券覆盖。操作进度、失败和重试在原位置显示。
- 新闻阅读、公司详情内部可展开 AI 研究。共用原 analyze + jobs + 结果接口；仅主动提交，不强迫跳旧 EventsPage，也没有独立研究功能区。
- 用户指定 Gemini 3.8 Flash，真实通道 / 模型 / 完成状态由后端记录。前端不代填成功、不伪造分析、不提供模型配置。
- 稿件本身的出处说明可折叠；新闻首页不展示来源健康或后台统计，来源管理不进入主流程。旧 `/settings`、`/sources` 直接重定向 `/events`，不通过 `sources=1` 打开任何面板。当前阅读选择不被后台更新悄悄替换，AI 未配置或失败仍能读新闻与规则传导。

## Boundary

同源 `/api/v1`、v1 envelope。全景新边界为 `/panorama/catalog`、`/panorama/context`、`/panorama/{industry_id}`，原静态知识不改，失败不回退静态文件。return 白名单只允许必要产品路由；身份按 symbol 和请求核对。

状态：2026-10-20 候选实现，未在 worker 运行测试 / 构建 / 浏览器；Codex 负责集成检查。详见 `docs/UI-CORE.md` 与 `DESIGN.md`。
