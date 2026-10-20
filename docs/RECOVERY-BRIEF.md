# 用户实际体验补齐：2026-10-18

用户反馈「怎么做一半不做了，除了有事件，别的什么都没有」。上一交付未达到完整体验。继续原计划，不能把端点/测试通过当完整产品。用户选择自己在设置填写AI；不得读取/复用旧项目.env或凭据。现有预览.local/runtime-v1须保留用户设置。所有旧job已apply/close，不再可续。

## 本轮完成条件
- 主页面直接可达证券、产业、研究；没有选中事件时展示实际数据状态与行动，不留大块空白。
- 行业目录统计完整数据库，点击0/任意行业真正重新取局部数据，不因500节点截断丢公司。
- 证券有真实可用行情、来源和源时间；失败不伪造。
- 多产业真实原创关系包可发现、安装、自动关联事件；不要求用户手写JSON。
- 用户填AI后可测试连接并做真实事件分析，结果可见，失败可诊断。用户没填时呈现明确一步配置，不自造模型分析。

## 新增API契约（原接口保持兼容）
所有返回原envelope。
GET /api/v1/chain/directory?q=：data={items:[{id,label,kind,company_count,relation_count}],totals:{companies,industries,products,segments,relations}}。只列非company节点，统计全部已存数据、不是局部500；q筛label。
GET /api/v1/chain?node_id=：按精确id播种；无此id404。原q/symbol/event_id继续工作。
GET /api/v1/overview：data={counts:{events,securities,relations,industries,products},model_ready:boolean,model_name:string,data_mode,ai_mode,last_sync_at:string|null}。不返回密钥。
GET /api/v1/chain/packages：data=[{id,name,description,version,installed:boolean,node_count,edge_count,source_urls:string[]}]；读取backend/data/packs/*.json合法ChainPackage（无额外字段也可，name=可读id/另manifest），自动导出已安装判断。
POST /api/v1/chain/packages/{id}/install：安装允许目录内本地包，禁任意路径；响应data={id,installed:true}。本地mode；ycore通过原remote契约同path透传。
POST /api/v1/config/test-model：测试已保存AI设置，真实最小调用，data={ok:true,model,latency_ms}；失败适当HTTP+可理解原因、不泄漏key/上游完整body。用户点击才调用；宿主可按用户授权调用。

## 实测源码/源依据
腾讯 https://qt.gtimg.cn/q=sz300750,sh600000,bj920001 和新浪 https://hq.sinajs.cn/list=... 均宿主HTTP200实际数据。GB18030，腾讯行v_sz300750="51~名称~代码~现价[3]~昨收[4]~...~时间[30]=20261016161430~涨跌[31]~幅度[32]..."。时间为Asia/Shanghai转UTC，不使用现在冒充源时间。新浪逗号字段3现价2昨收、30日期31时间。请求Referer https://finance.sina.com.cn。腾讯首选、东方财富备用（现有经常断开会等待25秒），合理缓存避免秒刷且时间明确。新可信公共域加入精确builtin白名单，保持TLS和用户RSS检查。

## 负责人边界
后端Pi：backend/app.py/research.py/adapters.py/models.py + 新modules及tests；不写backend/data/packs（Codex提供），不改DB用户配置，不运行代码。
前端Pi：frontend/src，使用上述契约，不写后端；保持现有设计，不展开另一次视觉提案。真实当前窗口704宽，入口不能仅靠页面最底部。
Codex：公开来源核查、原创产业包、宿主执行、实际用户流程（704/1440/390）、集成、真实AI验收、文档。
