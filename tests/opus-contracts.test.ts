import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createApp } from '../server/app.js';
import type { Pool } from '../server/db.js';
import {
  evaluateDslSpec,
  evaluateChainEventExposure,
  listStrategies,
  createCustomStrategy,
  toggleStrategy,
  deleteCustomStrategy,
  BUILTIN_STRATEGIES,
} from '../server/content/strategies.js';
import {
  INDICATOR_REGISTRY,
  calculateUsableTradeDate,
  normalizeIndustryCategory,
  getSystemStatus,
  getCompanyProfile,
  getIndicatorRegistry,
} from '../server/content/indicators.js';
import {
  listChains,
  getChainGraph,
  getNodeDetail,
  listEvents,
  getEventDetail,
  evaluateTextEvent,
  calculateNodeGrossMarginStats,
  CORE_CHAIN_SUMMARIES,
} from '../server/content/chain.js';
import {
  containsForbiddenRecommendation,
  SystemStatusResponseSchema,
  EventListResponseSchema,
  EventDetailResponseSchema,
  ChainListResponseSchema,
  ChainGraphResponseSchema,
  NodeDetailResponseSchema,
  IndicatorRegistryResponseSchema,
  CompanyProfileResponseSchema,
  StrategyListResponseSchema,
  StrategyManifestSchema,
  type IndicatorSnapshotValue,
} from '../src/contracts/index.js';

// ---------------------------------------------------------------------------
// 1. CI Forbidden Pattern Scan Test
// ---------------------------------------------------------------------------
test('scripts/ci-forbidden-scan.ts passes with 0 violations', () => {
  const output = execSync('node --import tsx scripts/ci-forbidden-scan.ts', {
    encoding: 'utf8',
  });
  assert.match(output, /CI Forbidden Pattern Scan PASSED \(0 violations\)/);
});

// ---------------------------------------------------------------------------
// 2. Opus 7-Case Event Polarity, Alias Matching & Uncovered Strict Tests
// ---------------------------------------------------------------------------
test('Opus 7 event probe cases: negative polarity, alias matching, and uncovered stopping', async () => {
  // Case 1: Lithium carbonate price crash -> unfavorable at Hop 0, uncertain at Hop 1/2
  const r1 = await evaluateTextEvent('碳酸锂现货价格单周暴跌20%，锂盐厂库存高企');
  assert.equal(r1.event.coverage_status, 'mapped');
  assert.equal(r1.event.epicenter_node_name, '碳酸锂');
  assert.equal(r1.impacts[0].direction, 'unfavorable');
  assert.ok(r1.impacts.some(i => i.node_name === '锂电池正极材料' && i.direction === 'uncertain'));
  assert.ok(r1.company_landings.some(c => c.company_name === '天齐锂业' && c.node_direction === 'unfavorable'));

  // Case 2: CATL plant fire -> unfavorable at Hop 0
  const r2 = await evaluateTextEvent('宁德时代宁德基地发生火灾，部分产线停产');
  assert.equal(r2.event.coverage_status, 'mapped');
  assert.equal(r2.event.epicenter_node_name, '锂离子电池');
  assert.equal(r2.impacts[0].direction, 'unfavorable');

  // Case 3: Naura entity list -> unfavorable at Hop 0
  const r3 = await evaluateTextEvent('美国商务部将北方华创列入实体清单，限制设备零部件出口');
  assert.equal(r3.event.coverage_status, 'mapped');
  assert.equal(r3.event.epicenter_node_name, '半导体设备');
  assert.equal(r3.impacts[0].direction, 'unfavorable');

  // Case 4: 800G order cuts -> unfavorable at Hop 0 and 1-hop upstream
  const r4 = await evaluateTextEvent('光模块需求不及预期，北美云厂商削减800G采购');
  assert.equal(r4.event.coverage_status, 'mapped');
  assert.equal(r4.event.epicenter_node_name, '光模块');
  assert.equal(r4.impacts[0].direction, 'unfavorable');
  assert.ok(r4.impacts.some(i => i.node_name === '光通信器件' && i.direction === 'unfavorable'));
  assert.ok(r4.impacts.some(i => i.node_name === '印制电路板' && i.direction === 'unfavorable'));

  // Case 5: Electronic specialty gas alias -> Semiconductor Material (ifind:2549), M&A hop-1 is uncertain
  const r5 = await evaluateTextEvent('国恩股份拟收购中氟能切入电子特气供应链');
  assert.equal(r5.event.coverage_status, 'mapped');
  assert.equal(r5.event.epicenter_node_name, '半导体材料');
  assert.equal(r5.impacts[0].direction, 'favorable');
  assert.ok(r5.impacts.some(i => i.node_name === '光刻机' && i.direction === 'uncertain'));

  // Case 5b: Rumor denial / clarification -> facts_only with 0 impacts
  const rDenial = await evaluateTextEvent('宁德时代否认停产传闻，称生产经营一切正常');
  assert.equal(rDenial.event.coverage_status, 'facts_only');
  assert.equal(rDenial.event.epicenter_node_name, '锂离子电池');
  assert.equal(rDenial.impacts.length, 0);
  assert.equal(rDenial.company_landings.length, 0);

  // Case 5c: Corporate share buyback -> facts_only with 0 impacts
  const rBuyback = await evaluateTextEvent('新易盛：控股股东提议回购8亿元-10亿元公司股份');
  assert.equal(rBuyback.event.coverage_status, 'facts_only');
  assert.equal(rBuyback.impacts.length, 0);

  // Case 6: Shennan Circuits PCB alias -> Printed Circuit Board (ifind:2899)
  const r6 = await evaluateTextEvent('深南电路预增近八成，PCB 算力载板兑现增长');
  assert.equal(r6.event.coverage_status, 'mapped');
  assert.equal(r6.event.epicenter_node_name, '印制电路板');
  assert.equal(r6.impacts[0].direction, 'favorable');

  // Case 7: Unrelated / Macro / Unmodeled node news -> uncovered with 0 impacts
  const testCases = [
    '央行宣布全面降准0.5个百分点',
    '央行下调存款准备金率50个基点，释放长期资金约1万亿元',
    '美联储宣布降息25个基点',
    '恩捷股份隔膜产品提价5%',
    '浪潮信息AI服务器出货量大增',
    '国足世预赛备战大名单公布，主教练公布集训球员阵容',
    '某地方生猪出栏价格波动，养殖企业出栏节奏平稳',
    '央行今日开展7天期逆回购操作2000亿元，中标利率保持平稳',
  ];

  for (const text of testCases) {
    const res = await evaluateTextEvent(text);
    assert.equal(res.event.coverage_status, 'uncovered', `Should be uncovered: ${text}`);
    assert.equal(res.event.matched_chain_id, null);
    assert.equal(res.event.epicenter_node_id, null);
    assert.equal(res.impacts.length, 0, 'Must have 0 impacts');
    assert.equal(res.company_landings.length, 0, 'Must have 0 company landings');
    assert.ok(res.coverage_gap_reason, 'Must provide coverage gap reason');
    assert.match(res.coverage_gap_reason!, /未命中当前已建库的 3 条核心产业链/);
  }
});

// ---------------------------------------------------------------------------
// 3. DSL Evaluator Unit Tests
// ---------------------------------------------------------------------------
test('DSL evaluator handles all, any, negate, rank_industry, and missing_policy', () => {
  const dummyIndicators = new Map<string, IndicatorSnapshotValue>();

  dummyIndicators.set('ep_ttm', {
    key: 'ep_ttm',
    name: '盈利收益率',
    category: 'valuation',
    value: 6.5,
    formatted_value: '6.50%',
    unit: '%',
    yoy_delta: 0.5,
    rank_market_pct: 0.75,
    rank_industry_pct: 0.82,
    status: 'ready',
    report_period: '2024-09-30',
    announcement_datetime: '2024-10-19 00:00:00',
    usable_trade_date: '2024-10-21',
    restatement_datetime: null,
    source_provider: 'eastmoney_f10',
    note: null,
  });

  dummyIndicators.set('fscore_total', {
    key: 'fscore_total',
    name: 'F-Score',
    category: 'fscore',
    value: 8,
    formatted_value: '8 / 9 分',
    unit: '分',
    yoy_delta: null,
    rank_market_pct: 0.88,
    rank_industry_pct: 0.9,
    status: 'ready',
    report_period: '2024-09-30',
    announcement_datetime: '2024-10-19 00:00:00',
    usable_trade_date: '2024-10-21',
    restatement_datetime: null,
    source_provider: 'eastmoney_f10',
    note: null,
  });

  dummyIndicators.set('is_st_risk', {
    key: 'is_st_risk',
    name: 'ST风险',
    category: 'valuation',
    value: 0,
    formatted_value: '正常',
    unit: 'flag',
    yoy_delta: null,
    rank_market_pct: null,
    rank_industry_pct: null,
    status: 'ready',
    report_period: '2024-09-30',
    announcement_datetime: '2024-10-19 00:00:00',
    usable_trade_date: '2024-10-21',
    restatement_datetime: null,
    source_provider: 'eastmoney_f10',
    note: null,
  });

  // Test 1: Successful 'all' combinator
  const dslSuccess = {
    combinator: 'all' as const,
    missing_policy: 'insufficient' as const,
    conditions: [
      {
        id: 'c1',
        label: 'EP 行业分位 >= 0.6',
        operand: { kind: 'rank_industry' as const, key: 'ep_ttm' },
        operator: 'gte' as const,
        threshold: 0.6,
      },
      {
        id: 'c2',
        label: 'F-Score >= 6',
        operand: { kind: 'ind' as const, key: 'fscore_total' },
        operator: 'gte' as const,
        threshold: 6,
      },
    ],
  };

  const resSuccess = evaluateDslSpec(dslSuccess, dummyIndicators, 's_test', '测试策略', 'quality', false);
  assert.equal(resSuccess.tier, 'favorable');
  assert.equal(resSuccess.condition_traces.length, 2);
  assert.equal(resSuccess.condition_traces[0].passed, true);
  assert.equal(resSuccess.condition_traces[1].passed, true);

  // Test 2: 'negate' operator
  const dslNegate = {
    combinator: 'all' as const,
    missing_policy: 'insufficient' as const,
    conditions: [
      {
        id: 'c_neg',
        label: 'EP 不得低于 10% (即 negate: EP < 10%)',
        operand: { kind: 'ind' as const, key: 'ep_ttm' },
        operator: 'lt' as const,
        threshold: 10.0,
        negate: true,
      },
    ],
  };
  const resNegate = evaluateDslSpec(dslNegate, dummyIndicators, 's_neg', '取反策略', 'value', false);
  // actual 6.5 < 10 is true, negate => false
  assert.equal(resNegate.condition_traces[0].passed, false);

  // Test 3: Redflag Veto
  const dslVeto = {
    combinator: 'all' as const,
    missing_policy: 'insufficient' as const,
    conditions: [
      {
        id: 'c_veto',
        label: '排雷：F-Score 必须 >= 9 (否决项)',
        operand: { kind: 'ind' as const, key: 'fscore_total' },
        operator: 'gte' as const,
        threshold: 9,
        is_redflag_veto: true,
      },
    ],
  };
  const resVeto = evaluateDslSpec(dslVeto, dummyIndicators, 's_veto', '否决策略', 'redflag', false);
  assert.equal(resVeto.tier, 'cautionary');
  assert.equal(resVeto.condition_traces[0].passed, false);

  // Test 4: Missing value with missing_policy: 'insufficient'
  const dslMissing = {
    combinator: 'all' as const,
    missing_policy: 'insufficient' as const,
    conditions: [
      {
        id: 'c_missing',
        label: '未收录指标',
        operand: { kind: 'ind' as const, key: 'non_existent_key' },
        operator: 'gt' as const,
        threshold: 0,
      },
    ],
  };
  const resMissing = evaluateDslSpec(dslMissing, dummyIndicators, 's_miss', '缺失策略', 'value', false);
  assert.equal(resMissing.tier, 'insufficient_data');
  assert.equal(resMissing.score, null);
  assert.equal(resMissing.condition_traces[0].passed, null); // NEVER true!
});

// ---------------------------------------------------------------------------
// 4. PIT Date Calculation & Holiday Window Tests
// ---------------------------------------------------------------------------
test('PIT usable_trade_date skips weekends and statutory holidays', () => {
  // Friday notice -> Monday trade date
  const fridayNotice = '2024-10-18';
  const nextMonday = calculateUsableTradeDate(fridayNotice);
  assert.equal(nextMonday, '2024-10-21');

  // National Day window: notice on Sept 30 -> Oct 8
  const preNationalDay = '2024-09-30';
  const afterNationalDay = calculateUsableTradeDate(preNationalDay);
  assert.equal(afterNationalDay, '2024-10-08');
});

// ---------------------------------------------------------------------------
// 5. Dynamic Node Gross Margin Stats & DB Empty/Error Fail-Closed Tests
// ---------------------------------------------------------------------------
test('Dynamic node gross margin is computed from mounted companies', () => {
  // CATL mounted on ifind:1879 with product gross margin 0.2063 (2026-06-30)
  const stats = calculateNodeGrossMarginStats('ifind:1879');
  assert.ok(stats.sample_count >= 1);
  assert.equal(stats.min_gross_margin, 0.2063);
  assert.equal(stats.as_of_report_period, '2026-06-30');
});

test('listEvents with empty DB returns 0 items (never falls back to OFFLINE_TEST_EVENTS)', async () => {
  const emptyPool = {
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as Pool;
  const res = await listEvents(emptyPool);
  assert.equal(res.total, 0);
  assert.equal(res.items.length, 0);

  const brokenPool = {
    query: async (sql: string) => {
      if (sql.includes('content_editorial_events')) {
        throw new Error('DB_CONNECTION_LOST');
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  await assert.rejects(() => listEvents(brokenPool), /DB_CONNECTION_LOST/);
});

// ---------------------------------------------------------------------------
// 6. Fastify App Endpoints Zod Schema Contracts Verification
// ---------------------------------------------------------------------------
test('Fastify app endpoints strictly pass all shared contracts (.parse)', async () => {
  const sessionRow = {
    token_hash: 'dummy',
    user_id: 'usr_test',
    client: 'web' as const,
    csrf: 'test_csrf_token',
    expires_at: new Date('2029-01-01'),
  };

  const sampleNewsRow = {
    id: 'ifind:news:test_001',
    published_at: null,
    observed_at: new Date('2026-10-16T09:42:11.601Z'),
    body: {
      title: '深南电路预增近八成，PCB 算力载板兑现增长',
      summary: 'AI算力需求拉动高速多层PCB订单增长。',
      source: '上海证券报',
      url: 'https://www.cnstock.com/test',
      verification: 'provider',
      node_ids: ['ifind:2899'],
      evidence: [
        {
          provider: 'hexin-ifind-ds-mcp',
          url: 'https://www.cnstock.com/test',
          title: '深南电路预增近八成，PCB 算力载板兑现增长',
          observed_at: '2026-10-16T09:42:11.601Z',
          as_of: null,
          verification: 'provider',
          source_item_id: 'test_src_001',
        },
      ],
    },
  };

  const dummyClient = {
    query: async (text: string) => {
      if (text.includes('sessions')) return { rows: [sessionRow] };
      return { rows: [] };
    },
    release: () => {},
  };

  const dummyPool = {
    query: async (text: string) => {
      if (text.includes('sessions')) return { rows: [sessionRow] };
      if (text.includes('users')) return { rows: [{ id: 'usr_test' }] };
      if (text.includes('FROM content_news') && text.includes('SELECT id')) {
        return { rows: [sampleNewsRow] };
      }
      return { rows: [] };
    },
    connect: async () => dummyClient,
  } as unknown as Pool;

  const app = await createApp(dummyPool, {
    databaseUrl: 'postgresql://test:test@localhost:5432/ytrader_test',
    host: '127.0.0.1',
    port: 3001,
    webOrigin: 'http://127.0.0.1:5173',
    nativeOrigin: 'capacitor://localhost',
    secureCookie: false,
    ycoreUrl: undefined,
    ycoreToken: undefined,
    modelEnabled: false,
    modelPolicy: 'disabled',
  });

  const authInject = (opts: any) =>
    app.inject({
      ...opts,
      cookies: { 'ytrader-dev': 'test_token', ...(opts.cookies || {}) },
      headers: {
        origin: 'http://127.0.0.1:5173',
        'x-csrf-token': 'test_csrf_token',
        ...(opts.headers || {}),
      },
    });

  try {
    // 1. GET /system/status
    const resStatus = await authInject({ method: 'GET', url: '/api/v1/content/system/status' });
    assert.equal(resStatus.statusCode, 200);
    const parsedStatus = SystemStatusResponseSchema.parse(JSON.parse(resStatus.body));
    assert.ok(['ok', 'empty', 'partial', 'failed', 'not_configured'].includes(parsedStatus.overall_status));

    // 2. GET /events
    const resEvents = await authInject({ method: 'GET', url: '/api/v1/content/events' });
    assert.equal(resEvents.statusCode, 200);
    const parsedEvents = EventListResponseSchema.parse(JSON.parse(resEvents.body));
    assert.ok(parsedEvents.items.length >= 1);

    // 3. GET /events/:id
    const resEventDetail = await authInject({
      method: 'GET',
      url: `/api/v1/content/events/${parsedEvents.items[0].event_id}`,
    });
    assert.equal(resEventDetail.statusCode, 200);
    const parsedEventDetail = EventDetailResponseSchema.parse(JSON.parse(resEventDetail.body));
    assert.equal(parsedEventDetail.event.event_id, parsedEvents.items[0].event_id);

    // 4. GET /chains
    const resChains = await authInject({ method: 'GET', url: '/api/v1/content/chains' });
    assert.equal(resChains.statusCode, 200);
    const parsedChains = ChainListResponseSchema.parse(JSON.parse(resChains.body));
    assert.equal(parsedChains.chains.length, 3);

    // 5. GET /chains/lithium_energy/graph
    const resGraph = await authInject({ method: 'GET', url: '/api/v1/content/chains/lithium_energy/graph' });
    assert.equal(resGraph.statusCode, 200);
    const parsedGraph = ChainGraphResponseSchema.parse(JSON.parse(resGraph.body));
    assert.equal(parsedGraph.chain.id, 'lithium_energy');
    assert.ok(parsedGraph.nodes.length >= 5);
    assert.ok(parsedGraph.edges.length >= 5);
    assert.ok(parsedGraph.exposures.length >= 1);

    // 6. GET /nodes/ifind:1879
    const resNode = await authInject({ method: 'GET', url: '/api/v1/content/nodes/ifind:1879' });
    assert.equal(resNode.statusCode, 200);
    const parsedNode = NodeDetailResponseSchema.parse(JSON.parse(resNode.body));
    assert.equal(parsedNode.node.id, 'ifind:1879');
    assert.ok(parsedNode.logic_card.pricing_mechanism);

    // 7. GET /indicators/registry
    const resRegistry = await authInject({ method: 'GET', url: '/api/v1/content/indicators/registry' });
    assert.equal(resRegistry.statusCode, 200);
    const parsedRegistry = IndicatorRegistryResponseSchema.parse(JSON.parse(resRegistry.body));
    assert.equal(parsedRegistry.total, 40);
    assert.equal(parsedRegistry.items.length, 40);

    // 8. GET /companies/300750.SZ/profile
    const resProfile = await authInject({ method: 'GET', url: '/api/v1/content/companies/300750.SZ/profile' });
    assert.equal(resProfile.statusCode, 200);
    const parsedProfile = CompanyProfileResponseSchema.parse(JSON.parse(resProfile.body));
    assert.equal(parsedProfile.code, '300750.SZ');
    assert.equal(parsedProfile.name, '宁德时代');
    assert.ok(parsedProfile.indicators.length === 40);
    assert.ok(parsedProfile.strategies.length >= 1);

    // 8b. GET /companies/000001.SZ/profile (Bank financial industry not_applicable check)
    const resBank = await authInject({ method: 'GET', url: '/api/v1/content/companies/000001.SZ/profile' });
    assert.equal(resBank.statusCode, 200);
    const parsedBank = CompanyProfileResponseSchema.parse(JSON.parse(resBank.body));
    assert.equal(parsedBank.code, '000001.SZ');
    assert.equal(parsedBank.name, '平安银行');
    assert.equal(parsedBank.industry_name, '银行');
    const bankGm = parsedBank.indicators.find(i => i.key === 'gross_margin');
    assert.equal(bankGm?.status, 'not_applicable');

    // 8b2. Non-bank financial industry classification & 600030.SH profile check (Gate D F1 regression)
    assert.deepEqual(normalizeIndustryCategory('金融-非银行金融-证券', '中信证券'), {
      displayIndustry: '证券',
      isFinancial: true,
      emCompanyType: 1,
    });
    assert.deepEqual(normalizeIndustryCategory('金融-非银行金融-保险', '中国平安'), {
      displayIndustry: '保险',
      isFinancial: true,
      emCompanyType: 2,
    });
    assert.deepEqual(normalizeIndustryCategory('金融-银行-全国性股份制银行', '招商银行'), {
      displayIndustry: '银行',
      isFinancial: true,
      emCompanyType: 3,
    });
    const resSec = await authInject({ method: 'GET', url: '/api/v1/content/companies/600030.SH/profile' });
    assert.equal(resSec.statusCode, 200);
    const parsedSec = CompanyProfileResponseSchema.parse(JSON.parse(resSec.body));
    assert.equal(parsedSec.code, '600030.SH');
    assert.equal(parsedSec.name, '中信证券');
    assert.equal(parsedSec.industry_name, '证券');
    const secCfo = parsedSec.indicators.find(i => i.key === 'cfo_to_np');
    assert.equal(secCfo?.status, 'ready');

    // 8c. GET /companies/999999.SH/profile (Nonexistent stock 404 check)
    const resNotFound = await authInject({ method: 'GET', url: '/api/v1/content/companies/999999.SH/profile' });
    assert.equal(resNotFound.statusCode, 404);

    // 9. POST /companies/300750.SZ/indicators/refresh
    const resRefresh = await authInject({
      method: 'POST',
      url: '/api/v1/content/companies/300750.SZ/indicators/refresh',
    });
    assert.equal(resRefresh.statusCode, 200);
    const parsedRefresh = CompanyProfileResponseSchema.parse(JSON.parse(resRefresh.body));
    assert.equal(parsedRefresh.code, '300750.SZ');

    // 10. GET /strategies
    const resStrategies = await authInject({ method: 'GET', url: '/api/v1/content/strategies' });
    assert.equal(resStrategies.statusCode, 200);
    const parsedStrategies = StrategyListResponseSchema.parse(JSON.parse(resStrategies.body));
    assert.ok(parsedStrategies.strategies.length >= 4);

    // 11. POST /strategies (Create custom strategy)
    const newCustomStrategy = {
      id: 'custom_high_roe',
      name: '超高 ROE 优选策略',
      category: 'quality' as const,
      description: '筛选加权 ROE 高于 20% 的高盈利标的',
      academic_basis: 'Novy-Marx (2013)',
      dsl: {
        combinator: 'all' as const,
        missing_policy: 'insufficient' as const,
        conditions: [
          {
            id: 'cond_roe',
            label: 'ROE >= 20%',
            operand: { kind: 'ind' as const, key: 'roe_jq' },
            operator: 'gte' as const,
            threshold: 20.0,
          },
        ],
      },
    };

    const resCreate = await authInject({
      method: 'POST',
      url: '/api/v1/content/strategies',
      payload: newCustomStrategy,
    });
    assert.equal(resCreate.statusCode, 200);
    const parsedCreated = StrategyManifestSchema.parse(JSON.parse(resCreate.body));
    assert.equal(parsedCreated.id, 'custom_high_roe');

    // 12. PUT /strategies/:id/toggle
    const resToggle = await authInject({
      method: 'PUT',
      url: '/api/v1/content/strategies/custom_high_roe/toggle',
      payload: { enabled: false },
    });
    assert.equal(resToggle.statusCode, 200);
    const toggleJson = JSON.parse(resToggle.body);
    assert.equal(toggleJson.enabled, false);

    // 13. DELETE /strategies/:id
    const resDelete = await authInject({
      method: 'DELETE',
      url: '/api/v1/content/strategies/custom_high_roe',
    });
    assert.equal(resDelete.statusCode, 200);
    const deleteJson = JSON.parse(resDelete.body);
    assert.equal(deleteJson.success, true);
  } finally {
    await app.close();
  }
});
