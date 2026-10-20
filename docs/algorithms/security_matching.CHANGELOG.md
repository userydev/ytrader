# security_matching CHANGELOG

## 1.0.0 · 2026-10-20
- 从 Research 提取目录编译与文本匹配为纯函数，保留名称至少两字符、代码数字边界和原 symbol。
- matcher 生命周期仍限定单次操作；持久化、INSERT OR IGNORE 与 reindex 行为留在 Research。
- 输出影响：无意图改变原匹配集合，不增加模糊名称/跨行业关联；新版本发现为附加能力。
- 此版本记录抽取基线，不虚构更早独立模块历史。
