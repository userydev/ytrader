// Adapted from ai-stock-pool/mobile_briefing.py, Copyright (c) 2026 Yaolei.
// MIT; see LICENSE and NOTICE in this directory. No upstream research data included.
import type { Briefing, Company, News } from '../../src/content-types.js';
const ticker = /^\d{6}\.(SZ|SH|BJ)$/;
export function parseReferenceIds(value?: string): Set<string> {
  const symbols = new Set<string>();
  for (const raw of (value ?? '').split(',')) {
    const reference = raw.trim();
    if (!reference.startsWith('ticker:')) continue;
    const symbol = reference.slice(7).trim().toUpperCase();
    if (ticker.test(symbol)) symbols.add(symbol);
  }
  return symbols;
}
export function normalizeTickers(value?: string): string[] {
  return [...new Set((value ?? '').split(';').map(x => x.trim().toUpperCase()).filter(x => ticker.test(x)))];
}
const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export function buildBriefing(news: News[], companies: Company[], references: Set<string> = new Set(), limit = 6, generatedAt = new Date()): Briefing {
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 20)) : 6;
  const names = new Map(companies.map(c => [c.code, c.name || c.code]));
  const selected = news.filter(n => n.id && n.title && (!references.size || n.company_codes.some(c => references.has(c))))
    .sort((a, b) => (time(b.published_at) ?? -Infinity) - (time(a.published_at) ?? -Infinity) || a.id.localeCompare(b.id)).slice(0, boundedLimit);
  const timestamps = selected.map(n => time(n.published_at)).filter((n): n is number => n !== null && n <= generatedAt.getTime());
  const latest = timestamps.length ? Math.max(...timestamps) : null;
  const staleAfterSeconds = 900;
  const state = !selected.length ? 'unavailable' : latest === null ? 'unknown' : generatedAt.getTime() - latest > staleAfterSeconds * 1000 ? 'stale' : 'fresh';
  return {
    schemaVersion: '1.0', generatedAt: generatedAt.toISOString(),
    dataFreshness: { state, sourceUpdatedAt: latest === null ? null : new Date(latest).toISOString(), staleAfterSeconds },
    data: { matchMode: references.size ? 'reference_tickers' : 'latest_public_signals', requestedReferences: [...references].sort().map(t => `ticker:${t}`),
      items: selected.map(row => ({
        id: row.id, kind: 'discovery_signal', title: row.title, summary: row.summary,
        occurredAt: row.published_at, relevance: 'possible',
        referenceObjects: row.company_codes.filter(t => !references.size || references.has(t)).slice(0, 12).map(t => ({ id: `ticker:${t}`, type: 'ticker', displayName: names.get(t) ?? t })),
        source: { title: row.source, url: row.url || null, publishedAt: row.published_at },
        disclaimer: '这是公共研究线索，不代表受益公司，不构成投资建议。'
      })) }
  };
}
