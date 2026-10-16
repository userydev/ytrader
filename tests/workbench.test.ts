import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SystemStatusResponseSchema,
  EventListResponseSchema,
  EventDetailResponseSchema,
  ChainListResponseSchema,
  ChainGraphResponseSchema,
  NodeDetailResponseSchema,
  CompanyProfileResponseSchema,
  StrategyListResponseSchema,
  IndicatorRegistryResponseSchema,
  CreateStrategyRequestSchema,
  containsForbiddenRecommendation,
} from '../src/contracts/index.js';

test('Contracts — SystemStatusResponse validates real system metrics and derived runs', () => {
  const validStatus = {
    overall_status: 'ok',
    derived_from_runs: [
      {
        provider: 'eastmoney_f10',
        run_id: 'run_123',
        status: 'ok',
        started_at: '2026-10-16T08:00:00Z',
        finished_at: '2026-10-16T08:00:02Z',
        item_count: 40,
        error_class: null,
        error_message: null,
      },
    ],
    counts: {
      events: 23,
      nodes: 26,
      production_edges: 32,
      companies: 15,
      verified_exposures: 28,
    },
    last_success_at: '2026-10-16T08:00:02Z',
  };

  const parsed = SystemStatusResponseSchema.parse(validStatus);
  assert.equal(parsed.overall_status, 'ok');
  assert.equal(parsed.counts.events, 23);
  assert.equal(parsed.derived_from_runs.length, 1);
});

test('Contracts — EventListResponse enforces { items, total, system_status } structure', () => {
  const validList = {
    items: [
      {
        event_id: 'ev_001',
        version: 1,
        headline: '多家头部新能源车企追加高能量密度动力电池订单',
        summary: '电芯排产负荷提升带动供应链核心部件需求',
        published_at: '2026-10-16T08:30:00Z',
        published_at_source: 'source',
        observed_at: '2026-10-16T08:35:00Z',
        source_name: '行业披露与快讯',
        source_url: null,
        importance: 'major',
        coverage_status: 'mapped',
        matched_chain_id: 'lithium_energy',
        matched_chain_name: '锂电与储能产业链',
        epicenter_node_id: 'ifind:1879',
        epicenter_node_name: '动力电池',
        one_line_impact: '直接刺激动力电芯排产提升',
        evidence_status: 'primary_supported',
        impacted_node_count: 2,
        landed_company_count: 3,
      },
    ],
    total: 1,
    system_status: {
      overall_status: 'ok',
      derived_from_runs: [],
      counts: { events: 1, nodes: 10, production_edges: 12, companies: 5, verified_exposures: 6 },
      last_success_at: '2026-10-16T08:00:00Z',
    },
  };

  const parsed = EventListResponseSchema.parse(validList);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].headline, '多家头部新能源车企追加高能量密度动力电池订单');
  assert.equal(parsed.items[0].coverage_status, 'mapped');

  // Must reject bare arrays
  assert.throws(() => {
    EventListResponseSchema.parse(validList.items as any);
  });
});

test('Contracts — EventDetailResponse supports claims, local subgraph and company landings', () => {
  const validDetail = {
    event: {
      event_id: 'ev_001',
      version: 1,
      headline: '多家头部新能源车企追加高能量密度动力电池订单',
      summary: null,
      published_at: null, // Test explicit null handling
      published_at_source: 'unknown',
      observed_at: '2026-10-16T08:00:00Z',
      source_name: '产业快讯',
      source_url: null,
      importance: 'major',
      coverage_status: 'mapped',
      matched_chain_id: 'lithium_energy',
      matched_chain_name: '锂电与储能产业链',
      epicenter_node_id: 'ifind:1879',
      epicenter_node_name: '动力电池',
      one_line_impact: '电芯环节需求扩张',
      evidence_status: 'primary_supported',
      impacted_node_count: 1,
      landed_company_count: 1,
    },
    claims: [
      {
        claim_id: 'c1',
        text: '车企追加电池订单',
        kind: 'fact',
        evidence_status: 'primary_supported',
        evidence: [
          {
            provider: '公告披露',
            url: null,
            title: '订单公告',
            observed_at: '2026-10-16T08:00:00Z',
            as_of: null,
            verification: 'primary',
            quote: '追加订购电池',
          },
        ],
      },
      {
        claim_id: 'c2',
        text: '预计下游毛利率将受成本影响',
        kind: 'conditional_inference',
        evidence_status: 'corroborated',
        evidence: [],
      },
    ],
    coverage_gap_reason: null,
    impacts: [
      {
        impact_id: 'imp_0',
        node_id: 'ifind:1879',
        node_name: '动力电池',
        hop: 0,
        via_edge_id: null,
        via_edge_relation: null,
        from_node_id: null,
        from_node_name: null,
        direction: 'favorable',
        direction_label: '偏正面',
        shock_variable: 'orders',
        mechanism: '订单放量拉动排产',
        conditions: ['排产持续'],
        counterforces: [],
        verify_metric: '月度装车量',
        depends_on_claim_ids: ['c1'],
      },
    ],
    subgraph_nodes: [
      {
        id: 'ifind:1879',
        name: '动力电池',
        node_type: 'product',
        origin: 'ifind',
        aliases: ['动力电芯'],
        layer: 1,
        upstream_count: 2,
        downstream_count: 1,
        verified_company_count: 2,
        computed_median_margin: 0.22,
        evidence: [],
      },
    ],
    subgraph_edges: [],
    company_landings: [
      {
        company_code: '300750.SZ',
        company_name: '宁德时代',
        node_id: 'ifind:1879',
        node_name: '动力电池',
        hop: 0,
        node_direction: 'favorable',
        exposure_strength: 'primary_over_50',
        revenue_share: 0.75,
        product_gross_margin: 0.24,
        exposure_basis: '主营业务收入披露',
        conditional_note: '全球动力电芯出货领先',
        evidence: [],
      },
    ],
    missing_evidence: [],
  };

  const parsed = EventDetailResponseSchema.parse(validDetail);
  assert.equal(parsed.claims.length, 2);
  assert.equal(parsed.claims[0].kind, 'fact');
  assert.equal(parsed.claims[1].kind, 'conditional_inference');
  assert.equal(parsed.impacts[0].hop, 0);
  assert.equal(parsed.company_landings[0].exposure_strength, 'primary_over_50');
  assert.equal(parsed.event.published_at, null);
});

test('Contracts — CreateStrategyRequest validates DSL rules and rejects forbidden recommendation terms', () => {
  const validRequest = {
    id: 'my_quality_strategy',
    name: '优质现金流与盈利收益策略',
    category: 'quality' as const,
    description: '综合评估企业在行业内的盈利收益率与应计项目质量',
    academic_basis: 'Novy-Marx (2013) & Sloan (1996)',
    dsl: {
      combinator: 'all' as const,
      missing_policy: 'insufficient' as const,
      conditions: [
        {
          id: 'c1',
          label: 'E/P 行业分位大于 0.5',
          operand: { kind: 'rank_industry' as const, key: 'ep_ttm' },
          operator: 'gt' as const,
          threshold: 0.5,
          negate: false,
          is_redflag_veto: false,
        },
      ],
    },
  };

  const parsed = CreateStrategyRequestSchema.parse(validRequest);
  assert.equal(parsed.id, 'my_quality_strategy');

  // Check forbidden recommendation terms detection
  assert.equal(containsForbiddenRecommendation('强烈推荐买入该股'), '强烈推荐');
  assert.equal(containsForbiddenRecommendation('目标价 100 元'), '目标价');
  assert.equal(containsForbiddenRecommendation('稳健量化指标'), null);

  // Rejects invalid ID characters
  assert.throws(() => {
    CreateStrategyRequestSchema.parse({
      ...validRequest,
      id: 'Invalid ID With Spaces!',
    });
  });
});

test('Contracts — IndicatorRegistryResponse validates 40-indicator registry definition', () => {
  const validRegistry = {
    total: 1,
    items: [
      {
        key: 'ep_ttm',
        name: '盈利收益率 (E/P)',
        category: 'valuation' as const,
        unit: '%',
        formula: 'TTM 归母净利润 / 总市值',
        raw_inputs: ['东财净利润', '腾讯市值'],
        frequency: 'daily' as const,
        pit_rule: '报告期披露公告次日生效',
        higher_is_better: true,
        not_applicable_industries: [],
        used_by_strategies: ['value_ep_industry'],
      },
    ],
  };

  const parsed = IndicatorRegistryResponseSchema.parse(validRegistry);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.items[0].key, 'ep_ttm');
  assert.equal(parsed.items[0].higher_is_better, true);
});
