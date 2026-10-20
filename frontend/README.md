# ytrader 前端

React / TypeScript / Vite 负责入口、新闻和证券目录；`public/industry/` 保留产业画布及公司四 Tab，`public/shared/` 提供共享导航与研究组件。所有业务请求使用同源 `/api/v1`。

## 开发

需要 Node.js 22+。先在仓库根目录启动后端（默认8000），再运行：

```sh
npm ci
npm run dev
```

Vite 默认5173，将 `/api/v1` 代理到8000。`npm run build` 执行类型检查和构建；`npm run preview` 查看构建结果。完整同源预览使用根目录的 `bash scripts/run-phase1.sh`，端口58730。

主入口为 `src/main.tsx`、`src/App.tsx`；新闻为 `src/Editorial.tsx`，证券目录为 `src/Securities.tsx`。产业页面通过真实文档导航打开，不嵌 iframe。设计见 [界面规范](../DESIGN.md)，API见 [核心接口](../docs/CORE-INTERFACES.md)。

内容保留来源、时间、报告期与缺失状态。未知数据不补示例值；规则推断不当作已核实事实。开发构建不能覆盖正在提供服务的静态目录；使用独立输出目录验证。
