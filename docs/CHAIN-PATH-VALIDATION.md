# 产业链真实路径与 iFinD 故障定位

2026-10-17。结果：**免费数据的“产品上下游→上市公司”路径已真实执行，并由公司年报核实一条关系；iFinD树接口已恢复，旧名单接口仍失败，但发现了可用的产品关联企业检索。** 这是数据路径验证，不是产品页面或完整产业链数据库交付。订阅继续后置。

## 已跑通的免费路径

`锂辉石 ─原料用于生产→ 碳酸锂 ─生产企业→ 江特电机（002176.SZ）`

直接读取 [ChainKnowledgeGraph](https://github.com/liuhuanyong/ChainKnowledgeGraph) 的既有JSONL，不安装Neo4j、不重新生成全库。固定仓库commit `498a21293a7cf50a8438154c4351349c2732fe1e`，本地实际统计4,654条公司记录、53,785条公司产品关系、110,153条产品关系；最后一项包含分类关系，不能全称上下游。

查询程序只做方向归一、去重和证券代码连接。`下游产品`按from→to、`上游材料`按to→from；产品小类不混入。碳酸锂命中5个上游、1个下游；指定002176.SZ后命中江特电机。锂辉石到碳酸锂的两条反向记录已合并，原始行号均保留：

- `data/product_product.json:56580`、`:57181`：产品上下游。
- `data/company_product.json:24388`：碳酸锂与002176.SZ。
- `data/company.json:3258`：按代码连接公司身份。

外部核验采用[江特电机2025年年度报告](https://static.cninfo.com.cn/finalpage/2026-04-29/1225240831.PDF)：PDF第6页确认证券代码与名称；第11页明确碳酸锂业务及锂辉石原料工艺；第12页说明2025年生产原料全部外购。只核实上述路径，不据此推导具体交易对手、全库正确性或当前营收占比。

**时效与使用边界**：GitHub文件历史显示数据最近提交为2021-10-26，2025-12-22更新的是代码，不能混为数据更新。当前仓库未见LICENSE，尚不能作为项目默认打包再分发的数据集；本次本地研究未复制全库到项目。静态名单里仍有旧简称，来源权重无期间，不能当当前占比。它适合已有数据的候选底图；实际展示需保留数据日期，以当前披露核实公司关系。

复现本次路径（仅Python标准库，无网络请求或额外服务）：

```sh
python3 tools/chain_query.py \
  --dataset /Users/Admin/.codex/research/ytrader-chain-path-20261017/ChainKnowledgeGraph/data \
  --product 碳酸锂 --company-code 002176.SZ \
  --snapshot 498a21293a7cf50a8438154c4351349c2732fe1e
```

[查询脚本](../tools/chain_query.py)接受任意精确产品名和可选公司代码；无匹配明确返回not_found，坏数据报错。输出status=candidate，不把本地行号当外部证据；经年报核实的结果另存`verified-path.json`。

## iFinD：定位到哪一层

继续使用项目已保存的私有配置，无需重新提供key。本轮7次工具查询、1次tools/list；与上一轮4次查询分别记账，实际配额扣减未知。没有自动重试。

| 检查 | 真实结果 | 判断 |
|---|---|---|
| 树目录，`{"name":""}`与`{}`对照 | 两种均成功，31个根、3,719个节点记录、3,704个不同代码 | 旧503本次已恢复，不是必须补name参数；确切短暂故障原因需服务端日志 |
| 电池级碳酸锂节点统计 | 361家企业、24家上市企业 | 节点确实存在；账户和部分企业能力可用 |
| 旧节点企业名单，改用root_code=11294 | 仍在`/industry_chain_api/ic/pro_chain/enter_list_cust`返回内层404 | 与上一轮node_codes=11297结果一致，定位到远端名单查询层；非本地HTTP连接失败 |
| 重新discover企业检索能力 | 找到`filter_get_enterprise_search_by_industry_chain` | 有可用替代检索入口，不能认定与旧列表语义完全等价 |
| 新入口`industry_chain_name=电池级碳酸锂` | 成功但0条 | 空结果，不是错误；不能断言现实中没有相关企业 |
| 新入口`product_service_name=碳酸锂` | 成功，total=752，本次只取5家 | 真实返回兴发集团、川能动力、天奇股份等公司全称；属于产品词关联，未限定上市公司，不能替代24家上市企业的精确列表 |

所有请求的MCP HTTP层返回200，内层状态另行判断。可以确认旧404出现在供应商返回的业务调用结果中；**没有证据将其确定为接口退役、某次发布或权限策略**，不能擅自宣布已修复供应商服务。公开资料未给出可核实的这次故障公告。保留故障请求ID `645b4d7c-5618-42aa-b17a-777a92f0db4c`，便于以后由服务方定位；未向外部发送工单。

可用替代调用的参数（传给kuaicha_tool_call；params_to_tool必须是JSON字符串）：

```json
{
  "tool_id": "filter_get_enterprise_search_by_industry_chain",
  "params_to_tool": "{\"product_service_name\":\"碳酸锂\",\"page\":1,\"page_size\":5,\"total\":true}"
}
```

统一接口须把该结果记为`product_keyword_match`候选关系。精确节点成员、生产该产品、实名供销三种关系不能互相冒充；需要证券代码映射与披露核实后再供策略使用。当前没有实现产品适配器。

## 新增项目实读结果

| 项目 | 已查看的真实资产 | 本轮取舍 |
|---|---|---|
| [ChainKnowledgeGraph](https://github.com/liuhuanyong/ChainKnowledgeGraph) | 全量JSONL及公司/产品连接，已执行并以年报核实一条路径 | 用于本地候选底图验证；2021数据、无明确LICENSE，不默认打包发行 |
| [KGData](https://github.com/chriswangweb/KGData) | MIT LICENSE、产业链product.csv、约23MB Neo4j dump | CSV可补产品分类；README明确上下游对齐不足，未解包验证dump中的公司关系，不声称已跑通其供销路径 |
| [apple-chain-graph](https://github.com/Coolgiserz/apple-chain-graph) | MIT，2026-09-15快照；46个产品、31类零部件、66家供应商、17个基地，完整JSON与CSV | 可直接复用图谱项目和候选数据；677条产品组件边按BOM模板生成，来源多为站点入口。`UTG→蓝思科技`明确写供苹果为推断；不能把存在source字段当作逐边核验 |
| [Serenity-ChainKnowledgegraph](https://github.com/pwu0125/Serenity-ChainKnowledgegraph) | 研究工作者实读enrich_products.py，新增公司产品由行业代码映射模板 | 不采用新增产品边作为事实，不以最近仓库更新时间证明数据准确 |

本轮因此保留“现成图数据→小型查询→原始披露核验”的接入方式，不采用研究草案中“apple-chain-graph每条边均有一手证据”的结论，也不把它选为默认可信数据源。

## 当前选择

免费路线改为直接利用已有结构化关系数据，并用现有公告/主营源补证。ChainKnowledgeGraph已用于真实验证，不能因为静态或原导入脚本有缺陷就误判为无可用数据。公开发行所需的数据授权与更新方式仍待解决；不能把局部成功包装成当前全市场数据库。

iFinD保留为可选自带key来源：树与图谱可取，新企业入口可作为关联检索，旧名单接口暂标不可用。CapexGraph继续仅作可选补证工具，不作为产业链底图或必需服务。ycore、订阅、采购均不成为免费路径前提。

## 本机证据与验收

证据目录：`/Users/Admin/.codex/research/ytrader-chain-path-20261017/evidence`。

- `free-chain-path.json`：全量文件真实查询的原始结果；`path-review.json`：方向、去重、公司连接检查。
- `verified-path.json`：独立年报核验、页码、日期与适用范围；`dataset-counts.json`、`dataset-history.json`：规模与数据历史。
- `ifind-*.json`与`ifind-diagnostics-ledger.json`：实际响应、请求ID和调用记录；无令牌。

Pi实现了小型查询程序，Codex审查并执行真实文件路径；没有部署完整应用或新增常驻服务。未运行与本任务无关的测试。
