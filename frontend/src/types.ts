export interface Meta {
  source: string;
  as_of: string | null;
  version: '1';
  completeness: 'complete' | 'partial' | 'unavailable';
  warnings: string[];
}
export interface Envelope<T> { data: T; meta: Meta }
export interface Config {
  data_mode: 'local' | 'ycore'; ai_mode: 'local' | 'ycore'; ycore_url: string;
  model_base_url: string; model_name: string; model_key_set: boolean; ycore_key_set: boolean;
  auto_analyze: boolean; sync_interval_minutes: number;
}
export type ConfigUpdate = Omit<Config, 'model_key_set' | 'ycore_key_set'> & {
  model_api_key?: string; ycore_api_key?: string; clear_model_key?: boolean; clear_ycore_key?: boolean;
};
export interface NewsCounts {
  received?: number; added?: number; duplicates?: number; rejected?: number; revisions?: number;
}
export interface Source {
  id: string; name: string; url: string; coverage: string; content_level: 'full' | 'summary' | 'title';
  enabled: boolean; status: string; last_success: string | null; last_error: string | null;
  capabilities: string[]; paid: boolean;
  last_checked?: string | null; latest_published_at?: string | null;
  next_retry_at?: string | null; failure_count?: number;
  statistics?: NewsCounts | null; total_statistics?: NewsCounts | null;
  http_status?: number | null; error_code?: string | null; not_modified?: boolean;
  quality_flags?: string[]; article_quality_counts?: Record<string, number>;
}
export interface NewsOverview {
  event_count: number; article_count: number; source_count: number; duplicate_count: number; revision_count: number;
  last_checked: string | null; latest_published_at: string | null;
  topics: { name: string; count: number }[]; warnings: string[];
}
export interface Job {
  id: string; kind: string; status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number; message: string; created_at: string; updated_at: string;
  subject_label?: string; target_url?: string;
}
export interface ResearchEvent {
  id: string; title: string; summary: string; published_at: string | null; updated_at: string;
  importance: number; relevance: number; score: number; article_count: number;
  source_names: string[]; symbols: string[]; tags: string[]; analysis_status: string;
  source_count?: number; latest_published_at?: string | null; quality_flags?: string[]; merge_reason?: string | null;
}
export interface Article {
  id: string; title: string; content: string; url: string; source: string;
  published_at: string | null; fetched_at: string; content_level: 'full' | 'summary' | 'title';
  revision_kind: 'initial' | 'update' | 'correction';
  source_id?: string | null; external_id?: string | null; canonical_url?: string | null;
  quality_flags?: string[]; merge_reason?: string | null;
}
export interface Claim { text: string; evidence_ids: string[] }
export interface Analysis {
  id: string; event_id: string; status: 'complete' | 'stale'; model: string; created_at: string;
  evidence_version: string; sections: Record<'facts' | 'links' | 'companies' | 'conditions' | 'counter_evidence' | 'unknowns', Claim[]>;
  warnings: string[];
  subject?: 'company'; symbol?: string;
}
export interface Path {
  id: string; node_ids: string[]; edge_ids: string[]; condition: string; evidence_ids: string[];
  kind: 'classification' | 'disclosed' | 'inferred';
}
export interface EventDetail { event: ResearchEvent; articles: Article[]; analysis: Analysis | null; paths: Path[]; primary_article_id?: string | null }
export interface Security {
  symbol: string; code: string; name: string; exchange: 'SH' | 'SZ' | 'BJ'; industry: string | null;
  status: 'listed' | 'delisted' | 'unknown'; as_of: string | null; source: string;
}
export interface SecurityDetail { security: Security; events: ResearchEvent[]; paths: Path[] }
export interface Coverage {
  as_of: string | null; counts: { SH: number; SZ: number; BJ: number }; status: string;
  source: string; missing_exchanges: string[]; warnings: string[];
}
export interface Quote {
  symbol: string; price: number | null; change_percent: number | null; as_of: string | null;
  source: string; status: string;
}
export interface ChainNode { id: string; label: string; kind: 'industry' | 'product' | 'segment' | 'company'; symbol?: string }
export interface Edge {
  id: string; from_id: string; to_id: string; relation: 'upstream' | 'classification' | 'disclosed_supply' | 'inferred';
  evidence_ids: string[]; confidence: number | null; as_of: string | null; source_url: string;
}
export interface Chain { nodes: ChainNode[]; edges: Edge[]; paths: Path[]; gaps: string[] }
export interface Evidence { id: string; title: string; url: string; excerpt: string; published_at: string | null; source: string }
export interface Overview {
  counts: { events: number; securities: number; relations: number; industries: number; products: number };
  model_ready: boolean; model_name: string; data_mode: 'local' | 'ycore'; ai_mode: 'local' | 'ycore'; last_sync_at: string | null;
}
export interface ChainDirectoryItem {
  id: string; label: string; kind: Exclude<ChainNode['kind'], 'company'>; company_count: number; relation_count: number;
}
export interface ChainDirectory {
  items: ChainDirectoryItem[];
  totals: { companies: number; industries: number; products: number; segments: number; relations: number };
}
export interface AvailableChainPackage {
  id: string; name: string; description: string; version: string; installed: boolean;
  node_count: number; edge_count: number; source_urls: string[];
}
export interface ModelTest { ok: boolean; model: string; latency_ms: number }
export interface ChainTopic {
  id: string; name: string; description: string; company_count: number; product_count: number; relation_count: number;
  matched_by: string[]; evidence_ids: string[];
}
export interface ChainTopics { items: ChainTopic[]; context: { event_id: string | null; symbol: string | null } }
export interface CompanyProfile {
  symbol: string; name: string; full_name: string | null; introduction: string | null; business_scope: string | null;
  website: string | null; province: string | null; industry: string | null; listing_date: string | null; established_date: string | null;
  source: string; source_url: string | null; as_of: string | null; fetched_at: string | null;
  status: 'ok' | 'stale' | 'unavailable'; evidence_ids: string[];
  businesses: { node_id: string; label: string; kind: string; evidence_ids: string[] }[];
  topics: { id: string; name: string }[];
}
export interface IndustrySource { id: string; title: string; publisher: string; url: string; locator: string; checked_at: string; access: string }
export interface IndustryNode { id: string; name: string; kind: 'product' | 'activity' | 'service' | 'application'; description: string; sources: string[] }
export type IndustryRelationKind = 'input_to' | 'produces' | 'component_of' | 'supports' | 'used_for' | 'precedes';
export interface IndustryRelation { id: string; from_id: string; to_id: string; kind: IndustryRelationKind; explanation: string; sources: string[] }
export interface IndustryCompany { id: string; name: string; symbol?: string | null; identity_note: string }
export interface IndustryParticipation { company_id: string; node_id: string; role: string; sources: string[] }
export interface IndustryStep { title: string; text: string; node_ids: string[]; sources: string[] }
export interface IndustryGroup { id: string; title: string; role: 'core' | 'support'; purpose: string; node_ids: string[] }
export interface IndustryStructure {
  version: 1; organization: 'production' | 'composition' | 'development' | 'mixed'; thesis: string;
  groups: IndustryGroup[]; primary_relation_ids: string[]; reading_order: string[];
}
export interface IndustryGraph {
  industry: { id: string; name: string; demand: string; boundary: string; summary: string };
  nodes: IndustryNode[]; relations: IndustryRelation[]; companies: IndustryCompany[]; participations: IndustryParticipation[]; sources: IndustrySource[];
  explanation: { overview: string; steps: IndustryStep[]; distinctions: { title: string; text: string; sources: string[] }[]; questions: string[]; gaps: string[] };
  structure?: IndustryStructure | null; structure_origin?: 'provided' | 'compatibility'; structure_notice?: string;
  origin?: 'public_reference' | 'ai'; version?: string; model?: string; created_at?: string;
}
export interface IndustrySummary { id: string; name: string; demand: string; summary: string; origin: 'public_reference' | 'ai'; roles: { node: string; role: string; origin: string }[] }
export interface IndustryList { items: IndustrySummary[] }
export interface IndustryResult { id: string; kind: string; graph: IndustryGraph; model: string; ai_mode: string; created_at: string; input_version: string; question: string; stale: boolean; origin: 'ai' }
export interface IndustryDetail { base: IndustryGraph | null; results: IndustryResult[]; job: Job | null }
export interface CompanyAnalysis { analysis: Analysis | null; job: Job | null }
export interface ChainPackage {
  id: string; version: string; license: string; source_url: string; as_of: string;
  nodes: ChainNode[]; edges: Edge[]; evidence: Evidence[];
}
