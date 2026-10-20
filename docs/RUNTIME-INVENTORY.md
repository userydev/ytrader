# 当前运行资源

2026-10-20清理时核对。PID只是快照，操作前须重新确认监听端口、启动参数和工作目录。

| 入口 | 用途 | 运行位置 |
| --- | --- | --- |
| `http://127.0.0.1:58730/events` | 新闻、产业链、个股统一应用；本次PID478 | `.local/phase1-20261020/data`、`web-dist`；`bash scripts/run-phase1.sh` |
| `http://127.0.0.1:58732/health` | 固定Gemini 3.8 Flash本机桥；本次PID90506 | `scripts/gemini_flash_gateway.py`；配置与限制见[桥说明](AI-LOCAL-GEMINI.md) |

当前应用保持运行，清理无需重启。58730端口已占用时启动脚本会退出；不要另启实例占用同一数据目录。停止时只操作核实后的本实例，禁止按通用进程名批量终止。

`.local/runtime-v1`保存旧真实用户数据，`.local/config`与`.env.local`可能含本机配置，均保留且不提交Git。`.venv`和`frontend/node_modules`是运行/开发依赖。

旧预览、验证副本、截图、日志与缓存从项目目录移除；当前入口不再引用历史端口。其它项目和仓库外资料不在本次清理范围。备份方法见[运行维护](DEPLOYMENT.md)。
