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
| 基础设施 | backend/app.py为服务组合与API入口；db.py、jobs.py、config.py负责持久化、任务及配置 |
| 机器契约 | backend/contracts/core-v1.schema.json；OpenAPI为运行中的/docs，/api/v1/contracts/core提供机器契约 |
| 自维护产业数据 | data/curated-chains/；manifest及additional-manifest索引精确包，来源版本哈希与证据摘录保留；本公开副本不附source-snapshots |
| 来源参考资料 | backend/data/panorama、packs、atlas、industries；保留来源身份，不自动提升为已审核事实 |

前端只从同源/api/v1获取业务数据，不从前端静态目录读取产业事实。所有已保存curated_v02链共用节点图；桌面右栏和公司详情属于现有功能。主导航只含新闻、产业链、个股。

## AI、配置与备份

本机Gemini桥为scripts/gemini_flash_gateway.py，固定loopback端口58732和gemini-3.8-flash-medium。启动命令为.venv/bin/python -B scripts/gemini_flash_gateway.py；模型服务配置使用http://127.0.0.1:58732/v1。桥仅接受公共研究上下文，CLI凭据不进入项目；工具调用被拒绝，超限/失败不伪装成功。健康检查不等于模型鉴权或推理成功。ycore适配保留，未声明的能力明确失败。

凭据独立保存在运行数据目录keys.json，权限0600，目录0700；配置读取不返回真实密钥。自动同步按既有配置运行，自动AI分析是否启用由配置决定。不要把数据库、密钥或缓存提交Git。

备份使用SQLite在线backup，或停止本服务后复制完整数据目录（含WAL/SHM和keys）。恢复先放到新目录并核对版本，不能直接以旧库覆盖运行库。依赖目录和运行数据库不属于源码垃圾。

## 检查

```sh
.venv/bin/python -B -m pytest -q
node --test frontend/tests/chain-layout.test.mjs
npm --prefix frontend run build
```

测试样例在tests，运行数据和研究原文保持独立。dev是开发分支，main是稳定发布分支。当前目录不存历史检查点、派工记录、变更日志或重复设计稿。

## 公开副本说明

数据与 AI 默认使用 local 模式；ycore 仅在用户显式配置后启用。运行数据库与个人凭据不在仓库中。
Gemini 本机桥需要用户自行安装 agy 并完成认证，仅限本机使用；仓库不提供其凭据。
本项目仅供本地使用，未提供身份认证，切勿直接暴露到公网。
25 条已研究产业链包均为研究草稿，不会自动发布或注入数据库；本副本不附原文快照及私有研究标识。
证据摘录、已记录的公开原始来源 URL 与真实来源版本保留；来源版本不代表本次重新采集。
