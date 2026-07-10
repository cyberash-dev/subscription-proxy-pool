# Partition — `spp-proxy`

## 1. Context

The Anthropic-compatible inference surface for Claude Code. Authenticates the
proxy key, derives the subscription provider from the model, routes to the
principal's provider-specific pool, and relays the provider response. Anthropic
requests retain direct forwarding with the Claude Code identity and beta
headers. OpenAI requests go through the configured OpenAI bridge with a fresh
OpenAI subscription credential. A 401 triggers one refresh+retry;
429/5xx/refresh-failure fail over within the selected provider.

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
  flags: [SPP_PROXY_PORT, SPP_ANTHROPIC_BASE_URL, SPP_OPENAI_BRIDGE_BASE_URL]
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

```yaml
---
id: spp-proxy:BEH-006
template: Behavior
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-10T22:06:46.325Z
  change_request: "spp: model-based provider routing + OpenAI bridge"
  scope: provider-routing
version: 1
applicability: { axis_invariant: true }
given: "An authenticated inference request whose body contains a model identifier."
when: "The proxy selects a subscription for the request."
then: "A model beginning with gpt- or codex-, or matching o<digits> followed by end-of-string or -, selects provider=openai; every other model value selects provider=anthropic. Every retry and failover for the request stays inside that provider and the principal's pool."
negative_cases:
  - "no eligible subscription for the selected provider -> 503 overloaded_error; the proxy does not fall back to the other provider"
out_of_scope: "runtime model catalogs and cross-provider failover"
concurrency_model:
  {
    actor_concurrency: multi_global,
    read_consistency: read_committed,
    idempotency: not_applicable,
    time_source: wall_clock,
  }
data_scope: all_data
policy_refs: [pol:POL-AUTH-001, pol:POL-PROVIDER-001]
test_obligations:
  [
    to:spp-proxy:BEH-006:model_routes_provider,
    to:spp-proxy:BEH-006:no_cross_provider_fallback,
  ]
---
```

```yaml
---
id: spp-proxy:BEH-007
template: Behavior
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-10T22:06:46.392Z
  change_request: "spp: model-based provider routing + OpenAI bridge"
  scope: provider-routing
version: 1
applicability: { axis_invariant: true }
given: "A request classified as provider=openai and an OpenAI subscription selected from the principal's pool."
when: "The proxy forwards one attempt."
then: "The proxy obtains a fresh access token, derives ChatGPT-Account-ID from the token claim https://api.openai.com/auth.chatgpt_account_id, sends the original Anthropic Messages JSON body without Claude identity injection to the configured OpenAI bridge path, and relays the bridge status, safe response headers, and body."
negative_cases:
  - "bridge 401 -> refresh once on the same OpenAI subscription, then fail over to another OpenAI subscription after a second 401"
  - "bridge 429, 529, or 5xx before relay -> record the available cooldown metadata and fail over to another OpenAI subscription"
  - "POST /v1/messages/count_tokens for an OpenAI model -> relay the bridge response; bridge version 1 returns 404 not_found_error"
out_of_scope: "translation inside SPP, OpenAI active probing, and retry after downstream response commitment"
concurrency_model:
  {
    actor_concurrency: multi_global,
    read_consistency: read_committed,
    idempotency: not_applicable,
    time_source: wall_clock,
  }
data_scope: all_data
policy_refs: [pol:POL-AUTH-001, pol:POL-PROVIDER-001, pol:POL-SECRET-001]
test_obligations:
  [
    to:spp-proxy:BEH-007:bridge_forward,
    to:spp-proxy:BEH-007:bridge_refresh_failover,
  ]
---
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

```yaml
---
id: spp-proxy:CNT-002
template: Contract
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-10T22:06:46.464Z
  change_request: "spp: model-based provider routing + OpenAI bridge"
  scope: provider-routing
version: 1
surface_ref: not_applicable
applicability: { axis_invariant: true }
schema:
  config: "SPP_OPENAI_BRIDGE_BASE_URL, default http://127.0.0.1:8080"
  request: "POST <bridge_base><original_path>; Authorization: Bearer <openai_access_token>; ChatGPT-Account-ID: <account_id>; Content-Type: application/json; Accept: text/event-stream when stream=true and application/json otherwise; body is the original Anthropic Messages JSON"
  response: "Anthropic-compatible status, safe headers, SSE, JSON, or error envelope relayed by SPP"
external_identifiers:
  [
    SPP_OPENAI_BRIDGE_BASE_URL,
    Authorization,
    ChatGPT-Account-ID,
    Content-Type,
    Accept,
  ]
preconditions: "The selected subscription has provider=openai and its fresh access token contains a non-empty ChatGPT account identifier."
postconditions: "The caller proxy key, x-api-key, anthropic-version, anthropic-beta, refresh token, and arbitrary inbound headers are absent from the bridge request."
compatibility_rules: "The bridge base URL comes only from process configuration and cannot be selected by an inbound request."
error_taxonomy: "bridge HTTP errors are relayed through the existing Anthropic-compatible proxy contract; bridge transport errors do not expose credentials"
concurrency_model:
  {
    actor_concurrency: multi_global,
    read_consistency: read_committed,
    idempotency: not_applicable,
    time_source: wall_clock,
  }
data_scope: all_data
policy_refs: [pol:POL-AUTH-001, pol:POL-PROVIDER-001, pol:POL-SECRET-001]
test_obligations:
  [to:spp-proxy:CNT-002:bridge_headers, to:spp-proxy:CNT-002:configured_url]
---
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
id: spp-proxy:INV-003
template: Invariant
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-10T22:06:46.533Z
  change_request: "spp: model-based provider routing + OpenAI bridge"
  scope: provider-routing
version: 1
applicability: { axis_invariant: true }
predicate: "An OpenAI-family model uses only an OpenAI subscription and the configured OpenAI bridge; every other model uses only an Anthropic subscription and the Anthropic upstream. The inbound proxy key and every subscription refresh token reach neither upstream."
evidence: public_api
stability: contractual
data_scope: all_data
policy_refs: [pol:POL-AUTH-001, pol:POL-PROVIDER-001, pol:POL-SECRET-001]
test_obligations: [to:spp-proxy:INV-003:provider_isolation]
---
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
id: spp-proxy:EXT-002
template: ExternalDependency
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-10T22:06:46.601Z
  change_request: "spp: model-based provider routing + OpenAI bridge"
  scope: provider-routing
version: 1
applicability: { axis_invariant: true }
provider: dumb-codex-oai-proxy
provider_surface@version: "anthropic-messages-http@1.0.0"
authority_url_or_doc: "dumb-codex-oai-proxy/spec/proxy.md, proxy:SURF-001 and proxy:CNT-001"
consumer_contract: "POST /v1/messages with one OpenAI Bearer, ChatGPT-Account-ID, JSON Anthropic Messages body, and stream-dependent Accept; consume an Anthropic-compatible SSE, JSON, or error response. POST /v1/messages/count_tokens is unsupported by bridge version 1 and returns 404."
drift_detection:
  mechanism: contract_test_against_sandbox
last_verified_at: 2026-07-10
auth_scope: "one request-scoped OpenAI subscription access token and ChatGPT account identifier"
rate_limits: "429 preserves Retry-After for SPP cooldown and failover"
retry/idempotency: "SPP owns one refresh retry after 401 and bounded provider-local failover; the bridge performs no retry"
error_taxonomy: "bridge preserves 401, 403, 429, and 5xx; bridge transport failure to OpenAI becomes 502 and timeout becomes 504"
sandbox_or_fixture: "loopback HTTP bridge fixture asserting the exact request and returning Anthropic-compatible stream and JSON fixtures"
policy_refs: [pol:POL-PROVIDER-001, pol:POL-SECRET-001]
test_obligations: [to:spp-proxy:EXT-002:bridge_contract]
---
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
lifecycle.status: removed
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "The upstream body preparation drops the client-supplied context_management field before forwarding. The pooled Anthropic endpoint rejects context_management with 400 invalid_request (Extra inputs are not permitted) because the proxy sends a fixed anthropic-beta that does not enable it; stripping the field keeps forwarded requests valid. The spp-proxy:BEH-002 system-identity preparation and every other body field are unchanged. Clients may still send context_management to the proxy (inbound contract unchanged) and it is silently ignored, so spp-proxy-http:SURF-001 is not bumped."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "the prepared upstream body forwarded the client context_management field verbatim."
tests_new_behavior: "the prepared upstream body omits context_management; model, messages and the injected system block are unchanged."
test_obligations: [to:spp-proxy:DLT-002:strips_context_management]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-08T20:56:48.914Z
  change_request: "retired: fixed by DLT-003/DLT-004"
  scope: first-time-approval
---
```

```yaml
---
id: spp-proxy:DLT-003
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-08T20:56:48.756Z
  change_request: forward client anthropic-beta (restore prompt-cache TTL)
  scope: first-time-approval
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "The upstream anthropic-beta header is the ordered union of the mandatory oauth-2025-04-20 and claude-code-20250219 tokens followed by every distinct beta token the client sent on its inbound anthropic-beta header. Previously the proxy sent a fixed anthropic-beta and discarded the client's, which suppressed client capability flags: notably extended-cache-ttl (collapsing the prompt-cache TTL to the 5-minute default so cross-turn requests miss the cache and re-pay the full cache-write prefix) and context-management. The mandatory tokens are always present and duplicates are removed. spp-proxy:BEH-004 and spp-proxy:INV-001 hold unchanged: the forwarded header set is still Authorization, anthropic-version and anthropic-beta with no x-api-key. The inbound request contract is unchanged (anthropic-beta was already an accepted passthrough header, previously ignored), so spp-proxy-http:SURF-001 is not bumped."
compatibility_action: ignore
tests_old_behavior: "the upstream anthropic-beta was the fixed string oauth-2025-04-20,claude-code-20250219 regardless of the client's inbound anthropic-beta header."
tests_new_behavior: "the upstream anthropic-beta carries the mandatory tokens plus the client's extra beta tokens with no duplicates; a request with no inbound anthropic-beta still carries exactly the mandatory tokens."
test_obligations:
  [
    to:spp-proxy:DLT-003:merges_client_beta,
    to:spp-proxy:DLT-003:mandatory_without_client_beta,
  ]
---
```

```yaml
---
id: spp-proxy:DLT-004
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-08T20:56:48.841Z
  change_request: forward context_management verbatim (supersedes DLT-002)
  scope: first-time-approval
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "The upstream body preparation forwards the client's context_management field verbatim instead of dropping it. This supersedes spp-proxy:DLT-002, which stripped the field because the fixed anthropic-beta did not enable it and the pooled Anthropic endpoint answered 400 invalid_request (Extra inputs are not permitted). spp-proxy:DLT-003 now forwards the client's context-management beta, so the endpoint accepts the field and Anthropic's server-side context editing stays active, which stops long tool-heavy sessions from re-billing the full transcript every turn. The spp-proxy:BEH-002 identity preparation and every other body field are unchanged. spp-proxy:DLT-002 is retired to removed with this Delta as its replacement."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "the prepared upstream body omitted context_management (spp-proxy:DLT-002)."
tests_new_behavior: "the prepared upstream body forwards context_management verbatim; model, messages and the injected identity system block are unchanged."
test_obligations: [to:spp-proxy:DLT-004:forwards_context_management]
---
```

```yaml
---
id: spp-proxy:DLT-005
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-10T22:06:46.669Z
  change_request: "spp: model-based provider routing + OpenAI bridge"
  scope: provider-routing
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "The inference proxy changes from an Anthropic-only upstream to model-based provider routing. spp-proxy:BEH-001, spp-proxy:BEH-002, and spp-proxy:BEH-004 remain the Anthropic branch; spp-proxy:BEH-006 and spp-proxy:BEH-007 add the OpenAI branch. spp-proxy:INV-001 is superseded by spp-proxy:INV-003 because the exact outbound header predicate becomes provider-dependent. The inbound paths, proxy-key authentication, Anthropic Messages request shape, Anthropic-compatible response shape, lease lifetime, refresh-on-401, and bounded failover remain unchanged. The predicate change to a contractual invariant referenced by spp-proxy-http:SURF-001 requires a major surface bump from 1.1.0 to 2.0.0."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "Every model selected provider=anthropic, received Claude identity preparation, and was sent directly to the Anthropic upstream with Anthropic headers."
tests_new_behavior: "OpenAI model families select only provider=openai and are sent unchanged to the configured bridge with the selected OpenAI Bearer and account identifier; all other model values retain the Anthropic route and no request crosses provider pools."
test_obligations:
  [
    to:spp-proxy:DLT-005:openai_route,
    to:spp-proxy:DLT-005:anthropic_compatibility,
    to:spp-proxy:DLT-005:provider_isolation,
  ]
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
