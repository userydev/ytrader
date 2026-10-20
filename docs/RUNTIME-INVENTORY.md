# 运行资源与整理结果

2026-10-20，已按当前进程命令、监听端口和目标目录核对。PID仅是本次快照，后续操作须重新核对，不能直接照抄kill。

## 最近登记（当前状态见下表）

| 端口 / 本次PID | 用途 | 目录与边界 |
| --- | --- | --- |
| 58730 / 97944 | 核心功能统一应用，当前交付入口 | 当前仓库`.local/phase1-20261020/{data,web-dist}`；启动`bash scripts/run-phase1.sh`，前台Ctrl-C停止；沿用第一阶段隔离数据，本轮更新代码前已备份 |
| 58732 / 90506 | 固定Gemini 3.8 Flash桥 | 当前仓库 `scripts/gemini_flash_gateway.py`；启动 `.venv/bin/python -B scripts/gemini_flash_gateway.py`，复用已有agy登录；只绑定回环地址 |
| 8000 / 旧84699（末次无监听） | 原业务服务与已有设置 | 当前仓库，先前记录数据目录`.local/runtime-v1`；本次未读取凭据或重启 |
| 58700 / 旧26940（末次无监听） | 产业与个股桌面稿 | `/Users/Admin/Documents/Codex/2026-10-19/ytrader-stock-profile/preview` |
| 58720 / 旧72648（末次无监听） | 当前新闻推荐 | `/Users/Admin/Documents/Codex/2026-10-20/ytrader-editorial-radar/runtime-news`与`web-dist` |
| 58721 / 旧71037（末次无监听） | 当前新闻到产业桥接 | `/Users/Admin/Documents/Codex/2026-10-20/ytrader-editorial-radar/industry-site` |

新闻58720仍每5分钟仅采集新闻；auto_analyze关闭，rules提供器，无复制的模型/ycore密钥。本轮不改变这些设置。8000的实际设置和用户输入保持原样，不从旧记录推断密钥状态。

最新新闻服务可通过现有脚本启动（仅在确认58720未监听时）：

```bash
/Users/Admin/Documents/Codex/2026-10-20/ytrader-editorial-radar/run-news.sh
```

静态预览可用表中实际目录启动`python3 -m http.server <端口> --bind 127.0.0.1 --directory <目录>`。不需要重建前端，不覆盖原`frontend/dist`。停止服务时先核对`lsof`与`ps`，再只对匹配进程发TERM。

## 已停止的过期预览

以下进程均先核对实际身份，再TERM；随后确认端口已停止监听。源目录、截图、数据库和运行证据未删除。

| 端口 | 原用途/目录 | 状态 |
| --- | --- | --- |
| 58620 | `/Users/Admin/Documents/Codex/2026-10-18/industry-chain-studies` | 已停止 |
| 58630 | `/Users/Admin/Documents/Codex/2026-10-18/ytrader-product-rethink/site` | 已停止 |
| 58640 | `/Users/Admin/Documents/Codex/2026-10-18/ytrader-desktop-chain/site` | 已停止 |
| 58650 | `/Users/Admin/Documents/Codex/2026-10-18/ytrader-industry-panorama/site` | 已停止 |
| 58660 | `/Users/Admin/Documents/Codex/2026-10-19/ytrader-panorama-workspace/preview` | 已停止 |
| 58670 | `/Users/Admin/Documents/Codex/2026-10-19/ytrader-panorama-event-map/preview` | 已停止 |
| 58680 | `/Users/Admin/Documents/Codex/2026-10-19/ytrader-panorama-inspector/preview` | 已停止 |
| 58690 | `/Users/Admin/Documents/Codex/2026-10-19/ytrader-panorama-layers/preview` | 已停止 |
| 58710 | `/Users/Admin/Documents/Codex/2026-10-19/ytrader-news-radar（上一RSS首页）` | 已停止 |

旧58710数据库保留。若需恢复，先读旧NEWS-VALIDATION的独立data/web-dist和NEWS_ONLY配置，不能只启动裸uvicorn而意外使用默认库。旧静态服务可按原目录恢复；58620此前使用随机端口启动，原输出已留存，不保证恢复时仍分配相同端口。

清理前命令与停止证据：`.local/handoff-20261020/processes-before-cleanup.json`、`process-cleanup.json`。这是运行资源整理，不是Git清理；没有删除源码、历史目录、依赖、缓存、数据或密钥。

第一阶段完成后再次核对：五端口HTTP200，四个原服务PID未变，原frontend/dist哈希未变。证据见PHASE1-VALIDATION。

用户要求恢复原产业链视图后：58730的`/chain`现进入同源`/industry/index.html`，源为项目`frontend/public/industry`中的58721原稿副本，样式与数据不变。仅适配新闻接口和返回路径；原58700/58721未修改，58730后端PID80085也未重启。

核心版已更新58730，旧PID80085身份核对后停止，当前88964；旧四服务PID保持且HTTP200，原构建与产业数据哈希未变。58731仅用于隔离验证，现已停止。Gemini配置只改58730的三个字段；启动说明与证据见CORE-VALIDATION。上述PID为快照，后续须重新核对。


2026-10-20产品收束：58730更新为97944，58732仍90506；其他四旧PID已不在且端口无监听，原因未查明，本轮未停止也未恢复。历史状态不表示当前运行。原文件哈希无变化。


## 2026-10-20 开放产业质量修复后

正式58730更新为PID478，原正式数据目录不变；97944已正常停止。Gemini桥58732 PID90506未改。隔离验证58731 PID248已停止。更新前SQLite备份与源文件哈希核对见CHAIN-QUALITY-STATUS；任何后续进程操作前重新核对实际身份。
