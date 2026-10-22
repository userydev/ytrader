import { coreApi } from '../shared/core.js?v=ai-api-v1';
import { supportedSymbol } from './fundamentals.js';

// A security without a panorama mapping has an independent context, never the
// first industry or a similarly named company. Each response confirms symbol.
export async function loadCompany(symbol) {
  if (!supportedSymbol(symbol)) throw new Error('证券代码无效，请从个股目录重新选择。');
  const paths = [`/securities/${encodeURIComponent(symbol)}`, `/securities/${encodeURIComponent(symbol)}/profile`];
  const results = await Promise.allSettled(paths.map(path => coreApi(path)));
  const warnings = [];
  let security = null, profile = null, events = [];
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === 'rejected') { warnings.push(`${index ? '公司资料' : '证券与新闻'}：${result.reason.message}`); continue; }
    const envelope = result.value, raw = envelope.data;
    const identity = index ? raw?.symbol : raw?.security?.symbol;
    if (identity !== symbol) { warnings.push('公司响应身份不一致，已拒收。'); continue; }
    warnings.push(...(envelope.meta.warnings || []));
    if (index) profile = raw;
    else { security = raw.security; events = Array.isArray(raw.events) ? raw.events : []; }
  }
  return { symbol, security, profile, events, warnings };
}

export async function loadCompanyMapping(symbol) {
  const envelope = await coreApi(`/securities/positions?${new URLSearchParams({ symbols: symbol })}`);
  const item = envelope.data?.items?.find(item => item.symbol === symbol);
  if (!item || !Array.isArray(item.roles)) throw new Error('产业位置身份或格式不符。');
  const roles = item.roles.map(role => ({ industryId: role.industry_id, industryName: role.industry_name,
    nodeId: role.node_id, nodeName: role.node_name, role: role.role, kind: role.kind,
    origin: role.origin, resultId: role.result_id, offset: role.offset || 0, asOf: role.as_of,
    sources: role.sources || [], sourceRecord: role.source_record,
    source: role.source_kind }));
  return { symbol, roles, warnings: item.warnings || [], status: 'ready' };
}
