# Partition — `spp-proxy`

## 1. Context

The Anthropic-compatible inference surface for Claude Code. Authenticates the
proxy key, routes to the principal's pool, injects the pooled subscription's
Bearer + beta headers and the Claude Code identity, forwards to Anthropic,
harvests rate-limit headers, and relays (streaming) the response. A 401 triggers
one refresh+retry; 429/5xx/refresh-failure fail over to the next subscription.

## 2. Glossary

See [`../00-glossary.md`](../00-glossary.md).

## 3. Partition

```yaml
partition_id: spp-proxy
owner_team: subscription-proxy-pool
gate_scope:
  baseline-valid: "this file §4 + src/features/proxy/"
  spec-valid: this file + pol:POL-AUTH-001 + pol:POL-PROVIDER-001
  implementation-valid: src/features/proxy/tests/
dependencies_on_other_partitions:
  - "spp-access-keys@1     # resolvePrincipal"
  - "spp-pool-selection@1  # select"
  - "spp-subscription-oauth@1 # token refresh"
  - "spp-load-monitor@1    # passive harvest"
default_policy_set: [pol:POL-AUTH-001, pol:POL-PROVIDER-001]
debt_budget:
  unmodeled_count_at_phase1: 0
  target_per_pr: shrink >= 1
```

## 4. Brownfield baseline

```yaml
discovery_scope:
  entrypoints:
    http_routes:
      [POST /v1/messages, POST /v1/messages/count_tokens, GET /health]
  datasets: []
  flags: [SPP_PROXY_PORT, SPP_ANTHROPIC_BASE_URL]
  freshness_token: pending
unmodeled: []
```

## 5. Surfaces

- `spp-proxy-http@1` (the inference HTTP surface).

## 6. Requirements

```yaml
- id: spp-proxy:BEH-001
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A POST /v1/messages with a proxy-key bearer.
  when: the proxy handles it.
  then: The principal is resolved, the least-loaded subscription in the principal's pool is selected, the request is forwarded to Anthropic with the subscription's Bearer, and the upstream response is relayed (streaming) unchanged.
  negative_cases:
    - "missing or unknown proxy key → 401 authentication_error"
    - "empty or fully-fenced pool → 503 overloaded_error with retry-after"
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: [pol:POL-AUTH-001]
  test_obligations:
    [to:spp-proxy:BEH-001:forward, to:spp-proxy:BEH-001:no_capacity]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:30.887Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-proxy:BEH-002
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A request whose model is not Haiku.
  when: the body is prepared for the upstream.
  then: The `system` field is made to begin with the exact Claude Code identity block (prepended if absent); Haiku requests are left untouched.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: not_applicable,
      idempotency: not_applicable,
      time_source: not_applicable,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-proxy:BEH-002:identity_block]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:31.223Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-proxy:BEH-003
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: An upstream 401 on the first forward.
  when: the proxy handles it.
  then: The subscription token is refreshed once and the request is retried on the same subscription; a second 401 or a refresh failure fails over to the next-least-loaded subscription.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-proxy:BEH-003:refresh_retry]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:31.559Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-proxy:BEH-004
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A client request carrying an x-api-key or Authorization header.
  when: the upstream request is built.
  then: The client credential is dropped; only the pooled subscription's Bearer, anthropic-version and anthropic-beta are sent; x-api-key is never forwarded.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: not_applicable,
      idempotency: not_applicable,
      time_source: not_applicable,
    }
  data_scope: all_data
  policy_refs: [pol:POL-AUTH-001]
  test_obligations: [to:spp-proxy:BEH-004:header_hygiene]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:31.909Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 7. Data contracts

```yaml
- id: spp-proxy:CNT-001
  template: Contract
  lifecycle.status: approved
  version: 1
  surface_ref: spp-proxy-http@1
  applicability: { axis_invariant: true }
  schema:
    request: "POST /v1/messages (Anthropic Messages request), Authorization: Bearer <proxy_key>"
    response: "relayed Anthropic response (SSE passthrough when stream=true); error envelope {type:error, error:{type,message}}"
  external_identifiers:
    [POST /v1/messages, POST /v1/messages/count_tokens, GET /health]
  preconditions: "Authorization carries a valid proxy key"
  postconditions: "upstream status and body relayed; hop-by-hop headers stripped"
  error_taxonomy: "authentication_error(401) | invalid_request_error(400/413) | not_found_error(404) | overloaded_error(503)"
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: [pol:POL-AUTH-001]
  test_obligations: [to:spp-proxy:CNT-001:streaming_passthrough]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:32.240Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 8. Invariants

```yaml
- id: spp-proxy:INV-001
  template: Invariant
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  predicate: "Every forwarded upstream request carries exactly Authorization: Bearer <access_token>, anthropic-version and anthropic-beta, and no x-api-key; the pool used is bound to the proxy key, not any request header."
  evidence: public_api
  stability: contractual
  data_scope: all_data
  policy_refs: [pol:POL-AUTH-001]
  test_obligations: [to:spp-proxy:INV-001:header_set]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:32.559Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

```yaml
---
id: spp-proxy:INV-002
template: Invariant
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-07T16:13:42.382Z
  change_request: guard proxy against double writeHead on mid-stream upstream failure (ERR_HTTP_HEADERS_SENT crash)
  scope: first-time-approval
version: 1
applicability: { axis_invariant: true }
predicate: "When the upstream response body fails after the client response headers have been committed (writeHead already issued), the proxy never issues a second writeHead or error envelope on that response; it terminates the client connection and the server process stays alive to serve other requests."
evidence: test_probe
stability: internal
data_scope: all_data
policy_refs: []
test_obligations: [to:spp-proxy:INV-002:mid_stream_failure_no_double_write]
---
```

## 9. External dependencies

```yaml
- id: spp-proxy:EXT-001
  template: ExternalDependency
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  provider: Anthropic Messages API (OAuth)
  surface: "POST /v1/messages with Bearer + anthropic-version + anthropic-beta; non-Haiku models require the Claude Code identity system block"
  failure_modes: "generic 400 without the identity block; 401 on expired token; 429 with unified rate-limit headers; 529 overloaded"
  policy_refs: [pol:POL-PROVIDER-001]
  test_obligations: [to:spp-proxy:EXT-001:stub_upstream]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:32.907Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

```yaml
---
id: spp-proxy:BEH-005
template: Behavior
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T22:56:44.234Z
  change_request: approve landed proxy/egress/oauth-verify spec (implemented + @covers-tested)
  scope: first-time-approval
version: 1
applicability: { axis_invariant: true }
given: The service is configured with an egress forward-proxy (SPP_EGRESS_PROXY, or the standard HTTPS_PROXY, is set) and the deployment has no direct external route.
when: it makes any outbound HTTP request to an external provider (the Anthropic relay, an OAuth token exchange, or credential verification).
then: The request is tunneled through the configured HTTP CONNECT forward-proxy; TLS stays end-to-end so the outbound Authorization Bearer is unchanged; a destination host matching NO_PROXY bypasses the proxy and connects directly.
negative_cases:
  - "no egress proxy configured → the global fetch dispatcher is left untouched and outbound requests connect directly"
  - "destination host in NO_PROXY → the request bypasses the forward-proxy"
concurrency_model:
  {
    actor_concurrency: multi_global,
    read_consistency: read_committed,
    idempotency: not_applicable,
    time_source: wall_clock,
  }
data_scope: all_data
policy_refs: [pol:POL-PROVIDER-001]
test_obligations: [to:spp-proxy:BEH-005:routes_via_connect_proxy]
---
```

```yaml
---
id: spp-proxy:DLT-001
template: Delta
lifecycle.status: approved
version: 1
baseline_version: spp:BL-001
kind: contract_change
applicability: { axis_invariant: true }
statement: "The response relay drops content-encoding and content-length in addition to hop-by-hop headers. The pool's upstream HTTP client (FetchUpstreamGateway over undici) transparently decompresses the response body, so forwarding the upstream content-encoding alongside an already-decompressed body makes the client decode plaintext as gzip and fail (ZlibError). Upstream status and body bytes are unchanged; only content-encoding and content-length are no longer forwarded. Refines the spp-proxy:CNT-001 postcondition -> spp-proxy-http minor bump 1.0.0 -> 1.1.0."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "filterResponseHeaders forwarded content-encoding and content-length verbatim; a gzip upstream response reached the client as content-encoding: gzip over an already-decompressed body."
tests_new_behavior: "filterResponseHeaders omits content-encoding and content-length; a gzip upstream response reaches the client with no content-encoding header and a body the client reads without a decompression error."
test_obligations: [to:spp-proxy:DLT-001:strips_content_encoding]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T12:45:03.818Z
  change_request: relay strips content-encoding/content-length (ZlibError fix)
  scope: first-time-approval
---
```

```yaml
---
id: spp-proxy:DLT-002
template: Delta
lifecycle.status: approved
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "The upstream body preparation drops the client-supplied context_management field before forwarding. The pooled Anthropic endpoint rejects context_management with 400 invalid_request (Extra inputs are not permitted) because the proxy sends a fixed anthropic-beta that does not enable it; stripping the field keeps forwarded requests valid. The spp-proxy:BEH-002 system-identity preparation and every other body field are unchanged. Clients may still send context_management to the proxy (inbound contract unchanged) and it is silently ignored, so spp-proxy-http:SURF-001 is not bumped."
compatibility_action: ignore
tests_old_behavior: "the prepared upstream body forwarded the client context_management field verbatim."
tests_new_behavior: "the prepared upstream body omits context_management; model, messages and the injected system block are unchanged."
test_obligations: [to:spp-proxy:DLT-002:strips_context_management]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T13:04:19.042Z
  change_request: strip context_management from upstream body (400 Extra inputs fix)
  scope: first-time-approval
---
```

## 10. Generated artifacts

`none`.

## 11. Localization

`none`.

## 12. Policies

`default_policy_set: [pol:POL-AUTH-001, pol:POL-PROVIDER-001]`.

## 13. Constraints

`none`.

## 14. Migrations

`none`.

## 15. Deltas

`none`.

## 16. Implementation bindings

`none`.

## 17. Open questions

- `oq:spp-proxy-mid-stream-401` — a 401 after SSE bytes are already relayed
  cannot be transparently retried; M1 rule: refresh-retry applies only before any
  byte is relayed.

## 18. Assumptions

`none`.

## 19. Out of scope

Proxying arbitrary upstream paths (unknown paths return 404).
