import { z } from 'zod';

/**
 * Opus Project Plan — Authoritative Shared Zod Contracts
 * Imported by BOTH backend (`server/`) and frontend (`src/`).
 * Eliminates all Class-A contract mismatches.
 */

export const FORBIDDEN_RECOMMENDATION_WORDS = [
  '强烈推荐',
  '建议买入',
  '建议卖出',
  '目标价',
  '买入评级',
  '增持评级',
  '减持评级',
  '抄底',
  '逃顶',
  '必涨',
  '翻倍',
  '满仓',
  '梭哈',
] as const;

export function containsForbiddenRecommendation(text: string): string | null {
  for (const word of FORBIDDEN_RECOMMENDATION_WORDS) {
    if (text.includes(word)) return word;
  }
  return null;
}

// 1. Evidence & Source Run (S1 Ingestion & Status)
export const VerificationStatusSchema = z.enum(['primary', 'provider', 'unverified']);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const EvidenceItemSchema = z.object({
  provider: z.string().min(1),
  url: z.string().nullable(),
  title: z.string().min(1),
  observed_at: z.string().min(1),
  as_of: z.string().nullable(),
  verification: VerificationStatusSchema,
  quote: z.string().optional(),
  source_item_id: z.string().optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const FetchRunStatusSchema = z.object({
  provider: z.string().min(1),
  run_id: z.string().min(1),
  status: z.enum(['ok', 'empty', 'partial', 'failed', 'not_configured']),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  item_count: z.number().int().nonnegative(),
  error_class: z.string().nullable(),
  error_message: z.string().nullable(),
});
export type FetchRunStatus = z.infer<typeof FetchRunStatusSchema>;

export const SystemStatusResponseSchema = z.object({
  overall_status: z.enum(['ok', 'empty', 'partial', 'failed', 'not_configured']),
  derived_from_runs: z.array(FetchRunStatusSchema),
  counts: z.object({
    events: z.number().int().nonnegative(),
    nodes: z.number().int().nonnegative(),
    production_edges: z.number().int().nonnegative(),
    companies: z.number().int().nonnegative(),
    verified_exposures: z.number().int().nonnegative(),
  }),
  last_success_at: z.string().nullable(),
});
export type SystemStatusResponse = z.infer<typeof SystemStatusResponseSchema>;

// 2. Industry Chain Graph, Node Logic Card & Company Exposure (P3)
export const NodeTypeSchema = z.enum(['product', 'material', 'equipment', 'service', 'classification', 'component', 'application']);
export const EdgeRelationSchema = z.enum(['input', 'output', 'equipment', 'service', 'classification']);
export const ExposureStrengthSchema = z.enum([
  'primary_over_50',   // 主营 (>50% 营收占比)
  'major_20_to_50',    // 重要 (20%~50% 营收占比)
  'minor_under_20',    // 次要 (<20% 营收占比)
  'verified_business', // 已核实主营披露（未披露精确分项占比）
  'candidate_only',    // 仅概念候选（不进入事件落点）
]);
export type ExposureStrength = z.infer<typeof ExposureStrengthSchema>;

export const MainbzItemSchema = z.object({
  item_name: z.string().min(1),
  mainop_type: z.enum(['product', 'industry', 'region']),
  revenue_yuan: z.number().nullable(),
  revenue_share: z.number().nullable(), // 0..1
  gross_margin: z.number().nullable(),  // 0..1
  report_date: z.string().min(1),
});
export type MainbzItem = z.infer<typeof MainbzItemSchema>;

export const NodeCompanyExposureSchema = z.object({
  exposure_id: z.string().min(1),
  company_code: z.string().regex(/^\d{6}\.(SZ|SH|BJ)$/),
  company_name: z.string().min(1),
  node_id: z.string().min(1),
  node_name: z.string().min(1),
  role: z.string().min(1),
  basis_type: z.enum(['mainbz_revenue', 'ifind_main_product', 'disclosure', 'candidate']),
  basis_text: z.string().min(1),
  matched_product_name: z.string().nullable(),
  revenue_share: z.number().nullable(), // 0..1 from real mainbz
  product_gross_margin: z.number().nullable(), // 0..1 from real mainbz
  report_period: z.string().nullable(),
  strength: ExposureStrengthSchema,
  evidence: z.array(EvidenceItemSchema),
});
export type NodeCompanyExposure = z.infer<typeof NodeCompanyExposureSchema>;

export const NodeLogicCardSchema = z.object({
  node_id: z.string().min(1),
  node_name: z.string().min(1),
  node_type: NodeTypeSchema,
  pricing_mechanism: z.string().min(1),
  key_cost_inputs: z.array(z.string()),
  demand_drivers: z.array(z.string()),
  supply_constraints: z.array(z.string()),
  // Computed in real time from member companies' financial reports (NEVER hardcoded text!)
  computed_margin_stats: z.object({
    sample_count: z.number().int().nonnegative(),
    min_gross_margin: z.number().nullable(),
    median_gross_margin: z.number().nullable(),
    max_gross_margin: z.number().nullable(),
    as_of_report_period: z.string().nullable(),
  }),
  tracked_observations: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      value: z.string().min(1),
      unit: z.string().min(1),
      date: z.string().min(1),
      source: z.string().min(1),
    })
  ),
  citations: z.array(EvidenceItemSchema),
});
export type NodeLogicCard = z.infer<typeof NodeLogicCardSchema>;

export const ChainGraphNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  node_type: NodeTypeSchema,
  origin: z.enum(['ifind', 'disclosure', 'manual_reviewed']),
  aliases: z.array(z.string()),
  layer: z.number().int(), // Directed graph topological layer (0 = upstream, 1 = midstream, 2+ = downstream)
  upstream_count: z.number().int().nonnegative(),
  downstream_count: z.number().int().nonnegative(),
  verified_company_count: z.number().int().nonnegative(),
  computed_median_margin: z.number().nullable(),
  evidence: z.array(EvidenceItemSchema),
});
export type ChainGraphNode = z.infer<typeof ChainGraphNodeSchema>;

export const ChainGraphEdgeSchema = z.object({
  id: z.string().min(1),
  from_id: z.string().min(1),
  from_name: z.string().min(1),
  to_id: z.string().min(1),
  to_name: z.string().min(1),
  relation: EdgeRelationSchema,
  origin: z.enum(['ifind', 'disclosure', 'manual_reviewed']),
  evidence: z.array(EvidenceItemSchema),
});
export type ChainGraphEdge = z.infer<typeof ChainGraphEdgeSchema>;

export const ChainSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  root_node_id: z.string().min(1),
  description: z.string().min(1),
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  company_count: z.number().int().nonnegative(),
  recent_event_count: z.number().int().nonnegative(),
});
export type ChainSummary = z.infer<typeof ChainSummarySchema>;

export const ChainListResponseSchema = z.object({
  chains: z.array(ChainSummarySchema),
});
export type ChainListResponse = z.infer<typeof ChainListResponseSchema>;

export const ChainGraphResponseSchema = z.object({
  chain: ChainSummarySchema,
  nodes: z.array(ChainGraphNodeSchema),
  edges: z.array(ChainGraphEdgeSchema),
  exposures: z.array(NodeCompanyExposureSchema),
});
export type ChainGraphResponse = z.infer<typeof ChainGraphResponseSchema>;

export const NodeDetailResponseSchema = z.object({
  node: ChainGraphNodeSchema,
  logic_card: NodeLogicCardSchema,
  upstream: z.array(ChainGraphEdgeSchema),
  downstream: z.array(ChainGraphEdgeSchema),
  companies: z.array(NodeCompanyExposureSchema),
  recent_events: z.array(
    z.object({
      event_id: z.string().min(1),
      headline: z.string().min(1),
      published_at: z.string().nullable(),
      hop: z.number().int().min(0).max(2),
      direction: z.enum(['favorable', 'unfavorable', 'uncertain']),
      mechanism: z.string().min(1),
    })
  ),
});
export type NodeDetailResponse = z.infer<typeof NodeDetailResponseSchema>;

// 3. Events & Graph-Constrained Transmission (P4)
export const ClaimItemSchema = z.object({
  claim_id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(['fact', 'source_opinion', 'conditional_inference']),
  evidence_status: z.enum(['primary_supported', 'corroborated', 'unverified', 'conflicting', 'refuted']),
  evidence: z.array(EvidenceItemSchema),
});
export type ClaimItem = z.infer<typeof ClaimItemSchema>;

export const EventNodeImpactSchema = z.object({
  impact_id: z.string().min(1),
  node_id: z.string().min(1),
  node_name: z.string().min(1),
  hop: z.number().int().min(0).max(2), // 0 = 震中节点, 1 = 一跳传导, 2 = 二跳传导
  via_edge_id: z.string().nullable(),
  via_edge_relation: EdgeRelationSchema.nullable(),
  from_node_id: z.string().nullable(),
  from_node_name: z.string().nullable(),
  direction: z.enum(['favorable', 'unfavorable', 'uncertain']),
  direction_label: z.string().min(1), // 偏正面 / 偏负面 / 不确定（取决于顺价与库存）
  shock_variable: z.enum(['input_cost', 'selling_price', 'demand', 'supply', 'capacity', 'inventory', 'policy', 'orders']),
  mechanism: z.string().min(1),
  conditions: z.array(z.string()),
  counterforces: z.array(z.string()),
  verify_metric: z.string().min(1),
  depends_on_claim_ids: z.array(z.string()).min(1),
});
export type EventNodeImpact = z.infer<typeof EventNodeImpactSchema>;

export const EventCompanyLandingSchema = z.object({
  company_code: z.string().regex(/^\d{6}\.(SZ|SH|BJ)$/),
  company_name: z.string().min(1),
  node_id: z.string().min(1),
  node_name: z.string().min(1),
  hop: z.number().int().min(0).max(2),
  node_direction: z.enum(['favorable', 'unfavorable', 'uncertain']),
  exposure_strength: ExposureStrengthSchema,
  revenue_share: z.number().nullable(),
  product_gross_margin: z.number().nullable(),
  exposure_basis: z.string().min(1),
  conditional_note: z.string().min(1),
  evidence: z.array(EvidenceItemSchema),
});
export type EventCompanyLanding = z.infer<typeof EventCompanyLandingSchema>;

export const EventSummaryItemSchema = z.object({
  event_id: z.string().min(1),
  version: z.number().int().positive(),
  headline: z.string().min(1),
  summary: z.string().nullable(),
  published_at: z.string().nullable(),
  published_at_source: z.enum(['source', 'parsed', 'unknown']),
  observed_at: z.string().min(1),
  source_name: z.string().min(1),
  source_url: z.string().nullable(),
  importance: z.enum(['major', 'watch']),
  coverage_status: z.enum(['mapped', 'uncovered', 'facts_only']),
  matched_chain_id: z.string().nullable(),
  matched_chain_name: z.string().nullable(),
  epicenter_node_id: z.string().nullable(),
  epicenter_node_name: z.string().nullable(),
  one_line_impact: z.string().min(1),
  evidence_status: z.enum(['primary_supported', 'corroborated', 'unverified']),
  impacted_node_count: z.number().int().nonnegative(),
  landed_company_count: z.number().int().nonnegative(),
});
export type EventSummaryItem = z.infer<typeof EventSummaryItemSchema>;

export const EventListResponseSchema = z.object({
  items: z.array(EventSummaryItemSchema),
  total: z.number().int().nonnegative(),
  system_status: SystemStatusResponseSchema,
});
export type EventListResponse = z.infer<typeof EventListResponseSchema>;

export const EventDetailResponseSchema = z.object({
  event: EventSummaryItemSchema,
  claims: z.array(ClaimItemSchema),
  coverage_gap_reason: z.string().nullable(),
  impacts: z.array(EventNodeImpactSchema),
  subgraph_nodes: z.array(ChainGraphNodeSchema),
  subgraph_edges: z.array(ChainGraphEdgeSchema),
  company_landings: z.array(EventCompanyLandingSchema),
  missing_evidence: z.array(z.string()),
});
export type EventDetailResponse = z.infer<typeof EventDetailResponseSchema>;

// 4. Financial Data Foundation & 40-Indicator PIT Registry (P1)
export const IndicatorCategorySchema = z.enum([
  'valuation',
  'profitability',
  'fscore',
  'cashflow_redflag',
  'dividend',
  'volatility_momentum',
]);
export type IndicatorCategory = z.infer<typeof IndicatorCategorySchema>;

export const IndicatorRegistryItemSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  category: IndicatorCategorySchema,
  unit: z.string().min(1),
  formula: z.string().min(1),
  raw_inputs: z.array(z.string()).min(1),
  frequency: z.enum(['daily', 'quarterly', 'event']),
  pit_rule: z.string().min(1),
  higher_is_better: z.boolean().nullable(),
  not_applicable_industries: z.array(z.string()),
  used_by_strategies: z.array(z.string()),
});
export type IndicatorRegistryItem = z.infer<typeof IndicatorRegistryItemSchema>;

export const IndicatorRegistryResponseSchema = z.object({
  total: z.number().int().positive(),
  items: z.array(IndicatorRegistryItemSchema),
});
export type IndicatorRegistryResponse = z.infer<typeof IndicatorRegistryResponseSchema>;

export const IndicatorSnapshotValueSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  category: IndicatorCategorySchema,
  value: z.number().nullable(),
  formatted_value: z.string().min(1),
  unit: z.string().min(1),
  yoy_delta: z.number().nullable(),
  rank_market_pct: z.number().nullable(),   // 0..1 (1 = highest in universe)
  rank_industry_pct: z.number().nullable(), // 0..1 (1 = highest in industry)
  status: z.enum(['ready', 'missing', 'not_applicable', 'stale', 'upstream_failed']),
  report_period: z.string().nullable(),
  announcement_datetime: z.string().nullable(),
  usable_trade_date: z.string().nullable(),
  restatement_datetime: z.string().nullable(),
  source_provider: z.string().min(1),
  note: z.string().nullable(),
});
export type IndicatorSnapshotValue = z.infer<typeof IndicatorSnapshotValueSchema>;

// 5. Pluggable Strategy Engine & DSL (P2)
export const StrategyDslOperandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ind'), key: z.string().min(1) }),
  z.object({ kind: z.literal('rank_industry'), key: z.string().min(1) }),
  z.object({ kind: z.literal('rank_market'), key: z.string().min(1) }),
  z.object({ kind: z.literal('delta_yoy'), key: z.string().min(1) }),
]);
export type StrategyDslOperand = z.infer<typeof StrategyDslOperandSchema>;

export const StrategyDslLeafConditionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  operand: StrategyDslOperandSchema,
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
  threshold: z.number(),
  negate: z.boolean().optional(),
  is_redflag_veto: z.boolean().optional(),
});
export type StrategyDslLeafCondition = z.infer<typeof StrategyDslLeafConditionSchema>;

export const StrategyDslSpecSchema = z.object({
  combinator: z.enum(['all', 'any']),
  conditions: z.array(StrategyDslLeafConditionSchema).min(1),
  missing_policy: z.enum(['insufficient', 'skip_condition']).default('insufficient'),
});
export type StrategyDslSpec = z.infer<typeof StrategyDslSpecSchema>;

export const StrategyManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['value', 'quality', 'redflag', 'dividend', 'lowvol', 'event_exposure', 'custom']),
  kind: z.enum(['code', 'dsl']),
  enabled: z.boolean(),
  is_builtin: z.boolean(),
  description: z.string().min(1),
  academic_basis: z.string().min(1),
  required_indicators: z.array(z.string()),
  dsl: StrategyDslSpecSchema.nullable(),
  updated_at: z.string().min(1),
});
export type StrategyManifest = z.infer<typeof StrategyManifestSchema>;

export const StrategyConditionTraceSchema = z.object({
  condition_id: z.string().min(1),
  label: z.string().min(1),
  indicator_key: z.string().min(1),
  operand_kind: z.enum(['ind', 'rank_industry', 'rank_market', 'delta_yoy']),
  actual_value: z.number().nullable(),
  actual_formatted: z.string().min(1),
  operator: z.string().min(1),
  threshold: z.number(),
  passed: z.boolean().nullable(), // null when missing
  is_redflag_veto: z.boolean(),
  explanation: z.string().min(1),
});
export type StrategyConditionTrace = z.infer<typeof StrategyConditionTraceSchema>;

export const StrategyRunResultSchema = z.object({
  strategy_id: z.string().min(1),
  strategy_version: z.string().min(1),
  strategy_name: z.string().min(1),
  category: StrategyManifestSchema.shape.category,
  kind: z.enum(['code', 'dsl']),
  enabled: z.boolean(),
  is_builtin: z.boolean(),
  tier: z.enum(['favorable', 'neutral', 'cautionary', 'insufficient_data']),
  tier_label: z.string().min(1),
  score: z.number().min(0).max(100).nullable(),
  conclusion: z.string().min(1),
  reasons: z.array(z.string()).min(1),
  risks: z.array(z.string()).min(1),
  condition_traces: z.array(StrategyConditionTraceSchema),
  data_cutoff: z.string().nullable(),
  missing_indicators: z.array(z.string()),
  inputs_hash: z.string().min(1),
  evaluated_at: z.string().min(1),
});
export type StrategyRunResult = z.infer<typeof StrategyRunResultSchema>;

export const CompanyProfileResponseSchema = z.object({
  code: z.string().regex(/^\d{6}\.(SZ|SH|BJ)$/),
  name: z.string().min(1),
  industry_name: z.string().min(1),
  business_scope: z.string().min(1),
  latest_report_period: z.string().nullable(),
  latest_notice_date: z.string().nullable(),
  quote: z.object({
    price: z.number().nullable(),
    total_mv_yi: z.number().nullable(),
    pe_ttm: z.number().nullable(),
    pb_mrq: z.number().nullable(),
    trade_date: z.string().nullable(),
    is_stale: z.boolean(),
  }),
  mainbz: z.array(MainbzItemSchema),
  node_exposures: z.array(NodeCompanyExposureSchema),
  recent_node_events: z.array(
    z.object({
      event_id: z.string().min(1),
      headline: z.string().min(1),
      published_at: z.string().nullable(),
      node_id: z.string().min(1),
      node_name: z.string().min(1),
      hop: z.number().int().min(0).max(2),
      direction: z.enum(['favorable', 'unfavorable', 'uncertain']),
      mechanism: z.string().min(1),
      exposure_strength: ExposureStrengthSchema,
      revenue_share: z.number().nullable(),
    })
  ),
  indicators: z.array(IndicatorSnapshotValueSchema),
  indicator_summary: z.object({
    total: z.number().int().positive(),
    ready: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    not_applicable: z.number().int().nonnegative(),
    is_stale: z.boolean(),
    as_of_trade_date: z.string().nullable(),
  }),
  strategies: z.array(StrategyRunResultSchema),
});
export type CompanyProfileResponse = z.infer<typeof CompanyProfileResponseSchema>;

export const StrategyListResponseSchema = z.object({
  strategies: z.array(StrategyManifestSchema),
});
export type StrategyListResponse = z.infer<typeof StrategyListResponseSchema>;

export const CreateStrategyRequestSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(2).max(80),
  category: z.enum(['value', 'quality', 'redflag', 'dividend', 'lowvol', 'event_exposure', 'custom']).default('custom'),
  description: z.string().trim().min(4).max(400),
  academic_basis: z.string().trim().min(2).max(200).default('自定义多因子规则'),
  dsl: StrategyDslSpecSchema,
});
export type CreateStrategyRequest = z.infer<typeof CreateStrategyRequestSchema>;
