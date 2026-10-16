export type Evidence = { item_id: string; item_version: number; source: string; title: string; url: string | null; published_at: string | null; fetched_at: string; content_kind: string; availability: string; support_locator: string; excerpt: string | null };
export type Event = {
  event_id: string; version: number; current_version: number; summary: string; headline?: string; change_summary?: string; impact_summary?: string; importance: string; importance_reason: string;
  evidence_state: string; evidence_label: string; occurred_at: string | null; source_published_at: string | null; generated_at: string; last_verified_at: string; substantive_at: string;
  claims: { claim_id: string; content_type: string; text: string; evidence_state: string; evidence: Evidence[] }[];
  paths: { name: string; mechanism: string; conditions: string[]; counterforces: string[]; direction: string; claim_ids: string[] }[];
  companies: { company_id: string; name: string; business_evidence: Evidence[]; mechanism_path: number; conditional_link: string; conditions: string[]; counterforces: string[] }[];
  stopping_message: string; explanation_status: string; change_kind: string; change_note: string; correction_notice: string | null;
  unread: boolean; correction_for_reader: boolean; impact_coverage: string;
};
export type Digest = { snapshot_id: string; window_start: string; window_end: string; data_cutoff_at: string | null; status: string; items: Event[]; watch_items: Event[]; corrections: Event[]; more_cursor: string | null; pending_count: number };
export type Page = { data: Event[]; next_cursor: string | null; has_more: boolean; snapshot_id: string };
export type Status = {
  status: string; last_success_at: string | null; failure_at: string | null; recovery_required: boolean; backlog: boolean; model_enabled: boolean; error_code?: string | null;
  coverage: { source: string; status: string; last_success_at: string | null; coverage_note?: string }[];
  budget: null | { enabled: boolean; currency: string; unit: 'micro_usd'; day: { limit: number; spent: number; reserved: number }; month: { limit: number; spent: number; reserved: number }; checked_at: string };
  jobs: { status: string; count: number; error_code?: string | null }[];
};
