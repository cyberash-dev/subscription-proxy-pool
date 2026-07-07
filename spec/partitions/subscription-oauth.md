# Partition — `spp-subscription-oauth`

## 1. Context

Level-2 subscription OAuth: PKCE begin/complete for linking a Claude Code
subscription, plus single-flight token refresh. Provider specifics live behind
the `SubscriptionOAuthProvider` port; Anthropic is implemented, OpenAI is a stub
seam.

## 2. Glossary

See [`../00-glossary.md`](../00-glossary.md).

## 3. Partition

```yaml
partition_id: spp-subscription-oauth
owner_team: subscription-proxy-pool
gate_scope:
  baseline-valid: "this file §4 + src/features/subscription-oauth/"
  spec-valid: this file + pol:POL-PROVIDER-001 + pol:POL-SECRET-001
  implementation-valid: src/features/subscription-oauth/tests/
dependencies_on_other_partitions: []
default_policy_set: [pol:POL-PROVIDER-001, pol:POL-SECRET-001]
debt_budget:
  unmodeled_count_at_phase1: 0
  target_per_pr: shrink >= 1
```

## 4. Brownfield baseline

```yaml
discovery_scope:
  entrypoints:
    http_routes: [POST /api/subscriptions/login]
  datasets: [pkce_sessions, subscriptions]
  flags: []
  freshness_token: pending
unmodeled: []
```

## 5. Surfaces

- `spp-mgmt-http@1` (subscription-login route).

## 6. Requirements

```yaml
- id: spp-subscription-oauth:BEH-001
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A supported provider and pool context.
  when: beginLink({provider, poolKind, ownerUserId?}) is called.
  then: A single-use PKCE session is persisted and a provider authorize URL with a code challenge is returned.
  negative_cases:
    - "user pool without an owner → invalid_request_error"
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: [pol:POL-PROVIDER-001]
  test_obligations: [to:spp-subscription-oauth:BEH-001:begin]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:33.240Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-subscription-oauth:BEH-002
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: An unconsumed link session.
  when: completeLink({state, code}) is called.
  then: The code is exchanged for a grant and returned with the pool context; the link session is single-use.
  negative_cases:
    - "reused link state → invalid_request_error"
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: single_use_state,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-subscription-oauth:BEH-002:complete]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:33.561Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-subscription-oauth:BEH-003
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A stored subscription with a near-expiry or invalid access token.
  when: TokenManager.ensureFresh / refreshNow is called.
  then: The token is refreshed via the provider and persisted; concurrent refreshers for one subscription coalesce to a single token request (single-flight); a refresh failure marks the subscription unusable.
  concurrency_model:
    {
      actor_concurrency: single_writer,
      read_consistency: read_committed,
      idempotency: single_flight,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: [pol:POL-SECRET-001]
  test_obligations: [to:spp-subscription-oauth:BEH-003:refresh]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:33.916Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-subscription-oauth:BEH-004
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: The OpenAI provider seam.
  when: any OpenAI provider operation is invoked.
  then: It returns a typed provider_not_implemented through the same port shape as Anthropic, without a partial call or leak.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: not_applicable,
      idempotency: not_applicable,
      time_source: not_applicable,
    }
  data_scope: all_data
  policy_refs: [pol:POL-PROVIDER-001]
  test_obligations: [to:spp-subscription-oauth:BEH-004:not_implemented]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:34.264Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

```yaml
---
id: spp-subscription-oauth:BEH-005
template: Behavior
lifecycle.status: approved
version: 1
applicability: { axis_invariant: true }
given: A SubscriptionOAuthProvider and a freshly exchanged access token.
when: verifyCredentials(accessToken) is called.
then: The provider performs one minimal authenticated request to its inference upstream and classifies the credential — valid on 2xx or 429 or 529 (authenticated; quota is not asserted), invalid on 401 or 403, inconclusive otherwise (network failure, timeout, or any other status).
concurrency_model:
  {
    actor_concurrency: multi_global,
    read_consistency: read_committed,
    idempotency: not_applicable,
    time_source: wall_clock,
  }
data_scope: all_data
policy_refs: [pol:POL-PROVIDER-001]
test_obligations: [to:spp-subscription-oauth:BEH-005:classify]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T22:56:44.030Z
  change_request: approve landed proxy/egress/oauth-verify spec (implemented + @covers-tested)
  scope: first-time-approval
---
```

```yaml
---
id: spp-subscription-oauth:DLT-001
template: Delta
lifecycle.status: approved
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "completeLink verifies the freshly exchanged credentials via provider.verifyCredentials before returning a grant. On invalid (401/403) it aborts with subscription_credentials_invalid; on inconclusive it retries a bounded number of times and, if still inconclusive, aborts with subscription_verification_unavailable. A grant is returned only when verification is valid, so an unusable subscription is never created."
compatibility_action: reject
tests_old_behavior: "completeLink returned a grant for any successfully exchanged authorization code."
tests_new_behavior: "completeLink returns a grant only when verifyCredentials is valid; a 401/403 upstream aborts with subscription_credentials_invalid and no subscription is added; exhausted inconclusive aborts with subscription_verification_unavailable."
test_obligations: [to:spp-subscription-oauth:DLT-001:verify_gates_link]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T22:56:44.098Z
  change_request: approve landed proxy/egress/oauth-verify spec (implemented + @covers-tested)
  scope: first-time-approval
---
```

```yaml
---
id: spp-subscription-oauth:DLT-002
template: Delta
lifecycle.status: approved
version: 1
baseline_version: spp:BL-001
kind: contract_change
applicability: { axis_invariant: true }
statement: "Resolves OQ-001 against the live Claude Code OAuth endpoint: the token endpoint expects a JSON body (Content-Type application/json), not application/x-www-form-urlencoded, and the authorization-code exchange must forward the state parsed from the pasted code#state. exchangeCode and refresh now POST JSON; exchangeCode sends grant_type, code, state, redirect_uri, client_id and code_verifier. This corrects CNST-001, which described the exchange as form-urlencoded."
compatibility_action: reject
tests_old_behavior: "exchange/refresh POSTed application/x-www-form-urlencoded and dropped state, which the live endpoint rejects with 400."
tests_new_behavior: "exchange POSTs an application/json body carrying code and the state forwarded from code#state plus code_verifier; the fake token endpoint records a JSON content-type and both fields."
test_obligations: [to:spp-subscription-oauth:DLT-002:json_exchange]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T22:56:44.167Z
  change_request: approve landed proxy/egress/oauth-verify spec (implemented + @covers-tested)
  scope: first-time-approval
---
```

## 7. Data contracts

```yaml
- id: spp-subscription-oauth:CNT-001
  template: Contract
  lifecycle.status: approved
  version: 1
  surface_ref: not_applicable
  applicability: { axis_invariant: true }
  schema:
    request: "SubscriptionOAuthProvider.{buildAuthorizeUrl, exchangeCode, refresh}"
    response: "OAuthGrant{accessToken, refreshToken, expiresAt, scopes}; identical port shape across providers"
  external_identifiers: [providerId]
  preconditions: "registry selects the provider by id"
  postconditions: "callers never branch on provider internals"
  error_taxonomy: "provider_not_implemented for unimplemented providers"
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: not_applicable,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: [pol:POL-PROVIDER-001]
  test_obligations: [to:spp-subscription-oauth:CNT-001:port_shape]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:34.606Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 8. Invariants

`none`.

## 9. External dependencies

```yaml
- id: spp-subscription-oauth:EXT-001
  template: ExternalDependency
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  provider: Anthropic OAuth (Claude Code)
  surface: "authorize + token endpoints; public client id; x-www-form-urlencoded exchange/refresh"
  failure_modes: "endpoint drift; token/refresh rotation; scope binding to the Claude Code client"
  policy_refs: [pol:POL-PROVIDER-001]
  test_obligations: [to:spp-subscription-oauth:EXT-001:faked_endpoint]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:35.023Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 10. Generated artifacts

`none`.

## 11. Localization

`none`.

## 12. Policies

`default_policy_set: [pol:POL-PROVIDER-001, pol:POL-SECRET-001]`.

## 13. Constraints

```yaml
- id: spp-subscription-oauth:CNST-001
  template: Constraint
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  statement: "Anthropic exchange and refresh are application/x-www-form-urlencoded POSTs using the fixed public Claude Code client id and scopes (org:create_api_key user:profile user:inference)."
  rationale: "Matches the Claude Code OAuth flow so subscription grants are accepted for inference."
  test_obligations: [to:spp-subscription-oauth:CNST-001:form_encoded]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:35.389Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 14. Migrations

`none`.

## 15. Deltas

`none`.

## 16. Implementation bindings

`none`.

## 17. Open questions

- `oq:spp-subscription-oauth-live` — exact Anthropic token endpoint URL, redirect
  URI, and whether the pasted code carries the state are unverified live; wire
  tests run against a faked endpoint, one manual live login validates the flow.

## 18. Assumptions

`none`.

## 19. Out of scope

The OpenAI OAuth flow itself (seam only in M1).
