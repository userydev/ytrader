---
name: ytrader
description: 中文公共信息公报的注释系统
colors:
  link: "#006a78"
  link-hover: "#003c48"
  action: "#153c50"
  focus: "#177f95"
  ink: "#172c43"
  muted: "#5a6d7e"
  metadata: "#52697b"
  caption: "#5c6f7d"
  canvas: "#f3f5f7"
  paper: "#ffffff"
  divider: "#cbd6de"
  fact-surface: "#f6f9fa"
  fact-rule: "#08798a"
  opinion-surface: "#f4f6f8"
  opinion-rule: "#8696a3"
  conditional-surface: "#fffaed"
  conditional-rule: "#b3832e"
  warning: "#8a5700"
  notice-surface: "#fff8e8"
  notice-ink: "#684e1e"
  danger: "#a92b36"
  danger-surface: "#fff1f1"
  danger-ink: "#8e2530"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.45
    letterSpacing: ".01em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "21px"
    fontWeight: 620
    lineHeight: 1.55
  list-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "23px"
    fontWeight: 620
    lineHeight: 1.55
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  tag: "2px"
  input: "3px"
  button: "4px"
spacing:
  label-gap: "8px"
  compact-gap: "12px"
  paragraph-gap: "16px"
  section-inset: "24px"
  section-gap: "36px"
  group-gap: "40px"
  column-gap: "56px"
components:
  button-default:
    backgroundColor: "{colors.paper}"
    textColor: "#183249"
    rounded: "{rounded.button}"
    padding: "7px 17px"
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper}"
    rounded: "{rounded.button}"
    padding: "7px 17px"
  button-text:
    backgroundColor: "transparent"
    textColor: "#536575"
    padding: "7px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "8px 12px"
  evidence-tag:
    textColor: "{colors.link}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "2px 8px"
  fact-annotation:
    backgroundColor: "{colors.fact-surface}"
    textColor: "{colors.ink}"
    padding: "16px 18px"
  opinion-annotation:
    backgroundColor: "{colors.opinion-surface}"
    textColor: "{colors.ink}"
    padding: "16px 18px"
  conditional-annotation:
    backgroundColor: "{colors.conditional-surface}"
    textColor: "{colors.ink}"
    padding: "18px 20px"
  notice:
    backgroundColor: "{colors.notice-surface}"
    textColor: "{colors.notice-ink}"
    padding: "15px 18px"
  notice-danger:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger-ink}"
    padding: "15px 18px"
---

# Design System: ytrader

## Overview

**Creative North Star: "中文公共信息公报的注释系统"**

以正文、来源和注释建立可信阅读。墨蓝文字落在浅冷灰或白色阅读面上；细线和留白承担层级，颜色帮助辨认依据、条件与更正。中文系统字体保持日常阅读的熟悉感，不另设装饰性展示字体。

本文记录 `src/App.tsx` 与 `src/style.css` 的当前实现，沿用 `docs/surfaces/reading.md` 的既定方向。适用于已实现的登录、今日、历史、来源与事件详情；不代表完整 P0 已验收。Web 与 iOS 模拟器检查由主任务记录，实体 iPhone 验收仍待完成。界面允许仅展示已核验事实并明确停止解释；样式的存在不证明机制或公司分析已经成立。

**Key Characteristics:**
- 文章列表与注释段落承载信息，不依靠仪表盘或嵌套卡片。
- 事实、来源表述、条件推断保留文字类别和不同注释样式。
- 阅读列有明确宽度，辅助状态在窄屏转到正文之后。
- 无栅格图片、渐变、纹理、阴影或装饰动画。

## Colors

冷灰与墨蓝构成阅读底色，青色标识链接和依据，琥珀与红色承担状态语义；确切值以 frontmatter 为准。侧车色阶仅供面板预览，合成色阶不新增页面用色。

### Primary
- `link` / `link-hover`：来源链接、展开依据、当前导航和已核验状态。
- `action`：登录等实心主按钮。`focus`：交互控件的可见焦点。

### Secondary
- `warning`、`conditional-*`、`notice-*`：未核实、条件解释与需要留意的状态；不是交易涨跌色。
- `danger`、`danger-surface`、`danger-ink`：更正、否定、撤回和读取错误。

### Neutral
- `ink` 为正文与标题；`muted`、`metadata`、`caption` 分别用于辅助说明、状态行与时间注释。
- `canvas` 为页面底色，`paper` 为详情阅读面及表单控件，`divider` 组织边界。
- `fact-*` 与 `opinion-*` 区分事实注释和来源表述。

**The 文字与颜色同在 Rule.** 状态必须有文字标签；颜色辅助识别，不独自承担可信度或方向含义。

## Typography

**Body Font:** frontmatter 中的中文系统字体栈。标题沿用同一字体，不加载外部字体。

- **Headline**：页面与事件标题；窄屏降为 27px。登录标题独用 29px。
- **Title**：正文分节；列表标题使用 `list-title`，窄屏降为 22px。
- **Body**：连续阅读正文；三级标题为 18px / 620，四级标题为 16px。
- **Label / Caption**：证据、版本和日期信息；正文不能整体缩成注释字号。侧栏为 14px，提示与展开依据为 15px。

**The 正文优先 Rule.** 标题负责定位内容，辅助信息保持次级；不把眉题或全大写字距作为新层级。

## Layout

外层最大宽度 1180px。桌面列表采用 `minmax(0, 1fr) 250px` 两列，列距使用 `column-gap`，页面水平边距为 28px；侧栏左分隔线加 25px 内边距。详情转为白色单列，外层上限 850px、文章上限 720px。

800px 及以下改为单列，侧栏置于正文后并使用顶分隔线，左右边距为 20px；380px 及以下边距缩为 16px。页面和头尾内边距使用 `env(safe-area-inset-*)` 容纳安全区域。正文、链接和证据位置允许换行，不能把长来源内容挤出阅读列。

段落间距使用 `paragraph-gap`。文章分节使用 `section-gap` 加 `section-inset`，窄屏分节前距降为 28px；事件行桌面上下内边距 25px、窄屏 23px。观察与更新分组使用 `group-gap`。这些是当前阅读布局，不预设尚未实现的公司页面构图。

## Elevation & Depth

当前系统没有阴影。浅色注释底、细分隔线、细左边线与段落留白建立层级；白色详情面仍然平贴。没有动画或过渡 token；减少动态效果偏好仅保证滚动行为为 `auto`。

**The 平面注释 Rule.** 用留白、文字层级和单条边线组织证据，不用悬浮阴影或多层卡片包装段落。

## Shapes

文章、提示和注释使用直角。证据标签、输入框和按钮各用 frontmatter 的小圆角。普通边框与分隔线为 1px，当前导航下边线为 2px。圆角区分可操作控件，不赋予正文段落卡片外形。

## Components

- **按钮**：默认白底细边框；实心主按钮用墨青色；会话操作使用透明文字按钮。最小高度 44px，默认按钮 hover 为浅青灰。禁用状态透明度为 0.6 并显示等待指针；主按钮当前没有独立 hover 色，不虚构交互状态。
- **输入框**：白底、细边框、全宽，最小高度 48px；标签在上方并保留 8px 间距。错误以旁边的文字提示呈现，当前没有输入框专用错误边框。
- **导航**：横向文字链接，当前页以青色及下边线双重标识。窄屏仍保留今日、历史、来源，不替换为隐藏菜单。
- **证据标签**：细边框小矩形；青、琥珀、红文字对应核验、待证实/冲突、否定。标签是状态，不表现为可点击筛选器。
- **事件条目**：由元信息、可点标题、入选理由、影响或停步说明、时间组成；条目之间用底分隔线。标题默认墨蓝，hover 添加青色下划线。影响摘要使用琥珀细左线。
- **注释与依据**：事实用浅冷灰底与青色左线；来源表述改为灰色；条件推断用浅琥珀底和琥珀左线。条件与反向因素独立列出。原生 `details` / `summary` 展开依据，摘要最小高度 44px，来源摘录用细左线引用块。
- **提示**：常规提示用浅琥珀面，错误或撤回用浅红面；均有文字说明。无结果、失败、离线、历史版本与解释停步保留各自语义，不用同一个空白占位替代。
- **焦点**：交互控件保留 3px 青色轮廓与 4px 偏移；跳到正文链接在聚焦时出现。路由切换时程序聚焦的 `h1[tabindex="-1"]` 不画整块轮廓，不推广为控件去焦点样式。

## Do's and Don'ts

### Do:
- **Do** 用明确文字并列呈现内容类别、证据状态、版本和时间。
- **Do** 将事实与条件注释分开，保留成立条件、反向因素和缺证据时的停步说明。
- **Do** 沿用阅读列宽、小圆角控件、细分隔线和安全区域内边距。
- **Do** 保留交互控件的可见焦点，并让长链接与来源位置自然换行。

### Don't:
- **Don't** 将青、琥珀、红状态色改作确定涨跌或交易指令。
- **Don't** 添加巨大装饰标题、眉题、渐变、纸张纹理或嵌套悬浮卡片。
- **Don't** 为凑满页面制造事件、机制、公司关联或图谱占位。
- **Don't** 把本视觉规范、模拟器结果或组件样例当作完整产品和实体 iPhone 验收证明。
