# CORE 产品界面（2026-10-20 候选）

## 权威与边界

原 `frontend/public/industry/styles.css`、产业画布和公司四 Tab 是视觉与阅读结构的 authority，不再使用旧绿色工作台，也不另造一套图或卡片墙。

- 暖白背景 `#FAF9F5`；正文 surface `#FFFEFA`；深蓝文字 `#243549`；动作蓝 `#315E94`；细线 `#D9DEE3`。
- 模块顺序为标题 → 横线 → 正文。连续列表、细线分隔、报告期与单位就近出现；来源和请求细节折叠。
- 新闻列表 / 阅读侧栏、证券目录与原公司 renderer 同一层级，不嵌 iframe、不创建双层应用壳或双重纵向视口。
- 窄窗新闻在列表与阅读之间切换；原图保留坐标、图层、环节侧栏、按公司对照。窄窗仅画布 / 对照表可横向平移，纵向仍滚动文档。

## 单一导航

`public/shared/core.js` 定义 `core-navigation`，`public/shared/core.css` 定义共享壳。React `App.tsx` 和原独立页面都使用此组件，不各自维护菜单数组。

汉堡侧栏只有 **新闻 / 产业链 / 个股**。原生 modal dialog 提供焦点圈定、Esc、遮罩关闭和关闭后恢复触发按钮焦点。活跃项使用 `aria-current`。保留可见键盘 focus、跳转正文链接、控件 label、加载 / 失败 / 空态。

设置、用户管理、独立任务不作为产品导航。旧 `/settings`、`/sources`、`/jobs` 入口直接重定向 `/events`，不构建设置或来源管理入口；现存配置与后台数据没有删除。新闻首页不展示来源健康或后台统计，保留各稿件出处和用户主动更新按钮。新闻更新和目录更新在各自正文操作，进度 / 错误内联，不要求打开任务页。

## Read 主流程

1. `/events` 读取真实 `/api/v1/news/editorial`。推荐原因、各媒体出处、稿件修订、持续事件仍可阅读，AI 不是阅读前提。
2. URL 的 `event`、`progress`、`article`、`view`、`industry` 标识阅读选择。指定 progress 不存在时不替换成当前进展。
3. 产业关联展示变量 → 机制 → 条件及来源触发片段。进入原图时携带 `news`、`progress` 和完整阅读 `return`；原图核对已收录节点，相关节点高亮，未知节点不猜测。
4. `/chain` 以真正文档导航进入 `/industry/index.html`，不是 iframe。加载同源 v1 envelope：`/panorama/catalog`、`/panorama/context`、`/panorama/{id}`。context 的 securities/context/observatory/profiles 对应原四份内容。单产业失败可重试或浏览其他产业；远端失败不回退静态 data。
5. `/securities` 读取主表，支持名称 / 六位代码、SH/SZ/BJ 及 URL `offset` 分页，每页 100 家，不是静态 40 家目录。
6. 目录和产业中的已上市公司都进入 `/securities/{canonical symbol}`，再替换为原页面 `?symbol=SH:…` 的独立公司模式，复用同一个 `renderCompanyWorkspace`。原四 Tab：**总览 / 财务 / 业务 / 新闻与公告**。刷新保留 symbol、tab、return。
7. 公司没有已确认的产业映射时建立独立证券上下文，不选第一产业、默认原油或同名公司。公司身份只认 canonical symbol；证券详情 / profile / fundamentals 的响应分别核对身份。资料缺失与缓存状态诚实展示。
8. `return` 只允许同源 events、securities、chain、原 industry 路径，拒绝外站、账号信息、控制字符与反斜线。公司可回原图，再回新闻进展；目录筛选和页码也保留在返回 URL。

## Operate：研究和更新

- `core-research` 是 React 新闻阅读和独立公司详情共用的内嵌可选研究实现。仅点击提交对应 `/events/{id}/analyze` 或 `/securities/{symbol}/analyze`；通过现有 `/jobs` 核对任务 ID、轮询真实状态，然后读取事件详情或公司 `/analysis`。
- 展示后端返回的六类研究、模型、时间、警告和证据标识。未配置（409）、失败、超时不显示假结果；提交成功不等于研究完成。刷新后可展开读取已有结果。
- 用户指定 Gemini 3.8 Flash；实际通道和模型记录由后端及宿主配置，前端不提供模型设置、不假报模型完成、不回退其他模型。
- 新闻更新继续使用 `/sync {kind:news}`；证券覆盖更新同样使用既有同步接口。新闻只保留稿件本身的出处说明，不展示来源健康、更新状态面板或来源管理入口；底层采集状态与 API 不变。

## 财务不可破坏约束

原 `fundamentals.js` 的 symbol 缓存与请求身份保护保留；不抓 `financials.json`。

- 金额：来源原币元 ÷ 1e8；pct 已是百分值，不能再乘100；composition 的 ratio 才乘100。未知币种不展示金额；不同报告期不补齐、不同币种不拼接。
- 仅 FY 做三年趋势。空值不是0；来源、分表状态、缓存时间和警告可展开核对。
- 本轮同步接收 periods 可选增补：扣非归母净利润及同比、加权 ROE、基本 EPS、`monetary_funds`、应收账款、存货。映射到原 core_profit / roe / eps / cash / receivables / inventory 位置；旧响应缺字段兼容 null。
- EPS 是原币/股，绝不除1e8；货币资金不等同可用现金或现金等价物。R&D 仍未提供，不推算。

## 交付检查边界

这是实现候选；本 worker 未运行构建、测试或浏览器。由 Codex 核对类型 / 模块加载、原图几何、窄窗、键盘 dialog、原路返回、真实 CORE 数据与 Gemini 任务。固定 API 语义和静态产业知识未修改。
