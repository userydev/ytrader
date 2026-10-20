# 公司基本面数据接口核对（Codex，2026-10-20）

本轮只读请求恒瑞医药 SH:600276 的东方财富公开接口，返回结构如下。该证据仅代表本次样本可访问，不证明全市场覆盖、未来稳定或商业分发许可。使用现有 Network 访问，不增加付费源、用户Key或新供应商授权。

- 指标：`https://emweb.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=SH600276`，data 数组9行。type=0近期累计报告；type=1历史年报（已验证9年）。字段 `SECUCODE=600276.SH`、`SECURITY_CODE=600276`、`REPORT_DATE`、`REPORT_TYPE`、`NOTICE_DATE`、`CURRENCY=CNY`、`ORG_TYPE=通用`，`TOTALOPERATEREVE`收入、`PARENTNETPROFIT`归母净利、`TOTALOPERATEREVETZ`收入同比%、`PARENTNETPROFITTZ`利润同比%、`XSMLL`毛利率%、`ZCFZL`资产负债率%。数值为元，百分比字段本身已经是百分数。
- 资产负债：`https://emweb.eastmoney.com/PC_HSF10/NewFinanceAnalysis/zcfzbAjaxNew?companyType=4&reportDateType=0&reportType=1&dates=2026-06-30&code=SH600276`，data行身份、报告期、币种可核对，`TOTAL_LIABILITIES`、`TOTAL_ASSETS`。companyType=4只验证通用类，不要把它当银行/保险/证券通用参数；特殊类未验证时保留可用指标并标缺少分表。
- 现金流：同一路径 `xjllbAjaxNew?companyType=4&reportDateType=0&reportType=1&dates=2026-06-30,2025-12-31&code=SH600276`，data返回两期；`NETCASH_OPERATE`经营现金流净额，按SECUCODE、REPORT_DATE合并，不按数组位置或顺序合并。
- 收入构成：`https://emweb.eastmoney.com/PC_HSF10/BusinessAnalysis/PageAjax?code=SH600276`，`zygcfx`数组200行；身份、REPORT_DATE、MAINOP_TYPE、ITEM_NAME、MAIN_BUSINESS_INCOME、MBI_RATIO、GROSS_RPOFIT_RATIO。本次样本 MAINOP_TYPE=2 为产品/业务、3 为地区；MBI_RATIO 为0到1的小数占比（如0.902464），UI百分比需乘100。本次 GROSS_RPOFIT_RATIO=0.854096，也是0到1的小数，转成百分比85.4096；不要套用指标接口已是百分数的规则。必须按报告期及MAINOP_TYPE分组，不能把不同分类混合成一个合计。zyfw是工商范围，jyps是经营评述，不是收入构成。

样本文件同目录 `indicators-sample.json`、`annual-sample.json`、`balance-sample.json`、`cashflow-sample.json`、`composition-sample.json`，均为上述公开响应，可供本次开发离线核对但不能注入产品数据库。

实现要求：验证交易所+代码、日期、币种及有限数值；保留0；日期不同不拼成同一期；资产<=0不计算负债率；缺字段、分表失败允许部分数据显示并有warning，不可把缺失当0。同期对比只使用同口径；源同比保留source标识，负基数不自算。缓存有限TTL、失败退避、最后成功数据；证据摘录可追溯来源URL/报告期。远端ycore模式不得回退本地。首次证券为空按现有同步流程，不用静态稿财务数据填库。
