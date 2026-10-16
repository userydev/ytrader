-- Dynamic industry chains and pluggable stock strategies
CREATE TABLE IF NOT EXISTS content_company_indicators (
  company_code text PRIMARY KEY,
  indicators jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_strategy_plugins (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  source_citation text NOT NULL,
  description text NOT NULL,
  builtin boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  rule_config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_strategy_plugins_category ON content_strategy_plugins(category);
CREATE INDEX IF NOT EXISTS content_strategy_plugins_enabled ON content_strategy_plugins(enabled);

CREATE TABLE IF NOT EXISTS content_industry_chains (
  id text PRIMARY KEY,
  scope_kind text NOT NULL,
  target_id text NOT NULL,
  body jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_industry_chains_target ON content_industry_chains(scope_kind, target_id);
