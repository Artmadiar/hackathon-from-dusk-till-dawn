-- S8 / B8: пользователи, OTP-вход (код SIMULATED в UI), сессии с несколькими учётками

CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('buyer', 'provider', 'admin')),
  name text NOT NULL,
  provider_id text,                  -- для role=provider: чей портал
  delivery_address text,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  api_key text NOT NULL UNIQUE,      -- MCP: API-ключ в заголовке (B8, limitations)
  created_at timestamptz NOT NULL
);

CREATE TABLE otp_codes (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,   -- TTL (C34)
  consumed_at timestamptz,           -- одноразовость (C34)
  created_at timestamptz NOT NULL
);
CREATE INDEX otp_codes_email_idx ON otp_codes (email, id);

-- Одна сессия держит несколько учёток и активную (B8); не трогаем при seed-сбросе
CREATE TABLE sessions (
  id text PRIMARY KEY,
  identities text[] NOT NULL,
  active_identity text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
