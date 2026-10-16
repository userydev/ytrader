export interface EditorialCitation { source: string; quote: string }
export interface EditorialStatement { text: string; citations: EditorialCitation[] }
export interface EditorialDraft {
  eligible: boolean; exclusion_reason: string | null;
  headline: string; change: EditorialStatement; why: EditorialStatement;
  facts: EditorialStatement[];
  transmission: { stage: string; mechanism: EditorialStatement }[];
  companies: { code: string; name: string; business: EditorialStatement; impact: string; counterforce: string; unknown_exposure: string }[];
  next_signals: { signal: string; interpretation: string; citations: EditorialCitation[] }[];
  countercase: string; missing_evidence: string[];
  priority: 'important' | 'watch'; priority_reason: string;
  group: { subject: string; action: string; discriminator: string; occurred_on: string | null };
  revision_summary: string;
}
export interface EditorialSource {
  key: string; item_id: string; item_version: number; title: string; provider: string; url: string | null;
  published_at: string | null; discovered_at: string; text: string;
  roles: ('news' | 'business' | 'relationship')[]; company_codes: string[];
  primary: boolean;
}
export interface EditorialInput {
  prompt_version: string; sources: EditorialSource[]; news_keys: string[];
  companies: { code: string; name: string; source_keys: string[] }[];
  relationships: { from: string; to: string; kind: string; source_keys: string[] }[];
}
export interface EditorialEvent {
  id: string; version: number; published_at: string; updated_at: string;
  source_published_at: string | null; discovered_at: string;
  draft: EditorialDraft; sources: EditorialSource[]; followed: boolean; unread: boolean;
}
export interface EditorialStatus {
  sync: { status?: string; last_success_at?: string; failure_at?: string; error_code?: string; coverage?: unknown[] };
  model: { enabled?: boolean; gate?: string | null; checked_at?: string };
  jobs: { status: string; count: number; error_code: string | null }[];
  unresolved?: { job_id:string; idempotency_key:string; invocation_id:string|null; error_code:string|null }[];
}
export interface EditorialFeed { items: EditorialEvent[]; status: EditorialStatus; has_more: boolean; next_offset: number | null; unavailable_count: number }
export interface EditorialDetail { event: EditorialEvent; history: { version: number; summary: string; published_at: string }[] }
export interface EditorialFollow { kind: 'event' | 'company'; target: string; name: string; created_at: string }
