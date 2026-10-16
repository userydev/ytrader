import { z } from 'zod';
import type { ContentBundle } from '../../src/content/types.js';
export const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const text = z.string().trim().min(1).max(1000).refine(s => !s.includes('\u0000'), 'NUL is not allowed');
const prose = z.string().max(16000).refine(s => !s.includes('\u0000'), 'NUL is not allowed');
const iso = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; });
const url = z.string().max(4096).url().refine(s => {
  try { return !s.includes('\u0000') && ['https:', 'http:'].includes(new URL(s).protocol); } catch { return false; }
}, 'HTTP(S) URL required');
export const nodeId = z.string().regex(/^ifind:[A-Za-z0-9_.:-]{1,120}$/);
export const companyCode = z.string().regex(/^\d{6}\.(SZ|SH|BJ)$/);
const identifier = z.string().min(1).max(240).refine(s => s.trim().length > 0 && !/[\u0000-\u001f]/.test(s));
const verification = z.enum(['primary', 'provider', 'unverified']);
export const evidenceSchema = z.object({ provider: text, url: url.nullable(), title: text, observed_at: iso, as_of: z.union([iso, date]).nullable(), verification,
  quote: prose.optional(), source_item_id: identifier.optional(), source_item_version: z.number().int().positive().max(2147483647).optional()
}).strict().superRefine((e, ctx) => { if (e.source_item_version !== undefined && !e.source_item_id) ctx.addIssue({ code: 'custom', message: 'source_item_version requires source_item_id' }); });
const evidence = z.array(evidenceSchema).max(64);
const node = z.object({ id: nodeId, name: text, aliases: z.array(text).max(100), root_ids: z.array(nodeId).max(100), evidence }).strict();
const edge = z.object({ id: identifier, from_id: nodeId, to_id: nodeId, kind: z.enum(['classification','input','output','equipment','service']), evidence }).strict();
const company = z.object({ code: companyCode, name: text, business: prose, products: z.array(text).max(200), report_period: text.nullable(),
  financials: z.array(z.object({ label: text, value: text, unit: text.nullable(), period: text.nullable(), evidence: evidence.refine(e => e.length > 0, 'Financials require evidence') }).strict()).max(200), evidence }).strict();
const exposure = z.object({ id: identifier, company_code: companyCode, node_id: nodeId, role: text, basis: prose, evidence, status: z.enum(['business','candidate']) }).strict().superRefine((e, ctx) => {
  if (e.status === 'business' && (!e.basis.trim() || !e.evidence.length)) ctx.addIssue({ code: 'custom', message: 'Business exposure requires explicit basis and evidence' });
});
const change = z.object({ variable: z.enum(['input_cost','selling_price','demand','capacity','supply','inventory','policy','orders']), direction: z.enum(['up','down','changed']), node_id: nodeId,
  basis: prose.refine(s => s.trim().length > 0), evidence: evidence.refine(e => e.length > 0, 'Change requires evidence') }).strict();
export const newsSchema = z.object({ id: identifier, title: text, summary: prose.nullable(), url: url.nullable(), source: text, published_at: z.union([iso, date]).nullable(), observed_at: iso, verification,
  node_ids: z.array(nodeId).max(200), company_codes: z.array(companyCode).max(200), evidence, change: change.optional() }).strict().superRefine((n, ctx) => {
  if (n.change && !n.node_ids.includes(n.change.node_id)) ctx.addIssue({ code: 'custom', message: 'Change node must be an explicit news reference' });
  if (new Set(n.node_ids).size !== n.node_ids.length || new Set(n.company_codes).size !== n.company_codes.length) ctx.addIssue({ code: 'custom', message: 'Duplicate news references' });
});
const observation = z.object({ id: identifier, node_id: nodeId, label: text, date, value: text, unit: text, source: text, evidence }).strict();
export const bundleSchema = z.object({ schema_version: z.literal(1), observed_at: iso,
  source_run: z.object({ id: identifier, provider: text, status: text, started_at: iso, finished_at: iso.nullable(), error: prose.optional() }).strict().superRefine((r, ctx) => {
    if (r.finished_at && Date.parse(r.finished_at) < Date.parse(r.started_at)) ctx.addIssue({ code: 'custom', message: 'Run finishes before it starts' });
  }),
  nodes: z.array(node).max(10000), edges: z.array(edge).max(20000), companies: z.array(company).max(10000),
  exposures: z.array(exposure).max(20000), news: z.array(newsSchema).max(10000), observations: z.array(observation).max(20000)
}).strict().superRefine((b, ctx) => {
  const groups = [b.nodes.map(x => x.id), b.edges.map(x => x.id), b.companies.map(x => x.code), b.exposures.map(x => x.id), b.news.map(x => x.id), b.observations.map(x => x.id)];
  if (groups.reduce((n, g) => n + g.length, 0) > 30000) ctx.addIssue({ code: 'custom', message: 'Bundle exceeds 30000 entities' });
  if (groups.some(g => new Set(g).size !== g.length)) ctx.addIssue({ code: 'custom', message: 'Duplicate entity IDs' });
});
export function parseBundle(value: unknown): ContentBundle {
  if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > MAX_BUNDLE_BYTES) throw new Error('CONTENT_BUNDLE_TOO_LARGE');
  return bundleSchema.parse(value);
}
export function parseBundleJSON(text: string) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BUNDLE_BYTES) throw new Error('CONTENT_BUNDLE_TOO_LARGE');
  return parseBundle(JSON.parse(text));
}
