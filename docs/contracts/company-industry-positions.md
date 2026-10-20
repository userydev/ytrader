# 公司产业位置与研究回答（增量读契约）

## 当前页批量位置

`GET /api/v1/securities/positions?symbols=SZ:300750,SH:600000`

- 1–24 个唯一、精确的 `SH|SZ|BJ:六位代码`，返回标准 envelope。
- `data={items:[{symbol,status,roles,warnings}],version}`；没有映射返回空 roles，不按名称或粗行业猜位置。
- role：`industry_id,industry_name,node_id,node_name,role,kind,origin,source_kind,as_of,sources,source_record? ,result_id?,offset? ,summary?`。
- `kind=classification` 为分类，`node_id=null`，打开分类页，不传不存在的产品节点。
- `kind=business` 为 CKG 主营关联，打开实际产品产业 ID + 产品节点；`offset` 为该公司所在40项记录分页。不是公司间交易或当前占比。
- `kind=position` 为来源图中的位置；`kind=ai` 为已保存 AI 角色。AI 回答角色必须携带 `result_id` 打开对应图，不能套入基础图或其他回答。
- `sources` 保留历史出处；CKG `source_record` 包含 file/line/snapshot/commit，Atlas 保留 MIT 归属。证券身份与产业角色证实程度分开。
- `version` 是保存研究序号，不是证券市场覆盖或来源核验版本。原图/包内快照与可选外部索引随进程缓存，不在每家公司读取时重扫全部业务表。

`GET /api/v1/securities/{symbol}/industries` 增量包含单公司 `symbol,roles,status,warnings`，并保留旧 `items`。

## 保存研究复用与回答选择

`GET /api/v1/industry-research/resolve?name=...&source_id=...` 返回 `{existing:null|{id,name,...}}`。有来源时按同名/同源规范 ID 查找，不把其他来源的同名生成冒充本来源研究。

`POST /api/v1/industry-research/generate` 命中已有结果返回 `{status:"cached",industry_id,target_url,message}`；否则仍为已有后台 Job。无论是否命中，调用方保留自己的 news/progress/return，不从旧新闻任务迁移上下文。

`POST /api/v1/industries/{id}/supplement {question}` 仍使用既有任务、基础版本与输出校验。回答独立存储，问题、模型与时间保留。

`GET /api/v1/panorama/{id}?result=base|result-<job-id>&offset=...`

- AI 产业未指定 result：最新有效回答（若有），否则基础解释。
- 原五图未指定或 result=base：保持原来源图；指定回答才进入该 AI 回答。
- 生成图保留完整 explanation；`research={base_version,selected_result,question,results:[{id,question,created_at,model}]}` 给原页切换已保存回答。来源型生成另保留 source_id 指向未改写的来源图。
- 过期/不存在的明确 result 返回错误，不替换成其他回答。
- `version` 为当前选定资料/回答身份，不因新闻选择而改变。AI 与来源记录保持区分。

影响接口 `GET|POST /api/v1/industry-research/{id}/impact?news=...&progress=...&result=...&offset=...` 必须与正在显示的 panorama 使用相同 result/offset。缓存输入继续绑定新闻内容和该图 version；保留 source_version 与真实 node_ids 校验。

## 新闻读取

推荐候选的原 evaluate/diversify 不消费宽关联；仅选中条目增强关联/条件影响，详情读取按需增强。推荐证据、排序和多样性不改，未缩小产业目录或新闻候选窗口。
