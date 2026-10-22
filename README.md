# ytrader

以产业链为核心的中文投资研究工具：重要新闻 → 产业结构与条件影响 → 参与公司及真实基本面。

产品范围、模块职责及算法规则见[产品说明](docs/PRODUCT.md)。代码采用MIT；第三方权利见[THIRD_PARTY](THIRD_PARTY.md)。

## 运行

需要Python 3.12+、Node.js 22+。首次安装后启动：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
npm --prefix frontend ci
bash scripts/run-phase1.sh
```

现用入口：http://127.0.0.1:58730/events。单进程运行，数据目录为.local/phase1-20261020/data，前端输出为同目录web-dist。端口被占用时脚本退出，不停止已有服务。启动不自动注入示例事实。

通用启动为.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000；开发前端使用npm --prefix frontend run dev。YTRADER_DATA_DIR指定SQLite/keys目录，YTRADER_WEB_DIST只指定前端构建目录。也可使用docker compose up --build -d；普通停止不删除数据卷。

## 模块入口

| 模块 | 实现与数据 |
| --- | --- |
| 产业链与版本维护 | backend/curated_chains.py、industry_research.py、panorama.py；frontend/src/IndustryResearch.tsx及public/industry/ |
| 新闻与更新 | backend/news.py、editorial.py、research.py；frontend/src/Editorial.tsx、news-runtime.tsx |
| 独立算法 | backend/algorithms/；纯计算与服务编排分开，算法版本由registry.py登记 |
| 数据源与适配 | backend/adapters.py、official.py、industry_sources.py、fundamentals.py；来源文件在backend/data/ |
| 公司与证券 | backend/companies.py、profiles.py、fundamentals.py；frontend/src/Securities.tsx及public/industry/company.js |
| AI统一接口 | backend/ai_gateway.py统一调度与校验，ai_providers.py复用Pydantic AI模型SDK；业务模块负责提示词、证据校验和保存；public/shared/ai-settings.js提供共用设置 |
| 基础设施 | backend/app.py为服务组合与API入口；db.py、jobs.py、config.py负责持久化、任务及配置 |
| 机器契约 | backend/contracts/core-v1.schema.json及ai-v1.schema.json；OpenAPI为运行中的/docs，/api/v1/contracts/core与/api/v1/contracts/ai提供机器契约 |
| 自维护产业数据 | data/curated-chains/；manifest及additional-manifest索引精确包，source-snapshots保留原文与哈希 |
| 来源参考资料 | backend/data/panorama、packs、atlas、industries；保留来源身份，不自动提升为已审核事实 |

前端只从同源/api/v1获取业务数据，不从前端静态目录读取产业事实。所有已保存curated_v02链共用节点图；桌面右栏和公司详情属于现有功能。主导航只含新闻、产业链、个股。

## AI、配置与备份

新闻、产业链及个股共用顶栏“AI 设置”。选择Gemini、OpenAI、Claude或其它供应商预设，填写自己的Key和模型，先保存，再按需测试。本机与部署版使用相同设置；Gemini预设直接调用官方API，不使用CLI登录凭据。自定义API支持OpenAI兼容、Gemini原生、Anthropic原生三种协议。预设模型不自动选择，地址可按账号地域和服务文档调整。

供应商协议由Pydantic AI的direct/model接口及官方SDK处理，不运行Agent。打开、切换和保存不会调用模型；Key不回填，留空仅保留同地址、同协议的已存Key，地址或协议改变会清除旧Key。OpenAI兼容高级选项可调整Token字段、temperature与JSON模式。AI设置不更改新闻数据源、同步或自动分析开关。

本阶段先完善ytrader自身的多模型接入，ycore仅预留协议与接口。后续ycore链路为ytrader → ycore → Cloudflare AI Gateway → 供应商。ytrader填写ycore服务地址与服务令牌；Cloudflare和供应商凭据留在ycore服务端。统一AI契约经/api/v1/contracts/ai提供。Cloudflare的/compat模式使用OpenAI兼容SDK并原样传递供应商/模型前缀。当前ycore异步/ycore/v1/model-invocations仍需适配统一契约，保留来源授权、产品认证与预算控制后联调；不能仅填地址就视为接通。

已有自定义连接保持原配置，直到用户明确保存。scripts/gemini_flash_gateway.py仅为已有旧连接保留的兼容工具，不是Gemini官方API预设，不自动迁移其CLI凭据。AI任务绑定配置版本，未知失败不自动重复可能计费调用；request_id不是供应商恰好计费一次的保证。

凭据独立保存在运行数据目录keys.json，权限0600，目录0700；配置读取不返回真实密钥。自动同步按既有配置运行，自动AI分析是否启用由配置决定。不要把数据库、密钥或缓存提交Git。

备份使用SQLite在线backup，或停止本服务后复制完整数据目录（含WAL/SHM和keys）。恢复先放到新目录并核对版本，不能直接以旧库覆盖运行库。依赖目录和运行数据库不属于源码垃圾。

## 检查

```sh
.venv/bin/python -B -m pytest -q
node --test frontend/tests/chain-layout.test.mjs
npm --prefix frontend run build
```

测试样例在tests，运行数据和研究原文保持独立。dev是开发分支，main是稳定发布分支。当前目录不存历史检查点、派工记录、变更日志或重复设计稿。

## 公开版本

GitHub默认分支及公开发布分支为`main`。开发使用本机`dev`；发布前须审查并脱敏，再将选定变更集成到`main`，不得直接推送本机开发目录或同步`dev`。

仅公开代码、产业结构和必要证据摘录。完整来源快照、私人研究标识、数据库、API Key和本机配置不在公开副本中；产业研究包仍是草稿，不会自动入库发布。代码许可不覆盖第三方原文。

本项目当前仅供本地使用，未提供身份认证，切勿将本机API服务直接暴露到公网。各模型使用用户自己的Key；已有CLI兼容工具仅保留旧连接，官方Gemini预设直接调用官方API。
