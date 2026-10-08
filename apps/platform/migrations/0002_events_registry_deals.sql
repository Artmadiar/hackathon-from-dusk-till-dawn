-- Один журнал на домен и агентов (концепт 3.8, U1); id — курсор SSE (B14)
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('domain', 'agent')),
  actor text NOT NULL,
  run_id text,
  task_id text,
  deal_id text,
  provider_id text,
  user_id text,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text
);
CREATE INDEX events_task_idx ON events (task_id, id);
CREATE INDEX events_user_idx ON events (user_id, id);

-- Реестр исполнителей; рейтинг в сотых (3.3.1), целым — без дрейфа float
CREATE TABLE providers (
  id text PRIMARY KEY,
  name text NOT NULL,
  agent_url text NOT NULL,
  contract_type_id text NOT NULL DEFAULT 'office-supplies.v1',
  categories text[] NOT NULL,
  rating_x100 int NOT NULL DEFAULT 400 CHECK (rating_x100 BETWEEN 0 AND 500),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);

CREATE TABLE tasks (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  contract_type_id text NOT NULL,
  request jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'SOURCING', 'DECIDING', 'ORDERED', 'DONE', 'FAILED')),
  created_via text NOT NULL DEFAULT 'ui' CHECK (created_via IN ('ui', 'mcp')),
  excluded_provider_ids text[] NOT NULL DEFAULT '{}',
  fail_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE deals (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id),
  provider_id text NOT NULL REFERENCES providers(id),
  status text NOT NULL CHECK (status IN ('QUOTED', 'HELD', 'ORDER_PLACED', 'PROOF_RECEIVED', 'SETTLED', 'REJECTED_BY_POLICY', 'CANCELLED')),
  quote jsonb NOT NULL,
  proof jsonb,
  cancel_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX deals_task_idx ON deals (task_id);
