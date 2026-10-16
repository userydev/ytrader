# 部署与联调方案

2026-10-15。以下是推荐默认方案，尚未部署。用户已允许使用自有新加坡服务器及 Cloudflare 管理的 `ydev.work`；本轮文档工作不扩展为发布、采购或 DNS 变更。

## 默认部署

| 组件 | 推荐位置 | 理由与调整条件 |
| --- | --- | --- |
| Web | Cloudflare Pages 静态托管，分支预览 | 个人工具无需为页面单独常驻服务器；受阻时可用相同静态产物迁往 Vercel |
| ytrader 业务服务 | 腾讯云新加坡主机，独立 Docker 服务 | 复用已有主机，承载业务 API 与初期后台处理 |
| ycore | 同机独立服务 | 多产品公共能力独立发布，不与 ytrader 共用业务表和服务凭据 |
| 数据 | PostgreSQL，按服务/环境分库和用户 | 初期无需图数据库；每份持久化数据有明确归属 |
| 模型入口 | ycore 经 Cloudflare AI Gateway | 产品规则和提示词归 ytrader，统一调用与用量管理归 ycore |

本次只读实查：主机 2 vCPU、约 3.7 GiB 内存、磁盘剩余约 43G，Docker 需 sudo。它适合小规模起步，不能预先保证同时运行多套环境的容量；部署时测量内存，按需启动 staging，不为每个 PR 复制完整后端。

## ycore 经常修改时怎么联调

- 日常开发在本机，公共协议固定版本，双方可用契约样例独立开发。样例不作为用户的真实信息产品。
- 联调默认使用本机或可丢弃隔离环境；服务器有实测余量时才部署一套独立 staging，采用独立库、卷、凭据和域名。资源不足时停止 staging，不能为联调暂停生产批次。生产保持已验证版本，不因本地 ycore 改动自动更新。
- Web 分支预览连接 staging；不得默认连接生产，更不能因预览域名变化就放宽生产权限。
- 破坏性协议升级版本，保留迁移窗口。ytrader 不依赖 ycore 源码目录或直接访问其数据库。
- Render 仅在需要多套并行临时后端、同机资源不足时评估。当前不启用；服务和数据库费用需另获授权。Vercel 是 Web 备选，不作为默认另起一套后端的理由。

## 域名规划

| 环境 | Web | ytrader API | ycore |
| --- | --- | --- | --- |
| 生产 | `ytrader.ydev.work` | `api-ytrader.ydev.work` | `ycore.ydev.work` |
| 联调 | `staging-ytrader.ydev.work` | `staging-api-ytrader.ydev.work` | `staging-ycore.ydev.work` |

只是命名规划，未创建 DNS 或绑定服务。ycore 优先供服务间访问；有域名不代表应向公网开放。

## 运行边界

ytrader/ycore，以及 staging/生产，分别使用容器、环境文件、数据库用户和数据卷。密钥只在服务端，不能进入 Git、镜像或前端变量。初期联调可经 SSH 隧道；公网访问前完成 TLS、个人身份验证及服务认证，CORS 不能代替认证。身份方案以 [架构](ARCHITECTURE.md) 的单用户服务端会话为准：Web安全Cookie/CSRF，iOS的Keychain/Bearer需实际验证；Cloudflare Access只作为可选外层。未完成认证不公开业务接口。

发布使用固定版本，先联调后生产；代码可以回退，数据迁移采用兼容方式，不能靠删库实现回退。持久化生产资料前启用加密异地备份并验证恢复；起步保留 7 日和 4 周备份。当前未配置备份服务或存储桶。

监控、异常处置负责人、恢复演练与真实交付门槛见 [DELIVERY.md](DELIVERY.md)。来源/模型长期权限、预算、iOS签名与机外备份均未核实，不以现有主机和域名代表这些条件已具备。

## 已发生与未发生

旧容器 `ytrader-m2-api` 和 `ytrader-m2-ai-worker` 已按用户单独指令删除，当时核实 4319 不再监听；镜像及绑定目录保留。该清理不代表新版本已经上线。

没有创建新 Pages/Vercel/Render 服务、DNS、数据库或 ycore API。本轮没有应用实现、CI 或发布配置。

平台依据：[Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)、[Vercel 部署](https://vercel.com/docs/deployments/overview)、[Render Preview](https://render.com/docs/preview-environments)、[Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)。这些说明平台能力，不证明当前账号已开通或部署。
