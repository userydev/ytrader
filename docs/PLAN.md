# 核心功能交付计划

2026-10-20。范围以用户最新明确指令及 [CORE-DEVELOPMENT](CORE-DEVELOPMENT.md) 为准。第一阶段记录保存在 [原计划](archive/2026-10-20-before-core-delivery/PLAN.md)。

| 工作 | 负责人及状态 | 完成条件 |
| --- | --- | --- |
| 固定接口与数据格式 | Codex审查约定，Pi实现，已集成 | v1 envelope、单位/缺失/状态、机器schema及样例；local/ycore同契约 |
| 新闻推荐与关联算法独立 | Pi实现，Codex已验证 | 推荐、事件归并、产业传导、证券匹配纯模块；独立版本、思路文档及CHANGELOG |
| 统一UI及核心路径 | Pi实现，Codex浏览器已验证 | 原产业链风格；菜单仅三项；新闻→产业→公司→返回保留上下文 |
| 个股信息与详情 | Pi实现，Codex源值核对及浏览器已验证 | 原四Tab、真实资料与财务；一般A股可独立访问；无映射明确提示 |
| Gemini首期接入 | Pi实现桥，Codex已集成与真实调用 | 固定Gemini 3.8 Flash；新闻与公司分析保存有效引用；无模型fallback |
| 用户体验 | 待用户反馈 | 确认方向或提出具体修改 |

已完成项不重复派工或扩充QA。实际检查范围和限制见 [CORE-VALIDATION](CORE-VALIDATION.md)。下一步按反馈修订；ycore实连、AI可配置服务、设置/用户管理及发布均不由此计划自动启动。
