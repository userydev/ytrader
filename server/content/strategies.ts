import { createHash } from 'node:crypto';
import type { Pool } from '../db.js';
import { ApiError } from '../auth.js';
import {
  type StrategyManifest,
  type StrategyDslSpec,
  type StrategyConditionTrace,
  type StrategyRunResult,
  type StrategyListResponse,
  type CreateStrategyRequest,
  type IndicatorSnapshotValue,
  type NodeCompanyExposure,
  StrategyManifestSchema,
  StrategyRunResultSchema,
  StrategyListResponseSchema,
  CreateStrategyRequestSchema,
  containsForbiddenRecommendation,
} from '../../src/contracts/index.js';

// In-memory store for custom strategies
const MEMORY_CUSTOM_STRATEGIES = new Map<string, StrategyManifest>();

const MODULE_LOADED_AT = new Date().toISOString();

// ---------------------------------------------------------------------------
// 4 Core Built-In Strategies (Opus §7.2)
// ---------------------------------------------------------------------------
export const BUILTIN_STRATEGIES: StrategyManifest[] = [
  {
    id: 'value_ep_industry',
    version: '1.0.0',
    name: 'A股价值与行业分位策略',
    category: 'value',
    kind: 'dsl',
    enabled: true,
    is_builtin: true,
    description:
      '基于中国 A 股盈利收益率 (E/P) 与扣非 E/P 行业分位，剔除 ST 风险警示与后 30% 小微盘壳污染，筛选权益估值具安全边际的优质标的。',
    academic_basis: 'Liu, Stambaugh & Yuan (2019) Size and Value in China; Lakonishok et al. (1994)',
    required_indicators: ['ep_ttm', 'ep_deduct_ttm', 'bp_mrq', 'is_st_risk', 'shell_size_flag'],
    dsl: {
      combinator: 'all',
      missing_policy: 'insufficient',
      conditions: [
        {
          id: 'c_ep_ind_pct',
          label: 'E/P 处于同行业前 40% 分位 (行业分位 ≥ 0.60)',
          operand: { kind: 'rank_industry', key: 'ep_ttm' },
          operator: 'gte',
          threshold: 0.6,
        },
        {
          id: 'c_ep_deduct',
          label: '扣非盈利收益率 > 3.0%',
          operand: { kind: 'ind', key: 'ep_deduct_ttm' },
          operator: 'gt',
          threshold: 3.0,
        },
        {
          id: 'c_bp_mrq',
          label: '账面市值比 (B/P) > 0.15',
          operand: { kind: 'ind', key: 'bp_mrq' },
          operator: 'gt',
          threshold: 0.15,
        },
        {
          id: 'veto_st',
          label: '排除 ST / *ST 风险警示',
          operand: { kind: 'ind', key: 'is_st_risk' },
          operator: 'eq',
          threshold: 0,
          is_redflag_veto: true,
        },
        {
          id: 'veto_shell',
          label: '排除市值 ≤ 35 亿元小微盘壳污染',
          operand: { kind: 'ind', key: 'shell_size_flag' },
          operator: 'eq',
          threshold: 0,
          is_redflag_veto: true,
        },
      ],
    },
    updated_at: MODULE_LOADED_AT,
  },
  {
    id: 'quality_fscore_gpa',
    version: '1.0.0',
    name: 'Piotroski F-Score 与 GP/A 质量策略',
    category: 'quality',
    kind: 'dsl',
    enabled: true,
    is_builtin: true,
    description:
      '结合 Piotroski 9 项财务改善信号与 Novy-Marx 毛利总资产比 (GP/A) 行业分位，筛选盈利质量扎实、资产创利能力强的企业。',
    academic_basis: 'Piotroski (2000) Value Investing; Novy-Marx (2013) The Other Side of Value',
    required_indicators: ['fscore_total', 'gpa', 'roe_jq'],
    dsl: {
      combinator: 'all',
      missing_policy: 'insufficient',
      conditions: [
        {
          id: 'c_fscore_gte_6',
          label: 'Piotroski F-Score 综合得分 ≥ 6 分',
          operand: { kind: 'ind', key: 'fscore_total' },
          operator: 'gte',
          threshold: 6,
        },
        {
          id: 'c_gpa_ind_pct',
          label: 'GP/A 处于同行业中位数以上 (行业分位 ≥ 0.50)',
          operand: { kind: 'rank_industry', key: 'gpa' },
          operator: 'gte',
          threshold: 0.5,
        },
        {
          id: 'c_roe_jq',
          label: '加权净资产收益率 (ROE) ≥ 8.0%',
          operand: { kind: 'ind', key: 'roe_jq' },
          operator: 'gte',
          threshold: 8.0,
        },
      ],
    },
    updated_at: MODULE_LOADED_AT,
  },
  {
    id: 'financial_redflags',
    version: '1.0.0',
    name: 'Sloan 应计与财务红旗排雷策略',
    category: 'redflag',
    kind: 'dsl',
    enabled: true,
    is_builtin: true,
    description:
      '利用 Sloan 会计应计异象、经营现金流对净利润覆盖度及资产负债率，排查盈利操纵、回款虚高与债务杠杆过大风险。',
    academic_basis:
      'Sloan (1996) Do Stock Prices Fully Reflect Information in Accruals?; Dechow et al. (2011)',
    required_indicators: ['sloan_accrual', 'cfo_to_np', 'debt_ratio', 'is_st_risk'],
    dsl: {
      combinator: 'all',
      missing_policy: 'insufficient',
      conditions: [
        {
          id: 'c_sloan',
          label: 'Sloan 应计比率 ≤ 8.0% (防范应计利润虚增)',
          operand: { kind: 'ind', key: 'sloan_accrual' },
          operator: 'lte',
          threshold: 8.0,
        },
        {
          id: 'c_cfo_np',
          label: '净现比 (CFO/NP) ≥ 0.80 倍 (利润含金量充足)',
          operand: { kind: 'ind', key: 'cfo_to_np' },
          operator: 'gte',
          threshold: 0.8,
        },
        {
          id: 'c_debt_ratio',
          label: '资产负债率 ≤ 70.0% (杠杆处于稳健区间)',
          operand: { kind: 'ind', key: 'debt_ratio' },
          operator: 'lte',
          threshold: 70.0,
        },
        {
          id: 'veto_st_flag',
          label: '排除 ST / *ST 风险警示状态',
          operand: { kind: 'ind', key: 'is_st_risk' },
          operator: 'eq',
          threshold: 0,
          is_redflag_veto: true,
        },
      ],
    },
    updated_at: MODULE_LOADED_AT,
  },
  {
    id: 'chain_event_exposure',
    version: '1.0.0',
    name: '产业链节点与事件暴露联动策略',
    category: 'event_exposure',
    kind: 'code',
    enabled: true,
    is_builtin: true,
    description:
      '联动产业链有向图知识库与近 30 天宏观/行业事件冲击，基于公司已核实的主营业务产品收入占比，评估产业链地位与边际事件传导收益。',
    academic_basis: 'Cohen & Frazzini (2008) Economic Links and Predictable Returns',
    required_indicators: ['main_products_count'],
    dsl: null,
    updated_at: MODULE_LOADED_AT,
  },
];

// ---------------------------------------------------------------------------
// DSL Evaluator
// ---------------------------------------------------------------------------
export function evaluateDslSpec(
  dsl: StrategyDslSpec,
  indicatorsMap: Map<string, IndicatorSnapshotValue>,
  strategyId: string,
  strategyName: string,
  category: StrategyManifest['category'],
  isBuiltin: boolean
): StrategyRunResult {
  const traces: StrategyConditionTrace[] = [];
  const missingIndicators: string[] = [];
  let hasVetoFail = false;
  let passCount = 0;
  let hasMissing = false;

  for (const cond of dsl.conditions) {
    const key = cond.operand.key;
    const snap = indicatorsMap.get(key);

    let actualVal: number | null = null;
    let actualFormatted = '--';

    if (snap && snap.status === 'ready' && snap.value !== null && !Number.isNaN(snap.value)) {
      if (cond.operand.kind === 'ind') {
        actualVal = snap.value;
        actualFormatted = snap.formatted_value;
      } else if (cond.operand.kind === 'rank_industry') {
        actualVal = snap.rank_industry_pct;
        actualFormatted = snap.rank_industry_pct !== null ? `${Math.round(snap.rank_industry_pct * 100)}%` : '--';
      } else if (cond.operand.kind === 'rank_market') {
        actualVal = snap.rank_market_pct;
        actualFormatted = snap.rank_market_pct !== null ? `${Math.round(snap.rank_market_pct * 100)}%` : '--';
      } else if (cond.operand.kind === 'delta_yoy') {
        actualVal = snap.yoy_delta;
        actualFormatted = snap.yoy_delta !== null ? `${snap.yoy_delta.toFixed(2)}%` : '--';
      }
    }

    if (actualVal === null || Number.isNaN(actualVal)) {
      const missingDesc =
        cond.operand.kind === 'rank_industry'
          ? `${key}(同业截面分位)`
          : cond.operand.kind === 'rank_market'
            ? `${key}(全市场截面分位)`
            : key;
      missingIndicators.push(missingDesc);
      hasMissing = true;
    }

    let passed: boolean | null = null;
    let explanation = '';

    if (actualVal === null || Number.isNaN(actualVal)) {
      passed = null; // Strict rule: missing never passes
      explanation =
        cond.operand.kind === 'rank_industry' || cond.operand.kind === 'rank_market'
          ? `指标 ${key} 尚未具备足够同业/全市场截面样本计算分位，暂不判定`
          : `指标 ${key} 数据缺失或不适用，无法判定条件`;
    } else {
      let rawPassed = false;
      switch (cond.operator) {
        case 'gt':
          rawPassed = actualVal > cond.threshold;
          break;
        case 'gte':
          rawPassed = actualVal >= cond.threshold;
          break;
        case 'lt':
          rawPassed = actualVal < cond.threshold;
          break;
        case 'lte':
          rawPassed = actualVal <= cond.threshold;
          break;
        case 'eq':
          rawPassed = Math.abs(actualVal - cond.threshold) < 1e-6;
          break;
      }

      passed = cond.negate ? !rawPassed : rawPassed;
      explanation = passed
        ? `${cond.label}：实际值 ${actualFormatted} 满足阈值要求`
        : `${cond.label}：实际值 ${actualFormatted} 未达阈值要求`;

      if (cond.is_redflag_veto && !passed) {
        hasVetoFail = true;
        explanation += ' [触碰红旗一票否决]';
      }

      if (passed) {
        passCount++;
      }
    }

    traces.push({
      condition_id: cond.id,
      label: cond.label,
      indicator_key: key,
      operand_kind: cond.operand.kind,
      actual_value: actualVal,
      actual_formatted: actualFormatted,
      operator: cond.operator,
      threshold: cond.threshold,
      passed,
      is_redflag_veto: !!cond.is_redflag_veto,
      explanation,
    });
  }

  let tier: 'favorable' | 'neutral' | 'cautionary' | 'insufficient_data' = 'neutral';
  let tierLabel = '中性待观察';
  let score: number | null = null;
  const reasons: string[] = [];
  const risks: string[] = [];

  if (hasVetoFail) {
    tier = 'cautionary';
    tierLabel = '风险预警';
    score = 25;
    reasons.push('触碰策略设定的负面排雷红旗约束条件');
    for (const t of traces.filter(x => x.is_redflag_veto && x.passed === false)) {
      reasons.push(t.explanation);
      risks.push(`存在红旗风险：${t.label}`);
    }
  } else if (hasMissing && dsl.missing_policy === 'insufficient') {
    tier = 'insufficient_data';
    tierLabel = '数据不足 / 暂不判断';
    reasons.push(`核心条件所需数据或截面分位暂缺（缺项：${missingIndicators.join(', ')}），按规则不作强行判断`);
    risks.push('缺少足够同行业截面样本或部分报告期字段，待截面样本齐备后重算');
  } else if (dsl.combinator === 'all') {
    const totalValidConditions = traces.filter(t => !t.is_redflag_veto).length;
    const nonVetoPassed = traces.filter(t => !t.is_redflag_veto && t.passed === true).length;

    if (totalValidConditions > 0 && nonVetoPassed === totalValidConditions) {
      tier = 'favorable';
      tierLabel = '偏正面支持';
      score = 85;
      reasons.push('全部正向质量与考核条件均得到充分满足');
      for (const t of traces.filter(x => x.passed === true)) {
        reasons.push(t.explanation);
      }
    } else if (nonVetoPassed > 0) {
      tier = 'neutral';
      tierLabel = '中性平衡';
      score = Math.round((nonVetoPassed / totalValidConditions) * 100);
      reasons.push(`部分满足考核条件 (${nonVetoPassed}/${totalValidConditions})，整体处于中性区间`);
      for (const t of traces.filter(x => x.passed === false)) {
        risks.push(`未达预期指标：${t.label}`);
      }
    } else {
      tier = 'cautionary';
      tierLabel = '偏谨慎提示';
      score = 35;
      reasons.push('核心考核条件均未达到门槛要求');
      for (const t of traces.filter(x => x.passed === false)) {
        risks.push(t.explanation);
      }
    }
  } else {
    if (passCount > 0) {
      tier = 'favorable';
      tierLabel = '偏正面支持';
      score = 75;
      reasons.push(`满足任一正向触发条件 (命中 ${passCount} 项)`);
      for (const t of traces.filter(x => x.passed === true)) {
        reasons.push(t.explanation);
      }
    } else {
      tier = 'neutral';
      tierLabel = '中性待观察';
      score = 50;
      reasons.push('未触发任意正向条件');
      risks.push('指标处于平淡区间，无明显催化信号');
    }
  }

  if (risks.length === 0) {
    risks.push('需持续跟踪下一季度财报披露与行业景气度变化');
  }

  const hashInput = JSON.stringify({
    strategyId,
    indicators: Array.from(indicatorsMap.entries()).map(([k, v]) => [k, v.value, v.rank_industry_pct]),
  });
  const inputsHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
  const actualReportCutoff =
    Array.from(indicatorsMap.values()).find(v => v.report_period)?.report_period ?? null;

  const result: StrategyRunResult = {
    strategy_id: strategyId,
    strategy_version: '1.0.0',
    strategy_name: strategyName,
    category,
    kind: 'dsl',
    enabled: true,
    is_builtin: isBuiltin,
    tier,
    tier_label: tierLabel,
    score,
    conclusion: `${strategyName}：${tierLabel}。${reasons[0] || ''}`,
    reasons: reasons.slice(0, 5),
    risks: risks.slice(0, 3),
    condition_traces: traces,
    data_cutoff: actualReportCutoff,
    missing_indicators: missingIndicators,
    inputs_hash: inputsHash,
    evaluated_at: new Date().toISOString(),
  };

  return StrategyRunResultSchema.parse(result);
}

// ---------------------------------------------------------------------------
// Chain Event Exposure Strategy Evaluator (Code Plugin)
// ---------------------------------------------------------------------------
export function evaluateChainEventExposure(
  nodeExposures: NodeCompanyExposure[],
  recentEvents: Array<{
    event_id: string;
    headline: string;
    published_at: string | null;
    node_id: string;
    node_name: string;
    direction: 'favorable' | 'unfavorable' | 'uncertain';
    mechanism: string;
  }>,
  dataCutoff: string | null = null
): StrategyRunResult {
  const verifiedExposures = nodeExposures.filter(e => e.strength !== 'candidate_only');
  const reasons: string[] = [];
  const risks: string[] = [];
  let tier: 'favorable' | 'neutral' | 'cautionary' | 'insufficient_data' = 'neutral';
  let tierLabel = '中性待观察';
  let score: number | null = 55;

  if (verifiedExposures.length === 0) {
    tier = 'insufficient_data';
    tierLabel = '产业链未覆盖';
    score = null;
    reasons.push('该标的暂未挂载到已建库的 3 条核心产业链权威节点上，无法进行产业链传导推断');
    risks.push('缺少主营业务产品对核心工业链条的明确暴露依据');
  } else {
    reasons.push(
      `标的在产业链图谱中挂载 ${verifiedExposures.length} 个核实节点：${verifiedExposures
        .map(e => `${e.node_name}(占比${e.revenue_share ? Math.round(e.revenue_share * 100) : '--'}%)`)
        .join('、')}`
    );

    const hitEvents = recentEvents.filter(ev => verifiedExposures.some(exp => exp.node_id === ev.node_id));
    if (hitEvents.length > 0) {
      const favCount = hitEvents.filter(e => e.direction === 'favorable').length;
      const unfavCount = hitEvents.filter(e => e.direction === 'unfavorable').length;

      if (favCount > unfavCount) {
        tier = 'favorable';
        tierLabel = '产业链利好传导';
        score = 82;
        reasons.push(`近 30 天内相关节点发生 ${favCount} 起正向催化事件`);
        for (const ev of hitEvents.slice(0, 2)) {
          reasons.push(`事件【${ev.headline}】对节点【${ev.node_name}】形成传导：${ev.mechanism}`);
        }
        risks.push('需跟踪下游实际排产、订单转化率及原材料价格异动对传导弹性的削弱风险');
      } else if (unfavCount > favCount) {
        tier = 'cautionary';
        tierLabel = '产业链利空承压';
        score = 38;
        reasons.push(`近 30 天内相关节点发生 ${unfavCount} 起负向冲击事件`);
        for (const ev of hitEvents.slice(0, 2)) {
          risks.push(`节点【${ev.node_name}】受冲击：${ev.mechanism}`);
        }
      } else {
        tier = 'neutral';
        tierLabel = '产业链多空平衡';
        score = 60;
        reasons.push(`近 30 天相关节点多空事件交织，传导机制取决于顺价弹性与库存周期`);
        risks.push('多空因素交织下需观察下一报告期毛利率与合同负债是否印证传导方向');
      }
    } else {
      tier = 'neutral';
      tierLabel = '产业链平稳运行';
      score = 65;
      reasons.push('近 30 天内核心暴露节点未受异常外生冲击，产业基本面供需维持常态');
      risks.push('需关注上游原材料涨价与下游终端景气度波动对利润池分配的影响');
    }
  }

  const result: StrategyRunResult = {
    strategy_id: 'chain_event_exposure',
    strategy_version: '1.0.0',
    strategy_name: '产业链节点与事件暴露联动策略',
    category: 'event_exposure',
    kind: 'code',
    enabled: true,
    is_builtin: true,
    tier,
    tier_label: tierLabel,
    score,
    conclusion: `产业链与事件联动：${tierLabel}。${reasons[0] || ''}`,
    reasons: reasons.slice(0, 5),
    risks: risks.slice(0, 3),
    condition_traces: [
      {
        condition_id: 'cond_node_exposure',
        label: '具备明确的产业链节点核实挂载依据',
        indicator_key: 'main_products_count',
        operand_kind: 'ind',
        actual_value: verifiedExposures.length,
        actual_formatted: `${verifiedExposures.length} 个节点`,
        operator: 'gt',
        threshold: 0,
        passed: verifiedExposures.length > 0,
        is_redflag_veto: false,
        explanation:
          verifiedExposures.length > 0
            ? '已通过主营收入拆分核实节点暴露'
            : '未命中已建库的 3 条核心产业链节点',
      },
    ],
    data_cutoff: dataCutoff,
    missing_indicators: verifiedExposures.length === 0 ? ['产业链节点挂载关系'] : [],
    inputs_hash: createHash('sha256')
      .update(JSON.stringify({ exposures: verifiedExposures.map(e => e.node_id), events: recentEvents.map(e => e.event_id) }))
      .digest('hex')
      .slice(0, 16),
    evaluated_at: new Date().toISOString(),
  };

  return StrategyRunResultSchema.parse(result);
}

// ---------------------------------------------------------------------------
// Evaluate all strategies for a company profile
// ---------------------------------------------------------------------------
export async function evaluateCompanyStrategies(
  indicators: IndicatorSnapshotValue[],
  nodeExposures: NodeCompanyExposure[],
  recentEvents: Array<{
    event_id: string;
    headline: string;
    published_at: string | null;
    node_id: string;
    node_name: string;
    direction: 'favorable' | 'unfavorable' | 'uncertain';
    mechanism: string;
  }>,
  pool?: Pool
): Promise<StrategyRunResult[]> {
  const map = new Map<string, IndicatorSnapshotValue>();
  for (const ind of indicators) {
    map.set(ind.key, ind);
  }
  const actualReportCutoff = indicators.find(v => v.report_period)?.report_period ?? null;

  const allManifests = await listStrategies(pool);
  const results: StrategyRunResult[] = [];

  for (const st of allManifests.strategies) {
    if (!st.enabled) continue;

    if (st.id === 'chain_event_exposure') {
      results.push(evaluateChainEventExposure(nodeExposures, recentEvents, actualReportCutoff));
    } else if (st.dsl) {
      results.push(evaluateDslSpec(st.dsl, map, st.id, st.name, st.category, st.is_builtin));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Strategy Management: List, Create, Toggle, Delete
// ---------------------------------------------------------------------------
export async function listStrategies(pool?: Pool): Promise<StrategyListResponse> {
  if (pool && typeof pool.query === 'function') {
    try {
      const res = await pool.query<{
        id: string;
        name: string;
        category: StrategyManifest['category'];
        source_citation: string;
        description: string;
        builtin: boolean;
        enabled: boolean;
        rule_config: StrategyDslSpec;
        updated_at: string;
      }>('SELECT * FROM content_strategy_plugins');

      for (const row of res.rows) {
        if (!row.builtin && !MEMORY_CUSTOM_STRATEGIES.has(row.id)) {
          MEMORY_CUSTOM_STRATEGIES.set(row.id, {
            id: row.id,
            version: '1.0.0',
            name: row.name,
            category: row.category,
            kind: 'dsl',
            enabled: row.enabled,
            is_builtin: false,
            description: row.description,
            academic_basis: row.source_citation || '用户自定义多因子规则',
            required_indicators: row.rule_config?.conditions?.map(c => c.operand.key) || [],
            dsl: row.rule_config,
            updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : MODULE_LOADED_AT,
          });
        }
      }
    } catch (err) {
      console.error('listStrategies db error:', err);
    }
  }

  const combined = [...BUILTIN_STRATEGIES, ...Array.from(MEMORY_CUSTOM_STRATEGIES.values())];
  return StrategyListResponseSchema.parse({ strategies: combined });
}

export async function createCustomStrategy(
  pool: Pool | undefined,
  input: CreateStrategyRequest
): Promise<StrategyManifest> {
  const validated = CreateStrategyRequestSchema.parse(input);

  const forbiddenWord =
    containsForbiddenRecommendation(validated.name) ||
    containsForbiddenRecommendation(validated.description) ||
    containsForbiddenRecommendation(validated.academic_basis);

  if (forbiddenWord) {
    throw new ApiError(422, 'FORBIDDEN_CONTENT', `策略定义包含荐股或买卖建议禁词：“${forbiddenWord}”，严禁提交`);
  }

  if (BUILTIN_STRATEGIES.some(s => s.id === validated.id)) {
    throw new ApiError(400, 'ID_CONFLICT', '不能覆盖内置策略 ID');
  }

  const requiredIndicators = Array.from(new Set(validated.dsl.conditions.map(c => c.operand.key)));

  const manifest: StrategyManifest = {
    id: validated.id,
    version: '1.0.0',
    name: validated.name,
    category: validated.category,
    kind: 'dsl',
    enabled: true,
    is_builtin: false,
    description: validated.description,
    academic_basis: validated.academic_basis,
    required_indicators: requiredIndicators,
    dsl: validated.dsl,
    updated_at: new Date().toISOString(),
  };

  const parsed = StrategyManifestSchema.parse(manifest);

  if (pool && typeof pool.query === 'function') {
    await pool.query(
      `INSERT INTO content_strategy_plugins (id, name, category, source_citation, description, builtin, enabled, rule_config, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, true, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         rule_config = EXCLUDED.rule_config,
         updated_at = now()`,
      [parsed.id, parsed.name, parsed.category, parsed.academic_basis, parsed.description, JSON.stringify(parsed.dsl)]
    );
  }

  MEMORY_CUSTOM_STRATEGIES.set(parsed.id, parsed);
  return parsed;
}

export async function toggleStrategy(
  pool: Pool | undefined,
  id: string,
  enabled: boolean
): Promise<{ success: boolean; id: string; enabled: boolean }> {
  const builtin = BUILTIN_STRATEGIES.find(s => s.id === id);
  if (builtin) {
    builtin.enabled = enabled;
    return { success: true, id, enabled };
  }

  const custom = MEMORY_CUSTOM_STRATEGIES.get(id);
  if (!custom) {
    throw new ApiError(404, 'NOT_FOUND', `未找到策略 ID: ${id}`);
  }

  if (pool && typeof pool.query === 'function') {
    await pool.query('UPDATE content_strategy_plugins SET enabled = $1, updated_at = now() WHERE id = $2', [
      enabled,
      id,
    ]);
  }

  custom.enabled = enabled;
  return { success: true, id, enabled };
}

export async function deleteCustomStrategy(
  pool: Pool | undefined,
  id: string
): Promise<{ success: boolean; id: string }> {
  if (BUILTIN_STRATEGIES.some(s => s.id === id)) {
    throw new ApiError(400, 'FORBIDDEN', '内置核心策略不可删除');
  }

  if (!MEMORY_CUSTOM_STRATEGIES.has(id)) {
    throw new ApiError(404, 'NOT_FOUND', `未找到自定义策略 ID: ${id}`);
  }

  if (pool && typeof pool.query === 'function') {
    await pool.query('DELETE FROM content_strategy_plugins WHERE id = $1 AND builtin = false', [id]);
  }

  MEMORY_CUSTOM_STRATEGIES.delete(id);
  return { success: true, id };
}

