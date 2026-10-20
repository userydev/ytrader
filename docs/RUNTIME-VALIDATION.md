# 现成服务与真实数据验证

> 后续实测已更新：[产业链路径与iFinD诊断](CHAIN-PATH-VALIDATION.md)。免费关系数据到江特电机已执行并以年报核实；树503已恢复，旧名单404仍在，新产品企业检索成功。以下保留首轮服务验证记录。

2026-10-17。范围：隔离启动 Miniflux、AKTools、CapexGraph；少量 iFinD 查询；核查免费产业链入口。没有实现产品业务、购买订阅或部署远端。单次成功只证明本次接口可用，不证明长期稳定或全市场覆盖。

## 结果与选型调整

| 组件 | 本次真实结果 | 决定 |
|---|---|---|
| Miniflux 2.3.3 + PostgreSQL 17.6 | 中新网财经、美联储货币政策 RSS 抓取成功；`feeds` 无解析错误，`entries` 返回45条 | 保留为新闻采集服务；更新与故障恢复尚未做持续验证 |
| AKTools 0.0.91 / AKShare 1.19.1 | 华润微财务摘要80行、主营构成200行；腾讯日K返回2026-10-08至16日的7条记录 | 保留为可替换连接层，按实际数据源选择接口，不能把整个库视为稳定供给 |
| AKTools 的东财接口 | 概况与日K均因上游断连返回500；去除错误的字符串timeout参数后仍失败 | 当前不作为已验证可用入口，不把失败记成空数据 |
| CapexGraph 0.5.1 | 健康接口、创建空run、CNINFO公告发现成功；正文抓取被本机代理fake-IP触发的SSRF防护拦截 | 降为可选材料发现/补证工具，不作默认产业链数据源或首版必需服务 |
| iFinD MCP | 接口发现和碳酸锂图谱成功；树目录503；节点上市企业列表404 | 可选自带key来源。当前未通过完整产业链到公司路径验收，不因收费就判定稳定 |

AKTools 的成功请求：

```text
GET /api/public/stock_financial_abstract?symbol=688396
GET /api/public/stock_zygc_em?symbol=SH688396
GET /api/public/stock_zh_a_hist_tx?symbol=sh688396&start_date=20261001&end_date=20261016&adjust=
```

腾讯样本为不复权日K。函数输出成交量、成交额、换手率等字段，接入仍须映射原始单位；单次响应不证明跨源口径等价。新浪财务摘要是宽表，不等于完整财报或历史时点数据库。

## 产业链数据查实

**iFinD真实样本**：`filter_get_industry_chain_atlas` 查询节点`11294`返回“碳酸锂”：上游为空；下游1个节点“铌酸锂”；包含关系为“电池级碳酸锂、医用碳酸锂、工业级碳酸锂”。包含关系不能改成上下游；空上游不能解释成现实中不存在上游。返回中未见逐边出处、证据或更新时间，覆盖完整性未知。

同一次验证，树目录`filter_get_industry_chain_tree_structure`返回内层503；对电池级碳酸锂`11297`查`filter_get_industry_chain_enterprise_list`，返回内层404，路径为`/industry_chain_api/ic/pro_chain/enter_list_cust`。MCP外层`isError=false`、`code=1`不能覆盖内层失败。不能据此宣称账户无权，也不能声称已获得上市企业列表或实名供应商/客户明细。以上图谱数据来源于同花顺旗下快查企业数据引擎。

**免费入口**：直接读取东方财富宁德时代`BusinessAnalysis/PageAjax?code=SZ300750`成功，包含主营构成、报告期和经营评述。2026-06-30报告期下有动力电池系统、储能电池系统等产品及营收占比；经营评述含实名合作方和客户提及。主营构成可证明业务参与，文字中的合作、客户与投资关系须分别识别，不能统一写成供应关系。同行业排名和概念标签不是上下游数据。

本轮未核实到可直接作为默认源的免费、持续、全市场结构化产业链API。[A股数据API的产业链接口](https://ashareapi.com/docs/endpoints/industry-chain/)标为付费，不能替代默认免费方案。CapexGraph是生成与取证工具，也不附送持续产业链数据库。

因此，**ytrader独立运行且默认有免费产业链仍是未完成的硬目标**。本轮完成的是数据入口核验，不能据此宣布完整产品或免费链路径已可用。下一步应先取得明确范围、有出处、可更新的免费关系数据并跑通“环节→公司”；不拿行业标签凑数，也不把ycore变为隐性必需依赖。

## CapexGraph 的实际边界

固定源码`effe3c18ec23983db0a37b5a03acae0040db00aa`。CNINFO发现返回华润微的真实公告；初次限定“年报”为空，是适配器先截取最新条目再按标题筛选，不能推断该公司没有年报。取消该筛选后取得3条公告。

PDF抓取报`Private or loopback evidence URLs are blocked`。本机将巨潮域名解析为`198.18.x.x`虚拟地址，触发其安全校验；没有关闭防护，也没有把fixture当真实数据。完整模型生成、证据审核、跨run归并和恢复均未验证。

## 已保存的本地 iFinD 配置

- ytrader：`.local/config/ifind-mcp.json`，包含官方金融、快查两个MCP服务。
- ycore：同相对路径链接到ytrader的同一私有文件，避免两份密钥漂移。
- 两项目的`.env.local`均设置`IFIND_MCP_CONFIG`绝对路径；复用现有凭据，不再向用户重复索取。CLI需显式加载此文件，例如在ycore执行`node --env-file=.env.local --import tsx src/content/cli.ts …`。当前不自动启动采集。
- 私有目录0700、凭据和环境文件0600；两项目Git忽略规则已核对。项目文档只记录路径，不写令牌。现有`loadMcpConfig`已读取成功。
- 后续初始化先读本节及私有配置；仅在凭据确实失效时请求用户更新。不得复制令牌进源码、日志、前端或公开仓库。

## 证据与资源

本机证据目录：`/Users/Admin/.codex/research/ytrader-runtime-data-20261017/evidence`。包含原始响应、版本与摘要、iFinD调用记录。iFinD本轮共发出4次工具查询（发现、树、图谱、企业），失败仍记为尝试，实际扣减以账户用量为准。

验证结束已关闭任务自有服务：Miniflux及其Postgres容器、AKTools进程组、CapexGraph进程组；18081–18083无监听。保留安装目录、证据和Miniflux数据卷供后续复现。没有供用户验收的运行预览；既有共享服务未停止。
