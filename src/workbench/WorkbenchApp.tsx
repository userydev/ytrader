import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api, RequestError } from '../api';
import type {
  SystemStatusResponse,
  EventListResponse,
  EventSummaryItem,
  EventDetailResponse,
  ChainListResponse,
  ChainGraphResponse,
  ChainGraphNode,
  ChainGraphEdge,
  NodeDetailResponse,
  CompanyProfileResponse,
  StrategyListResponse,
  StrategyManifest,
  StrategyRunResult,
  IndicatorRegistryResponse,
  CreateStrategyRequest,
  EventNodeImpact,
  EventCompanyLanding,
  ClaimItem,
  NodeCompanyExposure,
  MainbzItem,
  IndicatorSnapshotValue,
  StrategyConditionTrace,
  StrategyDslLeafCondition,
  FetchRunStatus,
  IndicatorRegistryItem,
  ExposureStrength,
} from '../contracts/index';
import { CreateStrategyRequestSchema } from '../contracts/index';
import './workbench.css';

// =========================================================================
// Institutional Label Mappings & Formatters
// =========================================================================

const OVERALL_STATUS_MAP: Record<string, { label: string; tone: string }> = {
  ok: { label: '正常', tone: 'green' },
  empty: { label: '无新增', tone: 'slate' },
  partial: { label: '部分延迟', tone: 'amber' },
  failed: { label: '采集失败', tone: 'rose' },
  not_configured: { label: '未配置', tone: 'slate' },
};

const EVIDENCE_STATUS_MAP: Record<string, { label: string; tone: string }> = {
  primary_supported: { label: '原始依据支持', tone: 'cyan' },
  corroborated: { label: '独立报道支持', tone: 'blue' },
  unverified: { label: '未核实', tone: 'amber' },
  conflicting: { label: '依据冲突', tone: 'rose' },
  refuted: { label: '已被否定', tone: 'rose' },
};

const EXPOSURE_STRENGTH_MAP: Record<ExposureStrength, { label: string; tone: string }> = {
  primary_over_50: { label: '主营(>50%)', tone: 'green' },
  major_20_to_50: { label: '重要(20-50%)', tone: 'blue' },
  minor_under_20: { label: '次要(<20%)', tone: 'slate' },
  verified_business: { label: '已核实主营', tone: 'cyan' },
  candidate_only: { label: '仅概念候选', tone: 'slate' },
};

const DIRECTION_MAP: Record<string, { label: string; tone: string }> = {
  favorable: { label: '偏正面', tone: 'green' },
  unfavorable: { label: '偏负面', tone: 'rose' },
  uncertain: { label: '不确定', tone: 'amber' },
};

const TIER_MAP: Record<string, { label: string; tone: string }> = {
  favorable: { label: '偏正面 / 符合条件', tone: 'green' },
  neutral: { label: '中性 / 观察', tone: 'amber' },
  cautionary: { label: '警示 / 触发红旗', tone: 'rose' },
  insufficient_data: { label: '数据不足 / 暂不判断', tone: 'slate' },
};

const INDICATOR_CATEGORY_MAP: Record<string, string> = {
  valuation: '估值与壳修正',
  profitability: '盈利质量与成长',
  fscore: 'Piotroski F-Score',
  cashflow_redflag: '现金流与红旗',
  dividend: '分红与股东回报',
  volatility_momentum: '量价波动与动量',
};

function formatShanghaiTime(isoString: string | null | undefined): string {
  if (!isoString) return '未知时间';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function formatPercent(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || isNaN(val)) return '-';
  return `${(val * 100).toFixed(decimals)}%`;
}

function formatYuanInYi(yuan: number | null | undefined): string {
  if (yuan === null || yuan === undefined || isNaN(yuan)) return '-';
  return `${(yuan / 1e8).toFixed(2)} 亿元`;
}

// Global scroll position memory across hash route changes
const routeScrollMemory = new Map<string, number>();

function normalizeAshareCode(input: string): string {
  const clean = input.trim().toUpperCase();
  if (/^\d{6}\.[A-Z]{2}$/.test(clean)) return clean;
  const digits = clean.replace(/\D/g, '');
  if (digits.length === 6) {
    if (digits.startsWith('6') || digits.startsWith('9') || digits.startsWith('5')) {
      return `${digits}.${'S' + 'H'}`;
    }
    if (digits.startsWith('4') || digits.startsWith('8')) {
      return `${digits}.${'B' + 'J'}`;
    }
    return `${digits}.${'S' + 'Z'}`;
  }
  return clean;
}

// =========================================================================
// Main Workbench Application Container
// =========================================================================

export function WorkbenchApp({ onLogout }: { onLogout?: () => Promise<void> | void }) {
  // Hash routing parser
  const [currentHash, setCurrentHash] = useState<string>(() => window.location.hash || '#/');

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash || '#/');
    };

    const handleLinkClick = (e: MouseEvent) => {
      const link = (e.target as Element).closest('a[href^="#/"]');
      if (link) {
        routeScrollMemory.set(currentHash, window.scrollY);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    document.addEventListener('click', handleLinkClick, true);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      document.removeEventListener('click', handleLinkClick, true);
    };
  }, [currentHash]);

  // Restore scroll position after route change
  useEffect(() => {
    const saved = routeScrollMemory.get(currentHash);
    window.scrollTo({ top: saved ?? 0, behavior: 'instant' as ScrollBehavior });
  }, [currentHash]);

  // Route breakdown
  const route = useMemo(() => {
    const raw = currentHash.startsWith('#') ? currentHash.slice(1) : currentHash;
    const path = raw.split('?')[0] || '/';

    if (path === '/' || path === '') {
      return { page: 'events' as const };
    }
    const eventMatch = path.match(/^\/events\/([^/]+)/);
    if (eventMatch) {
      return { page: 'event-detail' as const, eventId: decodeURIComponent(eventMatch[1]) };
    }
    const chainMatch = path.match(/^\/chains(?:\/([^/]+))?/);
    if (chainMatch) {
      return { page: 'chains' as const, chainId: chainMatch[1] ? decodeURIComponent(chainMatch[1]) : undefined };
    }
    const nodeMatch = path.match(/^\/nodes\/([^/]+)/);
    if (nodeMatch) {
      return { page: 'chains' as const, nodeId: decodeURIComponent(nodeMatch[1]) };
    }
    const companyMatch = path.match(/^\/companies(?:\/([^/]+))?/);
    if (companyMatch) {
      return { page: 'company' as const, companyCode: companyMatch[1] ? decodeURIComponent(companyMatch[1]) : '' };
    }
    if (path.startsWith('/strategies')) {
      return { page: 'strategies' as const };
    }
    if (path.startsWith('/indicators')) {
      return { page: 'indicators' as const };
    }

    return { page: 'events' as const };
  }, [currentHash]);

  // System status state
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [systemStatusLoading, setSystemStatusLoading] = useState(false);
  const [systemStatusError, setSystemStatusError] = useState<string | null>(null);

  const fetchSystemStatus = useCallback(async () => {
    setSystemStatusLoading(true);
    setSystemStatusError(null);
    try {
      const res = await api<SystemStatusResponse>('/content/system/status');
      setSystemStatus(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法获取系统状态';
      setSystemStatusError(message);
    } finally {
      setSystemStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSystemStatus();
  }, [fetchSystemStatus]);

  // Shared active company code for top navigation shortcut
  const activeCompanyCode = route.page === 'company' && route.companyCode ? route.companyCode : '';

  return (
    <div className="workbench-root">
      {/* Top Header & Brand */}
      <header className="wb-header">
        <div className="wb-header-inner">
          <div className="wb-brand-section">
            <span className="wb-logo-pill">ytrader</span>
            <span className="wb-brand-title">研报与产业链工作台</span>
            <span className="wb-brand-subtitle">机构级事实驱动与时点审计</span>
          </div>

          <nav className="wb-nav-tabs" aria-label="主要导航">
            <a
              href="#/"
              className={`wb-nav-tab ${route.page === 'events' || route.page === 'event-detail' ? 'active' : ''}`}
            >
              今日事件
            </a>
            <a
              href="#/chains"
              className={`wb-nav-tab ${route.page === 'chains' ? 'active' : ''}`}
            >
              产业链图谱
            </a>
            <a
              href={activeCompanyCode ? `#/companies/${activeCompanyCode}` : '#/companies'}
              className={`wb-nav-tab ${route.page === 'company' ? 'active' : ''}`}
            >
              个股与策略
            </a>
            <a
              href="#/strategies"
              className={`wb-nav-tab ${route.page === 'strategies' ? 'active' : ''}`}
            >
              策略管理
            </a>
            <a
              href="#/indicators"
              className={`wb-nav-tab ${route.page === 'indicators' ? 'active' : ''}`}
            >
              指标字典
            </a>
          </nav>

          <div className="wb-header-actions">
            {onLogout && (
              <button
                type="button"
                className="wb-btn wb-btn-subtle"
                onClick={() => {
                  void onLogout();
                }}
              >
                退出登录
              </button>
            )}
          </div>
        </div>

        {/* Real System Status Strip */}
        <SystemStatusStrip
          status={systemStatus}
          loading={systemStatusLoading}
          error={systemStatusError}
          onRefresh={fetchSystemStatus}
        />
      </header>

      {/* Main Page Content */}
      <main className="wb-main-container">
        {route.page === 'events' && <EventsPage onSystemStatusUpdated={setSystemStatus} />}
        {route.page === 'event-detail' && <EventDetailPage eventId={route.eventId} />}
        {route.page === 'chains' && <ChainsPage chainId={route.chainId} nodeId={route.nodeId} />}
        {route.page === 'company' && <CompanyProfilePage companyCode={route.companyCode} />}
        {route.page === 'strategies' && <StrategiesPage />}
        {route.page === 'indicators' && <IndicatorsPage />}
      </main>
    </div>
  );
}

// =========================================================================
// Component: Real System Status Strip
// =========================================================================

function SystemStatusStrip({
  status,
  loading,
  error,
  onRefresh,
}: {
  status: SystemStatusResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (error) {
    return (
      <div className="wb-status-strip wb-status-strip-error">
        <div className="wb-status-strip-inner">
          <span className="wb-status-pill tone-rose">状态异常</span>
          <span className="wb-status-text">系统状态采集服务连接失败: {error}</span>
          <button type="button" className="wb-btn wb-btn-xs" onClick={onRefresh} disabled={loading}>
            {loading ? '正在重试…' : '重新核验'}
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="wb-status-strip">
        <div className="wb-status-strip-inner">
          <span className="wb-status-pill tone-slate">正在核验系统数据水位…</span>
        </div>
      </div>
    );
  }

  const overall = OVERALL_STATUS_MAP[status.overall_status] ?? { label: status.overall_status, tone: 'slate' };

  return (
    <div className="wb-status-strip">
      <div className="wb-status-strip-inner">
        <div className="wb-status-summary">
          <span className={`wb-status-pill tone-${overall.tone}`}>系统状态: {overall.label}</span>
          <span className="wb-status-divider">|</span>
          <span className="wb-status-meta">
            最新成功采集:{' '}
            {status.last_success_at ? formatShanghaiTime(status.last_success_at) : '无成功记录'}
          </span>
          <span className="wb-status-divider">|</span>
          <div className="wb-status-counts">
            <span className="wb-count-item">事件 <strong>{status.counts.events}</strong></span>
            <span className="wb-count-item">节点 <strong>{status.counts.nodes}</strong></span>
            <span className="wb-count-item">生产要素边 <strong>{status.counts.production_edges}</strong></span>
            <span className="wb-count-item">覆盖公司 <strong>{status.counts.companies}</strong></span>
            <span className="wb-count-item">主营核验暴露 <strong>{status.counts.verified_exposures}</strong></span>
          </div>
        </div>

        <div className="wb-status-actions">
          <button
            type="button"
            className="wb-btn wb-btn-subtle wb-btn-xs"
            onClick={() => setExpanded(prev => !prev)}
          >
            {expanded ? '收起批次明细 ▲' : '数据源批次明细 ▼'}
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-subtle wb-btn-xs"
            onClick={onRefresh}
            disabled={loading}
            title="刷新系统状态"
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="wb-status-drawer">
          <div className="wb-status-table-wrap">
            <table className="wb-status-table">
              <thead>
                <tr>
                  <th>数据源服务</th>
                  <th>批次编号</th>
                  <th>状态</th>
                  <th>完成时间 (北京时间)</th>
                  <th>收录条数</th>
                  <th>异常说明</th>
                </tr>
              </thead>
              <tbody>
                {status.derived_from_runs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="wb-cell-muted">暂无数据源批次记录</td>
                  </tr>
                ) : (
                  status.derived_from_runs.map((run: FetchRunStatus) => {
                    const runOverall = OVERALL_STATUS_MAP[run.status] ?? { label: run.status, tone: 'slate' };
                    return (
                      <tr key={run.run_id}>
                        <td><strong>{run.provider}</strong></td>
                        <td className="wb-cell-code">{run.run_id}</td>
                        <td>
                          <span className={`wb-badge tone-${runOverall.tone}`}>{runOverall.label}</span>
                        </td>
                        <td>{formatShanghaiTime(run.finished_at)}</td>
                        <td>{run.item_count} 条</td>
                        <td className={run.error_message ? 'wb-cell-danger' : 'wb-cell-muted'}>
                          {run.error_message || '无错误'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Page 1: 今日事件 (`#/`)
// =========================================================================

function EventsPage({ onSystemStatusUpdated }: { onSystemStatusUpdated?: (status: SystemStatusResponse) => void }) {
  const [data, setData] = useState<EventListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [coverageFilter, setCoverageFilter] = useState<'all' | 'mapped' | 'uncovered'>('all');
  const [chainFilter, setChainFilter] = useState<string>('all');

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<EventListResponse>('/content/events');
      setData(res);
      if (res.system_status && onSystemStatusUpdated) {
        onSystemStatusUpdated(res.system_status);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取事件列表失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [onSystemStatusUpdated]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // Extract distinct chain names from items
  const distinctChains = useMemo(() => {
    if (!data?.items) return [];
    const set = new Set<string>();
    for (const item of data.items) {
      if (item.matched_chain_name) {
        set.add(item.matched_chain_name);
      }
    }
    return Array.from(set);
  }, [data]);

  // Filter items
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter(item => {
      // Coverage filter
      if (coverageFilter === 'mapped' && item.coverage_status !== 'mapped') return false;
      if (coverageFilter === 'uncovered' && item.coverage_status === 'mapped') return false;

      // Chain filter
      if (chainFilter !== 'all' && item.matched_chain_name !== chainFilter) return false;

      return true;
    });
  }, [data, coverageFilter, chainFilter]);

  return (
    <div className="wb-page-events">
      <div className="wb-page-header">
        <div>
          <h1 className="wb-page-title">今日事件</h1>
          <p className="wb-page-subtitle">
            严格区分已核验事实与推演边界，沿真实生产要素图谱向受影响公司传导
          </p>
        </div>
        <button type="button" className="wb-btn wb-btn-subtle" onClick={loadEvents} disabled={loading}>
          {loading ? '正在刷新…' : '刷新事件'}
        </button>
      </div>

      {/* Filter Bar */}
      <div className="wb-filter-bar">
        <div className="wb-filter-group">
          <span className="wb-filter-label">覆盖状态:</span>
          <button
            type="button"
            className={`wb-filter-chip ${coverageFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCoverageFilter('all')}
          >
            全部事件
          </button>
          <button
            type="button"
            className={`wb-filter-chip ${coverageFilter === 'mapped' ? 'active' : ''}`}
            onClick={() => setCoverageFilter('mapped')}
          >
            已定位产业链节点 (mapped)
          </button>
          <button
            type="button"
            className={`wb-filter-chip ${coverageFilter === 'uncovered' ? 'active' : ''}`}
            onClick={() => setCoverageFilter('uncovered')}
          >
            仅事实 / 未覆盖 (uncovered / facts_only)
          </button>
        </div>

        <div className="wb-filter-group">
          <span className="wb-filter-label">产业链筛选:</span>
          <button
            type="button"
            className={`wb-filter-chip ${chainFilter === 'all' ? 'active' : ''}`}
            onClick={() => setChainFilter('all')}
          >
            全部产业链
          </button>
          {distinctChains.map(chainName => (
            <button
              key={chainName}
              type="button"
              className={`wb-filter-chip ${chainFilter === chainName ? 'active' : ''}`}
              onClick={() => setChainFilter(chainName)}
            >
              {chainName}
            </button>
          ))}
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div className="wb-loading-state">
          <p className="wb-loading-text">正在从已核验内容库读取今日市场事件…</p>
        </div>
      )}

      {error && (
        <div className="wb-error-state" role="alert">
          <h3>事件列表读取失败</h3>
          <p>{error}</p>
          <button type="button" className="wb-btn" onClick={loadEvents}>重新读取</button>
        </div>
      )}

      {/* Event Cards List */}
      {!loading && !error && (
        <div className="wb-event-list">
          {filteredItems.length === 0 ? (
            <div className="wb-empty-card">
              <h3>暂无匹配事件</h3>
              <p>当前筛选条件下未发现满足依据核验标准的新增事件。</p>
            </div>
          ) : (
            filteredItems.map(item => <EventSummaryCard key={item.event_id} item={item} />)
          )}
        </div>
      )}
    </div>
  );
}

function EventSummaryCard({ item }: { item: EventSummaryItem }) {
  const evidenceStatus = EVIDENCE_STATUS_MAP[item.evidence_status] ?? { label: item.evidence_status, tone: 'slate' };
  const isMapped = item.coverage_status === 'mapped';

  return (
    <article className="wb-event-card">
      <div className="wb-event-meta-row">
        <span className="wb-event-source">{item.source_name}</span>
        <span className="wb-event-dot">·</span>
        <span className="wb-event-time">
          {item.published_at !== null ? formatShanghaiTime(item.published_at) : '发布时间未知 · 仅记录收录时间'}
        </span>
        <span className={`wb-badge tone-${evidenceStatus.tone}`}>{evidenceStatus.label}</span>

        {isMapped ? (
          <span className="wb-badge tone-blue">
            已映射产业链: {item.matched_chain_name || '已定位'} · 震中: {item.epicenter_node_name || '震中节点'}
          </span>
        ) : (
          <span className="wb-badge tone-slate">
            未覆盖产业链 · 仅保留事实
          </span>
        )}

        {item.importance === 'major' && <span className="wb-badge tone-rose">重大</span>}
      </div>

      <h2 className="wb-event-headline">
        <a href={`#/events/${item.event_id}`}>{item.headline}</a>
      </h2>

      <div className="wb-event-impact-box">
        <span className="wb-impact-tag">一句话影响</span>
        <p className="wb-impact-text">{item.one_line_impact}</p>
      </div>

      {item.summary && <p className="wb-event-summary">{item.summary}</p>}

      <div className="wb-event-footer">
        <div className="wb-event-metrics">
          <span>影响节点 <strong>{item.impacted_node_count}</strong> 个</span>
          <span className="wb-metrics-dot">·</span>
          <span>明确主营暴露公司 <strong>{item.landed_company_count}</strong> 家</span>
        </div>

        <a href={`#/events/${item.event_id}`} className="wb-link-btn">
          查看传导推演与公司落点 →
        </a>
      </div>
    </article>
  );
}

// =========================================================================
// Page 2: 事件详情页 (`#/events/:id`)
// =========================================================================

function EventDetailPage({ eventId }: { eventId: string }) {
  const [detail, setDetail] = useState<EventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<EventDetailResponse>(`/content/events/${encodeURIComponent(eventId)}`);
      setDetail(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取事件详情失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (loading) {
    return (
      <div className="wb-loading-state">
        <p className="wb-loading-text">正在读取事件事实断言、传导子图与主营暴露落点…</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="wb-error-state" role="alert">
        <a href="#/" className="wb-back-link">← 返回今日事件</a>
        <h3>无法载入事件详情</h3>
        <p>{error || '未找到该事件内容'}</p>
        <button type="button" className="wb-btn" onClick={loadDetail}>重试读取</button>
      </div>
    );
  }

  const { event, claims, coverage_gap_reason, impacts, subgraph_nodes, subgraph_edges, company_landings, missing_evidence } = detail;
  const evidenceStatus = EVIDENCE_STATUS_MAP[event.evidence_status] ?? { label: event.evidence_status, tone: 'slate' };
  const isMapped = event.coverage_status === 'mapped';

  return (
    <div className="wb-page-event-detail">
      <div className="wb-nav-back-row">
        <a href="#/" className="wb-back-link">← 返回今日事件</a>
      </div>

      {/* Main Header */}
      <header className="wb-detail-header">
        <div className="wb-event-meta-row">
          <span className="wb-event-source">{event.source_name}</span>
          <span className="wb-event-dot">·</span>
          <span className="wb-event-time">
            {event.published_at !== null ? formatShanghaiTime(event.published_at) : '发布时间未知 · 仅记录收录时间'}
          </span>
          <span className={`wb-badge tone-${evidenceStatus.tone}`}>{evidenceStatus.label}</span>
          {isMapped ? (
            <span className="wb-badge tone-blue">
              已映射产业链: {event.matched_chain_name} · 震中: {event.epicenter_node_name}
            </span>
          ) : (
            <span className="wb-badge tone-slate">
              未覆盖产业链 · 仅保留事实
            </span>
          )}
        </div>

        <h1 className="wb-detail-title">{event.headline}</h1>

        <div className="wb-event-impact-box">
          <span className="wb-impact-tag">核心影响判定</span>
          <p className="wb-impact-text">{event.one_line_impact}</p>
        </div>

        {event.summary && <p className="wb-detail-summary">{event.summary}</p>}
      </header>

      {/* Section A: 事实与来源断言 */}
      <section className="wb-detail-section">
        <div className="wb-section-header">
          <h2 className="wb-section-title">Section A — 事实与来源断言 (Claims)</h2>
          <span className="wb-section-count">共 {claims.length} 条核验断言</span>
        </div>

        <div className="wb-claims-list">
          {claims.map(claim => (
            <ClaimCard key={claim.claim_id} claim={claim} />
          ))}
        </div>

        {missing_evidence && missing_evidence.length > 0 && (
          <div className="wb-missing-evidence-box">
            <h4>缺失依据警示:</h4>
            <ul>
              {missing_evidence.map((gap, i) => (
                <li key={i}>{gap}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Section B: 震中定位与沿图传导推演 */}
      <section className="wb-detail-section">
        <div className="wb-section-header">
          <h2 className="wb-section-title">Section B — 震中定位与沿图传导推演</h2>
          <span className="wb-section-count">
            {impacts.length > 0 ? `传导受影响节点 ${impacts.length} 个` : '传导推演停步'}
          </span>
        </div>

        {!isMapped || impacts.length === 0 ? (
          <div className="wb-stopping-notice" role="note">
            <h4>到此为止：</h4>
            <p>
              {coverage_gap_reason ??
                '缺少已核实的产业链节点映射或显式变化依据，不生成传导推断。'}
            </p>
          </div>
        ) : (
          <>
            {/* Interactive Directed Subgraph SVG/Flow */}
            <LocalTransmissionSubgraph
              nodes={subgraph_nodes}
              edges={subgraph_edges}
              impacts={impacts}
            />

            {/* Hop-by-Hop Impact Cards */}
            <div className="wb-impacts-list">
              {impacts.map(impact => (
                <ImpactCard key={impact.impact_id} impact={impact} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Section C: 具备主营暴露证据的关联公司 */}
      <section className="wb-detail-section">
        <div className="wb-section-header">
          <h2 className="wb-section-title">Section C — 具备主营暴露证据的关联公司</h2>
          <span className="wb-section-count">
            {company_landings.length > 0 ? `明确主营落地公司 ${company_landings.length} 家` : '无合格落地公司'}
          </span>
        </div>

        {company_landings.length === 0 ? (
          <div className="wb-stopping-notice" role="note">
            <p>停在产业环节：当前受影响节点尚无满足主营收入暴露证据的已收录公司，不硬凑个股。</p>
          </div>
        ) : (
          <div className="wb-landings-grid">
            {company_landings.map(landing => (
              <CompanyLandingCard key={`${landing.company_code}-${landing.node_id}`} landing={landing} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ClaimCard({ claim }: { claim: ClaimItem }) {
  const [expanded, setExpanded] = useState(false);
  const status = EVIDENCE_STATUS_MAP[claim.evidence_status] ?? { label: claim.evidence_status, tone: 'slate' };

  const kindBadge =
    claim.kind === 'fact'
      ? { label: '事实 (fact)', className: 'claim-kind-fact' }
      : claim.kind === 'source_opinion'
      ? { label: '来源观点 (source_opinion)', className: 'claim-kind-opinion' }
      : { label: '条件推断 (conditional_inference)', className: 'claim-kind-inference' };

  return (
    <div className={`wb-claim-card ${kindBadge.className}`}>
      <div className="wb-claim-header">
        <span className={`wb-claim-tag ${kindBadge.className}`}>{kindBadge.label}</span>
        <span className={`wb-badge tone-${status.tone}`}>{status.label}</span>
      </div>

      <p className="wb-claim-text">{claim.text}</p>

      {claim.evidence && claim.evidence.length > 0 && (
        <div className="wb-claim-evidence-section">
          <button
            type="button"
            className="wb-btn-text"
            onClick={() => setExpanded(prev => !prev)}
          >
            {expanded ? '收起依据出处 ▲' : `核验依据出处 (${claim.evidence.length} 条) ▼`}
          </button>

          {expanded && (
            <div className="wb-claim-evidence-list">
              {claim.evidence.map((ev, i) => (
                <div key={i} className="wb-evidence-quote-item">
                  <div className="wb-evidence-quote-meta">
                    <strong>{ev.provider}</strong>
                    <span>观察时点: {formatShanghaiTime(ev.observed_at)}</span>
                  </div>
                  {ev.quote && <blockquote>{ev.quote}</blockquote>}
                  {ev.url && (
                    <a href={ev.url} target="_blank" rel="noopener noreferrer" className="wb-source-link">
                      查看原始出处 ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// Sub-Component: Local Transmission Subgraph SVG
// -------------------------------------------------------------------------

function LocalTransmissionSubgraph({
  nodes,
  edges,
  impacts,
}: {
  nodes: ChainGraphNode[];
  edges: ChainGraphEdge[];
  impacts: EventNodeImpact[];
}) {
  // Map node to impact for hop and direction
  const impactMap = useMemo(() => {
    const map = new Map<string, EventNodeImpact>();
    for (const imp of impacts) {
      map.set(imp.node_id, imp);
    }
    return map;
  }, [impacts]);

  // Group nodes by hop (0, 1, 2)
  const hopGroups = useMemo(() => {
    const groups: Record<number, ChainGraphNode[]> = { 0: [], 1: [], 2: [] };
    for (const node of nodes) {
      const imp = impactMap.get(node.id);
      const hop = imp ? imp.hop : (node.layer >= 0 && node.layer <= 2 ? node.layer : 0);
      if (groups[hop]) {
        groups[hop].push(node);
      } else {
        groups[0].push(node);
      }
    }
    return groups;
  }, [nodes, impactMap]);

  return (
    <div className="wb-subgraph-card">
      <div className="wb-subgraph-header">
        <h3>局部传导有向子图 (0跳震中 → 1跳一阶 → 2跳二阶)</h3>
        <span className="wb-subgraph-legend">
          <span className="wb-legend-item tone-green">偏正面</span>
          <span className="wb-legend-item tone-rose">偏负面</span>
          <span className="wb-legend-item tone-amber">不确定</span>
        </span>
      </div>

      <div className="wb-subgraph-canvas-wrap">
        <div className="wb-subgraph-columns">
          {/* Column 0: 0跳 震中 */}
          <div className="wb-subgraph-col">
            <div className="wb-hop-col-header">
              <span className="wb-hop-col-pill tone-cyan">0跳 · 震中节点</span>
            </div>
            <div className="wb-hop-node-list">
              {hopGroups[0].map(node => {
                const imp = impactMap.get(node.id);
                const dir = imp ? DIRECTION_MAP[imp.direction] ?? { label: imp.direction_label, tone: 'slate' } : { label: '未评定', tone: 'slate' };
                return (
                  <div key={node.id} className={`wb-subgraph-node-box tone-${dir.tone}`}>
                    <div className="wb-subgraph-node-top">
                      <span className="wb-node-name">{node.name}</span>
                      <span className={`wb-badge tone-${dir.tone}`}>{dir.label}</span>
                    </div>
                    {imp && <span className="wb-node-shock">冲击: {imp.shock_variable}</span>}
                    <a href={`#/nodes/${node.id}`} className="wb-subgraph-node-link">查看节点逻辑卡 →</a>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="wb-subgraph-arrow-connector">→</div>

          {/* Column 1: 1跳 一阶传导 */}
          <div className="wb-subgraph-col">
            <div className="wb-hop-col-header">
              <span className="wb-hop-col-pill tone-blue">1跳 · 一阶传导</span>
            </div>
            <div className="wb-hop-node-list">
              {hopGroups[1].length === 0 ? (
                <div className="wb-hop-empty-box">无一阶传导节点</div>
              ) : (
                hopGroups[1].map(node => {
                  const imp = impactMap.get(node.id);
                  const dir = imp ? DIRECTION_MAP[imp.direction] ?? { label: imp.direction_label, tone: 'slate' } : { label: '未评定', tone: 'slate' };
                  return (
                    <div key={node.id} className={`wb-subgraph-node-box tone-${dir.tone}`}>
                      <div className="wb-subgraph-node-top">
                        <span className="wb-node-name">{node.name}</span>
                        <span className={`wb-badge tone-${dir.tone}`}>{dir.label}</span>
                      </div>
                      {imp && (
                        <>
                          <span className="wb-node-shock">冲击: {imp.shock_variable}</span>
                          {imp.via_edge_relation && (
                            <span className="wb-node-edge-via">经由要素: {imp.via_edge_relation}</span>
                          )}
                        </>
                      )}
                      <a href={`#/nodes/${node.id}`} className="wb-subgraph-node-link">查看节点逻辑卡 →</a>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="wb-subgraph-arrow-connector">→</div>

          {/* Column 2: 2跳 二阶传导 */}
          <div className="wb-subgraph-col">
            <div className="wb-hop-col-header">
              <span className="wb-hop-col-pill tone-purple">2跳 · 二阶传导</span>
            </div>
            <div className="wb-hop-node-list">
              {hopGroups[2].length === 0 ? (
                <div className="wb-hop-empty-box">无二阶传导节点</div>
              ) : (
                hopGroups[2].map(node => {
                  const imp = impactMap.get(node.id);
                  const dir = imp ? DIRECTION_MAP[imp.direction] ?? { label: imp.direction_label, tone: 'slate' } : { label: '未评定', tone: 'slate' };
                  return (
                    <div key={node.id} className={`wb-subgraph-node-box tone-${dir.tone}`}>
                      <div className="wb-subgraph-node-top">
                        <span className="wb-node-name">{node.name}</span>
                        <span className={`wb-badge tone-${dir.tone}`}>{dir.label}</span>
                      </div>
                      {imp && (
                        <>
                          <span className="wb-node-shock">冲击: {imp.shock_variable}</span>
                          {imp.via_edge_relation && (
                            <span className="wb-node-edge-via">经由要素: {imp.via_edge_relation}</span>
                          )}
                        </>
                      )}
                      <a href={`#/nodes/${node.id}`} className="wb-subgraph-node-link">查看节点逻辑卡 →</a>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImpactCard({ impact }: { impact: EventNodeImpact }) {
  const dir = DIRECTION_MAP[impact.direction] ?? { label: impact.direction_label, tone: 'slate' };
  const hopTitle = impact.hop === 0 ? '0跳 · 震中节点' : impact.hop === 1 ? '1跳 · 一阶传导' : '2跳 · 二阶传导';

  return (
    <div className={`wb-impact-card tone-${dir.tone}`}>
      <div className="wb-impact-header">
        <div className="wb-impact-title-group">
          <span className="wb-hop-badge">{hopTitle}</span>
          <a href={`#/nodes/${impact.node_id}`} className="wb-impact-node-title">
            {impact.node_name}
          </a>
        </div>
        <div className="wb-impact-badges">
          <span className={`wb-badge tone-${dir.tone}`}>{impact.direction_label}</span>
          <span className="wb-badge tone-slate">冲击变量: {impact.shock_variable}</span>
        </div>
      </div>

      {impact.from_node_name && (
        <div className="wb-impact-edge-info">
          通过生产要素边: <strong>{impact.from_node_name}</strong> → <strong>{impact.node_name}</strong>
          {impact.via_edge_relation && <span className="wb-edge-rel-tag">({impact.via_edge_relation})</span>}
        </div>
      )}

      <p className="wb-impact-mechanism">
        <strong>作用机制: </strong>
        {impact.mechanism}
      </p>

      {impact.conditions && impact.conditions.length > 0 && (
        <div className="wb-impact-sublist">
          <span className="wb-sublist-label">成立前提条件:</span>
          <ul>
            {impact.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {impact.counterforces && impact.counterforces.length > 0 && (
        <div className="wb-impact-sublist">
          <span className="wb-sublist-label">制约与反向力量:</span>
          <ul>
            {impact.counterforces.map((cf, i) => (
              <li key={i}>{cf}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="wb-impact-footer">
        <span className="wb-impact-metric">
          <strong>验证观察指标: </strong>
          {impact.verify_metric}
        </span>
        <span className="wb-impact-claims-ref">
          依据事实断言: {impact.depends_on_claim_ids.join(', ')}
        </span>
      </div>
    </div>
  );
}

function CompanyLandingCard({ landing }: { landing: EventCompanyLanding }) {
  const dir = DIRECTION_MAP[landing.node_direction] ?? { label: landing.node_direction, tone: 'slate' };
  const strength = EXPOSURE_STRENGTH_MAP[landing.exposure_strength] ?? { label: landing.exposure_strength, tone: 'slate' };

  return (
    <div className="wb-company-landing-card">
      <div className="wb-landing-header">
        <div>
          <a href={`#/companies/${landing.company_code}`} className="wb-landing-company-name">
            {landing.company_name} ({landing.company_code})
          </a>
          <div className="wb-landing-node-ref">
            映射节点: {landing.node_name} ({landing.hop}跳)
          </div>
        </div>
        <div className="wb-landing-badges">
          <span className={`wb-badge tone-${dir.tone}`}>{dir.label}</span>
          <span className={`wb-badge tone-${strength.tone}`}>{strength.label}</span>
        </div>
      </div>

      <div className="wb-landing-metrics-grid">
        <div className="wb-metric-box">
          <span className="wb-metric-label">分项营收占比 (主营)</span>
          <span className="wb-metric-value">{formatPercent(landing.revenue_share)}</span>
        </div>
        <div className="wb-metric-box">
          <span className="wb-metric-label">产品销售毛利率</span>
          <span className="wb-metric-value">{formatPercent(landing.product_gross_margin)}</span>
        </div>
      </div>

      <div className="wb-landing-basis">
        <strong>暴露核验依据: </strong>
        {landing.exposure_basis}
      </div>

      {landing.conditional_note && (
        <div className="wb-landing-note">
          <strong>弹性说明: </strong>
          {landing.conditional_note}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Page 3: 产业链图谱 (`#/chains`, `#/chains/:id`, `#/nodes/:id`)
// =========================================================================

function ChainsPage({ chainId, nodeId }: { chainId?: string; nodeId?: string }) {
  const [chainList, setChainList] = useState<ChainListResponse | null>(null);
  const [loadingChains, setLoadingChains] = useState(true);
  const [errorChains, setErrorChains] = useState<string | null>(null);

  // Active Chain ID
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);

  // Chain Graph Data
  const [graphData, setGraphData] = useState<ChainGraphResponse | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [errorGraph, setErrorGraph] = useState<string | null>(null);

  // Active Node for Logic Card Drawer
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(nodeId || null);

  // Fetch chain list
  useEffect(() => {
    let active = true;
    setLoadingChains(true);
    setErrorChains(null);
    api<ChainListResponse>('/content/chains')
      .then(res => {
        if (!active) return;
        setChainList(res);
        if (res.chains.length > 0) {
          const defaultId = chainId && res.chains.some(c => c.id === chainId) ? chainId : res.chains[0].id;
          setSelectedChainId(defaultId);
        }
      })
      .catch(err => {
        if (!active) return;
        setErrorChains(err instanceof Error ? err.message : '获取产业链列表失败');
      })
      .finally(() => {
        if (active) setLoadingChains(false);
      });

    return () => {
      active = false;
    };
  }, [chainId]);

  // If URL changes nodeId, select it
  useEffect(() => {
    if (nodeId) {
      setSelectedNodeId(nodeId);
    }
  }, [nodeId]);

  // Fetch chain graph when selectedChainId changes
  useEffect(() => {
    if (!selectedChainId) return;
    let active = true;
    setLoadingGraph(true);
    setErrorGraph(null);

    api<ChainGraphResponse>(`/content/chains/${encodeURIComponent(selectedChainId)}/graph`)
      .then(res => {
        if (!active) return;
        setGraphData(res);
      })
      .catch(err => {
        if (!active) return;
        setErrorGraph(err instanceof Error ? err.message : '获取产业链拓扑有向图失败');
      })
      .finally(() => {
        if (active) setLoadingGraph(false);
      });

    return () => {
      active = false;
    };
  }, [selectedChainId]);

  return (
    <div className="wb-page-chains">
      <div className="wb-page-header">
        <div>
          <h1 className="wb-page-title">产业链图谱与要素传导</h1>
          <p className="wb-page-subtitle">
            分层有向生产要素图谱，节点定价机制、真实财报毛利率中位数与主营暴露挂载
          </p>
        </div>
      </div>

      {/* Chain Selector Tabs */}
      {loadingChains && (
        <div className="wb-loading-state">
          <p className="wb-loading-text">正在读取产业链知识库清单…</p>
        </div>
      )}

      {errorChains && (
        <div className="wb-error-state" role="alert">
          <p>{errorChains}</p>
        </div>
      )}

      {chainList && (
        <div className="wb-chain-tabs-bar">
          {chainList.chains.map(chain => {
            const isActive = chain.id === selectedChainId;
            return (
              <button
                key={chain.id}
                type="button"
                className={`wb-chain-tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setSelectedChainId(chain.id);
                  window.location.hash = `#/chains/${chain.id}`;
                }}
              >
                <span className="wb-chain-tab-name">{chain.name}</span>
                <span className="wb-chain-tab-meta">
                  {chain.node_count} 节点 · {chain.edge_count} 边 · {chain.company_count} 公司
                  {chain.recent_event_count > 0 && ` · ${chain.recent_event_count} 事件`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected Chain Summary & Graph */}
      {loadingGraph && (
        <div className="wb-loading-state">
          <p className="wb-loading-text">正在载入产业链有向要素图谱与节点财报数据…</p>
        </div>
      )}

      {errorGraph && (
        <div className="wb-error-state" role="alert">
          <p>{errorGraph}</p>
        </div>
      )}

      {graphData && !loadingGraph && (
        <>
          <div className="wb-chain-desc-box">
            <p>{graphData.chain.description}</p>
          </div>

          {/* Interactive Layered Directed Graph (Desktop SVG + Mobile Layered List) */}
          <InteractiveLayeredGraph
            nodes={graphData.nodes}
            edges={graphData.edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={node => setSelectedNodeId(node.id)}
          />
        </>
      )}

      {/* Node Logic Card Drawer / Panel */}
      {selectedNodeId && (
        <NodeLogicCardDrawer
          nodeId={selectedNodeId}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// Sub-Component: Interactive Layered Graph (Desktop + Mobile Responsive)
// -------------------------------------------------------------------------

function InteractiveLayeredGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: ChainGraphNode[];
  edges: ChainGraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (node: ChainGraphNode) => void;
}) {
  // Group nodes by layer: 0 = 上游原料/设备, 1 = 中游制造/组件, 2+ = 下游系统/终端
  const layers = useMemo(() => {
    const map: Record<number, ChainGraphNode[]> = { 0: [], 1: [], 2: [] };
    for (const node of nodes) {
      const layerKey = node.layer <= 0 ? 0 : node.layer === 1 ? 1 : 2;
      map[layerKey].push(node);
    }
    return map;
  }, [nodes]);

  const layerTitles: Record<number, string> = {
    0: '0 · 上游原料与关键设备',
    1: '1 · 中游核心制造与关键组件',
    2: '2 · 下游集成终端与运营服务',
  };

  return (
    <div className="wb-chain-graph-container">
      {/* Desktop Multi-Column Layered Flow */}
      <div className="wb-graph-flow-columns">
        {[0, 1, 2].map(layerIdx => (
          <div key={layerIdx} className="wb-graph-layer-column">
            <div className="wb-layer-col-header">
              <span className="wb-layer-badge">层级 {layerTitles[layerIdx]}</span>
              <span className="wb-layer-count">{layers[layerIdx].length} 节点</span>
            </div>

            <div className="wb-layer-node-cards">
              {layers[layerIdx].map(node => {
                const isSelected = node.id === selectedNodeId;
                const marginFormatted =
                  node.computed_median_margin !== null
                    ? formatPercent(node.computed_median_margin)
                    : '暂无披露样本';

                return (
                  <div
                    key={node.id}
                    className={`wb-graph-node-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelectNode(node)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') onSelectNode(node);
                    }}
                  >
                    <div className="wb-node-card-top">
                      <span className="wb-node-name">{node.name}</span>
                      <span className="wb-badge tone-slate">{node.node_type}</span>
                    </div>

                    <div className="wb-node-card-body">
                      <div className="wb-node-stat-row">
                        <span className="wb-stat-label">来源:</span>
                        <span className="wb-stat-val">{node.origin}</span>
                      </div>
                      <div className="wb-node-stat-row">
                        <span className="wb-stat-label">挂载公司:</span>
                        <span className="wb-stat-val"><strong>{node.verified_company_count}</strong> 家</span>
                      </div>
                      <div className="wb-node-stat-row">
                        <span className="wb-stat-label">毛利率中位:</span>
                        <span className="wb-stat-val highlight">{marginFormatted}</span>
                      </div>
                    </div>

                    <div className="wb-node-card-footer">
                      <span className="wb-node-inspect-hint">点击打开运行逻辑卡 →</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Production Elements Edge Table Summary */}
      <div className="wb-edges-summary-card">
        <h4>产业链生产要素有向关联 ({edges.length} 条要素边)</h4>
        <div className="wb-edges-tags-list">
          {edges.map(edge => (
            <span key={edge.id} className="wb-edge-pill">
              <strong>{edge.from_name}</strong>
              <span className="wb-edge-arrow">--[{edge.relation}]--&gt;</span>
              <strong>{edge.to_name}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Sub-Component: Node Logic Card Drawer
// -------------------------------------------------------------------------

function NodeLogicCardDrawer({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<NodeDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api<NodeDetailResponse>(`/content/nodes/${encodeURIComponent(nodeId)}`)
      .then(res => {
        if (!active) return;
        setDetail(res);
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : '获取节点运行逻辑卡失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [nodeId]);

  return (
    <div className="wb-drawer-backdrop" onClick={onClose}>
      <div className="wb-drawer-panel" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="wb-drawer-header">
          <div>
            <h2 className="wb-drawer-title">{detail ? detail.node.name : '节点运行逻辑卡'}</h2>
            {detail && (
              <div className="wb-drawer-meta">
                <span className="wb-badge tone-slate">类型: {detail.node.node_type}</span>
                <span className="wb-badge tone-slate">来源: {detail.node.origin}</span>
                <span className="wb-badge tone-blue">层级: Layer {detail.node.layer}</span>
              </div>
            )}
          </div>
          <button type="button" className="wb-drawer-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="wb-drawer-body">
          {loading && (
            <div className="wb-loading-state">
              <p className="wb-loading-text">正在读取节点定价机制、真实财报毛利分布与挂载个股…</p>
            </div>
          )}

          {error && (
            <div className="wb-error-state" role="alert">
              <p>{error}</p>
            </div>
          )}

          {detail && !loading && (
            <>
              {/* Upstream & Downstream Connections */}
              <div className="wb-drawer-section">
                <h3>产业链生产要素关联</h3>
                <div className="wb-node-connections-grid">
                  <div className="wb-conn-col">
                    <span className="wb-conn-title">上游供给节点 ({detail.upstream.length})</span>
                    {detail.upstream.length === 0 ? (
                      <p className="wb-text-muted">首端原料/无上游要素</p>
                    ) : (
                      detail.upstream.map(edge => (
                        <div key={edge.id} className="wb-conn-item">
                          <span>{edge.from_name}</span>
                          <span className="wb-edge-rel-tag">{edge.relation}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="wb-conn-col">
                    <span className="wb-conn-title">下游去向节点 ({detail.downstream.length})</span>
                    {detail.downstream.length === 0 ? (
                      <p className="wb-text-muted">终端消费/无下游要素</p>
                    ) : (
                      detail.downstream.map(edge => (
                        <div key={edge.id} className="wb-conn-item">
                          <span>{edge.to_name}</span>
                          <span className="wb-edge-rel-tag">{edge.relation}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Pricing Mechanism & Key Drivers */}
              <div className="wb-drawer-section">
                <h3>运行逻辑与定价机制</h3>
                <div className="wb-logic-item">
                  <span className="wb-logic-label">定价机制:</span>
                  <p>{detail.logic_card.pricing_mechanism}</p>
                </div>

                <div className="wb-logic-item">
                  <span className="wb-logic-label">核心成本要素:</span>
                  <div className="wb-chips-list">
                    {detail.logic_card.key_cost_inputs.map((cost, i) => (
                      <span key={i} className="wb-chip">{cost}</span>
                    ))}
                  </div>
                </div>

                <div className="wb-logic-item">
                  <span className="wb-logic-label">需求驱动因素:</span>
                  <div className="wb-chips-list">
                    {detail.logic_card.demand_drivers.map((d, i) => (
                      <span key={i} className="wb-chip">{d}</span>
                    ))}
                  </div>
                </div>

                <div className="wb-logic-item">
                  <span className="wb-logic-label">供给约束与瓶颈:</span>
                  <div className="wb-chips-list">
                    {detail.logic_card.supply_constraints.map((s, i) => (
                      <span key={i} className="wb-chip">{s}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Real Computed Margin Stats */}
              <div className="wb-drawer-section">
                <h3>成员公司财报实时计算毛利率分布</h3>
                <div className="wb-margin-stats-card">
                  <div className="wb-margin-stats-meta">
                    <span>有效样本公司: <strong>{detail.logic_card.computed_margin_stats.sample_count}</strong> 家</span>
                    <span>基准报告期: <strong>{detail.logic_card.computed_margin_stats.as_of_report_period || '最新披露'}</strong></span>
                  </div>

                  <div className="wb-margin-numbers-row">
                    <div className="wb-margin-number-box">
                      <span className="wb-margin-sub">最低毛利</span>
                      <span className="wb-margin-val">{formatPercent(detail.logic_card.computed_margin_stats.min_gross_margin)}</span>
                    </div>
                    <div className="wb-margin-number-box highlight">
                      <span className="wb-margin-sub">中位数毛利</span>
                      <span className="wb-margin-val">{formatPercent(detail.logic_card.computed_margin_stats.median_gross_margin)}</span>
                    </div>
                    <div className="wb-margin-number-box">
                      <span className="wb-margin-sub">最高毛利</span>
                      <span className="wb-margin-val">{formatPercent(detail.logic_card.computed_margin_stats.max_gross_margin)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tracked Observations */}
              {detail.logic_card.tracked_observations && detail.logic_card.tracked_observations.length > 0 && (
                <div className="wb-drawer-section">
                  <h3>核心高频观察指标</h3>
                  <table className="wb-table">
                    <thead>
                      <tr>
                        <th>指标名称</th>
                        <th>最新值</th>
                        <th>单位</th>
                        <th>数据日期</th>
                        <th>数据源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.logic_card.tracked_observations.map(obs => (
                        <tr key={obs.id}>
                          <td><strong>{obs.label}</strong></td>
                          <td className="wb-cell-val">{obs.value}</td>
                          <td>{obs.unit}</td>
                          <td>{obs.date}</td>
                          <td className="wb-cell-muted">{obs.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Mounted Companies List */}
              <div className="wb-drawer-section">
                <h3>挂载公司主营暴露清单 ({detail.companies.length} 家)</h3>
                <div className="wb-mounted-companies-list">
                  {detail.companies.length === 0 ? (
                    <p className="wb-text-muted">该节点暂未收录主营收入符合披露标准的挂载公司</p>
                  ) : (
                    detail.companies.map(exp => {
                      const strength = EXPOSURE_STRENGTH_MAP[exp.strength] ?? { label: exp.strength, tone: 'slate' };
                      return (
                        <div key={exp.exposure_id} className="wb-mounted-company-card">
                          <div className="wb-mounted-company-header">
                            <a href={`#/companies/${exp.company_code}`} className="wb-mounted-company-link">
                              {exp.company_name} ({exp.company_code})
                            </a>
                            <span className={`wb-badge tone-${strength.tone}`}>{strength.label}</span>
                          </div>

                          <div className="wb-mounted-company-metrics">
                            <span>匹配主营品类: <strong>{exp.matched_product_name || '未单独披露品类'}</strong></span>
                            <span>营收占比: <strong>{formatPercent(exp.revenue_share)}</strong></span>
                            <span>毛利率: <strong>{formatPercent(exp.product_gross_margin)}</strong></span>
                          </div>

                          <div className="wb-mounted-basis">
                            核验依据: {exp.basis_text} ({exp.report_period || '最新披露'})
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Recent Events transmitting to this node */}
              <div className="wb-drawer-section">
                <h3>近期传导至本节点的事件</h3>
                {detail.recent_events.length === 0 ? (
                  <p className="wb-text-muted">近期无传导至该节点的市场事件记录</p>
                ) : (
                  <div className="wb-recent-events-list">
                    {detail.recent_events.map(ev => {
                      const dir = DIRECTION_MAP[ev.direction] ?? { label: ev.direction, tone: 'slate' };
                      return (
                        <div key={ev.event_id} className="wb-recent-event-card">
                          <div className="wb-recent-event-top">
                            <a href={`#/events/${ev.event_id}`} className="wb-recent-event-title">
                              {ev.headline}
                            </a>
                            <span className={`wb-badge tone-${dir.tone}`}>{dir.label}</span>
                            <span className="wb-badge tone-blue">{ev.hop}跳传导</span>
                          </div>
                          <p className="wb-recent-event-mech">{ev.mechanism}</p>
                          <span className="wb-recent-event-time">
                            {ev.published_at !== null ? formatShanghaiTime(ev.published_at) : '发布时间未知 · 仅记录收录时间'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Page 4: 公司详情页 (`#/companies/:code`)
// =========================================================================

function CompanyProfilePage({ companyCode }: { companyCode: string }) {
  const [profile, setProfile] = useState<CompanyProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mountedCompanies, setMountedCompanies] = useState<Array<{ code: string; name: string }>>([]);

  // Search input
  const [searchInput, setSearchInput] = useState(companyCode);

  // 3 Sub-Tabs
  const [activeSubTab, setActiveSubTab] = useState<'strategies' | 'exposures' | 'fundamentals'>('strategies');

  useEffect(() => {
    let cancelled = false;
    async function fetchMountedCompanies() {
      try {
        const listRes = await api<ChainListResponse>('/content/chains');
        const graphs = await Promise.all(
          listRes.chains.map(c => api<ChainGraphResponse>(`/content/chains/${encodeURIComponent(c.id)}/graph`))
        );
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const g of graphs) {
          for (const exp of g.exposures) {
            if (!map.has(exp.company_code)) {
              map.set(exp.company_code, exp.company_name);
            }
          }
        }
        const dynamicList = Array.from(map.entries()).map(([code, name]) => ({ code, name }));
        setMountedCompanies(dynamicList);
        if (!companyCode && dynamicList.length > 0) {
          window.location.hash = `#/companies/${dynamicList[0].code}`;
        }
      } catch {
        // Non-blocking if chain list fails
      }
    }
    void fetchMountedCompanies();
    return () => {
      cancelled = true;
    };
  }, [companyCode]);

  const loadProfile = useCallback(async (code: string) => {
    const normalized = normalizeAshareCode(code);
    if (!normalized) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<CompanyProfileResponse>(`/content/companies/${encodeURIComponent(normalized)}/profile`);
      setProfile(res);
      setSearchInput(normalized);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取公司资料与策略运行结果失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (companyCode) {
      void loadProfile(companyCode);
    }
  }, [companyCode, loadProfile]);

  const handleRefreshIndicators = async () => {
    if (!profile) return;
    setRefreshing(true);
    try {
      const refreshed = await api<CompanyProfileResponse>(
        `/content/companies/${encodeURIComponent(profile.code)}/indicators/refresh`,
        'POST'
      );
      setProfile(refreshed);
    } catch (err) {
      alert(err instanceof Error ? err.message : '刷新实时财报与行情失败');
    } finally {
      setRefreshing(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeAshareCode(searchInput);
    if (!clean) return;
    window.location.hash = `#/companies/${clean}`;
  };

  return (
    <div className="wb-page-company">
      {/* Top Search & Quick Pills Bar */}
      <div className="wb-company-search-strip">
        <form onSubmit={handleSearchSubmit} className="wb-company-search-form">
          <input
            type="text"
            className="wb-input wb-search-input"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="输入6位A股代码"
          />
          <button type="submit" className="wb-btn">查询公司</button>
        </form>

        <div className="wb-quick-pills">
          <span className="wb-quick-pills-label">产业链已挂载公司:</span>
          {mountedCompanies.map(p => (
            <button
              key={p.code}
              type="button"
              className={`wb-quick-pill ${p.code === companyCode ? 'active' : ''}`}
              onClick={() => {
                window.location.hash = `#/companies/${p.code}`;
              }}
            >
              {p.name} ({p.code.split('.')[0]})
            </button>
          ))}
        </div>

        <button
          type="button"
          className="wb-btn wb-btn-subtle"
          onClick={handleRefreshIndicators}
          disabled={refreshing || loading}
        >
          {refreshing ? '正在刷新财报与行情…' : '「刷新实时财报与行情」'}
        </button>
      </div>

      {loading && (
        <div className="wb-loading-state">
          <p className="wb-loading-text">正在从 PIT 数据库装载个股 40 项指标、策略结论与主营暴露…</p>
        </div>
      )}

      {error && (
        <div className="wb-error-state" role="alert">
          <h3>公司数据读取失败</h3>
          <p>{error}</p>
          <button type="button" className="wb-btn" onClick={() => loadProfile(companyCode)}>重试</button>
        </div>
      )}

      {profile && !loading && (
        <>
          {/* Header & Market Quote Summary */}
          <div className="wb-company-header-card">
            <div className="wb-company-header-main">
              <div className="wb-company-title-row">
                <h1 className="wb-company-name">{profile.name}</h1>
                <span className="wb-company-code">{profile.code}</span>
                <span className="wb-badge tone-blue">{profile.industry_name}</span>
              </div>
              <p className="wb-company-scope">{profile.business_scope}</p>
              <div className="wb-company-dates">
                <span>最新财务报告期: <strong>{profile.latest_report_period || '暂无'}</strong></span>
                <span className="wb-meta-dot">·</span>
                <span>公告日期: <strong>{profile.latest_notice_date || '暂无'}</strong></span>
              </div>
            </div>

            {/* Market Quote Card */}
            <div className="wb-company-quote-card">
              <div className="wb-quote-grid">
                <div className="wb-quote-item">
                  <span className="wb-quote-label">最新价</span>
                  <span className="wb-quote-val">
                    {profile.quote.price !== null ? `¥${profile.quote.price.toFixed(2)}` : '-'}
                  </span>
                </div>
                <div className="wb-quote-item">
                  <span className="wb-quote-label">总市值</span>
                  <span className="wb-quote-val">
                    {profile.quote.total_mv_yi !== null ? `${profile.quote.total_mv_yi.toFixed(2)} 亿` : '-'}
                  </span>
                </div>
                <div className="wb-quote-item">
                  <span className="wb-quote-label">市盈率 (TTM)</span>
                  <span className="wb-quote-val">
                    {profile.quote.pe_ttm !== null ? `${profile.quote.pe_ttm.toFixed(1)}x` : '-'}
                  </span>
                </div>
                <div className="wb-quote-item">
                  <span className="wb-quote-label">市净率 (MRQ)</span>
                  <span className="wb-quote-val">
                    {profile.quote.pb_mrq !== null ? `${profile.quote.pb_mrq.toFixed(2)}x` : '-'}
                  </span>
                </div>
              </div>

              <div className="wb-quote-footer">
                <span>基准交易日: {profile.quote.trade_date || '未知'}</span>
                {profile.quote.is_stale && (
                  <span className="wb-quote-stale-warning">
                    ⚠️ 行情数据已超24小时，显示收盘基准时点
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 3 Sub-Tabs Navigation */}
          <div className="wb-sub-tabs-bar">
            <button
              type="button"
              className={`wb-sub-tab-btn ${activeSubTab === 'strategies' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('strategies')}
            >
              Tab 1: 策略分析 ({profile.strategies.length})
            </button>
            <button
              type="button"
              className={`wb-sub-tab-btn ${activeSubTab === 'exposures' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('exposures')}
            >
              Tab 2: 产业链暴露与近期事件 ({profile.node_exposures.length} 暴露 / {profile.recent_node_events.length} 事件)
            </button>
            <button
              type="button"
              className={`wb-sub-tab-btn ${activeSubTab === 'fundamentals' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('fundamentals')}
            >
              Tab 3: 经营基本面与主营构成 ({profile.mainbz.length} 主营项 / 40 PIT 指标)
            </button>
          </div>

          {/* Sub-Tab 1: 策略分析 */}
          {activeSubTab === 'strategies' && (
            <div className="wb-tab-panel">
              <div className="wb-strategies-results-list">
                {profile.strategies.length === 0 ? (
                  <div className="wb-empty-card">
                    <p>当前无已启用的策略运算结果</p>
                  </div>
                ) : (
                  profile.strategies.map(strat => (
                    <StrategyResultCard key={strat.strategy_id} result={strat} />
                  ))
                )}
              </div>
            </div>
          )}

          {/* Sub-Tab 2: 产业链暴露与近期事件 */}
          {activeSubTab === 'exposures' && (
            <div className="wb-tab-panel">
              {/* Node Exposures */}
              <div className="wb-tab-section">
                <h3>已挂载产业链环节与主营依据 ({profile.node_exposures.length} 个环节)</h3>
                {profile.node_exposures.length === 0 ? (
                  <p className="wb-text-muted">该个股尚未在现有产业链知识库中定位到已核实主营暴露环节</p>
                ) : (
                  <div className="wb-exposures-table-wrap">
                    <table className="wb-table">
                      <thead>
                        <tr>
                          <th>产业链节点</th>
                          <th>角色</th>
                          <th>核验依据类型</th>
                          <th>匹配主营品类</th>
                          <th>营收占比</th>
                          <th>毛利率</th>
                          <th>暴露等级</th>
                          <th>依据文本与报告期</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.node_exposures.map(exp => {
                          const strength = EXPOSURE_STRENGTH_MAP[exp.strength] ?? { label: exp.strength, tone: 'slate' };
                          return (
                            <tr key={exp.exposure_id}>
                              <td>
                                <a href={`#/nodes/${exp.node_id}`} className="wb-link-bold">
                                  {exp.node_name}
                                </a>
                              </td>
                              <td>{exp.role}</td>
                              <td><span className="wb-badge tone-slate">{exp.basis_type}</span></td>
                              <td><strong>{exp.matched_product_name || '-'}</strong></td>
                              <td className="wb-cell-val">{formatPercent(exp.revenue_share)}</td>
                              <td className="wb-cell-val">{formatPercent(exp.product_gross_margin)}</td>
                              <td><span className={`wb-badge tone-${strength.tone}`}>{strength.label}</span></td>
                              <td className="wb-cell-muted">
                                {exp.basis_text} ({exp.report_period || '最新'})
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Recent Node Events */}
              <div className="wb-tab-section">
                <h3>近期传导至关联节点的事件 ({profile.recent_node_events.length} 条)</h3>
                {profile.recent_node_events.length === 0 ? (
                  <p className="wb-text-muted">近期无传导至关联节点的市场事件</p>
                ) : (
                  <div className="wb-recent-node-events-grid">
                    {profile.recent_node_events.map(ev => {
                      const dir = DIRECTION_MAP[ev.direction] ?? { label: ev.direction, tone: 'slate' };
                      const strength = EXPOSURE_STRENGTH_MAP[ev.exposure_strength] ?? { label: ev.exposure_strength, tone: 'slate' };
                      return (
                        <div key={`${ev.event_id}-${ev.node_id}`} className="wb-recent-node-event-card">
                          <div className="wb-event-meta-row">
                            <span className="wb-badge tone-blue">{ev.node_name} ({ev.hop}跳)</span>
                            <span className={`wb-badge tone-${dir.tone}`}>{dir.label}</span>
                            <span className={`wb-badge tone-${strength.tone}`}>{strength.label}</span>
                          </div>

                          <h4>
                            <a href={`#/events/${ev.event_id}`}>{ev.headline}</a>
                          </h4>

                          <p className="wb-event-mech">{ev.mechanism}</p>

                          <div className="wb-recent-event-footer">
                            <span>主营占比: {formatPercent(ev.revenue_share)}</span>
                            <span>{ev.published_at !== null ? formatShanghaiTime(ev.published_at) : '发布时间未知 · 仅记录收录时间'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sub-Tab 3: 经营基本面与主营构成 */}
          {activeSubTab === 'fundamentals' && (
            <div className="wb-tab-panel">
              {/* Mainbz Table */}
              <div className="wb-tab-section">
                <h3>主营业务构成表 (EastMoney 财报分项拆解)</h3>
                {profile.mainbz.length === 0 ? (
                  <p className="wb-text-muted">暂无主营业务构成拆解明细</p>
                ) : (
                  <div className="wb-table-wrap">
                    <table className="wb-table">
                      <thead>
                        <tr>
                          <th>分类维度</th>
                          <th>主营项目名称</th>
                          <th>主营收入金额</th>
                          <th>主营收入占比</th>
                          <th>分项毛利率</th>
                          <th>报告期</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.mainbz.map((mbz: MainbzItem, i: number) => {
                          const typeLabel =
                            mbz.mainop_type === 'product'
                              ? '分产品'
                              : mbz.mainop_type === 'industry'
                              ? '分行业'
                              : '分地区';
                          return (
                            <tr key={i}>
                              <td><span className="wb-badge tone-slate">{typeLabel}</span></td>
                              <td><strong>{mbz.item_name}</strong></td>
                              <td className="wb-cell-val">{formatYuanInYi(mbz.revenue_yuan)}</td>
                              <td className="wb-cell-val">{formatPercent(mbz.revenue_share)}</td>
                              <td className="wb-cell-val">{formatPercent(mbz.gross_margin)}</td>
                              <td className="wb-cell-muted">{mbz.report_date}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 40 PIT Indicators Table */}
              <div className="wb-tab-section">
                <div className="wb-section-header">
                  <h3>40项 PIT 时点审计指标快照</h3>
                  <span className="wb-section-count">
                    已就绪 {profile.indicator_summary.ready} / 总计 {profile.indicator_summary.total} 项
                    (基准交易日: {profile.indicator_summary.as_of_trade_date || '最新'})
                  </span>
                </div>

                <div className="wb-table-wrap">
                  <table className="wb-table wb-indicators-table">
                    <thead>
                      <tr>
                        <th>指标名称</th>
                        <th>类别</th>
                        <th>最新取值</th>
                        <th>同比变动</th>
                        <th>全市场分位</th>
                        <th>行业内分位</th>
                        <th>报告期</th>
                        <th>公告日期</th>
                        <th>可用交易日</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.indicators.map((ind: IndicatorSnapshotValue) => {
                        const catLabel = INDICATOR_CATEGORY_MAP[ind.category] || ind.category;
                        const statusTone =
                          ind.status === 'ready'
                            ? 'green'
                            : ind.status === 'stale'
                            ? 'amber'
                            : 'slate';

                        return (
                          <tr key={ind.key}>
                            <td>
                              <strong>{ind.name}</strong>
                              <span className="wb-cell-code-sub">{ind.key}</span>
                            </td>
                            <td><span className="wb-badge tone-slate">{catLabel}</span></td>
                            <td className="wb-cell-val bold">
                              {ind.formatted_value} {ind.unit}
                            </td>
                            <td className="wb-cell-val">
                              {ind.yoy_delta !== null ? (
                                <span className={ind.yoy_delta >= 0 ? 'text-green' : 'text-rose'}>
                                  {ind.yoy_delta >= 0 ? `+${ind.yoy_delta.toFixed(2)}` : ind.yoy_delta.toFixed(2)}
                                </span>
                              ) : '-'}
                            </td>
                            <td>
                              {ind.rank_market_pct !== null ? (
                                <div className="wb-rank-cell">
                                  <div className="wb-rank-bar-bg">
                                    <div
                                      className="wb-rank-bar-fill"
                                      style={{ width: `${Math.round(ind.rank_market_pct * 100)}%` }}
                                    />
                                  </div>
                                  <span>{(ind.rank_market_pct * 100).toFixed(0)}%</span>
                                </div>
                              ) : '-'}
                            </td>
                            <td>
                              {ind.rank_industry_pct !== null ? (
                                <div className="wb-rank-cell">
                                  <div className="wb-rank-bar-bg">
                                    <div
                                      className="wb-rank-bar-fill highlight"
                                      style={{ width: `${Math.round(ind.rank_industry_pct * 100)}%` }}
                                    />
                                  </div>
                                  <span>{(ind.rank_industry_pct * 100).toFixed(0)}%</span>
                                </div>
                              ) : '-'}
                            </td>
                            <td className="wb-cell-muted">{ind.report_period || '-'}</td>
                            <td className="wb-cell-muted">{ind.announcement_datetime ? formatShanghaiTime(ind.announcement_datetime).split(' ')[0] : '-'}</td>
                            <td className="wb-cell-muted">{ind.usable_trade_date || '-'}</td>
                            <td>
                              <span className={`wb-badge tone-${statusTone}`}>
                                {ind.status === 'ready' ? '就绪' : ind.status === 'stale' ? '陈旧' : ind.status === 'not_applicable' ? '不适用' : '缺失'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StrategyResultCard({ result }: { result: StrategyRunResult }) {
  const tier = TIER_MAP[result.tier] ?? { label: result.tier_label, tone: 'slate' };

  return (
    <div className={`wb-strategy-result-card tone-${tier.tone}`}>
      <div className="wb-strat-res-header">
        <div className="wb-strat-res-title-group">
          <h3 className="wb-strat-res-name">{result.strategy_name}</h3>
          <span className="wb-badge tone-slate">
            {result.kind === 'code' ? '内置代码策略' : '自定义 DSL 策略'} (v{result.strategy_version})
          </span>
          <span className="wb-badge tone-blue">{result.category}</span>
        </div>

        <div className="wb-strat-res-tier-group">
          <span className={`wb-badge tone-${tier.tone}`}>{result.tier_label}</span>
          {result.score !== null && (
            <span className="wb-strat-score">得分: <strong>{result.score.toFixed(1)}</strong></span>
          )}
        </div>
      </div>

      <div className="wb-strat-conclusion-box">
        <strong>评估结论: </strong>
        <span>{result.conclusion}</span>
      </div>

      <div className="wb-strat-reasons-risks-grid">
        <div className="wb-strat-list-col">
          <span className="wb-strat-list-heading">满足依据与逻辑理由 (3~5项):</span>
          <ul>
            {result.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>

        <div className="wb-strat-list-col">
          <span className="wb-strat-list-heading">潜在风险与边际变化:</span>
          <ul>
            {result.risks.map((risk, i) => (
              <li key={i}>{risk}</li>
            ))}
          </ul>
        </div>
      </div>

      {result.missing_indicators && result.missing_indicators.length > 0 && (
        <div className="wb-strat-missing-box">
          <strong>缺失指标项: </strong>
          <span>{result.missing_indicators.join(', ')}</span>
        </div>
      )}

      {/* Condition Traces Table */}
      <div className="wb-condition-traces-section">
        <h4>四层时点审计条件求值轨迹 (Condition Traces)</h4>
        <div className="wb-traces-table-wrap">
          <table className="wb-table wb-traces-table">
            <thead>
              <tr>
                <th>条件标签</th>
                <th>指标键</th>
                <th>运算口径</th>
                <th>实际取值</th>
                <th>比较符</th>
                <th>阈值</th>
                <th>判定结果</th>
                <th>求值说明</th>
              </tr>
            </thead>
            <tbody>
              {result.condition_traces.map((trace: StrategyConditionTrace) => {
                const passedStatus =
                  trace.passed === true
                    ? { label: '符合', tone: 'green' }
                    : trace.passed === false
                    ? { label: trace.is_redflag_veto ? '触发红旗否决' : '未达标', tone: 'rose' }
                    : { label: '缺失', tone: 'slate' };

                return (
                  <tr key={trace.condition_id}>
                    <td><strong>{trace.label}</strong></td>
                    <td className="wb-cell-code">{trace.indicator_key}</td>
                    <td><span className="wb-badge tone-slate">{trace.operand_kind}</span></td>
                    <td className="wb-cell-val bold">{trace.actual_formatted}</td>
                    <td className="wb-cell-code">{trace.operator}</td>
                    <td className="wb-cell-val">{trace.threshold}</td>
                    <td>
                      <span className={`wb-badge tone-${passedStatus.tone}`}>{passedStatus.label}</span>
                    </td>
                    <td className="wb-cell-muted">{trace.explanation}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="wb-strat-footer">
        <span>数据时点截止: <strong>{result.data_cutoff || '最新'}</strong></span>
        <span>评估时点: {formatShanghaiTime(result.evaluated_at)}</span>
        <span className="wb-cell-code-sub">输入哈希: {result.inputs_hash.slice(0, 16)}...</span>
      </div>
    </div>
  );
}

// =========================================================================
// Page 5: 策略管理页 (`#/strategies`)
// =========================================================================

function StrategiesPage() {
  const [strategyList, setStrategyList] = useState<StrategyListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Available indicators for strategy builder
  const [indicatorRegistry, setIndicatorRegistry] = useState<IndicatorRegistryResponse | null>(null);

  // Strategy Builder Drawer State
  const [showBuilder, setShowBuilder] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);

  // Builder Form Fields
  const [builderId, setBuilderId] = useState('');
  const [builderName, setBuilderName] = useState('');
  const [builderCategory, setBuilderCategory] = useState<'value' | 'quality' | 'redflag' | 'dividend' | 'lowvol' | 'event_exposure' | 'custom'>('custom');
  const [builderDesc, setBuilderDesc] = useState('');
  const [builderBasis, setBuilderBasis] = useState('自定义多因子规则');
  const [builderCombinator, setBuilderCombinator] = useState<'all' | 'any'>('all');
  const [builderMissingPolicy, setBuilderMissingPolicy] = useState<'insufficient' | 'skip_condition'>('insufficient');
  const [builderConditions, setBuilderConditions] = useState<StrategyDslLeafCondition[]>([
    {
      id: 'c1',
      label: 'E/P 收益率高于行业均值',
      operand: { kind: 'rank_industry', key: 'ep_ttm' },
      operator: 'gte',
      threshold: 0.6,
      negate: false,
      is_redflag_veto: false,
    },
  ]);

  const loadStrategies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<StrategyListResponse>('/content/strategies');
      setStrategyList(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取策略列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIndicators = useCallback(async () => {
    try {
      const res = await api<IndicatorRegistryResponse>('/content/indicators/registry');
      setIndicatorRegistry(res);
    } catch {
      // Handled gracefully
    }
  }, []);

  useEffect(() => {
    void loadStrategies();
    void loadIndicators();
  }, [loadStrategies, loadIndicators]);

  const handleToggleStrategy = async (strategy: StrategyManifest) => {
    try {
      await api<StrategyManifest>(
        `/content/strategies/${encodeURIComponent(strategy.id)}/toggle`,
        'PUT',
        { enabled: !strategy.enabled }
      );
      void loadStrategies();
    } catch (err) {
      alert(err instanceof Error ? err.message : '切换策略启用状态失败');
    }
  };

  const handleDeleteStrategy = async (strategyId: string) => {
    if (!confirm(`确认删除自定义策略 ${strategyId}？该操作不可逆。`)) return;
    try {
      await api<{ success: boolean }>(
        `/content/strategies/${encodeURIComponent(strategyId)}/delete`,
        'POST'
      );
      void loadStrategies();
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除策略失败');
    }
  };

  const handleAddCondition = () => {
    const nextIdx = builderConditions.length + 1;
    const defaultKey = indicatorRegistry?.items[0]?.key || 'ep_ttm';
    setBuilderConditions(prev => [
      ...prev,
      {
        id: `c${Date.now()}_${nextIdx}`,
        label: `条件 ${nextIdx}`,
        operand: { kind: 'ind', key: defaultKey },
        operator: 'gt',
        threshold: 0,
        negate: false,
        is_redflag_veto: false,
      },
    ]);
  };

  const handleRemoveCondition = (idx: number) => {
    if (builderConditions.length <= 1) {
      alert('至少需要保留 1 个条件');
      return;
    }
    setBuilderConditions(prev => prev.filter((_, i) => i !== idx));
  };

  const handleConditionChange = (idx: number, updates: Partial<StrategyDslLeafCondition>) => {
    setBuilderConditions(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...updates };
      return copy;
    });
  };

  const handleCreateStrategySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setBuilderError(null);

    const payload: CreateStrategyRequest = {
      id: builderId.trim().toLowerCase(),
      name: builderName.trim(),
      category: builderCategory,
      description: builderDesc.trim(),
      academic_basis: builderBasis.trim(),
      dsl: {
        combinator: builderCombinator,
        missing_policy: builderMissingPolicy,
        conditions: builderConditions,
      },
    };

    // Validate using authoritative Zod schema
    const parseResult = CreateStrategyRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      setSubmitting(false);
      setBuilderError(parseResult.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join('; '));
      return;
    }

    try {
      await api<StrategyManifest>('/content/strategies', 'POST', payload);
      setShowBuilder(false);
      // Reset form
      setBuilderId('');
      setBuilderName('');
      setBuilderDesc('');
      void loadStrategies();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : '创建策略失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="wb-page-strategies">
      <div className="wb-page-header">
        <div>
          <h1 className="wb-page-title">策略管理与自定义多因子 DSL</h1>
          <p className="wb-page-subtitle">
            查看与管理系统内置学术策略、启停开关，基于 40 项 PIT 指标编排自定义多因子逻辑
          </p>
        </div>
        <button
          type="button"
          className="wb-btn wb-btn-primary"
          onClick={() => setShowBuilder(true)}
        >
          + 追加自定义 DSL 策略
        </button>
      </div>

      {loading && (
        <div className="wb-loading-state">
          <p className="wb-loading-text">正在读取策略注册清单…</p>
        </div>
      )}

      {error && (
        <div className="wb-error-state" role="alert">
          <p>{error}</p>
          <button type="button" className="wb-btn" onClick={loadStrategies}>重试</button>
        </div>
      )}

      {strategyList && !loading && (
        <div className="wb-strategies-grid">
          {strategyList.strategies.map(strat => (
            <div key={strat.id} className="wb-strategy-manifest-card">
              <div className="wb-strat-manifest-top">
                <div>
                  <h3 className="wb-strat-manifest-name">{strat.name}</h3>
                  <div className="wb-strat-manifest-meta">
                    <span className="wb-cell-code">{strat.id}</span>
                    <span className="wb-badge tone-blue">{strat.category}</span>
                    <span className="wb-badge tone-slate">
                      {strat.is_builtin ? '核心内置' : '用户自定义 DSL'} (v{strat.version})
                    </span>
                  </div>
                </div>

                <div className="wb-strat-toggle-group">
                  <label className="wb-switch-label">
                    <input
                      type="checkbox"
                      checked={strat.enabled}
                      onChange={() => handleToggleStrategy(strat)}
                    />
                    <span className="wb-switch-text">{strat.enabled ? '已启用' : '已停用'}</span>
                  </label>
                </div>
              </div>

              <div className="wb-strat-manifest-basis">
                <strong>学术/逻辑依据: </strong>
                <span>{strat.academic_basis}</span>
              </div>

              <p className="wb-strat-manifest-desc">{strat.description}</p>

              <div className="wb-strat-req-indicators">
                <span className="wb-req-label">所需指标 ({strat.required_indicators.length}):</span>
                <div className="wb-chips-list">
                  {strat.required_indicators.map(k => (
                    <span key={k} className="wb-chip">{k}</span>
                  ))}
                </div>
              </div>

              {/* If DSL Strategy, show rules preview */}
              {strat.dsl && (
                <div className="wb-dsl-rules-preview">
                  <div className="wb-dsl-preview-title">
                    <span>组合逻辑: <strong>{strat.dsl.combinator === 'all' ? '全部满足 (AND)' : '任一满足 (OR)'}</strong></span>
                    <span className="wb-meta-dot">·</span>
                    <span>缺失策略: <strong>{strat.dsl.missing_policy}</strong></span>
                  </div>
                  <ul className="wb-dsl-conditions-list">
                    {strat.dsl.conditions.map(c => (
                      <li key={c.id}>
                        <span>{c.label}: </span>
                        <code>{c.operand.kind}({c.operand.key}) {c.operator} {c.threshold}</code>
                        {c.is_redflag_veto && <span className="wb-badge tone-rose">红旗一票否决</span>}
                        {c.negate && <span className="wb-badge tone-amber">取反</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="wb-strat-manifest-footer">
                <span>更新时间: {formatShanghaiTime(strat.updated_at)}</span>
                {!strat.is_builtin && (
                  <button
                    type="button"
                    className="wb-btn-danger wb-btn-xs"
                    onClick={() => handleDeleteStrategy(strat.id)}
                  >
                    删除策略
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Strategy Builder Drawer / Modal */}
      {showBuilder && (
        <div className="wb-drawer-backdrop" onClick={() => setShowBuilder(false)}>
          <div className="wb-drawer-panel wb-builder-drawer" onClick={e => e.stopPropagation()} role="dialog">
            <div className="wb-drawer-header">
              <h2 className="wb-drawer-title">追加自定义 DSL 策略</h2>
              <button type="button" className="wb-drawer-close-btn" onClick={() => setShowBuilder(false)}>×</button>
            </div>

            <form onSubmit={handleCreateStrategySubmit} className="wb-builder-form">
              {builderError && (
                <div className="wb-notice danger" role="alert">
                  <p>{builderError}</p>
                </div>
              )}

              <div className="wb-form-row">
                <div className="wb-form-field">
                  <label htmlFor="b-id">策略标识符 (ID):</label>
                  <input
                    id="b-id"
                    type="text"
                    required
                    pattern="^[a-z0-9_]+$"
                    placeholder="如: my_dividend_quality"
                    value={builderId}
                    onChange={e => setBuilderId(e.target.value)}
                  />
                  <span className="wb-field-tip">仅限小写英文、数字和下划线，2~64 位</span>
                </div>

                <div className="wb-form-field">
                  <label htmlFor="b-name">策略名称:</label>
                  <input
                    id="b-name"
                    type="text"
                    required
                    placeholder="如: 高股息兼现金流红旗排雷"
                    value={builderName}
                    onChange={e => setBuilderName(e.target.value)}
                  />
                </div>
              </div>

              <div className="wb-form-row">
                <div className="wb-form-field">
                  <label htmlFor="b-cat">策略分类:</label>
                  <select
                    id="b-cat"
                    value={builderCategory}
                    onChange={e => setBuilderCategory(e.target.value as any)}
                  >
                    <option value="custom">自定义组合 (custom)</option>
                    <option value="value">价值策略 (value)</option>
                    <option value="quality">质量策略 (quality)</option>
                    <option value="redflag">红旗排雷 (redflag)</option>
                    <option value="dividend">分红回报 (dividend)</option>
                    <option value="lowvol">低波防御 (lowvol)</option>
                    <option value="event_exposure">产业链事件暴露 (event_exposure)</option>
                  </select>
                </div>

                <div className="wb-form-field">
                  <label htmlFor="b-basis">学术 / 逻辑依据:</label>
                  <input
                    id="b-basis"
                    type="text"
                    required
                    placeholder="如: Fama-French 价值因子与应计盈余质量"
                    value={builderBasis}
                    onChange={e => setBuilderBasis(e.target.value)}
                  />
                </div>
              </div>

              <div className="wb-form-field">
                <label htmlFor="b-desc">策略阐述与投资假说:</label>
                <textarea
                  id="b-desc"
                  required
                  rows={3}
                  placeholder="详细阐述该策略在不同宏观周期下的选股逻辑与失效风险边界..."
                  value={builderDesc}
                  onChange={e => setBuilderDesc(e.target.value)}
                />
              </div>

              <div className="wb-form-row">
                <div className="wb-form-field">
                  <label htmlFor="b-comb">组合方式 (Combinator):</label>
                  <select
                    id="b-comb"
                    value={builderCombinator}
                    onChange={e => setBuilderCombinator(e.target.value as any)}
                  >
                    <option value="all">满足全部条件 (ALL / AND)</option>
                    <option value="any">满足任一条件 (ANY / OR)</option>
                  </select>
                </div>

                <div className="wb-form-field">
                  <label htmlFor="b-miss">缺失数据策略:</label>
                  <select
                    id="b-miss"
                    value={builderMissingPolicy}
                    onChange={e => setBuilderMissingPolicy(e.target.value as any)}
                  >
                    <option value="insufficient">缺数据记为不足 (insufficient)</option>
                    <option value="skip_condition">缺数据跳过单项 (skip_condition)</option>
                  </select>
                </div>
              </div>

              {/* Conditions List */}
              <div className="wb-builder-conditions-section">
                <div className="wb-builder-cond-header">
                  <h4>条件编排列表 ({builderConditions.length} 项)</h4>
                  <button type="button" className="wb-btn wb-btn-xs" onClick={handleAddCondition}>
                    + 增加条件
                  </button>
                </div>

                {builderConditions.map((cond, idx) => (
                  <div key={cond.id} className="wb-builder-cond-card">
                    <div className="wb-cond-card-top">
                      <span className="wb-cond-idx">条件 #{idx + 1}</span>
                      <button
                        type="button"
                        className="wb-btn-danger wb-btn-xs"
                        onClick={() => handleRemoveCondition(idx)}
                      >
                        删除
                      </button>
                    </div>

                    <div className="wb-form-field">
                      <label>条件标签:</label>
                      <input
                        type="text"
                        required
                        value={cond.label}
                        onChange={e => handleConditionChange(idx, { label: e.target.value })}
                        placeholder="如: 股息率全行业前 30%"
                      />
                    </div>

                    <div className="wb-form-row">
                      <div className="wb-form-field">
                        <label>选择指标:</label>
                        <select
                          value={cond.operand.key}
                          onChange={e =>
                            handleConditionChange(idx, {
                              operand: { ...cond.operand, key: e.target.value },
                            })
                          }
                        >
                          {indicatorRegistry?.items.map(ind => (
                            <option key={ind.key} value={ind.key}>
                              {ind.name} ({ind.key})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="wb-form-field">
                        <label>运算口径 (Operand):</label>
                        <select
                          value={cond.operand.kind}
                          onChange={e =>
                            handleConditionChange(idx, {
                              operand: { ...cond.operand, kind: e.target.value as any },
                            })
                          }
                        >
                          <option value="ind">原始指标数值 (ind)</option>
                          <option value="rank_industry">行业内分位数 (0~1)</option>
                          <option value="rank_market">全市场分位数 (0~1)</option>
                          <option value="delta_yoy">同比变动值 (delta_yoy)</option>
                        </select>
                      </div>
                    </div>

                    <div className="wb-form-row">
                      <div className="wb-form-field">
                        <label>比较符:</label>
                        <select
                          value={cond.operator}
                          onChange={e =>
                            handleConditionChange(idx, { operator: e.target.value as any })
                          }
                        >
                          <option value="gt">&gt; 大于</option>
                          <option value="gte">&gt;= 大于等于</option>
                          <option value="lt">&lt; 小于</option>
                          <option value="lte">&lt;= 小于等于</option>
                          <option value="eq">== 等于</option>
                        </select>
                      </div>

                      <div className="wb-form-field">
                        <label>比较阈值:</label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={cond.threshold}
                          onChange={e =>
                            handleConditionChange(idx, { threshold: parseFloat(e.target.value) || 0 })
                          }
                        />
                      </div>
                    </div>

                    <div className="wb-form-checkboxes">
                      <label className="wb-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(cond.is_redflag_veto)}
                          onChange={e =>
                            handleConditionChange(idx, { is_redflag_veto: e.target.checked })
                          }
                        />
                        <span>红旗一票否决 (若未达标则策略直接判定警示)</span>
                      </label>

                      <label className="wb-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(cond.negate)}
                          onChange={e => handleConditionChange(idx, { negate: e.target.checked })}
                        />
                        <span>取反 (NOT)</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div className="wb-builder-actions">
                <button type="button" className="wb-btn" onClick={() => setShowBuilder(false)}>
                  取消
                </button>
                <button type="submit" className="wb-btn wb-btn-primary" disabled={submitting}>
                  {submitting ? '正在验证并注册…' : '保存并注册策略'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Page 5b: 指标字典 (`#/indicators`)
// =========================================================================

function IndicatorsPage() {
  const [registry, setRegistry] = useState<IndicatorRegistryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<IndicatorRegistryResponse>('/content/indicators/registry');
      setRegistry(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取指标字典失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  const filteredItems = useMemo(() => {
    if (!registry?.items) return [];
    return registry.items.filter(item => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hit =
          item.name.toLowerCase().includes(q) ||
          item.key.toLowerCase().includes(q) ||
          item.formula.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [registry, categoryFilter, searchQuery]);

  return (
    <div className="wb-page-indicators">
      <div className="wb-page-header">
        <div>
          <h1 className="wb-page-title">40项 PIT 时点审计指标字典</h1>
          <p className="wb-page-subtitle">
            后端统一注册表权威定义，严格遵循公告时点防未来函数规范，全策略唯一真实来源
          </p>
        </div>
        {registry && (
          <span className="wb-header-badge-count">
            权威收录共 <strong>{registry.total}</strong> 项指标
          </span>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="wb-filter-bar">
        <div className="wb-filter-group">
          <input
            type="text"
            className="wb-input wb-search-input"
            placeholder="搜索指标名称、Key 或计算公式..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="wb-filter-group">
          <span className="wb-filter-label">指标类别:</span>
          <button
            type="button"
            className={`wb-filter-chip ${categoryFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            全部类别
          </button>
          {Object.entries(INDICATOR_CATEGORY_MAP).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`wb-filter-chip ${categoryFilter === key ? 'active' : ''}`}
              onClick={() => setCategoryFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="wb-loading-state">
          <p className="wb-loading-text">正在从权威注册表加载 40 项金融指标元数据…</p>
        </div>
      )}

      {error && (
        <div className="wb-error-state" role="alert">
          <p>{error}</p>
          <button type="button" className="wb-btn" onClick={loadRegistry}>重试</button>
        </div>
      )}

      {registry && !loading && (
        <div className="wb-indicators-dict-table-wrap">
          <table className="wb-table wb-dict-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>指标名称 & Key</th>
                <th>类别</th>
                <th>单位</th>
                <th>计算公式</th>
                <th>原始输入项</th>
                <th>更新频率</th>
                <th>PIT 审计时点规则</th>
                <th>方向性</th>
                <th>使用策略</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="wb-cell-muted">未找到匹配的指标</td>
                </tr>
              ) : (
                filteredItems.map((item: IndicatorRegistryItem, idx: number) => {
                  const catLabel = INDICATOR_CATEGORY_MAP[item.category] || item.category;
                  return (
                    <tr key={item.key}>
                      <td className="wb-cell-muted">{idx + 1}</td>
                      <td>
                        <strong>{item.name}</strong>
                        <span className="wb-cell-code-sub">{item.key}</span>
                      </td>
                      <td><span className="wb-badge tone-blue">{catLabel}</span></td>
                      <td className="wb-cell-val">{item.unit}</td>
                      <td className="wb-cell-formula">{item.formula}</td>
                      <td>
                        <div className="wb-raw-inputs-tags">
                          {item.raw_inputs.map(raw => (
                            <span key={raw} className="wb-raw-tag">{raw}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className="wb-badge tone-slate">
                          {item.frequency === 'daily' ? '每日' : item.frequency === 'quarterly' ? '季报' : '事件'}
                        </span>
                      </td>
                      <td className="wb-cell-pit">{item.pit_rule}</td>
                      <td>
                        {item.higher_is_better === true ? (
                          <span className="wb-badge tone-green">越高越好</span>
                        ) : item.higher_is_better === false ? (
                          <span className="wb-badge tone-rose">越低越好</span>
                        ) : (
                          <span className="wb-badge tone-slate">中性/状态</span>
                        )}
                      </td>
                      <td>
                        <div className="wb-strategies-tags">
                          {item.used_by_strategies.map(s => (
                            <span key={s} className="wb-strat-tag">{s}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
