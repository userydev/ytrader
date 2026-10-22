export interface Meta {
  source: string;
  as_of: string | null;
  version: '1';
  completeness: 'complete' | 'partial' | 'unavailable';
  warnings: string[];
}
export interface Envelope<T> { data: T; meta: Meta }
export interface Job {
  id: string; kind: string; status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number; message: string; created_at: string; updated_at: string;
  subject_label?: string; target_url?: string;
}
export interface Article {
  id: string; title: string; content: string; url: string; source: string;
  published_at: string | null; fetched_at: string; content_level: 'full' | 'summary' | 'title';
  revision_kind: 'initial' | 'update' | 'correction';
  source_id?: string | null; external_id?: string | null; canonical_url?: string | null;
  quality_flags?: string[]; merge_reason?: string | null;
}
export interface Security {
  symbol: string; code: string; name: string; exchange: 'SH' | 'SZ' | 'BJ'; industry: string | null;
  status: 'listed' | 'delisted' | 'unknown'; as_of: string | null; source: string;
}
export interface Coverage {
  as_of: string | null; counts: { SH: number; SZ: number; BJ: number }; status: string;
  source: string; missing_exchanges: string[]; warnings: string[];
}
