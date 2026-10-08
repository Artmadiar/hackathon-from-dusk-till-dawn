-- Деньги (концепт 3.1): истина — леджер, balance/held материализованы.
CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('user', 'provider', 'platform')),
  owner_id text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  held bigint NOT NULL DEFAULT 0 CHECK (held >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT available_non_negative CHECK (balance - held >= 0),
  UNIQUE (owner_type, owner_id)
);

-- append-only; idempotency_key UNIQUE — ретрай/дубль webhook = одна запись (C02, C07, C08)
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  type text NOT NULL CHECK (type IN ('DEPOSIT', 'HOLD', 'HOLD_RELEASE', 'CAPTURE_OUT', 'CAPTURE_IN', 'REFUND')),
  amount bigint NOT NULL CHECK (amount > 0),
  deal_id text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE INDEX ledger_entries_wallet_created_idx ON ledger_entries (wallet_id, created_at);

CREATE TABLE spending_policies (
  user_id text PRIMARY KEY,
  max_per_deal bigint NOT NULL,
  max_per_day bigint NOT NULL,
  total_budget bigint NOT NULL,
  allowed_categories text[] NOT NULL
);
