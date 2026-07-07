# Surface — `spp-proxy-http@1`

The Anthropic-compatible inference HTTP surface consumed by Claude Code
(`ANTHROPIC_BASE_URL` → this proxy, `ANTHROPIC_AUTH_TOKEN` → a proxy key).

```yaml
id: spp-proxy-http:SURF-001
template: Surface
lifecycle.status: approved
version: 1
name: spp-proxy-http
semver: 1.1.0
boundary_type: api
applicability: { axis_invariant: true }
auth: "Authorization: Bearer <proxy_key>"
members:
  - spp-proxy:CNT-001
  - spp-proxy:BEH-001
  - spp-proxy:INV-001
concurrency_model:
  {
    actor_concurrency: multi_global,
    read_consistency: read_committed,
    idempotency: not_applicable,
    time_source: wall_clock,
  }
test_obligations: [to:spp-proxy-http:SURF-001:routes]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-04T14:48:38.773Z
  change_request: "subscription-proxy-pool: first-time approval"
  scope: first-time-approval
```

## Members

- `POST /v1/messages` — Anthropic Messages, streaming SSE passthrough.
- `POST /v1/messages/count_tokens` — token counting passthrough.
- `GET /health` — liveness `{ status: "ok" }`, no auth.

Errors use the Anthropic envelope `{ "type": "error", "error": { "type", "message" } }`.
