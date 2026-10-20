import { useEffect } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { query, dateTime } from './api';
import { safeNewsReturn } from './PanoramaEntry';
import { useApi } from './hooks';
import { Empty, ErrorBox, Loading, MetaLine, PageHeader, SearchForm, SyncButton } from './components';
import type { Coverage, Security } from './types';

const exchanges: Record<string, string> = { SH: '上交所', SZ: '深交所', BJ: '北交所' };
function CompanyEntry({ symbol }: { symbol: string }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('symbol', symbol);
  if (!params.has('return')) params.set('return', '/securities');
  const href = `/industry/index.html?${params}`;
  useEffect(() => { window.location.replace(href); }, [href]);
  return <p><a href={href}>进入个股详情 →</a></p>;
}
type CompanyPositions = { symbol: string; roles: { industry_name: string; node_name: string; role: string; kind: string; summary?: string }[] };
function Directory() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') || '';
  const exchange = ['SH', 'SZ', 'BJ'].includes(params.get('exchange') || '') ? params.get('exchange')! : '';
  const rawOffset = Number(params.get('offset') || 0);
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const limit = 24;
  const result = useApi<Security[]>(`/securities${query({ q: search, exchange, limit, offset })}`);
  const symbols = result.data?.map(s => s.symbol).join(',');
  const positions = useApi<{ items: CompanyPositions[] }>(symbols ? `/securities/positions?${new URLSearchParams({ symbols })}` : null);
  const coverage = useApi<Coverage>('/coverage');
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'offset') next.delete('offset');
    setParams(next);
  }
  const backParams = new URLSearchParams(params);
  if (offset) backParams.set('offset', String(offset)); else backParams.delete('offset');
  const back = `/securities${backParams.size ? `?${backParams}` : ''}`;
  useEffect(() => { window.scrollTo(0, 0); }, [offset]);
  return <section className="directory" aria-label="个股目录">
    <PageHeader title="个股" description="查找公司，了解业务与产业位置。" />
    {params.get('return') && <a className="directory-return" href={safeNewsReturn(params.get('return'))}>← 返回阅读流程</a>}
    <div className="directory-tools"><h2 className="search-heading">查找个股</h2><SearchForm key={search} initial={search} label="搜索个股" placeholder="公司名称 / 6 位证券代码" onSearch={value => filter('q', value)} />
      <div className="filter-row"><label htmlFor="exchange-filter">交易所</label><select id="exchange-filter" value={exchange} onChange={event => filter('exchange', event.target.value)}><option value="">全部</option>{Object.entries(exchanges).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>{(search || exchange) && <button type="button" className="text-button" onClick={() => { const next = new URLSearchParams(params); ['q', 'exchange', 'offset'].forEach(key => next.delete(key)); setParams(next); }}>清除筛选</button>}</div>
      <p className="muted">{result.loading ? '正在查找…' : `第 ${Math.floor(offset / limit) + 1} 页 · 本页 ${result.data?.length ?? '—'} 家`}</p>
    </div>
    <ErrorBox message={result.error} retry={result.reload} />{result.loading && <Loading label="正在读取证券目录…" />}
    {!result.loading && result.data?.length === 0 && <Empty title={search || exchange ? '未找到匹配证券' : '当前页暂无证券'}><p>可更换名称、代码或交易所条件。未获取到资料不等于退市。</p>{offset > 0 && <button type="button" onClick={() => filter('offset', '0')}>回到第一页</button>}</Empty>}
    <ul className="security-directory security-card-grid">{result.data?.map(security => {
      const roles = positions.data?.items.find(item => item.symbol === security.symbol)?.roles || [];
      const summary = roles.find(role => role.summary)?.summary;
      return <li key={security.symbol}><Link className="security-entry security-card" to={`/securities/${encodeURIComponent(security.symbol)}?${new URLSearchParams({ return: back })}`}><div><h2>{security.name}</h2><span className="identifier">{security.code} · {exchanges[security.exchange] || security.exchange}</span></div>
        {security.industry && <p className="security-sector">{security.industry}</p>}
        {summary && <p className="security-business">{summary}</p>}
        {roles.length > 0 && <div className="security-roles">{roles.slice(0, 2).map((role, index) => <p key={index}><strong>{role.industry_name}{role.node_name !== role.industry_name ? ` / ${role.node_name}` : ''}</strong><span>{role.kind === 'ai' ? 'AI 解释 · ' : ''}{role.role}</span></p>)}</div>}
        <span className="security-open">查看公司 →</span></Link></li>;
    })}</ul>
    <div className="research-actions"><button type="button" disabled={!offset || result.loading} onClick={() => filter('offset', String(Math.max(0, offset - limit)))}>上一页</button><button type="button" disabled={result.loading || (result.data?.length ?? 0) < limit} onClick={() => filter('offset', String(offset + limit))}>更多个股 →</button></div>
    <details className="coverage-block"><summary>证券覆盖、来源与更新</summary><ErrorBox message={coverage.error} retry={coverage.reload} />{coverage.loading && <Loading />}{coverage.data && <><dl className="coverage-counts">{Object.entries(exchanges).map(([id, name]) => <div key={id}><dt>{name}</dt><dd>{coverage.data!.counts[id as 'SH' | 'SZ' | 'BJ']} 家</dd></div>)}</dl><p className="muted">{coverage.data.source} · {dateTime(coverage.data.as_of)}</p>{coverage.data.warnings.map((warning, index) => <p key={index} className="muted">{warning}</p>)}</>}{positions.error && <p className="muted">产业位置暂不可用；公司资料仍可阅读。</p>}<MetaLine meta={result.meta} /><SyncButton kind="securities" onDone={() => { coverage.reload(); result.reload(); }}>更新证券目录</SyncButton></details>
  </section>;
}
export default function SecuritiesPage() { const { symbol } = useParams(); return symbol ? <CompanyEntry symbol={symbol} /> : <Directory />; }
