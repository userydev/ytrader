import { useEffect, useState, useMemo } from 'react';
import { api } from '../api';
import './chain-strategy.css';

const enc = encodeURIComponent;

// ============================================================================
// 1. 类型定义 (Type Definitions)
// ============================================================================

export interface ChainTransmission {
  hit: boolean;
  step_order?: number;
  direction?: 'positive' | 'negative' | 'mixed_or_uncertain' | string;
  direction_label?: string;
  mechanism?: string;
  conditions?: string[];
  counter_factors?: string[];
  reverse_factors?: string[];
}

export interface ChainCompany {
  code: string;
  name: string;
  status: 'business' | 'candidate' | string;
  role?: string;
  event_impact?: string | null;
  impact?: string;
  basis?: string;
  exposure_basis?: string;
}

export interface ChainStage {
  id: string;
  name: string;
  stage?: 'upstream' | 'midstream' | 'downstream' | string;
  stage_type?: 'upstream' | 'midstream' | 'downstream' | string;
  group?: 'upstream' | 'midstream' | 'downstream' | string;
  tier?: 'upstream' | 'midstream' | 'downstream' | string;
  origin?: 'graph' | 'ai_inferred' | string;
  node_id?: string | null;
  operating_logic?: string;
  profit_and_barriers?: string;
  pricing_and_margin_logic?: string;
  event_transmission?: ChainTransmission;
  companies?: ChainCompany[];
}

export interface ChainLink {
  from_id?: string;
  from_name: string;
  to_id?: string;
  to_name: string;
  kind?: string;
  kind_label: string;
}

export interface ChainData {
  chain_id?: string;
  chain_name: string;
  overview_logic?: string;
  value_distribution?: string;
  stages: ChainStage[];
  links?: ChainLink[];
  current_node_id?: string;
}

export interface PointInTime {
  report_period: string | null;
  announcement_datetime: string | null;
  usable_trade_date: string | null;
  restatement_datetime?: string | null;
  observed_at?: string;
}

export type IndicatorState = 'ok' | 'stale' | 'unknown' | 'not_applicable' | 'insufficient';

export interface CompanyIndicator {
  key: string;
  label: string;
  category: 'valuation' | 'quality' | 'cash_risk' | 'shareholder' | 'market_risk' | 'chain_segment' | string;
  value: number | string | boolean | null;
  formatted_value?: string;
  unit: string | null;
  state: IndicatorState;
  pit?: PointInTime;
  formula?: string;
  provider?: string;
  peer_percentile?: number | null;
}

export interface IndicatorCheck {
  key: string;
  label: string;
  formatted_value: string;
  state?: IndicatorState;
  pit_label?: string;
  passed: boolean | 'unknown';
  note?: string;
}

export interface StrategyVerdict {
  tier: 'favorable' | 'neutral' | 'cautionary' | 'insufficient_data' | 'not_applicable' | string;
  label: string;
  summary: string;
}

export interface StrategyEvaluation {
  plugin_id: string;
  plugin_name: string;
  category: string;
  builtin?: boolean;
  source_citation: string;
  verdict: StrategyVerdict;
  indicator_checks: IndicatorCheck[];
  conditions: string[];
  counter_evidence: string[];
  missing_indicators?: Array<{
    key: string;
    label: string;
    reason: string;
  }>;
}

export interface FiveLayerPill {
  key?: string;
  name?: string;
  tier: string;
  label: string;
  summary?: string;
}

export interface FiveLayerSummary {
  valuation?: FiveLayerPill;
  value?: FiveLayerPill;
  quality?: FiveLayerPill;
  cash_risk?: FiveLayerPill;
  market_risk?: FiveLayerPill;
  market_defense?: FiveLayerPill;
  chain_diffusion?: FiveLayerPill;
  chain_catalyst?: FiveLayerPill;
  layers?: FiveLayerPill[];
  top_counter_evidence?: string | string[];
}

export interface CompanyStrategiesData {
  company_code?: string;
  company_name?: string;
  company?: { code: string; name: string };
  five_layer_summary?: FiveLayerSummary;
  summary_overview?: FiveLayerSummary;
  evaluations: StrategyEvaluation[];
  indicator_snapshot:
    | CompanyIndicator[]
    | {
        indicators?: CompanyIndicator[];
        items?: CompanyIndicator[];
        summary?: { total: number; ready: number; stale: number; unknown: number; not_applicable: number };
        ready_count?: number;
        total?: number;
      };
  ready_count?: number;
  total_indicators?: number;
}

export interface StrategyPluginRule {
  key: string;
  operator: string;
  threshold: number;
}

export interface StrategyPlugin {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  category: string;
  source_citation: string;
  required_indicators?: Array<{ key: string; label?: string } | string>;
  rules?: StrategyPluginRule[];
  rule_config?: {
    favorable_label?: string;
    neutral_label?: string;
    cautionary_label?: string;
    favorable_conditions?: Array<{ indicator_key: string; operator: string; threshold: number | string | boolean }>;
  } | null;
  favorable_label?: string;
  cautionary_label?: string;
  conditions?: string[] | string;
  counter_evidence?: string[] | string;
}

// 标准指标元数据字典（用于追加策略表单及指标展示）
const STANDARD_INDICATORS = [
  { key: 'ep_ttm', label: '盈利收益率 (E/P = NP/MV)', unit: '%', category: 'valuation' },
  { key: 'ep_deduct_ttm', label: '扣非盈利收益率', unit: '%', category: 'valuation' },
  { key: 'bp_mrq', label: '账面市值比 (B/P = 1/PB)', unit: '倍', category: 'valuation' },
  { key: 'total_mv', label: '总市值', unit: '亿元', category: 'valuation' },
  { key: 'roe_ttm', label: '净资产收益率 (ROE)', unit: '%', category: 'quality' },
  { key: 'gross_margin', label: '销售毛利率', unit: '%', category: 'quality' },
  { key: 'gpa', label: '毛利资产比 (GP/A)', unit: '%', category: 'quality' },
  { key: 'rev_yoy', label: '营业收入同比增长率', unit: '%', category: 'quality' },
  { key: 'np_parent_yoy', label: '归母净利润同比增长率', unit: '%', category: 'quality' },
  { key: 'fscore_total', label: 'Piotroski F-Score 总分', unit: '分(0-9)', category: 'quality' },
  { key: 'debt_ratio', label: '资产负债率', unit: '%', category: 'cash_risk' },
  { key: 'cfo_to_np', label: '净现比 (CFO / 净利润)', unit: '倍', category: 'cash_risk' },
  { key: 'sloan_accrual', label: 'Sloan 应计比率', unit: '%', category: 'cash_risk' },
  { key: 'dividend_yield_ttm', label: '股息率 (TTM)', unit: '%', category: 'shareholder' },
  { key: 'shareholder_yield', label: '综合股东收益率', unit: '%', category: 'shareholder' },
  { key: 'vol_252d', label: '252日年化波动率', unit: '%', category: 'market_risk' },
  { key: 'beta_252d', label: '252日 Beta 系数', unit: '', category: 'market_risk' },
];

const CATEGORY_NAMES: Record<string, string> = {
  valuation: '估值与壳修正',
  quality: '盈利质量与F-Score',
  cash_risk: '应计与财务红旗',
  shareholder: '股东回报',
  market_risk: '市场风险与动量',
  chain_segment: '主营与产业链',
};

// ============================================================================
// 2. 产业链通用视图组件 (Shared Chain Flow Visualizer)
// ============================================================================

function classifyStage(stage: ChainStage): 'upstream' | 'midstream' | 'downstream' {
  const t = (stage.stage || stage.stage_type || stage.group || stage.tier || '').toLowerCase();
  if (t.includes('up') || t.includes('上游')) return 'upstream';
  if (t.includes('down') || t.includes('下游')) return 'downstream';
  return 'midstream';
}

function StageCard({
  stage,
  eventId,
  isCurrent = false,
}: {
  stage: ChainStage;
  eventId?: string;
  isCurrent?: boolean;
}) {
  const isHit = Boolean(stage.event_transmission?.hit);
  const tx = stage.event_transmission;
  const logicText = stage.operating_logic || stage.pricing_and_margin_logic;
  const barriersText = stage.profit_and_barriers;
  const conditions = tx?.conditions ?? [];
  const counterFactors = tx?.counter_factors ?? tx?.reverse_factors ?? [];

  return (
    <div className={`cs-stage-card ${isCurrent ? 'is-current' : ''} ${isHit ? 'is-hit' : ''}`}>
      <div className="cs-stage-header">
        <h4 className="cs-stage-name">
          {stage.node_id ? (
            <a href={`#/industries/${enc(stage.node_id)}`}>{stage.name}</a>
          ) : (
            <span>{stage.name}</span>
          )}
        </h4>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {isCurrent && <span className="cs-badge cs-badge-current">当前环节</span>}
          {stage.origin === 'graph' ? (
            <span className="cs-badge cs-badge-graph" title="由产业链图谱直接收录">图谱实证</span>
          ) : (
            <span className="cs-badge cs-badge-ai" title="由AI基于业务与行业运行逻辑补全">AI动态补全</span>
          )}
        </div>
      </div>

      {(logicText || barriersText) && (
        <div className="cs-stage-logic">
          {logicText && (
            <div className="cs-stage-logic-item">
              <span className="cs-stage-logic-label">运行与定价:</span>
              {logicText}
            </div>
          )}
          {barriersText && (
            <div className="cs-stage-logic-item">
              <span className="cs-stage-logic-label">壁垒与分配:</span>
              {barriersText}
            </div>
          )}
        </div>
      )}

      {isHit && tx && (
        <div className="cs-stage-transmission">
          <div className="cs-transmission-head">
            {tx.step_order != null && (
              <span className="cs-step-badge">传导第 {tx.step_order} 步</span>
            )}
            <span
              className={`cs-direction-badge ${
                tx.direction === 'positive' || (tx.direction_label && tx.direction_label.includes('正面'))
                  ? 'cs-dir-positive'
                  : tx.direction === 'negative' || (tx.direction_label && tx.direction_label.includes('负面'))
                  ? 'cs-dir-negative'
                  : 'cs-dir-uncertain'
              }`}
            >
              {tx.direction_label || (tx.direction === 'positive' ? '偏正面' : tx.direction === 'negative' ? '偏负面' : '分化/不确定')}
            </span>
          </div>
          {tx.mechanism && <p className="cs-transmission-mech">{tx.mechanism}</p>}
          {(conditions.length > 0 || counterFactors.length > 0) && (
            <details className="cs-transmission-details">
              <summary>展开传导机制成立条件与反向抵消因素</summary>
              {conditions.length > 0 && (
                <>
                  <p style={{ margin: '6px 0 2px', fontWeight: 600, color: '#414f44' }}>成立条件:</p>
                  <ul>
                    {conditions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
              {counterFactors.length > 0 && (
                <>
                  <p style={{ margin: '6px 0 2px', fontWeight: 600, color: '#8a5700' }}>反向抵消因素:</p>
                  <ul>
                    {counterFactors.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          )}
        </div>
      )}

      {stage.companies && stage.companies.length > 0 && (
        <div className="cs-stage-companies">
          <div className="cs-companies-title">环节关联 A 股公司落点 ({stage.companies.length})</div>
          <div className="cs-company-list">
            {stage.companies.map((c) => {
              const href = `#/companies/${enc(c.code)}${eventId ? `?from=${enc(eventId)}` : ''}`;
              const isBusiness = c.status === 'business';
              const impactText = c.event_impact || c.impact || c.basis || c.exposure_basis;
              return (
                <a
                  key={c.code}
                  href={href}
                  className={`cs-company-chip ${isBusiness ? 'is-business' : 'is-candidate'}`}
                >
                  <div className="cs-company-head">
                    <span className="cs-company-name">{c.name}</span>
                    <span className="cs-company-code">{c.code}</span>
                  </div>
                  {(c.role || impactText || !isBusiness) && (
                    <div className="cs-company-desc">
                      {!isBusiness && <span style={{ color: '#8a5700', marginRight: '4px' }}>[概念候选]</span>}
                      {c.role && <span>{c.role}</span>}
                      {impactText && <span> · {impactText}</span>}
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ChainFlowView({
  data,
  eventId,
  currentNodeId,
}: {
  data: ChainData;
  eventId?: string;
  currentNodeId?: string;
}) {
  const stages = data.stages || [];

  const upstream = stages.filter((s) => classifyStage(s) === 'upstream');
  const midstream = stages.filter((s) => classifyStage(s) === 'midstream');
  const downstream = stages.filter((s) => classifyStage(s) === 'downstream');

  return (
    <div>
      {/* 产业链核心运行逻辑横幅 */}
      <div className="cs-chain-banner">
        <div className="cs-chain-banner-title">
          <span>{data.chain_name || '产业链运行图谱与传导分析'}</span>
          <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#646c62' }}>
            共收录 {stages.length} 个产业链环节
          </span>
        </div>
        <div className="cs-chain-banner-grid">
          <div className="cs-banner-item">
            <span className="cs-banner-label">全链运行与驱动逻辑:</span>
            <p className="cs-banner-content">
              {data.overview_logic || '依托全链供需演进、核心工艺瓶颈与上下游采购周期的动态传导。'}
            </p>
          </div>
          <div className="cs-banner-item">
            <span className="cs-banner-label">利润分配与壁垒特征:</span>
            <p className="cs-banner-content">
              {data.value_distribution || '关键壁垒集中于核心原料纯度、专利技术制程及认证周期较长的核心部件。'}
            </p>
          </div>
        </div>
      </div>

      {/* 3-Column / 流式产业链结构图 */}
      <div className="cs-flow-container">
        {/* 上游环节 */}
        <div className="cs-flow-column">
          <div className="cs-flow-col-header">
            <h3 className="cs-flow-col-title">上游环节 (原材料 / 核心装备)</h3>
            <span className="cs-flow-col-count">{upstream.length}</span>
          </div>
          <div className="cs-flow-col-body">
            {upstream.length > 0 ? (
              upstream.map((stage) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  eventId={eventId}
                  isCurrent={currentNodeId ? stage.node_id === currentNodeId || stage.id === currentNodeId : false}
                />
              ))
            ) : (
              <p className="cs-section-subtitle" style={{ padding: '10px 0' }}>暂无已分类上游环节</p>
            )}
          </div>
        </div>

        <div className="cs-flow-arrow">→</div>

        {/* 中游环节 */}
        <div className="cs-flow-column">
          <div className="cs-flow-col-header">
            <h3 className="cs-flow-col-title">中游环节 (制造 / 加工 / 组装)</h3>
            <span className="cs-flow-col-count">{midstream.length}</span>
          </div>
          <div className="cs-flow-col-body">
            {midstream.length > 0 ? (
              midstream.map((stage) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  eventId={eventId}
                  isCurrent={currentNodeId ? stage.node_id === currentNodeId || stage.id === currentNodeId : false}
                />
              ))
            ) : (
              <p className="cs-section-subtitle" style={{ padding: '10px 0' }}>暂无已分类中游环节</p>
            )}
          </div>
        </div>

        <div className="cs-flow-arrow">→</div>

        {/* 下游环节 */}
        <div className="cs-flow-column">
          <div className="cs-flow-col-header">
            <h3 className="cs-flow-col-title">下游环节 (应用 / 终端 / 渠道)</h3>
            <span className="cs-flow-col-count">{downstream.length}</span>
          </div>
          <div className="cs-flow-col-body">
            {downstream.length > 0 ? (
              downstream.map((stage) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  eventId={eventId}
                  isCurrent={currentNodeId ? stage.node_id === currentNodeId || stage.id === currentNodeId : false}
                />
              ))
            ) : (
              <p className="cs-section-subtitle" style={{ padding: '10px 0' }}>暂无已分类下游环节</p>
            )}
          </div>
        </div>
      </div>

      {/* 传导链路关系表 (links) */}
      {data.links && data.links.length > 0 && (
        <div className="cs-links-box">
          <h4 className="cs-links-title">环节间传导链路与业务供求关系 ({data.links.length})</h4>
          <div className="cs-links-tags">
            {data.links.map((link, idx) => (
              <span key={idx} className="cs-link-tag">
                <span className="cs-link-node">{link.from_name}</span>
                <span className="cs-link-relation">──[{link.kind_label || link.kind || '传导关系'}]──▶</span>
                <span className="cs-link-node">{link.to_name}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 3. 事件产业链组件 (EventChainSection)
// ============================================================================

export function EventChainSection({ eventId }: { eventId: string }) {
  const [data, setData] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    void api<ChainData>(`/content/events/${enc(eventId)}/chain`)
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : '产业链图谱读取失败');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [eventId, retry]);

  if (loading) {
    return (
      <section className="cs-section">
        <p className="cr-meta" role="status">正在读取产业链结构与事件传导图…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="cs-section">
        <div className="cr-notice cr-error" role="alert">
          <p>{error}</p>
          <button className="cs-button" onClick={() => setRetry((n) => n + 1)}>
            重试读取产业链
          </button>
        </div>
      </section>
    );
  }

  if (!data || !data.stages || data.stages.length === 0) {
    return (
      <section className="cs-section">
        <div className="cs-section-header">
          <h2 className="cs-section-title">产业链结构、运行逻辑与事件传导图</h2>
          <p className="cs-section-subtitle">
            本次事件未匹配到明确的产业链结构或尚待生成传导链路。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="cs-section">
      <div className="cs-section-header">
        <h2 className="cs-section-title">
          产业链结构、运行逻辑与事件传导图
        </h2>
        <p className="cs-section-subtitle">
          结合图谱实证与 AI 动态补全，辨认上下游各环节议价权、成本转嫁路径及具体 A 股落点。
        </p>
      </div>

      <ChainFlowView data={data} eventId={eventId} />
    </section>
  );
}

// ============================================================================
// 4. 产业节点产业链组件 (IndustryChainSection)
// ============================================================================

export function IndustryChainSection({ industryId }: { industryId: string }) {
  const [data, setData] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    void api<ChainData>(`/content/industries/${enc(industryId)}/chain`)
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : '产业上下游链条读取失败');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [industryId, retry]);

  if (loading) {
    return (
      <section className="cs-section">
        <p className="cr-meta" role="status">正在读取上下游链条与环节结构图…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="cs-section">
        <div className="cr-notice cr-error" role="alert">
          <p>{error}</p>
          <button className="cs-button" onClick={() => setRetry((n) => n + 1)}>
            重试读取上下游链条
          </button>
        </div>
      </section>
    );
  }

  if (!data || !data.stages || data.stages.length === 0) {
    return null;
  }

  return (
    <section className="cs-section">
      <div className="cs-section-header">
        <h2 className="cs-section-title">上下游全链条结构与运行逻辑</h2>
        <p className="cs-section-subtitle">
          上游供应环节 → 当前核心环节 → 下游应用场景全景展示。
        </p>
      </div>

      <ChainFlowView data={data} currentNodeId={industryId} />
    </section>
  );
}

// ============================================================================
// 5. 个股策略工作台 (CompanyStrategyWorkbench)
// ============================================================================

function formatPit(pit?: PointInTime): string {
  if (!pit) return '四层时点未知';
  const parts: string[] = [];
  if (pit.report_period) parts.push(`报告期: ${pit.report_period}`);
  if (pit.announcement_datetime) parts.push(`首次披露: ${pit.announcement_datetime}`);
  if (pit.usable_trade_date) parts.push(`可用交易日: ${pit.usable_trade_date}`);
  if (pit.restatement_datetime) parts.push(`重述: ${pit.restatement_datetime}`);
  return parts.length > 0 ? parts.join(' · ') : '无可用披露时点 (防未来函数)';
}

function getTierClass(tier: string): string {
  const t = (tier || '').toLowerCase();
  if (t === 'favorable' || t.includes('优') || t.includes('强') || t.includes('便宜') || t.includes('低波') || t.includes('稳健') || t.includes('正面') || t.includes('低风险') || t.includes('正常')) {
    return 'cs-tier-favorable';
  }
  if (t === 'cautionary' || t.includes('需关注') || t.includes('警惕') || t.includes('高风险') || t.includes('昂贵') || t.includes('弱') || t.includes('高波') || t.includes('存疑') || t.includes('负面')) {
    return 'cs-tier-cautionary';
  }
  if (t === 'insufficient_data' || t.includes('不足') || t.includes('待补') || t.includes('待核验')) {
    return 'cs-tier-insufficient';
  }
  if (t === 'not_applicable' || t.includes('不适用')) {
    return 'cs-tier-not-applicable';
  }
  return 'cs-tier-neutral';
}

export function CompanyStrategyWorkbench({ code }: { code: string }) {
  const [data, setData] = useState<CompanyStrategiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('valuation');
  const [showManager, setShowManager] = useState(false);

  const fetchData = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    const path = `/content/companies/${enc(code)}/strategies${isRefresh ? '?refresh=true' : ''}`;
    void api<CompanyStrategiesData>(path)
      .then((res) => {
        setData(res);
        setLoading(false);
        setRefreshing(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '策略评估计算失败');
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    fetchData(false);
  }, [code]);

  // 整理 5 层看板与头号反证
  const fiveLayer = useMemo(() => {
    if (!data) return null;
    const summary = data.five_layer_summary || data.summary_overview;
    const evals = data.evaluations || [];

    // 默认或从 evaluations 中推导各维度
    const getDim = (
      explicitPill: FiveLayerPill | undefined,
      catOrPlugin: string,
      fallbackName: string
    ): FiveLayerPill => {
      const matched = evals.find(
        (e) =>
          e.plugin_id === catOrPlugin ||
          e.category === catOrPlugin ||
          e.plugin_name.includes(fallbackName)
      );
      if (explicitPill && explicitPill.label) {
        return {
          name: fallbackName,
          tier: explicitPill.tier || matched?.verdict.tier || 'insufficient_data',
          label: explicitPill.label,
          summary: explicitPill.summary || matched?.verdict.summary || '',
        };
      }
      if (matched) {
        return {
          name: fallbackName,
          tier: matched.verdict.tier,
          label: matched.verdict.label,
          summary: matched.verdict.summary,
        };
      }
      return {
        name: fallbackName,
        tier: 'insufficient_data',
        label: '待补充底层指标',
        summary: '当前数据源尚未补齐该维度所需标准字段',
      };
    };

    const valuePill = getDim(summary?.valuation || summary?.value, 'value_ep', '价值评估 (E/P)');
    const qualityPill = getDim(summary?.quality, 'quality_fscore_gpa', '企业质量 (F-Score/GP/A)');
    const cashPill = getDim(summary?.cash_risk, 'accrual_redflag', '现金与财务红旗');
    const defensePill = getDim(summary?.market_risk || summary?.market_defense, 'lowvol_defense', '市场防御 (低波/Beta)');
    const chainPill = getDim(summary?.chain_diffusion || summary?.chain_catalyst, 'chain_diffusion', '产业链催化');

    // 提炼头号反证
    let topCounter = summary?.top_counter_evidence;
    if (!topCounter || (Array.isArray(topCounter) && topCounter.length === 0)) {
      const counters = evals.flatMap((e) => e.counter_evidence || []);
      topCounter = counters.length > 0 ? counters[0] : '暂无显著失真反证，但仍需核查周期所处位置与真实经营现金流。';
    }

    return {
      value: valuePill,
      quality: qualityPill,
      cash_risk: cashPill,
      market_defense: defensePill,
      chain_catalyst: chainPill,
      topCounter,
    };
  }, [data]);

  // 整理指标完备度快照
  const indicatorList: CompanyIndicator[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data.indicator_snapshot)) return data.indicator_snapshot;
    if (data.indicator_snapshot) {
      if (Array.isArray(data.indicator_snapshot.indicators)) return data.indicator_snapshot.indicators;
      if (Array.isArray(data.indicator_snapshot.items)) return data.indicator_snapshot.items;
    }
    return [];
  }, [data]);

  const readyCount = useMemo(() => {
    if (data?.ready_count != null) return data.ready_count;
    if (!Array.isArray(data?.indicator_snapshot)) {
      const s = data?.indicator_snapshot?.summary as Record<string, number> | undefined;
      if (s?.ready_count != null) return s.ready_count;
      if (s?.ready != null) return s.ready;
    }
    return indicatorList.filter((i) => i.state === 'ok').length;
  }, [data, indicatorList]);

  const totalIndicators = useMemo(() => {
    if (data?.total_indicators != null) return data.total_indicators;
    if (!Array.isArray(data?.indicator_snapshot)) {
      const s = data?.indicator_snapshot?.summary as Record<string, number> | undefined;
      if (s?.total_indicators != null) return s.total_indicators;
      if (s?.total != null) return s.total;
    }
    return indicatorList.length || STANDARD_INDICATORS.length;
  }, [data, indicatorList]);

  const readyPercentage = totalIndicators > 0 ? Math.round((readyCount / totalIndicators) * 100) : 0;

  const currentCategoryIndicators = useMemo(() => {
    return indicatorList.filter((ind) => (ind.category || 'valuation') === activeCategory);
  }, [indicatorList, activeCategory]);

  if (loading) {
    return (
      <section className="cs-section">
        <p className="cr-meta" role="status">正在运行可插拔个股策略算法与指标核算…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="cs-section">
        <div className="cr-notice cr-error" role="alert">
          <p>{error}</p>
          <button className="cs-button" onClick={() => fetchData(false)}>重试计算</button>
        </div>
      </section>
    );
  }

  return (
    <section className="cs-section">
      <div className="cs-section-header">
        <div className="cs-banner-headline">
          <h2 className="cs-section-title">
            个股量化与产业链策略评估工作台
          </h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="cs-button"
              disabled={refreshing}
              onClick={() => fetchData(true)}
              title="重新从 iFinD / 东财 F10 刷新多期财务并重新运行策略插件"
            >
              {refreshing ? '正在刷新计算…' : '↻ 刷新数据源指标与重算策略'}
            </button>
            <button
              className="cs-button"
              onClick={() => setShowManager((v) => !v)}
            >
              {showManager ? '收起策略管理' : '⚙ 管理已启用策略'}
            </button>
          </div>
        </div>
        <p className="cs-section-subtitle">
          报告第 20 页非黑箱基准：不合成单一总分，不输出买卖建议，依托四层时点真实指标逐项核验各机制档位与反证。
        </p>
      </div>

      {/* 嵌入式策略插件管理抽屉 */}
      {showManager && (
        <div style={{ marginBottom: '24px', padding: '16px', background: '#f5f2e9', border: '1px solid #d8d7cc', borderRadius: '4px' }}>
          <StrategyManagerPage onPluginsChange={() => fetchData(false)} />
        </div>
      )}

      {/* 1. 五层结构化评估总览条 (Report Page 20 Non-Black-Box Banner) */}
      {fiveLayer && (
        <div className="cs-workbench-banner">
          <div className="cs-banner-headline">
            <h3 className="cs-banner-title">五层结构化评估总览</h3>
            <span className="cs-non-black-box-notice">
              非黑箱原则 · 严禁输出买卖建议或机械合成总分
            </span>
          </div>
          <p className="cs-banner-manifesto">
            各维度机制相互独立且互补：价值关注盈利收益率（E/P），质量融合 Piotroski F-Score 与毛利资产比，现金关注 Sloan 应计红旗，市场关注低波防御，产业链关注上下游传导催化。
          </p>

          <div className="cs-five-cards">
            {/* 价值 */}
            <div className="cs-five-card">
              <span className="cs-five-card-name">1. 价值评估 (E/P)</span>
              <span className={`cs-five-card-pill ${getTierClass(fiveLayer.value.tier)}`}>
                {fiveLayer.value.label}
              </span>
              <p className="cs-five-card-desc">{fiveLayer.value.summary}</p>
            </div>

            {/* 质量 */}
            <div className="cs-five-card">
              <span className="cs-five-card-name">2. 企业质量 (F-Score/GPA)</span>
              <span className={`cs-five-card-pill ${getTierClass(fiveLayer.quality.tier)}`}>
                {fiveLayer.quality.label}
              </span>
              <p className="cs-five-card-desc">{fiveLayer.quality.summary}</p>
            </div>

            {/* 现金红旗 */}
            <div className="cs-five-card">
              <span className="cs-five-card-name">3. 现金与财务红旗</span>
              <span className={`cs-five-card-pill ${getTierClass(fiveLayer.cash_risk.tier)}`}>
                {fiveLayer.cash_risk.label}
              </span>
              <p className="cs-five-card-desc">{fiveLayer.cash_risk.summary}</p>
            </div>

            {/* 市场防御 */}
            <div className="cs-five-card">
              <span className="cs-five-card-name">4. 市场防御 (低波/Beta)</span>
              <span className={`cs-five-card-pill ${getTierClass(fiveLayer.market_defense.tier)}`}>
                {fiveLayer.market_defense.label}
              </span>
              <p className="cs-five-card-desc">{fiveLayer.market_defense.summary}</p>
            </div>

            {/* 产业链催化 */}
            <div className="cs-five-card">
              <span className="cs-five-card-name">5. 产业链催化</span>
              <span className={`cs-five-card-pill ${getTierClass(fiveLayer.chain_catalyst.tier)}`}>
                {fiveLayer.chain_catalyst.label}
              </span>
              <p className="cs-five-card-desc">{fiveLayer.chain_catalyst.summary}</p>
            </div>
          </div>

          {/* 主要反证与失真提醒 Callout */}
          <div className="cs-top-counter-evidence">
            <div className="cs-top-counter-head">
              <span>⚠ 主要反证与评分失真提醒:</span>
            </div>
            <div>
              {Array.isArray(fiveLayer.topCounter)
                ? fiveLayer.topCounter.map((c, i) => <p key={i} style={{ margin: '4px 0' }}>• {c}</p>)
                : <p style={{ margin: 0 }}>{fiveLayer.topCounter}</p>}
            </div>
          </div>
        </div>
      )}

      {/* 2. 已启用个股分析策略评估卡 (Strategy Evaluations) */}
      <div className="cs-section-header">
        <h3 className="cs-section-title" style={{ fontSize: '18px' }}>
          已启用独立分析策略评估卡 ({data?.evaluations?.length ?? 0})
        </h3>
        <p className="cs-section-subtitle">
          展示各策略插件的学术依据、指标逐项核验结果（附四层时点）、成立前提、主要反证及缺项。
        </p>
      </div>

      <div className="cs-evaluations-list">
        {data?.evaluations && data.evaluations.length > 0 ? (
          data.evaluations.map((ev) => (
            <div key={ev.plugin_id} className="cs-eval-card">
              <div className="cs-eval-header">
                <div className="cs-eval-title-group">
                  <h4 className="cs-eval-title">{ev.plugin_name}</h4>
                  <span className={`cs-badge ${ev.builtin ? 'cs-badge-graph' : 'cs-badge-ai'}`}>
                    {ev.builtin ? '内置核心引擎' : '自定义策略'}
                  </span>
                  <span className="cs-badge" style={{ background: '#f0f3f5', color: '#5a6d7e' }}>
                    {CATEGORY_NAMES[ev.category] || ev.category}
                  </span>
                </div>
                {ev.source_citation && (
                  <span className="cs-eval-citation">出处依据: {ev.source_citation}</span>
                )}
              </div>

              {/* 档位与结论 */}
              <div className="cs-eval-verdict">
                <span className={`cs-verdict-badge ${getTierClass(ev.verdict.tier)}`}>
                  {ev.verdict.label}
                </span>
                <p className="cs-verdict-summary">{ev.verdict.summary}</p>
              </div>

              {/* 指标核对与四层时点表格 */}
              {ev.indicator_checks && ev.indicator_checks.length > 0 && (
                <div className="cs-checks-table-container">
                  <table className="cs-checks-table">
                    <thead>
                      <tr>
                        <th>指标名称 / Key</th>
                        <th>当前取值</th>
                        <th>四层时点 (PIT)</th>
                        <th>核验状态</th>
                        <th>说明 / 规则阈值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ev.indicator_checks.map((chk) => (
                        <tr key={chk.key}>
                          <td>
                            <strong>{chk.label}</strong>
                            <span className="cs-code-pill" style={{ marginLeft: '6px' }}>{chk.key}</span>
                          </td>
                          <td><strong>{chk.formatted_value}</strong></td>
                          <td className="cs-pit-label">{chk.pit_label || '报告期时点未知'}</td>
                          <td>
                            {chk.passed === true ? (
                              <span className="cs-status-pass">✓ 满足</span>
                            ) : chk.passed === false ? (
                              <span className="cs-status-fail">⚠ 不满足</span>
                            ) : (
                              <span className="cs-status-unknown">? 待补数据</span>
                            )}
                          </td>
                          <td style={{ color: '#5a6d7e' }}>{chk.note || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 成立前提、主要反证与待补数据清单 */}
              <div className="cs-eval-collapsibles">
                {ev.conditions && ev.conditions.length > 0 && (
                  <details className="cs-details-block" open>
                    <summary>该策略结论成立的前提条件 ({ev.conditions.length})</summary>
                    <div className="cs-details-content">
                      <ul>
                        {ev.conditions.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  </details>
                )}

                {ev.counter_evidence && ev.counter_evidence.length > 0 && (
                  <details className="cs-details-block is-warning" open>
                    <summary>主要反证与失真风险（为什么可能误判） ({ev.counter_evidence.length})</summary>
                    <div className="cs-details-content">
                      <ul>
                        {ev.counter_evidence.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  </details>
                )}

                {ev.missing_indicators && ev.missing_indicators.length > 0 && (
                  <details className="cs-details-block">
                    <summary style={{ color: '#646c62' }}>
                      尚待数据源补全的指标 ({ev.missing_indicators.length})
                    </summary>
                    <div className="cs-details-content">
                      <ul>
                        {ev.missing_indicators.map((m, i) => (
                          <li key={i}>
                            <strong>{m.label} ({m.key})</strong>: {m.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="cs-section-subtitle">暂无可用的策略评估结果，请点击上方管理按钮启用策略插件。</p>
        )}
      </div>

      {/* 3. 底层数据指标完备度矩阵 (Indicator Snapshot Matrix) */}
      <div className="cs-snapshot-box">
        <div className="cs-snapshot-header">
          <div>
            <h3 className="cs-snapshot-title">底层数据指标完备度矩阵</h3>
            <p className="cs-section-subtitle" style={{ marginTop: '4px' }}>
              6 大核心模块指标库真实快照，严格区分报告期、发布日与交易日时点。
            </p>
          </div>
          <div className="cs-readiness-bar-box">
            <span className="cs-readiness-text">
              指标完备度: {readyCount} / {totalIndicators} ({readyPercentage}%)
            </span>
            <div className="cs-readiness-bar">
              <div
                className="cs-readiness-fill"
                style={{ width: `${readyPercentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* 6 大分类标签页 */}
        <div className="cs-cat-tabs">
          {Object.entries(CATEGORY_NAMES).map(([key, label]) => {
            const count = indicatorList.filter((i) => (i.category || 'valuation') === key).length;
            return (
              <button
                key={key}
                type="button"
                className={`cs-cat-tab ${activeCategory === key ? 'is-active' : ''}`}
                onClick={() => setActiveCategory(key)}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        {/* 指标矩阵表格 */}
        <div className="cs-matrix-table-container">
          <table className="cs-matrix-table">
            <thead>
              <tr>
                <th>标准指标</th>
                <th>当前数值</th>
                <th>单位</th>
                <th>数据源</th>
                <th>计算口径 / 公式</th>
                <th>四层时点防未来函数 (PIT)</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {currentCategoryIndicators.length > 0 ? (
                currentCategoryIndicators.map((ind) => (
                  <tr key={ind.key}>
                    <td>
                      <strong>{ind.label}</strong>
                      <div className="cs-code-pill" style={{ display: 'inline-block', marginTop: '2px' }}>
                        {ind.key}
                      </div>
                    </td>
                    <td>
                      <strong>{ind.formatted_value ?? (ind.value != null ? String(ind.value) : '-')}</strong>
                    </td>
                    <td>{ind.unit || '-'}</td>
                    <td>{ind.provider || 'iFinD / 东财'}</td>
                    <td style={{ color: '#5a6d7e', maxWidth: '220px' }}>{ind.formula || '-'}</td>
                    <td className="cs-pit-label" style={{ maxWidth: '280px' }}>
                      {formatPit(ind.pit)}
                    </td>
                    <td>
                      <span
                        className={`cs-state-badge ${
                          ind.state === 'ok'
                            ? 'cs-state-ok'
                            : ind.state === 'stale'
                            ? 'cs-state-stale'
                            : 'cs-state-unknown'
                        }`}
                      >
                        {ind.state === 'ok'
                          ? '正常'
                          : ind.state === 'stale'
                          ? '陈旧'
                          : ind.state === 'not_applicable'
                          ? '不适用'
                          : '待补'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: '#646c62', padding: '20px' }}>
                    本分类下暂无已收录指标记录，系统将按需从数据源提取。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// 6. 策略管理独立页面 / 嵌入面板 (StrategyManagerPage)
// ============================================================================

export function StrategyManagerPage({ onPluginsChange }: { onPluginsChange?: () => void }) {
  const [plugins, setPlugins] = useState<StrategyPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  // 新增表单状态
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState('quality');
  const [formCitation, setFormCitation] = useState('');
  const [formFavorable, setFormFavorable] = useState('估值与质量：共振偏优');
  const [formCautionary, setFormCautionary] = useState('估值与质量：需警惕');
  const [formConditions, setFormConditions] = useState('财报披露真实且应计利润与现金流匹配；非微利壳股。');
  const [formCounter, setFormCounter] = useState('行业处于下行周期底部或存在突发非经常性损益扰动时可能失真。');
  const [rules, setRules] = useState<StrategyPluginRule[]>([
    { key: 'roe_ttm', operator: '>=', threshold: 12 },
    { key: 'debt_ratio', operator: '<=', threshold: 60 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const fetchPlugins = () => {
    setLoading(true);
    setError('');
    void api<StrategyPlugin[] | { items: StrategyPlugin[] }>('/content/strategies')
      .then((res) => {
        const list = Array.isArray(res) ? res : res.items || [];
        setPlugins(list);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '策略插件列表读取失败');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchPlugins();
  }, []);

  // 启停开关
  const togglePlugin = async (id: string, currentEnabled: boolean) => {
    setActionMsg('');
    try {
      await api(`/content/strategies/${enc(id)}/toggle`, 'PUT', { enabled: !currentEnabled });
      setPlugins((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled: !currentEnabled } : p))
      );
      setActionMsg(`策略 ${id} 状态已更新为：${!currentEnabled ? '已启用' : '已停用'}`);
      onPluginsChange?.();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : '切换失败，请重试');
    }
  };

  // 删除自定义插件
  const deletePlugin = async (id: string) => {
    if (!window.confirm(`确认删除自定义策略插件「${id}」吗？`)) return;
    setActionMsg('');
    try {
      await api(`/content/strategies/${enc(id)}/delete`, 'POST', {});
      setPlugins((prev) => prev.filter((p) => p.id !== id));
      setActionMsg(`已成功删除策略 ${id}`);
      onPluginsChange?.();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : '删除失败，内置策略不可物理删除');
    }
  };

  // 追加规则行
  const addRule = () => {
    if (rules.length >= 3) {
      alert('自定义策略至多支持 3 项核心指标门槛规则');
      return;
    }
    setRules([...rules, { key: 'gross_margin', operator: '>=', threshold: 20 }]);
  };

  const removeRule = (idx: number) => {
    if (rules.length <= 1) {
      alert('至少需要 1 项指标规则');
      return;
    }
    setRules(rules.filter((_, i) => i !== idx));
  };

  const updateRule = (idx: number, patch: Partial<StrategyPluginRule>) => {
    setRules(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  // 提交新增自定义策略
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('请填写策略名称');
      return;
    }
    let validId = formId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!validId) {
      validId = `user_${Date.now().toString(36)}`;
    } else if (!validId.startsWith('user_')) {
      validId = `user_${validId}`;
    }

    const opMap: Record<string, 'gt' | 'gte' | 'lt' | 'lte' | 'eq'> = {
      '>': 'gt',
      '>=': 'gte',
      '<': 'lt',
      '<=': 'lte',
      '==': 'eq',
      gt: 'gt',
      gte: 'gte',
      lt: 'lt',
      lte: 'lte',
      eq: 'eq',
    };

    setSubmitting(true);
    setActionMsg('');

    const payload = {
      id: validId,
      name: formName.trim(),
      description: formDesc.trim() || '用户自定义量化与基本面策略',
      category: formCategory,
      source_citation: formCitation.trim() || '用户自定义选股与分析规则',
      rule_config: {
        favorable_label: formFavorable.trim() || '偏优',
        neutral_label: '中性观察',
        cautionary_label: formCautionary.trim() || '需警惕',
        favorable_conditions: rules.map((r) => ({
          indicator_key: r.key,
          operator: opMap[r.operator] || 'gte',
          threshold: r.threshold,
        })),
        cautionary_conditions: [],
        conditions_note: formConditions.split('\n').map((s) => s.trim()).filter(Boolean),
        counter_evidence: formCounter.split('\n').map((s) => s.trim()).filter(Boolean),
      },
    };

    try {
      await api('/content/strategies', 'POST', payload);
      setActionMsg(`自定义策略「${payload.name}」已成功创建并保存！`);
      setFormId('');
      setFormName('');
      setFormDesc('');
      fetchPlugins();
      onPluginsChange?.();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : '创建失败，请核对字段规范');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cs-manager-container">
      <div className="cs-section-header">
        <h2 className="cs-section-title">个股分析策略算法管理</h2>
        <p className="cs-section-subtitle">
          系统支持内置核心引擎与自定义量化策略热插拔。所有策略均遵循非黑箱原则输出独立档位与反证。
        </p>
      </div>

      {actionMsg && (
        <div className="cr-notice" style={{ marginBottom: '16px' }}>
          {actionMsg}
        </div>
      )}

      {loading && <p className="cr-meta" role="status">正在加载策略插件列表…</p>}
      {error && (
        <div className="cr-notice cr-error" role="alert">
          <p>{error}</p>
          <button className="cs-button" onClick={fetchPlugins}>重试</button>
        </div>
      )}

      {/* 插件列表 */}
      <div style={{ margin: '20px 0' }}>
        {plugins.map((plugin) => {
          const displayRules =
            plugin.rules && plugin.rules.length > 0
              ? plugin.rules.map((r) => `${r.key} ${r.operator} ${r.threshold}`).join(' 且 ')
              : plugin.rule_config?.favorable_conditions && plugin.rule_config.favorable_conditions.length > 0
              ? plugin.rule_config.favorable_conditions
                  .map((r) => `${r.indicator_key} ${r.operator} ${r.threshold}`)
                  .join(' 且 ')
              : '';
          return (
            <div key={plugin.id} className="cs-plugin-card">
              <div className="cs-plugin-main">
                <div className="cs-plugin-title-row">
                  <h4 className="cs-plugin-name">{plugin.name}</h4>
                  <span className={`cs-badge ${plugin.builtin ? 'cs-badge-graph' : 'cs-badge-ai'}`}>
                    {plugin.builtin ? '内置核心引擎' : '自定义算法'}
                  </span>
                  <span className="cs-badge" style={{ background: '#eeeee4', color: '#414f44' }}>
                    {CATEGORY_NAMES[plugin.category] || plugin.category}
                  </span>
                  <span className="cs-code-pill">{plugin.id}</span>
                </div>
                <p className="cs-plugin-desc">{plugin.description}</p>
                <div className="cs-plugin-meta">
                  <span>出处: {plugin.source_citation}</span>
                  {displayRules && <span>规则: {displayRules}</span>}
                </div>
              </div>

              <div className="cs-plugin-actions">
                <button
                  type="button"
                  className={`cs-button ${plugin.enabled ? 'cs-button-primary' : ''}`}
                  onClick={() => togglePlugin(plugin.id, plugin.enabled)}
                >
                  {plugin.enabled ? '已启用 · 点击停用' : '已停用 · 点击启用'}
                </button>
                {!plugin.builtin && (
                  <button
                    type="button"
                    className="cs-button cs-button-danger"
                    onClick={() => deletePlugin(plugin.id)}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ＋ 追加自定义个股分析策略表单 */}
      <form className="cs-form-card" onSubmit={handleCreate}>
        <h3 className="cs-form-title">＋ 追加自定义个股分析策略</h3>
        <p className="cs-section-subtitle" style={{ marginBottom: '16px' }}>
          基于真实数据指标库组合 1–3 项规则门槛，定义偏优档位、警惕档位与主要失真反证。
        </p>

        <div className="cs-form-grid">
          <div className="cs-form-group">
            <label htmlFor="cs-form-id">策略标识 ID (自动添加 user_ 前缀)</label>
            <input
              id="cs-form-id"
              type="text"
              placeholder="如 roe_low_debt"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
            />
            <span className="cs-form-hint">留空将自动生成随机编码</span>
          </div>

          <div className="cs-form-group">
            <label htmlFor="cs-form-name">策略名称 *</label>
            <input
              id="cs-form-name"
              type="text"
              placeholder="如：低负债高ROE成长质量策略"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>

          <div className="cs-form-group cs-form-full">
            <label htmlFor="cs-form-desc">策略逻辑描述</label>
            <input
              id="cs-form-desc"
              type="text"
              placeholder="简要说明该策略的筛选目的与经济学含义"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
            />
          </div>

          <div className="cs-form-group">
            <label htmlFor="cs-form-cat">策略分类</label>
            <select
              id="cs-form-cat"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value)}
            >
              <option value="valuation">估值与壳修正</option>
              <option value="quality">盈利质量与F-Score</option>
              <option value="cash_risk">应计与财务红旗</option>
              <option value="shareholder">股东回报</option>
              <option value="market_risk">市场风险与动量</option>
            </select>
          </div>

          <div className="cs-form-group">
            <label htmlFor="cs-form-citation">出处依据 / 逻辑引用</label>
            <input
              id="cs-form-citation"
              type="text"
              placeholder="如：Novy-Marx 质量与资产负债表稳健性组合"
              value={formCitation}
              onChange={(e) => setFormCitation(e.target.value)}
            />
          </div>

          <div className="cs-form-group">
            <label htmlFor="cs-form-fav">偏优档位标签 (满足规则时)</label>
            <input
              id="cs-form-fav"
              type="text"
              value={formFavorable}
              onChange={(e) => setFormFavorable(e.target.value)}
            />
          </div>

          <div className="cs-form-group">
            <label htmlFor="cs-form-caut">需警惕档位标签 (不满足时)</label>
            <input
              id="cs-form-caut"
              type="text"
              value={formCautionary}
              onChange={(e) => setFormCautionary(e.target.value)}
            />
          </div>

          {/* 指标规则组 */}
          <div className="cs-form-full">
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              指标门槛规则 (1 ~ 3 项)
            </label>
            {rules.map((rule, idx) => (
              <div key={idx} className="cs-rule-row">
                <select
                  value={rule.key}
                  onChange={(e) => updateRule(idx, { key: e.target.value })}
                  style={{ flex: 2 }}
                >
                  {STANDARD_INDICATORS.map((ind) => (
                    <option key={ind.key} value={ind.key}>
                      {ind.label} ({ind.unit || '数值'})
                    </option>
                  ))}
                </select>

                <select
                  value={rule.operator}
                  onChange={(e) => updateRule(idx, { operator: e.target.value })}
                  style={{ flex: 1 }}
                >
                  <option value=">=">&gt;= (大于等于)</option>
                  <option value=">">&gt; (大于)</option>
                  <option value="<=">&lt;= (小于等于)</option>
                  <option value="<">&lt; (小于)</option>
                  <option value="==">== (等于)</option>
                </select>

                <input
                  type="number"
                  step="any"
                  value={rule.threshold}
                  onChange={(e) => updateRule(idx, { threshold: Number(e.target.value) })}
                  style={{ flex: 1 }}
                  placeholder="阈值"
                />

                <button
                  type="button"
                  className="cs-button cs-button-danger"
                  onClick={() => removeRule(idx)}
                >
                  ✕
                </button>
              </div>
            ))}

            {rules.length < 3 && (
              <button
                type="button"
                className="cs-button"
                onClick={addRule}
                style={{ marginTop: '4px' }}
              >
                ＋ 增加一项指标规则
              </button>
            )}
          </div>

          <div className="cs-form-group cs-form-full">
            <label htmlFor="cs-form-conditions">成立前提 (换行分隔)</label>
            <textarea
              id="cs-form-conditions"
              rows={2}
              value={formConditions}
              onChange={(e) => setFormConditions(e.target.value)}
              style={{
                font: 'inherit',
                border: '1px solid #a5b6c3',
                borderRadius: '3px',
                padding: '8px 12px',
                background: '#ffffff',
                lineHeight: 1.6,
              }}
            />
          </div>

          <div className="cs-form-group cs-form-full">
            <label htmlFor="cs-form-counter">主要反证与失真原因 (换行分隔)</label>
            <textarea
              id="cs-form-counter"
              rows={2}
              value={formCounter}
              onChange={(e) => setFormCounter(e.target.value)}
              style={{
                font: 'inherit',
                border: '1px solid #a5b6c3',
                borderRadius: '3px',
                padding: '8px 12px',
                background: '#ffffff',
                lineHeight: 1.6,
              }}
            />
          </div>
        </div>

        <div className="cs-form-actions">
          <button
            type="submit"
            className="cs-button cs-button-primary"
            disabled={submitting}
          >
            {submitting ? '保存中…' : '✔ 保存并启用自定义策略'}
          </button>
        </div>
      </form>
    </div>
  );
}
