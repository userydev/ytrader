import { z } from 'zod';
import type { Config } from './config.js';
export const refSchema = z.object({ item_id: z.string().min(1), item_version: z.number().int().positive() }).strict();
const companyMetadataSchema = z.object({ company_id: z.string().regex(/^(SSE|SZSE|BSE)\.\d{6}$/), company_name: z.string().min(1).max(100), reviewed: z.literal(true) });
// Product persistence shape. Never parse a core response as this internal shape.
export const internalItemSchema = z.object({
  item_id: z.string().min(1), version: z.number().int().positive(), source: z.string().min(1),
  independence_key: z.string().min(1).optional(), source_classification: z.enum(['primary','secondary']).optional(),
  title: z.string(), url: z.string().url().nullable().optional(), published_at: z.string().datetime().nullable(),
  first_seen_at: z.string().datetime(), fetched_at: z.string().datetime(),
  content: z.string().max(160000).nullable().optional(), content_kind: z.enum(['full','snippet','none']),
  item_type: z.string(), language: z.string(),
  metadata: z.object({ company_id: z.string().regex(/^(SSE|SZSE|BSE)\.\d{6}$/), company_name: z.string().min(1).max(100), reviewed: z.boolean() }).optional(),
  license_scope: z.object({ store: z.boolean(), display: z.boolean(), model: z.boolean() }),
  availability: z.enum(['available','removed','unavailable'])
});
export type Item = z.infer<typeof internalItemSchema>;
const deniedRights = { discovery: false, store_fulltext: false, ai_input: false };
const rightsSchema = z.object({ discovery: z.boolean(), store_fulltext: z.boolean(), ai_input: z.boolean() });
const coreSourceSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), origin_group: z.string().min(1),
  classification: z.enum(['primary','secondary']),
  rights: rightsSchema.catch(deniedRights), current_rights: rightsSchema.optional()
});
export const itemSchema = z.object({
  item_id: z.string().min(1), version: z.number().int().positive(), source: coreSourceSchema,
  url: z.string().url().nullable().optional(), title: z.string(), published_at: z.string().datetime().nullable(),
  published_at_raw: z.string().nullable(), first_seen_at: z.string().datetime(), fetched_at: z.string().datetime(),
  content: z.string().max(160000).optional(), content_kind: z.enum(['text','metadata','tombstone']),
  item_type: z.string(), language: z.string(), license_scope: z.string(),
  availability: z.enum(['available','retracted','removed']), independence_key: z.string().min(1)
}).transform((raw): Item => {
  const historical = raw.source.rights;
  const current = raw.source.current_rights ?? deniedRights;
  const fulltext = historical.store_fulltext && current.store_fulltext;
  // Discovery authorises title/URL metadata, not a hidden fulltext or model grant.
  const metadata = (historical.discovery && current.discovery) || fulltext;
  const store = metadata;
  const display = metadata;
  const available = raw.availability==='available' && raw.content_kind!=='tombstone';
  const canRetain = available && fulltext;
  return {
    item_id: raw.item_id, version: raw.version, source: raw.source.name, independence_key: raw.source.origin_group, source_classification: raw.source.classification,
    title: display && available ? raw.title : '', url: raw.url, published_at: raw.published_at,
    first_seen_at: raw.first_seen_at, fetched_at: raw.fetched_at,
    content: canRetain && raw.content_kind==='text' ? raw.content ?? null : null,
    content_kind: canRetain && raw.content_kind==='text' && raw.content ? 'full' : 'none',
    item_type: raw.item_type,
    language: raw.language,
    license_scope: { store, display, model: canRetain && raw.content_kind==='text' && Boolean(raw.content?.trim()) && historical.ai_input && current.ai_input },
    availability: raw.availability==='removed' ? 'removed' : available ? 'available' : 'unavailable'
    // There is intentionally NO company metadata copied/inferred from the core payload.
  };
});
export const companyMappingSchema = companyMetadataSchema.extend({ item_id: z.string().min(1), item_version: z.number().int().positive() }).strict();
export type CompanyMapping = z.infer<typeof companyMappingSchema>;
export function withCompanyMapping(item: Item, candidate: CompanyMapping): Item {
  const mapping = companyMappingSchema.parse(candidate);
  if (item.item_id!==mapping.item_id || item.version!==mapping.item_version || !['company_profile','document'].includes(item.item_type)) throw new Error('COMPANY_MAPPING_REF_MISMATCH');
  return { ...item, metadata: { company_id: mapping.company_id, company_name: mapping.company_name, reviewed: true } };
}
const changeSchema = z.object({ data: z.array(z.object({ item_id: z.string(), version: z.number().int().positive(), change: z.enum(['created','updated','retracted','removed']), changed_at: z.string().datetime() })).max(300), next_cursor: z.string().nullable(), has_more: z.boolean() });
export type ChangePage = z.infer<typeof changeSchema>;
const micro = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const microPeriod = z.object({ limit: micro, spent: micro, reserved: micro });
const decimalUSD = z.union([z.number().finite().nonnegative(),z.string().regex(/^\d+(?:\.\d+)?$/)]);
const corePeriod = z.object({ limit: decimalUSD, spent: decimalUSD, reserved: decimalUSD, micro_usd: microPeriod });
export const budgetSchema = z.object({
  enabled: z.boolean(), currency: z.literal('USD'), timezone: z.literal('Asia/Shanghai'),
  day: corePeriod, month: corePeriod, unknown_reserved: decimalUSD, unknown_reserved_micro_usd: micro,
  pool_policy: z.literal('shared_hard_cap_no_priority'), reservation_policy: z.literal('all_unsettled_reservations_carry_across_all_periods')
}).transform(raw => ({ enabled: raw.enabled, currency: raw.currency, unit: 'micro_usd' as const,
  day: raw.day.micro_usd, month: raw.month.micro_usd, unknown_reserved: raw.unknown_reserved_micro_usd }));
export const sourceStatusSchema = z.object({ data: z.array(coreSourceSchema.omit({ current_rights: true }).extend({
  license_scope: z.string(), capabilities: z.object({ stream: z.boolean(), bounded_search: z.literal(false), document_import: z.boolean() }),
  status: z.enum(['disabled','error','never_ingested','stale','healthy']),
  last_attempt: z.string().datetime().nullable(), last_success: z.string().datetime().nullable(),
  error_code: z.string().nullable(), coverage: z.object({ start: z.string().datetime().nullable(), end: z.string().datetime().nullable(), completeness: z.literal('observed_only') }),
  watermark: z.unknown(), interval_seconds: z.number().nonnegative(), age_seconds: z.number().nonnegative().nullable(), delay_seconds: z.number().nonnegative().nullable()
})) }).transform(raw => {
  const states = raw.data.map(source => ({
    source: source.name,
    status: source.status==='disabled' ? 'not_configured' : source.status==='healthy' && source.last_success ? 'ok' : source.status==='stale' ? 'stale' : 'unavailable',
    last_success_at: source.last_success,
    coverage_note: `仅覆盖已观测内容，不代表完整覆盖。${source.delay_seconds ? `最新条目距今 ${source.delay_seconds} 秒。` : ''}`
  }));
  const active = states.filter(source => source.status!=='not_configured');
  const status = !active.length ? 'not_configured' : active.every(source => source.status==='ok') ? 'ok' : active.some(source => source.status==='ok') ? 'partial' : active.every(source => source.status==='stale') ? 'stale' : 'unavailable';
  return { status, sources: states };
});
const coreInvocationSchema = z.object({ invocation_id: z.string().optional(),
  status: z.enum(['queued','dispatched','succeeded','unknown','rejected','failed_billed','exceeded_bound']),
  output: z.string().optional(), error_class: z.string().optional() });
type Invocation = { invocation_id?: string; status: 'queued'|'dispatched'|'succeeded'|'failed'|'unknown'|'rejected'; output?: unknown; error_class?: string };
function normalizeInvocation(raw: z.infer<typeof coreInvocationSchema>): Invocation {
  if (raw.status==='failed_billed' || raw.status==='exceeded_bound') return { ...raw, status: 'failed', error_class: raw.error_class ?? raw.status };
  if (raw.status==='succeeded' && !raw.output?.trim()) return { ...raw, status: 'failed', error_class: 'OUTPUT_UNAVAILABLE' };
  return { ...raw, status: raw.status };
}
export const invocationSchema = coreInvocationSchema.transform(normalizeInvocation);
export class UpstreamError extends Error { constructor(public code: string, public status: number = 503, public definitelyUnaccepted = false) { super(code); } }
export class Ycore {
  constructor(private config: Config, private companyMappings: readonly CompanyMapping[] = []) {}
  get configured() { return Boolean(this.config.ycoreUrl && this.config.ycoreToken); }
  private async request<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, body?: unknown, key?: string): Promise<T> {
    if (!this.configured) throw new UpstreamError('NOT_CONFIGURED');
    let response: Response;
    try {
      response = await fetch(`${this.config.ycoreUrl!.replace(/\/$/, '')}/ycore/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15000), redirect: 'error',
        headers: { Authorization: `Bearer ${this.config.ycoreToken}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch { throw new UpstreamError('UPSTREAM_UNCERTAIN'); }
    if (!response.ok) {
      // Confirmed gateway validation/rate-limit responses do not dispatch a provider request.
      if (response.status===400 || response.status===429) throw new UpstreamError(response.status===400 ? 'UPSTREAM_VALIDATION' : 'UPSTREAM_RATE_LIMITED',response.status,true);
      if (response.status === 410) throw new UpstreamError('CURSOR_EXPIRED', 410);
      if (response.status === 409) throw new UpstreamError('BUDGET_OR_CONFLICT', 409);
      throw new UpstreamError(`UPSTREAM_${response.status}`, response.status);
    }
    try { return schema.parse(await response.json()); } catch { throw new UpstreamError('CONTRACT_MISMATCH'); }
  }
  changes(cursor: string | null) { return this.request(`/items/changes?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, changeSchema); }
  async item(id: string, version: number) {
    const item = await this.request(`/items/${encodeURIComponent(id)}/versions/${version}`,itemSchema);
    const mappings = this.companyMappings.filter(mapping => mapping.item_id===item.item_id && mapping.item_version===item.version);
    if (mappings.length>1) throw new UpstreamError('AMBIGUOUS_COMPANY_MAPPING');
    return mappings.length ? withCompanyMapping(item,mappings[0]) : item;
  }
  contentSnapshot() { return this.request('/content/snapshot', z.object({ bundle: z.unknown(), coverage: z.array(z.unknown()) })); }
  sources() { return this.request('/sources/status', sourceStatusSchema); }
  budget() { return this.request('/products/ytrader/budget', budgetSchema); }
  createInvocation(body: unknown, key: string) {
    const receiptSchema = coreInvocationSchema.extend({ invocation_id: z.string().min(1) }).transform(raw => ({ ...normalizeInvocation(raw), invocation_id: raw.invocation_id }));
    return this.request('/model-invocations', receiptSchema, body, key);
  }
  invocation(id: string) { return this.request(`/model-invocations/${encodeURIComponent(id)}`, invocationSchema); }
}
export function budgetGate(b: z.infer<typeof budgetSchema>): string | null {
  if (!b.enabled) return 'MODEL_NOT_CONFIGURED';
  // Only authoritative integer micro-USD fields are used; decimal display fields are never rounded into a budget.
  if (b.unit!=='micro_usd' || b.day.limit>1_000_000 || b.month.limit>10_000_000) return 'BUDGET_POLICY_UNVERIFIED';
  if (b.day.limit<=b.day.spent+b.day.reserved || b.month.limit<=b.month.spent+b.month.reserved) return 'BUDGET_EXHAUSTED';
  return null;
}
