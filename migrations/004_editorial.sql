-- Independent, paid editorial path. Never touches legacy jobs/analyze.
CREATE TABLE IF NOT EXISTS content_editorial_jobs (
 id text PRIMARY KEY, fingerprint text NOT NULL UNIQUE, primary_refs jsonb NOT NULL,
 input jsonb NOT NULL, request_body jsonb,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','inflight','unknown','published','excluded','rejected','failed')),
 invocation_id text, error_code text, attempts integer NOT NULL DEFAULT 0,
 retry_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_editorial_jobs_work ON content_editorial_jobs(status,retry_at,created_at);
CREATE TABLE IF NOT EXISTS content_editorial_events (
 id text PRIMARY KEY, current_version integer NOT NULL DEFAULT 0,
 group_key text NOT NULL, group_body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_editorial_group ON content_editorial_events(group_key);
CREATE TABLE IF NOT EXISTS content_editorial_versions (
 event_id text NOT NULL REFERENCES content_editorial_events(id), version integer NOT NULL,
 job_id text NOT NULL UNIQUE REFERENCES content_editorial_jobs(id), body jsonb NOT NULL,
 sources jsonb NOT NULL, primary_refs jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_id,version)
);
CREATE TABLE IF NOT EXISTS content_editorial_follows (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('event','company')), target text NOT NULL, name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,kind,target)
);
CREATE TABLE IF NOT EXISTS content_editorial_reads (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id text NOT NULL REFERENCES content_editorial_events(id),
 version integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,event_id)
);
CREATE TABLE IF NOT EXISTS content_editorial_state (
 key text PRIMARY KEY, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
