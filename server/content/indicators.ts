import { randomUUID } from 'node:crypto';
import type { Pool } from '../db.js';
import { ApiError } from '../auth.js';
import {
  type IndicatorCategory,
  type IndicatorRegistryItem,
  type IndicatorSnapshotValue,
  type MainbzItem,
  type CompanyProfileResponse,
  type FetchRunStatus,
  type SystemStatusResponse,
  SystemStatusResponseSchema,
  IndicatorRegistryResponseSchema,
  CompanyProfileResponseSchema,
} from '../../src/contracts/index.js';

// In-memory store for runs and snapshots to ensure reliability when DB is optional or offline
const MEMORY_RUNS = new Map<string, FetchRunStatus>();
const MEMORY_PROFILES = new Map<string, CompanyProfileResponse>();

// ---------------------------------------------------------------------------
// 40 Authoritative PIT Indicators in Registry
// ---------------------------------------------------------------------------
export const INDICATOR_REGISTRY: IndicatorRegistryItem[] = [
  // 1. 估值与壳修正 (1-6)
  {
    key: 'total_mv',
    name: '总市值',
    category: 'valuation',
    unit: '亿元',
    formula: '当日收盘价 × 总股本',
    raw_inputs: ['腾讯行情收盘价', '最新总股本'],
    frequency: 'daily',
    pit_rule: '交易日收盘时点生效',
    higher_is_better: null,
    not_applicable_industries: [],
    used_by_strategies: ['value_ep_industry', 'quality_fscore_gpa'],
  },
  {
    key: 'ep_ttm',
    name: '盈利收益率 (E/P TTM)',
    category: 'valuation',
    unit: '%',
    formula: 'TTM 归母净利润 / 总市值',
    raw_inputs: ['东财利润表 PARENT_NETPROFIT TTM', '总市值'],
    frequency: 'daily',
    pit_rule: '报告期披露公告次一交易日生效 + 每日市值',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['value_ep_industry', 'quality_fscore_gpa'],
  },
  {
    key: 'ep_deduct_ttm',
    name: '扣非盈利收益率',
    category: 'valuation',
    unit: '%',
    formula: 'TTM 扣非归母净利润 / 总市值',
    raw_inputs: ['东财利润表 DEDUCT_PARENT_NETPROFIT TTM', '总市值'],
    frequency: 'daily',
    pit_rule: '报告期披露公告次一交易日生效 + 每日市值',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['value_ep_industry'],
  },
  {
    key: 'bp_mrq',
    name: '账面市值比 (B/P MRQ)',
    category: 'valuation',
    unit: '倍',
    formula: '最新报告期归母净资产 / 总市值',
    raw_inputs: ['东财资产负债表 TOTAL_PARENT_EQUITY', '总市值'],
    frequency: 'daily',
    pit_rule: '报告期披露公告次一交易日生效 + 每日市值',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['value_ep_industry'],
  },
  {
    key: 'is_st_risk',
    name: 'ST/*ST 风险警示',
    category: 'valuation',
    unit: 'flag',
    formula: '证券简称是否含 ST 或 *ST 风险警示标记 (1=风险, 0=正常)',
    raw_inputs: ['证券简称'],
    frequency: 'daily',
    pit_rule: '每日交易日开市前生效',
    higher_is_better: false,
    not_applicable_industries: [],
    used_by_strategies: ['value_ep_industry', 'financial_redflags'],
  },
  {
    key: 'shell_size_flag',
    name: '小微盘壳污染',
    category: 'valuation',
    unit: 'flag',
    formula: '总市值 ≤ 35 亿元 (A股全市场后 30% 壳污染区标记)',
    raw_inputs: ['总市值'],
    frequency: 'daily',
    pit_rule: '交易日市值判断',
    higher_is_better: false,
    not_applicable_industries: [],
    used_by_strategies: ['value_ep_industry'],
  },

  // 2. 盈利质量与成长 (7-13)
  {
    key: 'roe_jq',
    name: '加权净资产收益率 (ROE)',
    category: 'profitability',
    unit: '%',
    formula: '当期归母净利润 / 加权平均净资产',
    raw_inputs: ['东财主要指标 ROEJQ'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'roa_net',
    name: '总资产净利率 (ROA)',
    category: 'profitability',
    unit: '%',
    formula: '当期净利润 / 期末总资产',
    raw_inputs: ['东财利润表 PARENT_NETPROFIT', '东财资产负债表 TOTAL_ASSETS'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'roic',
    name: '投入资本回报率 (ROIC)',
    category: 'profitability',
    unit: '%',
    formula: '息税前利润 (EBIT) × (1 - 实际税率) / 投入资本',
    raw_inputs: ['东财主要财务指标 ROIC'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'gross_margin',
    name: '销售毛利率',
    category: 'profitability',
    unit: '%',
    formula: '(营业总收入 - 营业成本) / 营业总收入',
    raw_inputs: ['东财利润表 TOTAL_OPERATE_INCOME', 'OPERATE_COST'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'gpa',
    name: '毛利总资产比 (GP/A)',
    category: 'profitability',
    unit: '%',
    formula: 'TTM (营业总收入 - 营业成本) / 平均总资产',
    raw_inputs: ['东财利润表 TTM 毛利', '东财资产负债表 Avg TOTAL_ASSETS'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'rev_yoy',
    name: '营业总收入增速',
    category: 'profitability',
    unit: '%',
    formula: '(当期营收 - 上年同期营收) / 上年同期营收',
    raw_inputs: ['东财利润表 TOTAL_OPERATE_INCOME'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'np_parent_yoy',
    name: '归母净利润增速',
    category: 'profitability',
    unit: '%',
    formula: '(当期归母净利润 - 上年同期归母净利润) / 上年同期归母净利润',
    raw_inputs: ['东财利润表 PARENT_NETPROFIT'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },

  // 3. Piotroski F-Score 9项 (14-23)
  {
    key: 'fscore_roa_pos',
    name: 'F1: ROA > 0',
    category: 'fscore',
    unit: '分',
    formula: '当期总资产净利率 (ROA) > 0 时计 1 分，否则 0 分',
    raw_inputs: ['东财资产负债表与利润表 ROA'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'fscore_cfo_pos',
    name: 'F2: CFO > 0',
    category: 'fscore',
    unit: '分',
    formula: '当期经营现金流净额 (CFO) > 0 时计 1 分，否则 0 分',
    raw_inputs: ['东财现金流量表 NETCASH_OPERATE'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'fscore_delta_roa',
    name: 'F3: ROA 同比提升',
    category: 'fscore',
    unit: '分',
    formula: '当期 ROA > 上年同期 ROA 时计 1 分，否则 0 分',
    raw_inputs: ['ROA(t)', 'ROA(t-4)'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'fscore_cfo_gt_np',
    name: 'F4: 现金流优于利润',
    category: 'fscore',
    unit: '分',
    formula: '当期经营现金流净额 (CFO) > 归母净利润 (NP) 时计 1 分',
    raw_inputs: ['东财现金流量表 NETCASH_OPERATE', '东财利润表 PARENT_NETPROFIT'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'fscore_delta_lever',
    name: 'F5: 资产负债率未恶化',
    category: 'fscore',
    unit: '分',
    formula: '当期资产负债率 ≤ 上年同期资产负债率时计 1 分',
    raw_inputs: ['资产负债率(t)', '资产负债率(t-4)'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'fscore_delta_curr',
    name: 'F6: 流动比率同比改善',
    category: 'fscore',
    unit: '分',
    formula: '当期流动比率 > 上年同期流动比率时计 1 分',
    raw_inputs: ['流动比率(t)', '流动比率(t-4)'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'fscore_no_eq_iss',
    name: 'F7: 近一年未稀释股权',
    category: 'fscore',
    unit: '分',
    formula: '过去 12 个月内未实施增发或配股新股时计 1 分',
    raw_inputs: ['东财 BonusFinancing zfmx / pgmx'],
    frequency: 'event',
    pit_rule: '发行上市披露日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'fscore_delta_gm',
    name: 'F8: 销售毛利率同比改善',
    category: 'fscore',
    unit: '分',
    formula: '当期销售毛利率 > 上年同期销售毛利率时计 1 分',
    raw_inputs: ['毛利率(t)', '毛利率(t-4)'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'fscore_delta_turn',
    name: 'F9: 资产周转率提升',
    category: 'fscore',
    unit: '分',
    formula: '当期总资产周转率 > 上年同期总资产周转率时计 1 分',
    raw_inputs: ['营业收入 / 平均总资产 (t vs t-4)'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['quality_fscore_gpa'],
  },
  {
    key: 'fscore_total',
    name: 'F-Score 综合得分',
    category: 'fscore',
    unit: '分',
    formula: 'Piotroski 9 项财务改善信号求和 (0~9 分)',
    raw_inputs: ['F1..F9 得分累加'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['quality_fscore_gpa'],
  },

  // 4. 现金流与财务红旗 (24-29)
  {
    key: 'cfo_to_np',
    name: '净现比 (CFO / NP)',
    category: 'cashflow_redflag',
    unit: '倍',
    formula: 'TTM 经营现金流净额 / TTM 归母净利润',
    raw_inputs: ['TTM NETCASH_OPERATE', 'TTM PARENT_NETPROFIT'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: ['financial_redflags'],
  },
  {
    key: 'sloan_accrual',
    name: 'Sloan 应计比率',
    category: 'cashflow_redflag',
    unit: '%',
    formula: '(TTM 归母净利润 - TTM 经营现金流净额) / 平均总资产',
    raw_inputs: ['TTM PARENT_NETPROFIT', 'TTM NETCASH_OPERATE', 'Avg TOTAL_ASSETS'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: false,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['financial_redflags'],
  },
  {
    key: 'debt_ratio',
    name: '资产负债率',
    category: 'cashflow_redflag',
    unit: '%',
    formula: '期末总负债 / 期末总资产',
    raw_inputs: ['东财资产负债表 TOTAL_LIABILITIES', 'TOTAL_ASSETS'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: false,
    not_applicable_industries: [],
    used_by_strategies: ['financial_redflags'],
  },
  {
    key: 'current_ratio',
    name: '流动比率',
    category: 'cashflow_redflag',
    unit: '倍',
    formula: '流动资产合计 / 流动负债合计',
    raw_inputs: ['东财资产负债表 流动资产 / 流动负债'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: true,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['financial_redflags'],
  },
  {
    key: 'ar_turnover_days',
    name: '应收账款周转天数',
    category: 'cashflow_redflag',
    unit: '天',
    formula: '360 × 平均应收账款 / TTM 营业收入',
    raw_inputs: ['东财资产负债表 应收账款', '东财利润表 营业收入'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: false,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['financial_redflags'],
  },
  {
    key: 'inv_turnover_days',
    name: '存货周转天数',
    category: 'cashflow_redflag',
    unit: '天',
    formula: '360 × 平均存货 / TTM 营业成本',
    raw_inputs: ['东财资产负债表 存货', '东财利润表 营业成本'],
    frequency: 'quarterly',
    pit_rule: '财报披露公告次一交易日生效',
    higher_is_better: false,
    not_applicable_industries: ['银行', '保险', '证券', '非银金融'],
    used_by_strategies: ['financial_redflags'],
  },

  // 5. 股东回报分红 (30-33)
  {
    key: 'dividend_yield_ttm',
    name: '股息率 (TTM)',
    category: 'dividend',
    unit: '%',
    formula: '近 12 个月现金分红总额 / 最新总市值',
    raw_inputs: ['东财 lnfhrz TOTAL_DIVIDEND', '总市值'],
    frequency: 'daily',
    pit_rule: '分红公告实施日生效 + 每日市值',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
  {
    key: 'dividend_streak_years',
    name: '连续分红年数',
    category: 'dividend',
    unit: '年',
    formula: '历史上连续实施现金分红的年数序列',
    raw_inputs: ['东财 lnfhrz 历年分红记录'],
    frequency: 'event',
    pit_rule: '历史公告序列',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
  {
    key: 'payout_ratio',
    name: '股利支付率',
    category: 'dividend',
    unit: '%',
    formula: '年度现金分红总额 / 年度归母净利润',
    raw_inputs: ['TOTAL_DIVIDEND', 'PARENT_NETPROFIT'],
    frequency: 'quarterly',
    pit_rule: '财报与分红披露日生效',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
  {
    key: 'shareholder_yield',
    name: '综合股东收益率',
    category: 'dividend',
    unit: '%',
    formula: '股息率(TTM) + 股票回购收益率 - 股权净融资稀释率',
    raw_inputs: ['股息率', '回购金额', '增发募集金额'],
    frequency: 'daily',
    pit_rule: '综合 PIT 审计',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: [],
  },

  // 6. 市场风险与动量 (34-40)
  {
    key: 'vol_252d',
    name: '年化波动率 (252日)',
    category: 'volatility_momentum',
    unit: '%',
    formula: '前复权日对数收益率样本标准差 × √252',
    raw_inputs: ['腾讯前复权日 K 线 252 交易日收盘价'],
    frequency: 'daily',
    pit_rule: '交易日盘后更新',
    higher_is_better: false,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
  {
    key: 'downside_vol_252d',
    name: '下行波动率 (252日)',
    category: 'volatility_momentum',
    unit: '%',
    formula: '负收益日样本标准差 × √252',
    raw_inputs: ['腾讯前复权日 K 线 负收益日序列'],
    frequency: 'daily',
    pit_rule: '交易日盘后更新',
    higher_is_better: false,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
  {
    key: 'beta_252d',
    name: '沪深300相对 Beta',
    category: 'volatility_momentum',
    unit: '倍',
    formula: '标的日收益率与沪深300日收益率之协方差 / 沪深300方差',
    raw_inputs: ['标的前复权日K线', '沪深300日K线'],
    frequency: 'daily',
    pit_rule: '交易日盘后更新',
    higher_is_better: null,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
  {
    key: 'max_drawdown_252d',
    name: '近1年最大回撤',
    category: 'volatility_momentum',
    unit: '%',
    formula: '252 个交易日内峰值到后续谷值的最大跌幅',
    raw_inputs: ['腾讯前复权日 K 线 收盘价序列'],
    frequency: 'daily',
    pit_rule: '交易日盘后更新',
    higher_is_better: false,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
  {
    key: 'adv_20d',
    name: '20日日均成交额',
    category: 'volatility_momentum',
    unit: '亿元',
    formula: '过去 20 个交易日成交金额的简单算术均值',
    raw_inputs: ['腾讯前复权日 K 线 20日成交额'],
    frequency: 'daily',
    pit_rule: '交易日盘后更新',
    higher_is_better: null,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
  {
    key: 'ret_12m_skip_1m',
    name: '动量因子 (12-1M)',
    category: 'volatility_momentum',
    unit: '%',
    formula: '剔除最近 1 个月短期反转的动量收益率: (P_t-20 / P_t-250) - 1',
    raw_inputs: ['腾讯前复权日 K 线 收盘价序列'],
    frequency: 'daily',
    pit_rule: '交易日盘后更新',
    higher_is_better: true,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
  {
    key: 'main_products_count',
    name: '主营产品业务项数',
    category: 'volatility_momentum',
    unit: '项',
    formula: '公司披露的核心主营业务及主要产品分类项数',
    raw_inputs: ['东财 F10 主营构成 zygcfx 产品分类项'],
    frequency: 'quarterly',
    pit_rule: '报告期披露公告次一交易日生效',
    higher_is_better: null,
    not_applicable_industries: [],
    used_by_strategies: [],
  },
];

export function getIndicatorRegistry() {
  const result = {
    total: INDICATOR_REGISTRY.length,
    items: INDICATOR_REGISTRY,
  };
  return IndicatorRegistryResponseSchema.parse(result);
}

// ---------------------------------------------------------------------------
// Upstream Fetch Recording into content_runs (Only on real HTTP requests)
// ---------------------------------------------------------------------------
export async function recordFetchRun(
  pool: Pool | null | undefined,
  provider: string,
  runId: string,
  params: {
    status: 'ok' | 'empty' | 'partial' | 'failed' | 'not_configured';
    startedAt: string | null;
    finishedAt: string | null;
    itemCount: number;
    errorClass: string | null;
    errorMessage: string | null;
  }
): Promise<void> {
  const record: FetchRunStatus = {
    provider,
    run_id: runId,
    status: params.status,
    started_at: params.startedAt,
    finished_at: params.finishedAt,
    item_count: params.itemCount,
    error_class: params.errorClass,
    error_message: params.errorMessage,
  };
  MEMORY_RUNS.set(`${provider}:${runId}`, record);

  if (pool && typeof pool.query === 'function') {
    try {
      await pool.query(
        `INSERT INTO content_runs (provider, id, body, observed_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (provider, id) DO UPDATE
         SET body = EXCLUDED.body, observed_at = now()`,
        [provider, runId, JSON.stringify(record)]
      );
    } catch (err) {
      console.error('recordFetchRun db error:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// System Status derived strictly from content_runs rows
// ---------------------------------------------------------------------------
export async function getSystemStatus(pool?: Pool): Promise<SystemStatusResponse> {
  let runs: FetchRunStatus[] = [];
  let eventCount = 0;
  let nodeCount = 0;
  let edgeCount = 0;
  let companyCount = 0;
  let exposureCount = 0;

  if (pool && typeof pool.query === 'function') {
    try {
      const runsRes = await pool.query<{
        provider: string;
        id: string;
        body: Record<string, unknown>;
        observed_at: Date;
      }>(`SELECT provider, id, body, observed_at FROM content_runs ORDER BY observed_at DESC LIMIT 50`);
      if (runsRes.rows.length > 0) {
        runs = runsRes.rows.map(r => {
          const b = r.body ?? {};
          const rawStatus = String(b.status ?? 'ok').toLowerCase();
          const status: FetchRunStatus['status'] =
            rawStatus === 'ok' || rawStatus === 'success' || rawStatus === 'succeeded' || rawStatus === 'completed'
              ? 'ok'
              : rawStatus === 'partial'
                ? 'partial'
                : rawStatus === 'empty'
                  ? 'empty'
                  : rawStatus === 'not_configured'
                    ? 'not_configured'
                    : 'failed';
          const obsIso = r.observed_at instanceof Date ? r.observed_at.toISOString() : null;
          return {
            provider: String(r.provider || b.provider || 'unknown'),
            run_id: String(b.run_id || r.id || b.id || 'run_unknown'),
            status,
            started_at: typeof b.started_at === 'string' ? b.started_at : obsIso,
            finished_at: typeof b.finished_at === 'string' ? b.finished_at : obsIso,
            item_count:
              typeof b.item_count === 'number' && Number.isFinite(b.item_count)
                ? Math.max(0, Math.floor(b.item_count))
                : 0,
            error_class: typeof b.error_class === 'string' ? b.error_class : null,
            error_message:
              typeof b.error_message === 'string'
                ? b.error_message
                : typeof b.error === 'string'
                  ? b.error
                  : null,
          };
        });
      }

      const countsRes = await pool.query<{
        events: string;
        nodes: string;
        edges: string;
        companies: string;
        exposures: string;
      }>(`
        SELECT
          (SELECT count(*) FROM content_news) as events,
          (SELECT count(*) FROM content_nodes) as nodes,
          (SELECT count(*) FROM content_edges WHERE kind != 'classification') as edges,
          (SELECT count(*) FROM content_companies) as companies,
          (SELECT count(*) FROM content_exposures WHERE status = 'business') as exposures
      `);
      if (countsRes.rows[0]) {
        eventCount = parseInt(countsRes.rows[0].events || '0', 10);
        nodeCount = parseInt(countsRes.rows[0].nodes || '0', 10);
        edgeCount = parseInt(countsRes.rows[0].edges || '0', 10);
        companyCount = parseInt(countsRes.rows[0].companies || '0', 10);
        exposureCount = parseInt(countsRes.rows[0].exposures || '0', 10);
      }
    } catch (err: any) {
      console.error('getSystemStatus db fallback:', err);
      const errIso = new Date().toISOString();
      runs.push({
        provider: 'postgres_db',
        run_id: 'db_status_check',
        status: 'failed',
        started_at: errIso,
        finished_at: errIso,
        item_count: 0,
        error_class: 'DB_QUERY_FAILED',
        error_message: String(err?.message || err),
      });
    }
  }

  if (runs.length === 0) {
    runs = Array.from(MEMORY_RUNS.values());
  }

  let overallStatus: SystemStatusResponse['overall_status'] = 'ok';
  if (runs.length === 0) {
    overallStatus = 'empty';
  } else if (runs.some(r => r.status === 'failed')) {
    overallStatus = runs.every(r => r.status === 'failed') ? 'failed' : 'partial';
  } else if (runs.some(r => r.status === 'partial')) {
    overallStatus = 'partial';
  } else if (runs.every(r => r.status === 'empty')) {
    overallStatus = 'empty';
  }

  const lastOkRun = runs.find(r => r.status === 'ok' && r.finished_at);

  const result: SystemStatusResponse = {
    overall_status: overallStatus,
    derived_from_runs: runs,
    counts: {
      events: eventCount,
      nodes: nodeCount,
      production_edges: edgeCount,
      companies: companyCount,
      verified_exposures: exposureCount,
    },
    last_success_at: lastOkRun?.finished_at ?? null,
  };

  return SystemStatusResponseSchema.parse(result);
}

// ---------------------------------------------------------------------------
// A-Share Holiday & Real Trading Calendar Usable Trade Date Calculation
// ---------------------------------------------------------------------------
let CACHED_HS300_KLINES: Array<{ date: string; close: number; ret: number }> | null = null;
let CACHED_HS300_AT = 0;

// Official SSE/SZSE closed holiday dates [year, month, day] covering 2024–2028
const ASHARE_HOLIDAY_TUPLES: ReadonlyArray< readonly [number, number, number] > = [
  // 2024
  [2024, 1, 1],
  [2024, 2, 9], [2024, 2, 12], [2024, 2, 13], [2024, 2, 14], [2024, 2, 15], [2024, 2, 16],
  [2024, 4, 4], [2024, 4, 5],
  [2024, 5, 1], [2024, 5, 2], [2024, 5, 3],
  [2024, 6, 10],
  [2024, 9, 16], [2024, 9, 17],
  [2024, 10, 1], [2024, 10, 2], [2024, 10, 3], [2024, 10, 4], [2024, 10, 7],
  // 2025
  [2025, 1, 1],
  [2025, 1, 28], [2025, 1, 29], [2025, 1, 30], [2025, 1, 31], [2025, 2, 3], [2025, 2, 4],
  [2025, 4, 4],
  [2025, 5, 1], [2025, 5, 2], [2025, 5, 5],
  [2025, 6, 2],
  [2025, 10, 1], [2025, 10, 2], [2025, 10, 3], [2025, 10, 6], [2025, 10, 7], [2025, 10, 8],
  // 2026
  [2026, 1, 1], [2026, 1, 2],
  [2026, 2, 16], [2026, 2, 17], [2026, 2, 18], [2026, 2, 19], [2026, 2, 20], [2026, 2, 23],
  [2026, 4, 6],
  [2026, 5, 1], [2026, 5, 4], [2026, 5, 5],
  [2026, 6, 19],
  [2026, 9, 25],
  [2026, 10, 1], [2026, 10, 2], [2026, 10, 5], [2026, 10, 6], [2026, 10, 7],
  // 2027
  [2027, 1, 1],
  [2027, 2, 5], [2027, 2, 8], [2027, 2, 9], [2027, 2, 10], [2027, 2, 11], [2027, 2, 12],
  [2027, 4, 5],
  [2027, 5, 3], [2027, 5, 4], [2027, 5, 5],
  [2027, 6, 14],
  [2027, 9, 15],
  [2027, 10, 1], [2027, 10, 4], [2027, 10, 5], [2027, 10, 6], [2027, 10, 7],
  // 2028
  [2028, 1, 3],
  [2028, 1, 26], [2028, 1, 27], [2028, 1, 28], [2028, 1, 31], [2028, 2, 1],
  [2028, 4, 4],
  [2028, 5, 1], [2028, 5, 2], [2028, 5, 3],
  [2028, 10, 2], [2028, 10, 3], [2028, 10, 4], [2028, 10, 5], [2028, 10, 6],
];

const KNOWN_ASHARE_HOLIDAYS = new Set<string>(
  ASHARE_HOLIDAY_TUPLES.map(([y, m, d]) => {
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${y}-${pad(m)}-${pad(d)}`;
  })
);

export function calculateUsableTradeDate(
  noticeDateStr: string | null,
  realTradeDates?: string[]
): string | null {
  if (!noticeDateStr) return null;
  const match = noticeDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const noticeDay = `${match[1]}-${match[2]}-${match[3]}`;

  if (realTradeDates && realTradeDates.length > 0) {
    const found = realTradeDates.find(td => td > noticeDay);
    if (found) return found;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const d = new Date(Date.UTC(year, month - 1, day + 1));

  for (let i = 0; i < 30; i++) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const date = d.getUTCDate();
    const dayOfWeek = d.getUTCDay();
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const iso = `${y}-${pad(m)}-${pad(date)}`;

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = KNOWN_ASHARE_HOLIDAYS.has(iso);

    if (!isWeekend && !isHoliday) {
      return iso;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }

  return noticeDay;
}

// ---------------------------------------------------------------------------
// Helper: Fetch JSON with timeout
// ---------------------------------------------------------------------------
async function fetchJsonWithTimeout(url: string, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json,text/plain,*/*',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getHs300Klines(): Promise<Array<{ date: string; close: number; ret: number }>> {
  if (CACHED_HS300_KLINES && Date.now() - CACHED_HS300_AT < 15 * 60 * 1000) {
    return CACHED_HS300_KLINES;
  }
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000300,day,,,260,qfq';
  const json = await fetchJsonWithTimeout(url, 6000);
  const rawBars: any[] = json?.data?.sh000300?.day || json?.data?.sh000300?.qfqday || [];
  const parsed: Array<{ date: string; close: number; ret: number }> = [];
  for (let i = 0; i < rawBars.length; i++) {
    const d = String(rawBars[i][0]);
    const c = parseFloat(String(rawBars[i][2]));
    if (!Number.isFinite(c) || c <= 0) continue;
    const prevClose = parsed.length > 0 ? parsed[parsed.length - 1].close : c;
    const ret = parsed.length > 0 ? c / prevClose - 1 : 0;
    parsed.push({ date: d, close: c, ret });
  }
  if (parsed.length > 0) {
    CACHED_HS300_KLINES = parsed;
    CACHED_HS300_AT = Date.now();
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Normalize Industry Name from EastMoney EM2016
// Note: EastMoney EM2016 writes non-bank finance as "金融-非银行金融-证券/保险/多元金融",
// so we strip "非银行" before checking "银行", and check 保险/证券 first!
// ---------------------------------------------------------------------------
export function normalizeIndustryCategory(em2016: string | undefined, securityName: string): {
  displayIndustry: string;
  isFinancial: boolean;
  emCompanyType: number;
} {
  const raw = String(em2016 || '').trim();
  const nonBankClean = raw.replace(/非银行/g, '非银');
  if (raw.includes('保险') || securityName.includes('保险') || securityName.includes('人寿')) {
    return { displayIndustry: '保险', isFinancial: true, emCompanyType: 2 };
  }
  if (raw.includes('证券') || securityName.includes('证券')) {
    return { displayIndustry: '证券', isFinancial: true, emCompanyType: 1 };
  }
  if (nonBankClean.includes('银行') || securityName.includes('银行')) {
    return { displayIndustry: '银行', isFinancial: true, emCompanyType: 3 };
  }
  if (raw.includes('金融') || raw.includes('信托') || raw.includes('期货')) {
    return { displayIndustry: '非银金融', isFinancial: true, emCompanyType: 4 };
  }
  return {
    displayIndustry: raw || '未分类行业',
    isFinancial: false,
    emCompanyType: 4,
  };
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Real Raw 3-Statement + Mainbz + Bonus + K-Line Fetch & Computation
// ---------------------------------------------------------------------------
export async function fetchAndComputeRealCompanyProfile(
  pool: Pool | null | undefined,
  normCode: string
): Promise<CompanyProfileResponse> {
  const [symbol, suffix] = normCode.split('.');
  const emCode = `${suffix}${symbol}`;
  const tcCode = `${suffix.toLowerCase()}${symbol}`;

  const startedAt = new Date().toISOString();
  let surveyJson: any;
  try {
    surveyJson = await fetchJsonWithTimeout(
      `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${emCode}`
    );
  } catch (err: any) {
    await recordFetchRun(pool, 'eastmoney_f10', `f10_${normCode}_${Date.now()}`, {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      itemCount: 0,
      errorClass: 'UPSTREAM_NETWORK_ERROR',
      errorMessage: String(err?.message || err),
    });
    throw new ApiError(502, 'UPSTREAM_ERROR', `请求东方财富上市公司档案失败: ${String(err?.message || err)}`);
  }

  const jbzl = surveyJson?.jbzl?.[0];
  if (!jbzl || !jbzl.SECURITY_NAME_ABBR) {
    await recordFetchRun(pool, 'eastmoney_f10', `f10_${normCode}_${Date.now()}`, {
      status: 'empty',
      startedAt,
      finishedAt: new Date().toISOString(),
      itemCount: 0,
      errorClass: 'NOT_FOUND',
      errorMessage: `EastMoney CompanySurvey returned no company for ${emCode}`,
    });
    throw new ApiError(
      404,
      'NOT_FOUND',
      `未找到股票代码 ${normCode} 的真实上市公司档案，拒绝生成合成数据`
    );
  }

  const companyName = String(jbzl.SECURITY_NAME_ABBR).trim();
  const businessScope = String(jbzl.BUSINESS_SCOPE || jbzl.MAIN_BUSINESS || '未披露经营范围').trim();
  const { displayIndustry, isFinancial, emCompanyType } = normalizeIndustryCategory(
    jbzl.EM2016,
    companyName
  );

  // Track sub-request errors explicitly (never swallow into "未披露")
  const subErrors = new Map<string, string>();
  async function trackedSubFetch<T>(subKey: string, fn: () => Promise<T>, fallbackVal: T): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err?.message || err);
      subErrors.set(subKey, msg);
      console.error(`[indicators] upstream sub-request ${subKey} (${normCode}) failed:`, msg);
      return fallbackVal;
    }
  }

  // Fetch zyzb, mainbz, bonus financing, full dividend history (RPT_SHAREBONUS_DET), and Tencent K-lines
  const [zyzbJson, mainbzJson, bonusJson, sharebonusDetJson, klineJson, hs300Bars] = await Promise.all([
    fetchJsonWithTimeout(
      `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/zyzbAjaxNew?type=0&code=${emCode}`
    ),
    trackedSubFetch(
      'mainbz',
      () => fetchJsonWithTimeout(`https://emweb.securities.eastmoney.com/PC_HSF10/BusinessAnalysis/PageAjax?code=${emCode}`),
      null
    ),
    trackedSubFetch(
      'bonus',
      () => fetchJsonWithTimeout(`https://emweb.securities.eastmoney.com/PC_HSF10/BonusFinancing/PageAjax?code=${emCode}`),
      null
    ),
    trackedSubFetch(
      'sharebonus_det',
      () =>
        fetchJsonWithTimeout(
          `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=REPORT_DATE,EX_DIVIDEND_DATE,IMPL_PLAN_PROFILE,PRETAX_BONUS_RMB,ASSIGN_PROGRESS&filter=(SECURITY_CODE%3D%22${symbol}%22)&pageNumber=1&pageSize=100&sortColumns=REPORT_DATE&sortTypes=-1`
        ),
      null
    ),
    fetchJsonWithTimeout(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tcCode},day,,,260,qfq`
    ),
    trackedSubFetch('hs300', () => getHs300Klines(), []),
  ]);

  const zyzbRows: any[] = Array.isArray(zyzbJson?.data) ? zyzbJson.data : [];
  if (zyzbRows.length === 0) {
    throw new ApiError(404, 'NOT_FOUND', `股票 ${normCode} (${companyName}) 缺少东方财富财务报表数据`);
  }

  // Determine the 5 report dates needed for TTM (t, Q_prev, FY_prev, t-4)
  const latestRow = zyzbRows[0];
  const latestReportPeriod = String(latestRow.REPORT_DATE || '').slice(0, 10);
  const latestNoticeDate = String(latestRow.NOTICE_DATE || latestReportPeriod).slice(0, 10);
  const latestUpdateDateRaw = latestRow.UPDATE_DATE ? String(latestRow.UPDATE_DATE).slice(0, 10) : null;
  const restatementDatetime =
    latestUpdateDateRaw && latestUpdateDateRaw > latestNoticeDate
      ? `${latestUpdateDateRaw} 00:00:00`
      : null;

  const yearT = parseInt(latestReportPeriod.slice(0, 4), 10);
  const mmddT = latestReportPeriod.slice(5, 10);
  const t4ReportPeriod = `${yearT - 1}-${mmddT}`;
  const fyPrevReportPeriod = `${yearT - 1}-12-31`;

  const dateSet = new Set<string>();
  for (const r of zyzbRows.slice(0, 6)) {
    if (r?.REPORT_DATE) dateSet.add(String(r.REPORT_DATE).slice(0, 10));
  }
  dateSet.add(latestReportPeriod);
  dateSet.add(t4ReportPeriod);
  dateSet.add(fyPrevReportPeriod);
  const datesParam = Array.from(dateSet).slice(0, 5).join(',');

  // Fetch raw 3 statements (Balance Sheet zcfzb, Income Statement lrb, Cash Flow xjllb) with explicit failure tracking
  const [zcfzJson, lrbJson, xjllJson] = await Promise.all([
    trackedSubFetch(
      'zcfzb',
      () =>
        fetchJsonWithTimeout(
          `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/zcfzbAjaxNew?companyType=${emCompanyType}&reportDateType=0&reportType=1&dates=${datesParam}&code=${emCode}`
        ),
      { data: [] }
    ),
    trackedSubFetch(
      'lrb',
      () =>
        fetchJsonWithTimeout(
          `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/lrbAjaxNew?companyType=${emCompanyType}&reportDateType=0&reportType=1&dates=${datesParam}&code=${emCode}`
        ),
      { data: [] }
    ),
    trackedSubFetch(
      'xjllb',
      () =>
        fetchJsonWithTimeout(
          `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/xjllbAjaxNew?companyType=${emCompanyType}&reportDateType=0&reportType=1&dates=${datesParam}&code=${emCode}`
        ),
      { data: [] }
    ),
  ]);

  const zcfzRows: any[] = Array.isArray(zcfzJson?.data) ? zcfzJson.data : [];
  const lrbRows: any[] = Array.isArray(lrbJson?.data) ? lrbJson.data : [];
  const xjllRows: any[] = Array.isArray(xjllJson?.data) ? xjllJson.data : [];

  const findByDate = (arr: any[], datePrefix: string) =>
    arr.find(r => String(r?.REPORT_DATE || '').startsWith(datePrefix)) || null;

  const zyzbT = latestRow;
  const zyzbT4 = findByDate(zyzbRows, t4ReportPeriod);
  const zcfzT = findByDate(zcfzRows, latestReportPeriod);
  const zcfzT4 = findByDate(zcfzRows, t4ReportPeriod);
  const lrbT = findByDate(lrbRows, latestReportPeriod);
  const lrbT4 = findByDate(lrbRows, t4ReportPeriod);
  const lrbFyPrev = findByDate(lrbRows, fyPrevReportPeriod);
  const xjllT = findByDate(xjllRows, latestReportPeriod);
  const xjllT4 = findByDate(xjllRows, t4ReportPeriod);
  const xjllFyPrev = findByDate(xjllRows, fyPrevReportPeriod);

  // True 4-quarter rolling TTM helper: TTM(X) = X_t + X_{FY,prev} - X_{t-4} (or X_t if 12-31)
  const computeRollingTtm = (
    tRow: any,
    fyRow: any,
    t4Row: any,
    fieldNames: string[]
  ): number | null => {
    const pick = (row: any) => {
      if (!row) return null;
      for (const f of fieldNames) {
        const val = numOrNull(row[f]);
        if (val !== null) return val;
      }
      return null;
    };
    const valT = pick(tRow);
    if (valT === null) return null;
    if (mmddT === '12-31') return valT;
    const valFy = pick(fyRow);
    const valT4 = pick(t4Row);
    if (valFy === null || valT4 === null) return null;
    return valT + valFy - valT4;
  };

  const revTtmYuan = computeRollingTtm(lrbT, lrbFyPrev, lrbT4, [
    'TOTAL_OPERATE_INCOME',
    'OPERATE_INCOME',
  ]);
  const costTtmYuan = computeRollingTtm(lrbT, lrbFyPrev, lrbT4, [
    'OPERATE_COST',
    'TOTAL_OPERATE_COST',
  ]);
  const npTtmYuan = computeRollingTtm(lrbT, lrbFyPrev, lrbT4, ['PARENT_NETPROFIT']);
  const npDeductTtmYuan = computeRollingTtm(lrbT, lrbFyPrev, lrbT4, ['DEDUCT_PARENT_NETPROFIT']);
  const cfoTtmYuan = computeRollingTtm(xjllT, xjllFyPrev, xjllT4, ['NETCASH_OPERATE']);

  const assetsTYuan = numOrNull(zcfzT?.TOTAL_ASSETS);
  const assetsT4Yuan = numOrNull(zcfzT4?.TOTAL_ASSETS);
  const avgAssetsYuan =
    assetsTYuan !== null && assetsT4Yuan !== null
      ? (assetsTYuan + assetsT4Yuan) / 2
      : assetsTYuan;

  const equityTYuan = numOrNull(zcfzT?.TOTAL_PARENT_EQUITY);
  const liabTYuan = numOrNull(zcfzT?.TOTAL_LIABILITIES);
  const liabT4Yuan = numOrNull(zcfzT4?.TOTAL_LIABILITIES);

  // Parse Tencent daily K-lines & real-time quote
  const tcData = klineJson?.data?.[tcCode] || {};
  const qtArr: any[] = tcData?.qt?.[tcCode] || [];
  const rawKlines: any[] = tcData?.qfqday || tcData?.day || [];

  const priceRaw = numOrNull(qtArr[3]) ?? (rawKlines.length > 0 ? numOrNull(rawKlines.at(-1)?.[2]) : null);
  const price = priceRaw !== null && priceRaw > 0 ? priceRaw : null;
  const totalMvYiRaw = numOrNull(qtArr[45]);
  const totalMvYi = totalMvYiRaw !== null && totalMvYiRaw > 0 ? totalMvYiRaw : null;
  const totalMvYuan = totalMvYi !== null ? totalMvYi * 1e8 : null;
  const peTtmQuote = numOrNull(qtArr[39]);
  const pbMrqQuote = numOrNull(qtArr[46]);
  const latestTradeDate =
    (rawKlines.length > 0 ? String(rawKlines.at(-1)?.[0]) : null) ||
    (qtArr[30] ? `${String(qtArr[30]).slice(0, 4)}-${String(qtArr[30]).slice(4, 6)}-${String(qtArr[30]).slice(6, 8)}` : null);

  // Check staleness: if latestTradeDate is > 10 calendar days before today
  const tradeAgeDays = latestTradeDate
    ? (Date.now() - Date.parse(`${latestTradeDate}T00:00:00Z`)) / (86400 * 1000)
    : Infinity;
  const isQuoteStale = !Number.isFinite(tradeAgeDays) || tradeAgeDays > 10;

  // Compute K-line derived indicators (last 252 bars)
  const bars252 = rawKlines.slice(-253);
  const dailyRets: Array<{ date: string; ret: number; close: number; amountWan: number | null }> = [];
  for (let i = 1; i < bars252.length; i++) {
    const prevClose = numOrNull(bars252[i - 1]?.[2]);
    const curClose = numOrNull(bars252[i]?.[2]);
    const amtWan = numOrNull(bars252[i]?.[8]);
    if (prevClose && prevClose > 0 && curClose && curClose > 0) {
      dailyRets.push({
        date: String(bars252[i][0]),
        ret: curClose / prevClose - 1,
        close: curClose,
        amountWan: amtWan,
      });
    }
  }

  let vol252d: number | null = null;
  let downsideVol252d: number | null = null;
  let maxDrawdown252d: number | null = null;
  let adv20dYi: number | null = null;
  let ret12mSkip1m: number | null = null;
  let beta252d: number | null = null;

  if (dailyRets.length >= 60) {
    const meanRet = dailyRets.reduce((s, x) => s + x.ret, 0) / dailyRets.length;
    const variance =
      dailyRets.reduce((s, x) => s + (x.ret - meanRet) ** 2, 0) / (dailyRets.length - 1);
    vol252d = Math.sqrt(variance) * Math.sqrt(252) * 100;

    // Sortino downside volatility: sqrt(mean(min(r, 0)^2)) * sqrt(252)
    const downSqSum = dailyRets.reduce((s, x) => s + (x.ret < 0 ? x.ret ** 2 : 0), 0);
    downsideVol252d = Math.sqrt(downSqSum / dailyRets.length) * Math.sqrt(252) * 100;

    // Max drawdown over window
    let peak = numOrNull(bars252[0]?.[2]) || dailyRets[0].close;
    let maxDd = 0;
    for (const b of dailyRets) {
      if (b.close > peak) peak = b.close;
      const dd = (b.close - peak) / peak;
      if (dd < maxDd) maxDd = dd;
    }
    maxDrawdown252d = maxDd * 100;

    // 20D average turnover in 亿元 (Tencent amount is in 万元, 1亿 = 10000万)
    const last20Amt = dailyRets
      .slice(-20)
      .map(x => x.amountWan)
      .filter((v): v is number => v !== null && v > 0);
    if (last20Amt.length >= 10) {
      const avgWan = last20Amt.reduce((a, b) => a + b, 0) / last20Amt.length;
      adv20dYi = avgWan / 10000;
    }

    // 12-1M momentum: (P_{t-20} / P_{t-250} - 1) * 100
    if (dailyRets.length >= 200) {
      const pStart = numOrNull(bars252[0]?.[2]);
      const pSkip1m = dailyRets[dailyRets.length - 21]?.close;
      if (pStart && pStart > 0 && pSkip1m && pSkip1m > 0) {
        ret12mSkip1m = (pSkip1m / pStart - 1) * 100;
      }
    }

    // Beta against CSI 300 (sh000300)
    if (hs300Bars.length >= 60) {
      const hsMap = new Map<string, number>();
      for (const h of hs300Bars) hsMap.set(h.date, h.ret);
      const pairs: Array<[number, number]> = [];
      for (const d of dailyRets) {
        const mRet = hsMap.get(d.date);
        if (mRet !== undefined) pairs.push([d.ret, mRet]);
      }
      if (pairs.length >= 60) {
        const meanS = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
        const meanM = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
        let cov = 0;
        let varM = 0;
        for (const [rs, rm] of pairs) {
          cov += (rs - meanS) * (rm - meanM);
          varM += (rm - meanM) ** 2;
        }
        if (varM > 0) {
          beta252d = cov / varM;
        }
      }
    }
  }

  // Parse Mainbz (zygcfx) for latest report date
  const rawZygcfx: any[] = Array.isArray(mainbzJson?.zygcfx) ? mainbzJson.zygcfx : [];
  const mainbzDates = Array.from(
    new Set(rawZygcfx.map(r => String(r?.REPORT_DATE || '').slice(0, 10)).filter(Boolean))
  ).sort().reverse();
  const latestMainbzDate = mainbzDates[0] || latestReportPeriod;
  const latestZygcfx = rawZygcfx.filter(
    r => String(r?.REPORT_DATE || '').startsWith(latestMainbzDate)
  );

  const mainbzItems: MainbzItem[] = latestZygcfx
    .filter(r => r?.ITEM_NAME && !['合计', '其中:关联交易'].includes(String(r.ITEM_NAME).trim()))
    .map(r => {
      const mType = String(r.MAINOP_TYPE || '');
      const mainopType: MainbzItem['mainop_type'] =
        mType === '2' ? 'product' : mType === '1' ? 'industry' : 'region';
      return {
        item_name: String(r.ITEM_NAME).trim(),
        mainop_type: mainopType,
        revenue_yuan: numOrNull(r.MAIN_BUSINESS_INCOME),
        revenue_share: numOrNull(r.MBI_RATIO),
        gross_margin: numOrNull(r.GROSS_RPOFIT_RATIO),
        report_date: latestMainbzDate,
      };
    });

  const productMainbzCount = mainbzItems.filter(m => m.mainop_type === 'product').length || mainbzItems.length;

  // Parse BonusFinancing (fhyx, lnfhrz, zfmx, pgmx) + RPT_SHAREBONUS_DET for complete dividend streak
  const fhyxRows: any[] = Array.isArray(bonusJson?.fhyx) ? bonusJson.fhyx : [];
  const lnfhrzRows: any[] = Array.isArray(bonusJson?.lnfhrz) ? bonusJson.lnfhrz : [];
  const zfmxRows: any[] = Array.isArray(bonusJson?.zfmx) ? bonusJson.zfmx : [];
  const pgmxRows: any[] = Array.isArray(bonusJson?.pgmx) ? bonusJson.pgmx : [];
  const sharebonusDetRows: any[] = Array.isArray(sharebonusDetJson?.result?.data)
    ? sharebonusDetJson.result.data
    : [];

  // Calculate TTM cash dividend per share from implemented plans in last 365 days
  const oneYearAgoIso = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
  let ttmDivPerShare = 0;
  for (const fh of fhyxRows) {
    const profileStr = String(fh?.IMPL_PLAN_PROFILE || '');
    const match = profileStr.match(/10(?:送\d+(?:\.\d+)?股?)?(?:转\d+(?:\.\d+)?股?)?派(\d+(?:\.\d+)?)元/);
    const noticeIso = String(fh?.NOTICE_DATE || fh?.EX_DIVIDEND_DATE || '').slice(0, 10);
    if (match && noticeIso >= oneYearAgoIso) {
      const perShare = parseFloat(match[1]) / 10;
      ttmDivPerShare += perShare;
    }
  }

  // Full dividend streak years calculation using RPT_SHAREBONUS_DET + lnfhrz
  const divReportYears = new Set<number>();
  for (const row of sharebonusDetRows) {
    const bonus = numOrNull(row?.PRETAX_BONUS_RMB);
    const repYr = parseInt(String(row?.REPORT_DATE || '').slice(0, 4), 10);
    if (bonus !== null && bonus > 0 && Number.isFinite(repYr)) {
      divReportYears.add(repYr);
    }
  }
  for (const row of lnfhrzRows) {
    const totDiv = numOrNull(row?.TOTAL_DIVIDEND);
    const statYr = parseInt(String(row?.STATISTICS_YEAR || '').slice(0, 4), 10);
    if (totDiv !== null && totDiv > 0 && Number.isFinite(statYr)) {
      divReportYears.add(statYr);
    }
  }

  let dividendStreakYears = 0;
  let isDividendWindowTruncated = false;
  if (divReportYears.size > 0) {
    const sortedYrs = Array.from(divReportYears).sort((a, b) => b - a);
    let curYr = sortedYrs[0];
    for (const y of sortedYrs) {
      if (y === curYr) {
        dividendStreakYears++;
        curYr--;
      } else if (y < curYr) {
        break;
      }
    }
    // Check if sharebonusDet failed or hit the 100-row pagination limit while streak reaches the earliest year
    if (
      (sharebonusDetRows.length === 0 || sharebonusDetRows.length >= 100) &&
      sortedYrs[sortedYrs.length - 1] === curYr + 1
    ) {
      isDividendWindowTruncated = true;
    }
  }

  const shareCapitalT = numOrNull(zcfzT?.SHARE_CAPITAL);
  const ttmTotalCashDivYuan =
    ttmDivPerShare > 0 && shareCapitalT && shareCapitalT > 0
      ? ttmDivPerShare * shareCapitalT
      : null;

  const dividendYieldTtm =
    ttmDivPerShare > 0 && price && price > 0 ? (ttmDivPerShare / price) * 100 : fhyxRows.length > 0 ? 0 : null;
  const payoutRatio =
    ttmTotalCashDivYuan !== null && npTtmYuan !== null && npTtmYuan > 0
      ? (ttmTotalCashDivYuan / npTtmYuan) * 100
      : ttmDivPerShare === 0 && fhyxRows.length > 0
        ? 0
        : null;

  // Check if equity offering occurred in last 365 days (F7)
  const hadRecentEqOffering = [...zfmxRows, ...pgmxRows].some(r => {
    const dt = String(r?.NOTICE_DATE || r?.LISTING_DATE || r?.ISSUE_DATE || '').slice(0, 10);
    return dt >= oneYearAgoIso;
  });

  // Fundamental metrics at t and t-4
  const roeJq = numOrNull(zyzbT?.ROEJQ);
  const roaT = numOrNull(zyzbT?.ZZCJLL) ?? (npTtmYuan !== null && avgAssetsYuan ? (npTtmYuan / avgAssetsYuan) * 100 : null);
  const roaT4 = numOrNull(zyzbT4?.ZZCJLL);
  const roic = numOrNull(zyzbT?.ROIC);
  const grossMarginT = isFinancial ? null : numOrNull(zyzbT?.XSMLL);
  const grossMarginT4 = isFinancial ? null : numOrNull(zyzbT4?.XSMLL);
  const gpaPct =
    !isFinancial && revTtmYuan !== null && costTtmYuan !== null && avgAssetsYuan && avgAssetsYuan > 0
      ? ((revTtmYuan - costTtmYuan) / avgAssetsYuan) * 100
      : null;
  const revYoy = numOrNull(zyzbT?.TOTALOPERATEREVETZ);
  const npParentYoy = numOrNull(zyzbT?.PARENTNETPROFITTZ);

  const debtRatioT =
    numOrNull(zyzbT?.ZCFZL) ??
    (liabTYuan !== null && assetsTYuan && assetsTYuan > 0 ? (liabTYuan / assetsTYuan) * 100 : null);
  const debtRatioT4 =
    numOrNull(zyzbT4?.ZCFZL) ??
    (liabT4Yuan !== null && assetsT4Yuan && assetsT4Yuan > 0 ? (liabT4Yuan / assetsT4Yuan) * 100 : null);

  const currentRatioT = isFinancial ? null : numOrNull(zyzbT?.LD);
  const currentRatioT4 = isFinancial ? null : numOrNull(zyzbT4?.LD);
  const assetTurnT = isFinancial ? null : numOrNull(zyzbT?.TOAZZL);
  const assetTurnT4 = isFinancial ? null : numOrNull(zyzbT4?.TOAZZL);
  const arDays = isFinancial ? null : numOrNull(zyzbT?.YSZKZZTS);
  const invDays = isFinancial ? null : numOrNull(zyzbT?.CHZZTS);

  const cfoTYuan = numOrNull(xjllT?.NETCASH_OPERATE);
  const npTYuan = numOrNull(lrbT?.PARENT_NETPROFIT);

  const cfoToNp =
    cfoTtmYuan !== null && npTtmYuan !== null && npTtmYuan !== 0
      ? cfoTtmYuan / npTtmYuan
      : null;
  const sloanAccrualPct =
    !isFinancial && npTtmYuan !== null && cfoTtmYuan !== null && avgAssetsYuan && avgAssetsYuan > 0
      ? ((npTtmYuan - cfoTtmYuan) / avgAssetsYuan) * 100
      : null;

  const epTtmPct =
    npTtmYuan !== null && totalMvYuan && totalMvYuan > 0
      ? (npTtmYuan / totalMvYuan) * 100
      : peTtmQuote && peTtmQuote > 0
        ? (1 / peTtmQuote) * 100
        : null;
  const epDeductTtmPct =
    npDeductTtmYuan !== null && totalMvYuan && totalMvYuan > 0
      ? (npDeductTtmYuan / totalMvYuan) * 100
      : null;
  const bpMrqVal =
    equityTYuan !== null && totalMvYuan && totalMvYuan > 0
      ? equityTYuan / totalMvYuan
      : pbMrqQuote && pbMrqQuote > 0
        ? 1 / pbMrqQuote
        : null;

  // Compute individual Piotroski F-Score binary signals strictly from raw data
  const f1 = roaT !== null ? (roaT > 0 ? 1 : 0) : null;
  const f2 = cfoTYuan !== null ? (cfoTYuan > 0 ? 1 : 0) : null;
  const f3 = roaT !== null && roaT4 !== null ? (roaT > roaT4 ? 1 : 0) : null;
  const f4 = cfoTYuan !== null && npTYuan !== null ? (cfoTYuan > npTYuan ? 1 : 0) : null;
  const f5 = debtRatioT !== null && debtRatioT4 !== null ? (debtRatioT <= debtRatioT4 ? 1 : 0) : null;
  const f6 =
    isFinancial
      ? null
      : currentRatioT !== null && currentRatioT4 !== null
        ? currentRatioT > currentRatioT4
          ? 1
          : 0
        : null;
  const f7 = subErrors.has('bonus') ? null : hadRecentEqOffering ? 0 : 1;
  const f8 =
    isFinancial
      ? null
      : grossMarginT !== null && grossMarginT4 !== null
        ? grossMarginT > grossMarginT4
          ? 1
          : 0
        : null;
  const f9 =
    isFinancial
      ? null
      : assetTurnT !== null && assetTurnT4 !== null
        ? assetTurnT > assetTurnT4
          ? 1
          : 0
        : null;

  const fComponents = [f1, f2, f3, f4, f5, f6, f7, f8, f9];
  const validFComponents = fComponents.filter((x): x is number => x !== null);
  const fscoreTotal = !isFinancial && validFComponents.length === 9 ? validFComponents.reduce((a, b) => a + b, 0) : null;

  const isSt = companyName.toUpperCase().includes('ST');
  const hs300TradeDates = hs300Bars.map(b => b.date);
  const usableTradeDate = calculateUsableTradeDate(latestNoticeDate, hs300TradeDates);
  const announcementDatetime = `${latestNoticeDate} 00:00:00`;

  // Map each indicator to any upstream sub-request it depends on so failures are marked upstream_failed
  const indicatorSubDeps: Record<string, string[]> = {
    ep_ttm: ['lrb'],
    ep_deduct_ttm: ['lrb'],
    bp_mrq: ['zcfzb'],
    gpa: ['lrb', 'zcfzb'],
    fscore_cfo_pos: ['xjllb'],
    fscore_cfo_gt_np: ['xjllb', 'lrb'],
    fscore_no_eq_iss: ['bonus'],
    fscore_total: ['lrb', 'zcfzb', 'xjllb', 'bonus'],
    cfo_to_np: ['xjllb', 'lrb'],
    sloan_accrual: ['xjllb', 'lrb', 'zcfzb'],
    dividend_yield_ttm: ['bonus'],
    dividend_streak_years: ['bonus', 'sharebonus_det'],
    payout_ratio: ['bonus', 'lrb', 'zcfzb'],
    shareholder_yield: ['bonus'],
    beta_252d: ['hs300'],
    main_products_count: ['mainbz'],
  };

  // Build all 40 indicators without any fake constants
  const rawValues: Record<
    string,
    {
      val: number | null;
      fmt: string;
      yoy?: number | null;
      provider: 'eastmoney_f10' | 'eastmoney_mainbz' | 'tencent_quote' | 'ifind';
      note?: string | null;
      forceStatus?: IndicatorSnapshotValue['status'];
    }
  > = {
    total_mv: {
      val: totalMvYi !== null ? Math.round(totalMvYi * 100) / 100 : null,
      fmt: totalMvYi !== null ? `${totalMvYi.toFixed(2)} 亿元` : '缺失',
      provider: 'tencent_quote',
    },
    ep_ttm: {
      val: epTtmPct !== null ? Math.round(epTtmPct * 100) / 100 : null,
      fmt: epTtmPct !== null ? `${epTtmPct.toFixed(2)}%` : '缺失',
      provider: 'eastmoney_f10',
    },
    ep_deduct_ttm: {
      val: epDeductTtmPct !== null ? Math.round(epDeductTtmPct * 100) / 100 : null,
      fmt: epDeductTtmPct !== null ? `${epDeductTtmPct.toFixed(2)}%` : '缺失',
      provider: 'eastmoney_f10',
    },
    bp_mrq: {
      val: bpMrqVal !== null ? Math.round(bpMrqVal * 1000) / 1000 : null,
      fmt: bpMrqVal !== null ? `${bpMrqVal.toFixed(3)} 倍` : '缺失',
      provider: 'eastmoney_f10',
    },
    is_st_risk: {
      val: isSt ? 1 : 0,
      fmt: isSt ? 'ST 风险警示' : '正常',
      provider: 'eastmoney_f10',
    },
    shell_size_flag: {
      val: totalMvYi !== null ? (totalMvYi <= 35 ? 1 : 0) : null,
      fmt: totalMvYi !== null ? (totalMvYi <= 35 ? '小微盘壳风险 (≤35亿)' : '正常 (>35亿)') : '缺失',
      provider: 'tencent_quote',
      note: '当前小市值代理阈值 ≤35亿元；待接入全市场截面后切换为后30%分位',
    },
    roe_jq: {
      val: roeJq !== null ? Math.round(roeJq * 100) / 100 : null,
      fmt: roeJq !== null ? `${roeJq.toFixed(2)}%` : '缺失',
      yoy: numOrNull(zyzbT?.ROEJQTZ),
      provider: 'eastmoney_f10',
    },
    roa_net: {
      val: roaT !== null ? Math.round(roaT * 100) / 100 : null,
      fmt: roaT !== null ? `${roaT.toFixed(2)}%` : '缺失',
      yoy: numOrNull(zyzbT?.ZZCJLLTZ),
      provider: 'eastmoney_f10',
    },
    roic: {
      val: roic !== null ? Math.round(roic * 100) / 100 : null,
      fmt: roic !== null ? `${roic.toFixed(2)}%` : '缺失',
      yoy: numOrNull(zyzbT?.ROICTZ),
      provider: 'eastmoney_f10',
    },
    gross_margin: {
      val: grossMarginT !== null ? Math.round(grossMarginT * 100) / 100 : null,
      fmt: grossMarginT !== null ? `${grossMarginT.toFixed(2)}%` : '缺失',
      yoy: numOrNull(zyzbT?.XSMLL_TB),
      provider: 'eastmoney_f10',
    },
    gpa: {
      val: gpaPct !== null ? Math.round(gpaPct * 100) / 100 : null,
      fmt: gpaPct !== null ? `${gpaPct.toFixed(2)}%` : '缺失',
      provider: 'eastmoney_f10',
    },
    rev_yoy: {
      val: revYoy !== null ? Math.round(revYoy * 100) / 100 : null,
      fmt: revYoy !== null ? `${revYoy >= 0 ? '+' : ''}${revYoy.toFixed(2)}%` : '缺失',
      yoy: revYoy !== null ? Math.round(revYoy * 100) / 100 : null,
      provider: 'eastmoney_f10',
    },
    np_parent_yoy: {
      val: npParentYoy !== null ? Math.round(npParentYoy * 100) / 100 : null,
      fmt: npParentYoy !== null ? `${npParentYoy >= 0 ? '+' : ''}${npParentYoy.toFixed(2)}%` : '缺失',
      yoy: npParentYoy !== null ? Math.round(npParentYoy * 100) / 100 : null,
      provider: 'eastmoney_f10',
    },
    fscore_roa_pos: {
      val: f1,
      fmt: f1 === null ? '缺失' : f1 === 1 ? '1 分 (满足)' : '0 分 (未满足)',
      provider: 'eastmoney_f10',
    },
    fscore_cfo_pos: {
      val: f2,
      fmt: f2 === null ? '缺失' : f2 === 1 ? '1 分 (满足)' : '0 分 (未满足)',
      provider: 'eastmoney_f10',
    },
    fscore_delta_roa: {
      val: f3,
      fmt: f3 === null ? '缺失' : f3 === 1 ? '1 分 (满足)' : '0 分 (未满足)',
      provider: 'eastmoney_f10',
    },
    fscore_cfo_gt_np: {
      val: f4,
      fmt: f4 === null ? '缺失' : f4 === 1 ? '1 分 (满足)' : '0 分 (未满足)',
      provider: 'eastmoney_f10',
    },
    fscore_delta_lever: {
      val: f5,
      fmt: f5 === null ? '缺失' : f5 === 1 ? '1 分 (满足)' : '0 分 (未满足)',
      provider: 'eastmoney_f10',
    },
    fscore_delta_curr: {
      val: f6,
      fmt: f6 === null ? '缺失' : f6 === 1 ? '1 分 (满足)' : '0 分 (未满足)',
      provider: 'eastmoney_f10',
    },
    fscore_no_eq_iss: {
      val: f7,
      fmt: f7 === null ? '缺失' : f7 === 1 ? '1 分 (无增发配股)' : '0 分 (有股权融资)',
      provider: 'eastmoney_f10',
    },
    fscore_delta_gm: {
      val: f8,
      fmt: f8 === null ? '缺失' : f8 === 1 ? '1 分 (满足)' : '0 分 (未满足)',
      provider: 'eastmoney_f10',
    },
    fscore_delta_turn: {
      val: f9,
      fmt: f9 === null ? '缺失' : f9 === 1 ? '1 分 (满足)' : '0 分 (未满足)',
      provider: 'eastmoney_f10',
    },
    fscore_total: {
      val: fscoreTotal,
      fmt:
        isFinancial
          ? '不适用金融行业 (9项满分口径)'
          : fscoreTotal !== null
            ? `${fscoreTotal} / 9 分`
            : '缺失',
      provider: 'eastmoney_f10',
      forceStatus: isFinancial ? 'not_applicable' : undefined,
      note: isFinancial ? '传统 Piotroski 9项满分模型包含毛利率/流动比率/资产周转率，不适用于金融企业' : undefined,
    },
    cfo_to_np: {
      val: cfoToNp !== null ? Math.round(cfoToNp * 100) / 100 : null,
      fmt: cfoToNp !== null ? `${cfoToNp.toFixed(2)} 倍` : '缺失',
      provider: 'eastmoney_f10',
    },
    sloan_accrual: {
      val: sloanAccrualPct !== null ? Math.round(sloanAccrualPct * 100) / 100 : null,
      fmt: sloanAccrualPct !== null ? `${sloanAccrualPct.toFixed(2)}%` : '缺失',
      provider: 'eastmoney_f10',
    },
    debt_ratio: {
      val: debtRatioT !== null ? Math.round(debtRatioT * 100) / 100 : null,
      fmt: debtRatioT !== null ? `${debtRatioT.toFixed(2)}%` : '缺失',
      yoy: numOrNull(zyzbT?.ZCFZLTZ),
      provider: 'eastmoney_f10',
    },
    current_ratio: {
      val: currentRatioT !== null ? Math.round(currentRatioT * 100) / 100 : null,
      fmt: currentRatioT !== null ? `${currentRatioT.toFixed(2)} 倍` : '缺失',
      provider: 'eastmoney_f10',
    },
    ar_turnover_days: {
      val: arDays !== null ? Math.round(arDays * 10) / 10 : null,
      fmt: arDays !== null ? `${arDays.toFixed(1)} 天` : '缺失',
      provider: 'eastmoney_f10',
    },
    inv_turnover_days: {
      val: invDays !== null ? Math.round(invDays * 10) / 10 : null,
      fmt: invDays !== null ? `${invDays.toFixed(1)} 天` : '缺失',
      provider: 'eastmoney_f10',
    },
    dividend_yield_ttm: {
      val: dividendYieldTtm !== null ? Math.round(dividendYieldTtm * 100) / 100 : null,
      fmt: dividendYieldTtm !== null ? `${dividendYieldTtm.toFixed(2)}%` : '缺失',
      provider: 'eastmoney_f10',
    },
    dividend_streak_years: {
      val:
        isDividendWindowTruncated
          ? null
          : sharebonusDetRows.length > 0 || lnfhrzRows.length > 0 || fhyxRows.length > 0
            ? dividendStreakYears
            : null,
      fmt:
        isDividendWindowTruncated
          ? `≥${dividendStreakYears} 年（窗口截断）`
          : sharebonusDetRows.length > 0 || lnfhrzRows.length > 0 || fhyxRows.length > 0
            ? `${dividendStreakYears} 年`
            : '缺失',
      provider: 'eastmoney_f10',
      forceStatus: isDividendWindowTruncated ? 'missing' : undefined,
      note: isDividendWindowTruncated
        ? '受限于分红接口返回窗口，连续分红年数在窗口起点处截断'
        : undefined,
    },
    payout_ratio: {
      val: payoutRatio !== null ? Math.round(payoutRatio * 100) / 100 : null,
      fmt: payoutRatio !== null ? `${payoutRatio.toFixed(2)}%` : '缺失',
      provider: 'eastmoney_f10',
    },
    shareholder_yield: {
      val: dividendYieldTtm !== null ? Math.round(dividendYieldTtm * 100) / 100 : null,
      fmt: dividendYieldTtm !== null ? `${dividendYieldTtm.toFixed(2)}%` : '缺失',
      provider: 'eastmoney_f10',
      note: '基于近12个月已实施现金分红总额计算（未含回购注销明细）',
    },
    vol_252d: {
      val: vol252d !== null ? Math.round(vol252d * 100) / 100 : null,
      fmt: vol252d !== null ? `${vol252d.toFixed(2)}%` : '缺失',
      provider: 'tencent_quote',
    },
    downside_vol_252d: {
      val: downsideVol252d !== null ? Math.round(downsideVol252d * 100) / 100 : null,
      fmt: downsideVol252d !== null ? `${downsideVol252d.toFixed(2)}%` : '缺失',
      provider: 'tencent_quote',
    },
    beta_252d: {
      val: beta252d !== null ? Math.round(beta252d * 100) / 100 : null,
      fmt: beta252d !== null ? `${beta252d.toFixed(2)}` : '缺失',
      provider: 'tencent_quote',
    },
    max_drawdown_252d: {
      val: maxDrawdown252d !== null ? Math.round(maxDrawdown252d * 100) / 100 : null,
      fmt: maxDrawdown252d !== null ? `${maxDrawdown252d.toFixed(2)}%` : '缺失',
      provider: 'tencent_quote',
    },
    adv_20d: {
      val: adv20dYi !== null ? Math.round(adv20dYi * 100) / 100 : null,
      fmt: adv20dYi !== null ? `${adv20dYi.toFixed(2)} 亿元` : '缺失',
      provider: 'tencent_quote',
    },
    ret_12m_skip_1m: {
      val: ret12mSkip1m !== null ? Math.round(ret12mSkip1m * 100) / 100 : null,
      fmt: ret12mSkip1m !== null ? `${ret12mSkip1m >= 0 ? '+' : ''}${ret12mSkip1m.toFixed(2)}%` : '缺失',
      provider: 'tencent_quote',
    },
    main_products_count: {
      val: mainbzItems.length > 0 ? productMainbzCount : null,
      fmt: mainbzItems.length > 0 ? `${productMainbzCount} 项主营构成` : '缺失',
      provider: 'eastmoney_mainbz',
    },
  };

  const indicatorList: IndicatorSnapshotValue[] = INDICATOR_REGISTRY.map(reg => {
    if (isFinancial && reg.not_applicable_industries.includes(displayIndustry)) {
      return {
        key: reg.key,
        name: reg.name,
        category: reg.category,
        value: null,
        formatted_value: '不适用金融行业',
        unit: reg.unit,
        yoy_delta: null,
        rank_market_pct: null,
        rank_industry_pct: null,
        status: 'not_applicable',
        report_period: latestReportPeriod,
        announcement_datetime: announcementDatetime,
        usable_trade_date: usableTradeDate,
        restatement_datetime: restatementDatetime,
        source_provider: 'eastmoney_f10',
        note: `该指标不适用于${displayIndustry}行业`,
      };
    }

    const entry = rawValues[reg.key];
    const val = entry?.val ?? null;
    const deps = indicatorSubDeps[reg.key] ?? [];
    const failedDep = deps.find(d => subErrors.has(d));

    let status: IndicatorSnapshotValue['status'];
    let note: string | null;

    if (entry?.forceStatus) {
      status = entry.forceStatus;
      note = entry.note ?? null;
    } else if (val === null && failedDep) {
      status = 'upstream_failed';
      note = `上游子接口 (${failedDep}) 请求失败: ${subErrors.get(failedDep)}`;
    } else if (val === null) {
      status = 'missing';
      note = entry?.note ?? '上游原始报表未披露该项或无法折算';
    } else if (isQuoteStale && reg.frequency === 'daily') {
      status = 'stale';
      note = entry?.note ?? '行情时点距今超过10日';
    } else {
      status = 'ready';
      note = entry?.note ?? '网页抓取源 (reliability: scraped) · 待计算全市场截面分位';
    }

    return {
      key: reg.key,
      name: reg.name,
      category: reg.category,
      value: val,
      formatted_value: status === 'upstream_failed' ? '上游请求失败' : (entry?.fmt ?? '缺失'),
      unit: reg.unit,
      yoy_delta: entry?.yoy ?? null,
      rank_market_pct: null,
      rank_industry_pct: null,
      status,
      report_period: latestReportPeriod,
      announcement_datetime: announcementDatetime,
      usable_trade_date: usableTradeDate,
      restatement_datetime: restatementDatetime,
      source_provider: entry?.provider ?? 'eastmoney_f10',
      note,
    };
  });

  const readyCount = indicatorList.filter(i => i.status === 'ready').length;
  const missingCount = indicatorList.filter(i => i.status === 'missing' || i.status === 'upstream_failed').length;
  const naCount = indicatorList.filter(i => i.status === 'not_applicable').length;
  const hasSubError = subErrors.size > 0;

  await recordFetchRun(pool, 'eastmoney_f10', `f10_${normCode}`, {
    status: hasSubError || readyCount === 0 ? 'partial' : 'ok',
    startedAt,
    finishedAt: new Date().toISOString(),
    itemCount: readyCount,
    errorClass: hasSubError ? 'SUB_REQUEST_FAILED' : null,
    errorMessage: hasSubError
      ? Array.from(subErrors.entries())
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ')
      : null,
  });

  const profile: CompanyProfileResponse = {
    code: normCode,
    name: companyName,
    industry_name: displayIndustry,
    business_scope: businessScope,
    latest_report_period: latestReportPeriod,
    latest_notice_date: latestNoticeDate,
    quote: {
      price,
      total_mv_yi: totalMvYi !== null ? Math.round(totalMvYi * 100) / 100 : null,
      pe_ttm: peTtmQuote,
      pb_mrq: pbMrqQuote,
      trade_date: latestTradeDate,
      is_stale: isQuoteStale,
    },
    mainbz: mainbzItems,
    node_exposures: [],
    recent_node_events: [],
    indicators: indicatorList,
    indicator_summary: {
      total: indicatorList.length,
      ready: readyCount,
      missing: missingCount,
      not_applicable: naCount,
      is_stale: isQuoteStale,
      as_of_trade_date: latestTradeDate,
    },
    strategies: [],
  };

  return CompanyProfileResponseSchema.parse(profile);
}

// ---------------------------------------------------------------------------
// Populate Real Cross-Sectional Percentiles when Sample Size is Sufficient
// ---------------------------------------------------------------------------
async function enrichCrossSectionalPercentiles(
  pool: Pool | null | undefined,
  profile: CompanyProfileResponse
): Promise<CompanyProfileResponse> {
  const allProfiles: CompanyProfileResponse[] = Array.from(MEMORY_PROFILES.values());
  if (pool && typeof pool.query === 'function') {
    try {
      const res = await pool.query<{ indicators: CompanyProfileResponse }>(
        `SELECT indicators FROM content_company_indicators LIMIT 500`
      );
      for (const r of res.rows) {
        if (r.indicators?.code && !allProfiles.some(p => p.code === r.indicators.code)) {
          allProfiles.push(r.indicators);
        }
      }
    } catch (err) {
      console.error('enrichCrossSectionalPercentiles error:', err);
    }
  }

  // Strictly enforce statistical minimum sample thresholds:
  // Market percentile requires >= 30 stocks; Industry percentile requires >= 10 stocks in the same industry.
  const marketSampleCount = allProfiles.length;
  const industryProfiles = allProfiles.filter(p => p.industry_name === profile.industry_name);
  const industrySampleCount = industryProfiles.length;

  if (marketSampleCount < 30 && industrySampleCount < 10) {
    return profile;
  }

  const regMap = new Map(INDICATOR_REGISTRY.map(r => [r.key, r]));
  const updatedIndicators = profile.indicators.map(ind => {
    if (ind.value === null || ind.status !== 'ready') return ind;
    const reg = regMap.get(ind.key);
    const higherIsBetter = reg?.higher_is_better ?? true;

    let rankMarketPct: number | null = null;
    if (marketSampleCount >= 30) {
      const vals = allProfiles
        .map(p => p.indicators.find(i => i.key === ind.key)?.value ?? null)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      if (vals.length >= 30) {
        const cnt = higherIsBetter === false
          ? vals.filter(v => v >= ind.value!).length
          : vals.filter(v => v <= ind.value!).length;
        rankMarketPct = Math.round((cnt / vals.length) * 100) / 100;
      }
    }

    let rankIndustryPct: number | null = null;
    if (industrySampleCount >= 10) {
      const vals = industryProfiles
        .map(p => p.indicators.find(i => i.key === ind.key)?.value ?? null)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      if (vals.length >= 10) {
        const cnt = higherIsBetter === false
          ? vals.filter(v => v >= ind.value!).length
          : vals.filter(v => v <= ind.value!).length;
        rankIndustryPct = Math.round((cnt / vals.length) * 100) / 100;
      }
    }

    return {
      ...ind,
      rank_market_pct: rankMarketPct,
      rank_industry_pct: rankIndustryPct,
    };
  });

  return {
    ...profile,
    indicators: updatedIndicators,
  };
}

// ---------------------------------------------------------------------------
// Public Entry: getCompanyProfile
// ---------------------------------------------------------------------------
export async function getCompanyProfile(
  pool: Pool | null | undefined,
  code: string,
  forceRefresh = false
): Promise<CompanyProfileResponse> {
  const normCode = code.toUpperCase();

  const cached = MEMORY_PROFILES.get(normCode);
  if (cached && !forceRefresh && !cached.quote.is_stale) {
    return enrichCrossSectionalPercentiles(pool, cached);
  }

  if (pool && typeof pool.query === 'function' && !forceRefresh) {
    try {
      const res = await pool.query<{ indicators: CompanyProfileResponse; updated_at: Date }>(
        `SELECT indicators, updated_at FROM content_company_indicators WHERE company_code = $1`,
        [normCode]
      );
      if (res.rows[0]?.indicators) {
        const ageMs = Date.now() - new Date(res.rows[0].updated_at).getTime();
        const parsed = CompanyProfileResponseSchema.parse(res.rows[0].indicators);
        if (ageMs < 24 * 3600 * 1000 && !parsed.quote.is_stale) {
          MEMORY_PROFILES.set(normCode, parsed);
          return enrichCrossSectionalPercentiles(pool, parsed);
        }
      }
    } catch (err) {
      console.error('getCompanyProfile cache read error:', err);
    }
  }

  const freshProfile = await fetchAndComputeRealCompanyProfile(pool, normCode);
  MEMORY_PROFILES.set(normCode, freshProfile);

  if (pool && typeof pool.query === 'function') {
    try {
      await pool.query(
        `INSERT INTO content_company_indicators (company_code, indicators, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (company_code) DO UPDATE
         SET indicators = EXCLUDED.indicators, updated_at = now()`,
        [normCode, JSON.stringify(freshProfile)]
      );
    } catch (err) {
      console.error('getCompanyProfile cache write error:', err);
    }
  }

  return enrichCrossSectionalPercentiles(pool, freshProfile);
}

