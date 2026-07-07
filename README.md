# subscription-proxy-pool

Pools AI-subscription OAuth credentials and exposes an **Anthropic-compatible
HTTP proxy** for Claude Code. It auto-selects the least-loaded, non-rate-limited
subscription per request, supports per-user and shared "donor" pools, and runs a
two-level authorization model.

Standalone Node 20+ / TypeScript service. SQLite by default; PostgreSQL supported.

## Two-level authorization

| Level              | Credential                        | Where                        |
| ------------------ | --------------------------------- | ---------------------------- |
| **L1 — identity**  | OIDC session bearer               | management API `/api/*`      |
| **L2 — inference** | subscription OAuth grant (stored) | forwarded to Anthropic       |
| **Caller**         | proxy key bearer                  | inference API `/v1/messages` |

- **L1**: a user logs in via social OIDC (Microsoft/Google/… — any OIDC issuer by
  config) to work with the pool. Social tokens are used only to verify identity
  and are never stored.
- **L2**: the user links their Claude Code subscription (OAuth, PKCE). The grant
  is stored and refreshed (single-flight) and pays for inference.
- **Proxy key**: issued under an L1 session; it is what Claude Code presents.
  The key alone decides the user and the pool (`own` or `donor`) — no header
  chooses the pool.

## Quick start

```sh
npm install
export SPP_TOKEN_CRYPT_KEYS="1:$(openssl rand -base64 32)"   # required: token-encryption key (persist it)
npm run migrate                      # create the SQLite schema (0600)
npm run serve                        # start both HTTP surfaces + optional prober
```

`SPP_TOKEN_CRYPT_KEYS` is mandatory: it encrypts subscription tokens at rest.
Store it outside the DB and reuse the same value across restarts, otherwise
stored tokens can no longer be decrypted.

Bootstrap a user + proxy key via the admin CLI (or use the OIDC flow):

```sh
npm run cli -- admin user-create --handle alice        # prints user_id
npm run cli -- admin key-issue --user <user_id> --pool own   # prints the proxy key (once)
```

Point Claude Code at the proxy:

```sh
export ANTHROPIC_BASE_URL=http://127.0.0.1:8788
export ANTHROPIC_AUTH_TOKEN=<proxy_key>
```

## HTTP surfaces

**Inference (`SPP_PROXY_PORT`, default 8788)** — `spp-proxy-http@1`

- `POST /v1/messages` — Anthropic Messages, streaming SSE passthrough.
- `POST /v1/messages/count_tokens`
- `GET /health`

**Management (`SPP_MGMT_PORT`, default 8789)** — `spp-mgmt-http@1`

- `GET /auth/login/:provider` → 302 to the OIDC authorize URL.
- `GET /auth/callback` → mints a session (`{ session_token, user_id, expires_at }`).
- `POST|GET /api/keys`, `DELETE /api/keys/:id` — proxy-key management.
- `POST /api/subscriptions/login` + `POST /api/subscriptions/complete` — link a subscription.
- `GET /api/subscriptions`, `PATCH /api/subscriptions/:id` — list / disable.
- `GET /api/pools` — per-pool subscriptions with utilization + fence state.

All `/api/*` require the session bearer. The session and the proxy key are not
interchangeable.

## How selection + load work

- Every proxied response's `anthropic-ratelimit-unified-*` headers are harvested
  into a per-subscription load snapshot (passive, free).
- Selection picks the eligible subscription with the lowest representative-window
  utilization, biased by in-flight count; it fences anything rate-limited, in
  cooldown, or near-full.
- On `401` the token is refreshed once and retried; on `429`/`5xx`/refresh
  failure the request fails over to the next-least-loaded subscription.
- An optional in-process prober (`SPP_PROBE_ENABLED=true`) refreshes idle
  subscriptions' load with a cheap Haiku request.

## Configuration (env)

| Var                                                                   | Default                      | Purpose                                                         |
| --------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| `SPP_HOME`                                                            | `~/.subscription-proxy-pool` | data dir                                                        |
| `SPP_TOKEN_CRYPT_KEYS`                                                | — (required)                 | token-encryption key ring `<id>:<base64-32B>` (comma-separated) |
| `SPP_LISTEN_ADDR`                                                     | `127.0.0.1`                  | bind address                                                    |
| `SPP_PROXY_PORT` / `SPP_MGMT_PORT`                                    | 8788 / 8789                  | listen ports                                                    |
| `SPP_PUBLIC_URL`                                                      | `http://127.0.0.1:8789`      | OIDC callback base                                              |
| `SPP_ANTHROPIC_BASE_URL`                                              | `https://api.anthropic.com`  | upstream                                                        |
| `SPP_EGRESS_PROXY`                                                    | `HTTPS_PROXY`                | outbound forward proxy for upstream calls                       |
| `SPP_ENGINE` / `SPP_PG_URL` / `SPP_PG_POOL_MAX`                       | `sqlite`                     | storage backend                                                 |
| `SPP_DB_FILE_MODE`                                                    | `0600`                       | DB file mode                                                    |
| `SPP_SESSION_TTL_MS`                                                  | 7d                           | session lifetime                                                |
| `SPP_PROBE_ENABLED` / `SPP_PROBE_PERIOD_MS` / `SPP_IDLE_THRESHOLD_MS` | off / 60s / 120s             | active prober                                                   |
| `SPP_OIDC_<NAME>_{ISSUER,CLIENT_ID,CLIENT_SECRET,SCOPES}`             | —                            | an L1 identity provider                                         |
| `SPP_CONFIG`                                                          | —                            | config-module path                                              |

The `SPP_CONFIG` module's default export (`SppConfigModule`) may expose
`identityProviders()` and `database(): EngineConfig`. When `database()` is
present it selects the storage engine, overriding `SPP_ENGINE` / `SPP_PG_URL`;
without it, engine selection falls back to those env vars.

## Architecture

Hexagonal vertical slices under `src/features/`: `auth` (L1 OIDC),
`access-keys` (proxy keys), `subscription-oauth` (L2 Anthropic/OpenAI + token
refresh), `subscriptions` (pool store), `load-monitor`, `pool-selection`,
`proxy`. Cross-cutting kernel in `src/shared/` (`db` Engine port, `pkce`,
`oidc`, `anthropic`, `http`). Composition root in `src/infrastructure/`.

## Testing

Inline JSON-result runners on `tsx` (no Jest/Vitest):

```sh
npm test     # runs every suite via tests/run-all.ts
npm run tsc  # strict typecheck
```

## Spec-driven development

The `spec/` tree is the source of truth (`.sdd/config.json`). Normative IDs land
`proposed`; a non-agent reviewer promotes them with `sdd approve` + `sdd finalize`.

```sh
npm run sdd:lint    # spec-valid gate (must be 0)
npm run sdd:ready   # implementation-valid gate (proposed IDs show as [unapproved] until reviewed)
```

Every behaviour is covered by a test carrying `@covers <partition>:<id>`.

> **Note on terms of service:** using Claude subscription OAuth credentials
> outside the official client is a gray area of Anthropic's ToS. Operate within
> your authorization.

## License

[MIT](./LICENSE) © cyberash
