CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 singleton boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), client text NOT NULL CHECK(client IN ('web','ios')),
 csrf text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), touched_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE TABLE IF NOT EXISTS login_limits (key text PRIMARY KEY, started_at timestamptz NOT NULL, attempts integer NOT NULL);
CREATE TABLE IF NOT EXISTS service_state (
 key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO service_state(key,value) VALUES ('sync','{"cursor":null,"status":"not_configured"}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS source_versions (
 item_id text NOT NULL, version integer NOT NULL CHECK(version>0), body jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(item_id,version)
);
CREATE TABLE IF NOT EXISTS source_current (
 item_id text PRIMARY KEY, version integer NOT NULL, availability text NOT NULL,
 FOREIGN KEY(item_id,version) REFERENCES source_versions(item_id,version)
);
CREATE TABLE IF NOT EXISTS events (
 id text PRIMARY KEY, item_id text NOT NULL UNIQUE, current_version integer NOT NULL DEFAULT 0,
 substantive_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS event_versions (
 event_id text NOT NULL REFERENCES events(id), version integer NOT NULL CHECK(version>0),
 item_version integer NOT NULL, phase text NOT NULL CHECK(phase IN ('source','analysis')), input_fingerprint text NOT NULL,
 change_kind text NOT NULL, change_note text NOT NULL, payload jsonb, withdrawn boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(event_id,version), UNIQUE(event_id,input_fingerprint)
);
CREATE TABLE IF NOT EXISTS jobs (
 id text PRIMARY KEY, event_id text NOT NULL REFERENCES events(id), item_id text NOT NULL, item_version integer NOT NULL,
 input_fingerprint text NOT NULL UNIQUE, idempotency_key text NOT NULL UNIQUE, request_body jsonb,
 status text NOT NULL DEFAULT 'queued', step text NOT NULL DEFAULT 'prepare', invocation_id text UNIQUE,
 error_code text, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, fencing_token integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS job_inputs (
 job_id text NOT NULL REFERENCES jobs(id), item_id text NOT NULL, item_version integer NOT NULL,
 PRIMARY KEY(job_id,item_id,item_version), FOREIGN KEY(item_id,item_version) REFERENCES source_versions(item_id,version)
);
CREATE TABLE IF NOT EXISTS event_dependencies (
 event_id text NOT NULL, event_version integer NOT NULL, item_id text NOT NULL, item_version integer NOT NULL,
 PRIMARY KEY(event_id,event_version,item_id,item_version),
 FOREIGN KEY(event_id,event_version) REFERENCES event_versions(event_id,version)
);
CREATE TABLE IF NOT EXISTS read_state (
 user_id text NOT NULL REFERENCES users(id), event_id text NOT NULL REFERENCES events(id),
 last_read_version integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,event_id)
);
CREATE TABLE IF NOT EXISTS reading_snapshots (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), kind text NOT NULL, query text NOT NULL DEFAULT '',
 refs jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,lease_until);
CREATE INDEX IF NOT EXISTS events_recent ON events(substantive_at DESC,id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
