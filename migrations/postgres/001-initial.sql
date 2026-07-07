-- Migration 001 (Postgres) — full initial schema for subscription-proxy-pool.
-- Dialect-partitioned counterpart of migrations/001-initial.sql (spp-db:CNST-001).
-- Portable DDL only: SQLite-only pragmas dropped; timestamps use now()::text.

CREATE TABLE schema_version(
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

INSERT INTO schema_version(version, applied_at) VALUES (1, now()::text);

-- Level-1 identity: a person who works with the pool.
CREATE TABLE users(
  user_id    TEXT PRIMARY KEY,
  handle     TEXT UNIQUE,
  created_at TEXT NOT NULL
);

-- Social/OIDC identities linked to a user (issuer+subject is the external key).
CREATE TABLE user_identities(
  identity_id TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  issuer      TEXT NOT NULL,
  subject     TEXT NOT NULL,
  email       TEXT,
  linked_at   TEXT NOT NULL,
  UNIQUE(issuer, subject)
);
CREATE INDEX idx_user_identities_user ON user_identities(user_id);

-- Management-API sessions (level 1). Bearer secret is stored hashed.
CREATE TABLE auth_sessions(
  session_id   TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

-- Inference-time credential for the Claude Code CLI. Secret stored hashed;
-- the key row alone decides user + pool target (own|donor).
CREATE TABLE proxy_keys(
  key_id      TEXT PRIMARY KEY,
  key_hash    TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  pool_target TEXT NOT NULL CHECK(pool_target IN ('own', 'donor')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX idx_proxy_keys_user ON proxy_keys(user_id);

-- Level-2 subscription credentials pooled per user or in the donor pool.
-- access_token/refresh_token hold a versioned authenticated-ciphertext envelope
-- (spp-subscriptions:DLT-001); the encryption key is held outside the DB.
CREATE TABLE subscriptions(
  subscription_id  TEXT PRIMARY KEY,
  provider         TEXT NOT NULL CHECK(provider IN ('anthropic', 'openai')),
  pool_kind        TEXT NOT NULL CHECK(pool_kind IN ('user', 'donor')),
  owner_user_id    TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  label            TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'unusable', 'revoked')),
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  scopes           TEXT NOT NULL,
  unusable_reason  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK ((pool_kind = 'user'  AND owner_user_id IS NOT NULL)
      OR (pool_kind = 'donor' AND owner_user_id IS NULL))
);
CREATE INDEX idx_subs_userpool  ON subscriptions(pool_kind, owner_user_id, provider, status);
CREATE INDEX idx_subs_donorpool ON subscriptions(pool_kind, provider, status);

-- Per-subscription load snapshots harvested passively from proxy traffic or by
-- the active prober.
CREATE TABLE subscription_load(
  load_id         TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(subscription_id) ON DELETE CASCADE,
  sampled_at      TEXT NOT NULL,
  source          TEXT NOT NULL CHECK(source IN ('passive', 'probe')),
  unified_status  TEXT CHECK(unified_status IN ('allowed', 'rate_limited')),
  representative  TEXT CHECK(representative IN ('5h', '7d')),
  util_5h         REAL,
  reset_5h        INTEGER,
  status_5h       TEXT,
  util_7d         REAL,
  reset_7d        INTEGER,
  status_7d       TEXT,
  retry_after_s   INTEGER,
  cooldown_until  BIGINT,
  http_status     INTEGER
);
CREATE INDEX idx_load_latest ON subscription_load(subscription_id, sampled_at DESC);

-- Transient PKCE flow state for both auth levels (single-use).
CREATE TABLE pkce_sessions(
  session_id     TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK(kind IN ('login', 'subscription')),
  provider       TEXT NOT NULL,
  verifier       TEXT NOT NULL,
  nonce          TEXT,
  redirect_after TEXT,
  pool_kind      TEXT CHECK(pool_kind IN ('user', 'donor')),
  owner_user_id  TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL,
  consumed_at    TEXT
);
