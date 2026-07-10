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

```yaml
---
id: spp-proxy-http:DLT-001
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-10T22:06:46.737Z
  change_request: "spp: model-based provider routing + OpenAI bridge"
  scope: provider-routing
version: 1
baseline_version: spp:BL-001
kind: contract_change
applicability: { axis_invariant: true }
statement: "spp-proxy-http:SURF-001 retains its inbound paths, proxy-key authentication, Anthropic Messages request schema, and Anthropic-compatible response schema. It adds successful handling for OpenAI model families through spp-proxy:BEH-006, spp-proxy:BEH-007, spp-proxy:CNT-002, and spp-proxy:INV-003. Because spp-proxy:INV-001 had a contractual always-Anthropic header predicate and the replacement predicate is provider-dependent, the surface version changes from 1.1.0 to 2.0.0."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "Every accepted model was forwarded as an Anthropic subscription request."
tests_new_behavior: "OpenAI model families use only OpenAI subscriptions through the configured bridge; the existing Anthropic route remains byte-compatible for all other model values."
test_obligations:
  [
    to:spp-proxy-http:DLT-001:openai_route,
    to:spp-proxy-http:DLT-001:anthropic_compatibility,
  ]
---
```
