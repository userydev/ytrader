# 产业链结构研究：AI算力、原油、创新药

2026-10-18。研究结论：三个差异明显的产业可以使用同一套轻量结构，但关系必须保留含义。公司参与只说明产业位置；财务和业务贡献属于个股分析。三个实例支持这一方向，尚不足以证明覆盖“大多数产业”。

## 1. 三个实例讲清什么

### AI算力：组成与配套

问题是“模型任务需要什么系统才能运行”。本例从GPU计算部件到服务器、集群运行，再到训练与推理；网络、存储、软件、供电与散热从侧面支撑。GPU和服务器是组成关系，散热和集群是支撑关系，不能把它们依次排成加工流水线。

公司角色只挂到对应节点：NVIDIA提供GPU和DGX服务器，浪潮信息提供AI服务器及管理软件。同一公司可以横跨硬件和软件，不需要先计算业务占比。样例没有据此建立两家公司的交易关系。依据：[NVIDIA架构](https://docs.nvidia.com/dgx-superpod/reference-architecture-scalable-infrastructure-b200/latest/dgx-superpod-components.html)、[机房设计](https://docs.nvidia.com/dgx-superpod/design-guides/dgx-superpod-data-center-design-h100/latest/index.html)、[浪潮产品目录](https://www.ieisystems.com/en/product/ai/index.html)。

本例没有展开芯片设计、制造和封装；这些可以连接共享的半导体产业结构。当前说明的是算力部署主干，不冒充全产业覆盖。数据：[ai-compute.json](examples/industry-structure/ai-compute.json)。

### 原油：投入、加工与分流

问题是“原油怎样成为不同用途的产品”。主干为勘探开发与开采→原油→炼制；炼制分流到燃料、化工原料，再进入不同用途。储运支撑投入和交付，不是原油被加工成的下一种产品。依据：[EIA炼制说明](https://www.eia.gov/energyexplained/oil-and-petroleum-products/refining-crude-oil-the-refining-process.php)。

这个结构解释了为何“原油产业”不能只列油气公司，也不能压成“原油→汽油”：同一加工环节有多种产出。公司样例采用[中国海洋石油有限公司](https://www.cnoocltd.com/gywm/zyzyq/)的勘探开发与生产角色，以及[上海石化产品目录](https://spc.sinopec.com/spc/business/ywgs/A136004005Gone1.shtml)中的燃料和石脑油角色。后者本次采用公开检索返回的官网正文，直开抓取未稳定成功。两家公司共同说明从上游生产到炼制产品的不同位置，不表示双方有采购关系。数据：[crude-oil.json](examples/industry-structure/crude-oil.json)。

### 创新药：研发流程与跨阶段服务

问题是“候选药物如何经过研究和审评，以及谁提供支持”。发现→临床前→临床→审评→获准上市后的使用与监测，表示有条件的流程顺序。各阶段可能终止；它不是把上游材料加工为下游材料的流向。此处使用[FDA流程](https://www.fda.gov/patients/learn-about-drug-and-device-approvals/drug-development-process)作为公开例子，不将其写成中国注册规则。

临床CRO支持临床研究；CDMO可跨临床与商业阶段提供研发制造服务，不能排成“CRO→CDMO→药企”的单向公司链。恒瑞作为药物研发、生产企业挂到相应活动；泰格与凯莱英分别展示服务角色，不暗示三家有具体合作。依据：[恒瑞公司概况](https://www.hengrui.com/about/survey.html)、[泰格临床服务](https://www.tigermedgrp.com/en/solutions/clinical-development)、[凯莱英公开简介](https://www.asymchem.com/investor-relations)。凯莱英本次采用搜索返回的官网正文，直开抓取未稳定取得正文；自动更新入口仍需验证。

商业化生产支撑药品供应，可以提前准备，所以样例没有强制“审评结束才开始制造准备”。不展开具体药品、临床成功率、市场空间和估值。数据：[innovative-drugs.json](examples/industry-structure/innovative-drugs.json)。

## 2. 共用的是结构，不是固定三层图

| 对象 | 三个实例共用的信息 |
| --- | --- |
| 产业范围 | 满足的需求、解释边界、简短主线 |
| 节点 | 稳定ID、名称、产品/活动/服务/应用、一句话作用 |
| 关系 | 起点、终点、语义类型、解释、来源 |
| 公司参与 | 公司身份、所处节点、实际角色、来源 |
| 来源 | 发布者、URL、正文位置、核查日期 |

本轮六种关系为 `input_to` 投入、`produces` 产出、`component_of` 组成、`supports` 支撑、`used_for` 应用、`precedes` 流程先后。它们覆盖三个样例中的关系；替代、循环等以后出现真实需要时再增加，不先建庞大本体。

原始节点之间的关系，才是解释路径。行业分类、上中下游分组和图的排版是导航方式，不替代关系语义。公司表是主数据，公司参与是多对多映射。三份JSON没有收入占比、毛利率、估值或影响评分。

## 3. 开源项目实际怎样得到关系

检查范围为固定提交的源码和样例数据，未运行这些项目。以下记录的是实现机制，项目数据中的公司与产品名称不作为本轮产业事实导入。

### ChainKnowledgeGraph：有用的对象拆分，仍需纠正关系语义

固定提交 `498a21293a7cf50a8438154c4351349c2732fe1e`。

其核心是公司、行业、产品三类对象；公司先连接产品，产品再连接其他产品。这比“行业→股票名单”更接近解释产业的需要。

实际追踪一条记录：`product_product.json`中的“服务器—上游材料→磁盘系统”，经过 `load_data` 读取，再由 `create_relationships_dynamic` 按原始 `rel` 分组，按两端名称匹配后建边。代码没有在这里重新验证“上游材料”的含义，也没有把方向标准化为上游→下游。因此如果沿箭头直接理解，方向就会错；按本轮语义应把磁盘系统视为服务器部件或配套，不能直接继承材料类型。

同一数据样例还有“临床试验—上游材料→EAP临床试验”。这表明“有边”不等于“产业投入关系成立”。README描述过规则抽取思路，但当前建图入口消费的是已经生成的JSON，不能把它当作从公开网页持续采集产业事实的完整自动化流水线。依据：[建图代码](https://github.com/liuhuanyong/ChainKnowledgeGraph/blob/498a21293a7cf50a8438154c4351349c2732fe1e/build_graph.py)、[原始关系](https://github.com/liuhuanyong/ChainKnowledgeGraph/blob/498a21293a7cf50a8438154c4351349c2732fe1e/data/product_product.json)。

采用：公司与产品分开，通过产品连接产业。改进：关系类型、方向、别名和证据在导入前校验。不会把其中的主营权重搬进产业链基础要求，也不把该数据整体导入或分发。

### KAG supplychain：可以追到公司，但推理规则不等于真实因果

固定提交 `fdab15b3929d2ee40dfcdd388f90233096a6afc9`。

真实样例中，产品CSV里的“顺丁橡胶”通过 `hasSupplyChain` 连接轮胎类产品；公司CSV中不同公司通过 `product` 连接这些产品。`indexer.py`把CSV映射为schema对象、向量化并写图。结构可回答“某产品变化会涉及哪些下游产品及参与公司”，并不需要先建立每家公司之间的交易。

事件CSV提供一条价格上涨事件；`concept.rule`沿产品关系找到公司，生成“成本上涨”，再生成“利润下跌”。后一步缺少价格转嫁等条件，不应直接采用为产业解释结论。另一个 `mainSupply` 规则还要求公司资金往来及占比，这类条件不适合作为公共产业骨架的前提。

采用其“产品网络＋公司参与＋事件定位”的分层。事件先定位有关环节，盈利判断留到个股分析；不复制固定传导结论。它的 `CompanyLinkOp` 使用文本检索第一条结果连接主体，提示我们实体归一不能只靠名称相似度自动确认。依据：[Schema](https://github.com/OpenSPG/KAG/blob/fdab15b3929d2ee40dfcdd388f90233096a6afc9/kag/examples/supplychain/schema/SupplyChain.schema)、[规则](https://github.com/OpenSPG/KAG/blob/fdab15b3929d2ee40dfcdd388f90233096a6afc9/kag/examples/supplychain/schema/concept.rule)、[构建入口](https://github.com/OpenSPG/KAG/blob/fdab15b3929d2ee40dfcdd388f90233096a6afc9/kag/examples/supplychain/builder/indexer.py)、[主体匹配](https://github.com/OpenSPG/KAG/blob/fdab15b3929d2ee40dfcdd388f90233096a6afc9/kag/examples/supplychain/builder/operator/company_link_op.py)。

### apple-chain-graph：模板适合组织，不等于逐条事实

固定提交 `aa83b97f2416be58cb3beaea95c08a86c40dbedc`。

`generate.py`定义 `PHONE_COMP` 等产品线部件模板，各产品引用模板，循环生成 `USES_COMPONENT`；另用 `COMP_SUP` 生成部件与供应商关系，再输出CSV和JSON。源码明确说明：模板边不是每一型号都经拆解验证。

这个机制适合复用“系统由什么组成”的解释骨架；模板生成的每条边仍需标明依据层级。不能从“某供应商供应某类部件”进一步自动断言“它供应每款使用这类部件的产品”。采用分层组织方法，不采用未经逐条复核的型号和供应关系。依据：[生成代码及模板说明](https://github.com/Coolgiserz/apple-chain-graph/blob/aa83b97f2416be58cb3beaea95c08a86c40dbedc/scripts/generate.py)。

### CapexGraph：把依据绑定到边

固定提交 `effe3c18ec23983db0a37b5a03acae0040db00aa`。

`SupplyChainEdge`直接保存产品、关系、依据、证据ID与日期，并校验中高置信度边至少有证据ID。对本项目有价值的是“每条关系都能回看依据”。有证据ID仍不证明证据支持该关系，语义核对不能省略。无需为了这点引入其完整公司财务研究模型，也不先增加置信度打分系统。依据：[数据模型](https://github.com/Mrjie7205/CapexGraph/blob/effe3c18ec23983db0a37b5a03acae0040db00aa/src/capexgraph/domain/models.py)。

## 4. 可自动化的部分与真正难点

四个项目共同说明：图数据库解决存储和遍历；产业关系的可靠生成另有工作。现有关系表、手写模板和推理规则都需要核查，不能只换一种展示。

| 输入资料 | 可重复处理的动作 | 仍需判断的地方 |
| --- | --- | --- |
| 行业分类与产品目录 | 提取名称、别名和分类；建立词表 | 分类不能变成物料依赖 |
| 流程资料、技术架构 | 提取活动、组成、投入产出和支撑候选，保留原文位置 | 范围、节点合并、关系类型及方向 |
| 公司官网产品/服务 | 抽取公司→节点→角色并匹配主数据 | 上市主体/集团/子公司身份，是否真实参与 |
| 后续页面版本和新闻 | 比较新增、删除、改名，定位已有节点 | 更新是否改变原关系，是否只是计划或宣传 |

例子：机构资料给出“炼制产出燃料和化工原料”，一次结构化后可被不同公司复用；不必为每家炼厂重做一套产业链。公司目录只补参与角色。这里的维护单位是“节点与关系”，不是每家公司的一份研究报告。

本轮JSON由Codex依据公开资料人工整理，尚未接上自动抽取或定时更新。要验证可扩展性，下一项研究应将同一抽取规则用于三个实例的原始资料，统计语义错误、主体匹配错误和人工修正点；不以JSON能解析代替自动化成功。公共网页可读取也不代表已有稳定接口或可整库再分发。

## 5. 本轮产物与检查

三份JSON统一格式，明确边界，每个节点、关系及公司参与都绑定来源；无公司财务门槛。它们是结构试验，未装入现有主题包或数据库。引用ID、关系端点、关系类型和参与映射由本地检查；关键关系语义由Codex对照上述资料复核。

当前缺口：公司样本未穷举各环节参与者；创新药流程采用美国说明；AI样例不含完整半导体上游；来源自动采集与广泛跨产业覆盖仍未验证。这些限制界定样例用途，不将其包装成成品。
