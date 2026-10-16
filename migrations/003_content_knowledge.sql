-- Independent content domain; no writes to the legacy editorial/model tables.
CREATE TABLE IF NOT EXISTS content_runs (
 provider text NOT NULL, id text NOT NULL, body jsonb NOT NULL,
 observed_at timestamptz NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,id)
);
CREATE TABLE IF NOT EXISTS content_nodes (
 id text PRIMARY KEY, body jsonb NOT NULL, observed_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS content_node_roots (
 node_id text NOT NULL REFERENCES content_nodes(id), root_id text NOT NULL REFERENCES content_nodes(id), PRIMARY KEY(node_id,root_id)
);
CREATE TABLE IF NOT EXISTS content_edges (
 id text PRIMARY KEY, from_id text NOT NULL REFERENCES content_nodes(id), to_id text NOT NULL REFERENCES content_nodes(id),
 kind text NOT NULL CHECK(kind IN ('classification','input','output','equipment','service')),
 body jsonb NOT NULL, observed_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_edges_from ON content_edges(from_id,kind);
CREATE INDEX IF NOT EXISTS content_edges_to ON content_edges(to_id,kind);
CREATE TABLE IF NOT EXISTS content_companies (
 code text PRIMARY KEY CHECK(code ~ '^[0-9]{6}\.(SZ|SH|BJ)$'), body jsonb NOT NULL,
 observed_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS content_exposures (
 id text PRIMARY KEY, company_code text NOT NULL REFERENCES content_companies(code), node_id text NOT NULL REFERENCES content_nodes(id),
 status text NOT NULL CHECK(status IN ('business','candidate')), body jsonb NOT NULL,
 observed_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_exposures_node ON content_exposures(node_id);
CREATE INDEX IF NOT EXISTS content_exposures_company ON content_exposures(company_code);
CREATE TABLE IF NOT EXISTS content_news (
 id text PRIMARY KEY, body jsonb NOT NULL, published_at timestamptz,
 observed_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 origin text NOT NULL DEFAULT 'bundle' CHECK(origin IN ('bundle','existing')),
 source_item_id text, source_item_version integer
);
CREATE INDEX IF NOT EXISTS content_news_recent ON content_news(published_at DESC NULLS LAST,id);
CREATE INDEX IF NOT EXISTS content_news_source ON content_news(source_item_id) WHERE origin='existing';
CREATE TABLE IF NOT EXISTS content_news_nodes (
 news_id text NOT NULL REFERENCES content_news(id) ON DELETE CASCADE,
 node_id text NOT NULL REFERENCES content_nodes(id), PRIMARY KEY(news_id,node_id)
);
CREATE INDEX IF NOT EXISTS content_news_nodes_lookup ON content_news_nodes(node_id,news_id);
CREATE TABLE IF NOT EXISTS content_news_companies (
 news_id text NOT NULL REFERENCES content_news(id) ON DELETE CASCADE,
 company_code text NOT NULL REFERENCES content_companies(code), PRIMARY KEY(news_id,company_code)
);
CREATE INDEX IF NOT EXISTS content_news_companies_lookup ON content_news_companies(company_code,news_id);
CREATE TABLE IF NOT EXISTS content_observations (
 id text PRIMARY KEY, node_id text NOT NULL REFERENCES content_nodes(id), date date NOT NULL,
 body jsonb NOT NULL, observed_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_observations_node ON content_observations(node_id,date DESC);
CREATE TABLE IF NOT EXISTS content_methods (
 version text PRIMARY KEY, fingerprint text NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Rebuildable, non-paid analysis projection. GET derives from current data, never trusts a stale cache.
CREATE TABLE IF NOT EXISTS content_mechanisms (
 id text PRIMARY KEY, news_id text NOT NULL REFERENCES content_news(id) ON DELETE CASCADE,
 method_version text NOT NULL REFERENCES content_methods(version), body jsonb NOT NULL,
 built_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_mechanisms_news ON content_mechanisms(news_id);
