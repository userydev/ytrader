# ytrader

以产业链为核心的中文投资研究工具：阅读重要新闻，理解产业影响，查看参与公司及真实基本面。代码采用 MIT；第三方内容权利见 [THIRD_PARTY.md](THIRD_PARTY.md)。

当前保留的版本统一使用原产业链 UI，主导航为新闻、产业链、个股。产业页右栏切换当前详情、关联新闻和产业解释；公司详情包含总览、财务、业务、新闻与公告。开放产业目录不限于初始跟踪主题，来源记录与 AI 整理分开标示。

## 本地运行

需要 Python 3.12+、Node.js 22+。在仓库根目录安装：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
npm --prefix frontend ci
bash scripts/run-phase1.sh
```

打开 [本地应用](http://127.0.0.1:58730/events)。脚本固定使用 `.local/phase1-20261020/data` 保存数据、`web-dist` 保存构建输出；端口已占用时会退出，不会停止现有实例。其他启动方式与备份见 [运行维护](docs/DEPLOYMENT.md)。

本机 AI 使用 Gemini 3.8 Flash，启动和接入见 [Gemini 桥](docs/AI-LOCAL-GEMINI.md)。ycore 接口已准备，尚未完成真实服务接入；公共来源可用性不作保证。

## 开发与文档

技术栈为 React/TypeScript、原生产业页面、FastAPI、SQLite。`dev` 是开发分支，`main` 是稳定发布分支。

- [文档目录](docs/INDEX.md)：当前产品、架构、接口、算法与数据说明。
- [当前检查点](docs/CHECKPOINT.md)：目标、授权、任务状态和下一步。
- [运行资源](docs/RUNTIME-INVENTORY.md)：现用实例与数据边界。
- [界面规范](DESIGN.md)、[前端开发](frontend/README.md)、[后端开发](backend/README.md)。

```sh
.venv/bin/python -m pytest -q
npm --prefix frontend run build
```

不提交凭据、运行数据库和缓存。旧阶段文档与不可达页面已从当前目录清理，历史可从 Git 查阅。产品范围以重建后确认的约束和最新明确指令为准。
