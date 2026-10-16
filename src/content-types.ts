// Shared wire types: timestamps are ISO strings (never Date objects).
export type Verification = 'primary' | 'provider' | 'unverified';
export interface Evidence {
  provider: string; url: string | null; title: string; observed_at: string; as_of: string | null;
  verification: Verification; quote?: string; source_item_id?: string; source_item_version?: number;
}
export interface IndustryNode { id: string; name: string; aliases: string[]; root_ids: string[]; evidence: Evidence[] }
export type EdgeKind = 'classification' | 'input' | 'output' | 'equipment' | 'service';
export interface IndustryEdge { id: string; from_id: string; to_id: string; kind: EdgeKind; evidence: Evidence[] }
export interface Financial { label: string; value: string; unit: string | null; period: string | null; evidence: Evidence[] }
export interface Company { code: string; name: string; business: string; products: string[]; report_period: string | null; financials: Financial[]; evidence: Evidence[] }
export interface Exposure { id: string; company_code: string; node_id: string; role: string; basis: string; evidence: Evidence[]; status: 'business' | 'candidate' }
export type ChangeVariable = 'input_cost' | 'selling_price' | 'demand' | 'capacity' | 'supply' | 'inventory' | 'policy' | 'orders';
export interface Change { variable: ChangeVariable; direction: 'up' | 'down' | 'changed'; node_id: string; basis: string; evidence: Evidence[] }
export interface News {
  id: string; title: string; summary: string | null; url: string; source: string;
  published_at: string | null; observed_at: string; verification: Verification;
  node_ids: string[]; company_codes: string[]; evidence: Evidence[]; change?: Change;
}
export interface Observation { id: string; node_id: string; label: string; date: string; value: string; unit: string; source: string; evidence: Evidence[] }
export interface SourceRun { id: string; provider: string; status: string; started_at: string; finished_at: string | null; error?: string }
export interface ContentBundle {
  schema_version: 1; observed_at: string; source_run: SourceRun;
  nodes: IndustryNode[]; edges: IndustryEdge[]; companies: Company[]; exposures: Exposure[]; news: News[]; observations: Observation[];
}
export interface TransmissionRule {
  variables: ChangeVariable[]; anchor: 'from' | 'to'; edge_kinds: Exclude<EdgeKind, 'classification'>[]; statement: string;
}
export interface Method {
  id: string; variables: ChangeVariable[]; title: string; conditions: string[];
  reverse_factors: string[]; required_data: string[]; explanation: string;
  direct_explanations: Partial<Record<ChangeVariable, string>>; transmissions: TransmissionRule[];
}
export interface MethodSet { version: string; status: 'conditional_only'; methods: Method[]; disclaimer: string }
export interface MechanismStep { kind: 'fact' | 'structure' | 'inference'; statement: string; evidence: Evidence[]; edge_id?: string; exposure_id?: string }
export interface Mechanism {
  id: string; method_version: string; method_id: string; status: 'conditional'; news_id: string;
  node_id: string; company_code: string | null; variable: ChangeVariable; direction: Change['direction'];
  steps: MechanismStep[]; conditions: string[]; reverse_factors: string[]; missing_evidence: string[];
}
export interface NewsItem extends News { source_status: Verification; analysis_status: 'conditional' | 'pending_evidence' | 'no_explicit_change' }
export interface Page<T> { items: T[]; total: number }
export interface NewsPage extends Page<NewsItem> { updated_at: string | null }
export interface Relation { edge: IndustryEdge; node: IndustryNode }
export interface CompanyExposure { company: Company; exposure: Exposure }
export interface ExposureNode { exposure: Exposure; node: IndustryNode }
export interface Coverage {
  nodes: number; edges: number; production_edges: number; companies: number; news: number; observations: number;
  latest_run: SourceRun | null; updated_at: string | null; completeness: 'observed_only';
}
export interface Overview {
  counts: { industries: number; relations: number; companies: number; news: number; observations: number };
  coverage: Coverage; recent_news: NewsItem[]; featured_industries: IndustryNode[]; recent_companies: Company[];
}
export interface NewsDetail { news: NewsItem; industries: IndustryNode[]; companies: Company[]; mechanisms: Mechanism[]; missing_evidence: string[]; methods: MethodSet }
export interface IndustryDetail {
  node: IndustryNode; parents: Relation[]; children: Relation[]; upstream: Relation[]; downstream: Relation[];
  companies: CompanyExposure[]; news: NewsItem[]; observations: Observation[]; mechanisms: Mechanism[];
  coverage: { companies: number; news: number; observations: number; completeness: 'observed_only'; truncated: boolean }; methods: MethodSet;
}
export interface CompanyDetail { company: Company; exposures: ExposureNode[]; news: NewsItem[]; mechanisms: Mechanism[]; missing_evidence: string[]; methods: MethodSet }
// Adapted mobile_briefing reference/source/list contract. Related is not beneficiary.
export interface BriefingItem {
  id: string; kind: 'discovery_signal'; title: string; summary: string | null; occurredAt: string | null;
  relevance: 'possible'; referenceObjects: { id: string; type: 'ticker'; displayName: string }[];
  source: { title: string; url: string | null; publishedAt: string | null }; disclaimer: string;
}
export interface Briefing {
  schemaVersion: '1.0'; generatedAt: string;
  dataFreshness: { state: 'fresh' | 'stale' | 'unknown' | 'unavailable'; sourceUpdatedAt: string | null; staleAfterSeconds: number };
  data: { matchMode: 'reference_tickers' | 'latest_public_signals'; requestedReferences: string[]; items: BriefingItem[] };
}
