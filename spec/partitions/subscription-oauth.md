# Partition — `spp-subscription-oauth`

## 1. Context

Level-2 subscription authorization: PKCE begin/code/complete for linking
Anthropic and OpenAI subscriptions, plus single-flight token refresh. Provider
specifics live behind the `SubscriptionOAuthProvider` port.

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

```yaml
---
id: spp-subscription-oauth:EXT-002
template: ExternalDependency
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-09T21:11:36.675Z
  change_request: OpenAI subscription linking
  scope: first-time-approval
version: 1
applicability: { axis_invariant: true }
provider: OpenAI ChatGPT subscription authorization
surface: "browser authorization at https://auth.openai.com/oauth/authorize; authorization-code and refresh exchange at https://auth.openai.com/oauth/token; credential validation at https://auth.openai.com/api/accounts; public client app_EMoamEEZ73f0CkXaXp7hrann; scopes openid profile email offline_access"
failure_modes: "authorization parameter or endpoint drift; expired or reused link code; refresh-token rotation; account/workspace permission rejection; response missing access_token or refresh_token"
policy_refs: [pol:POL-PROVIDER-001, pol:POL-SECRET-001]
test_obligations: [to:spp-subscription-oauth:EXT-002:faked_openai_endpoints]
---
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

```yaml
---
id: spp-subscription-oauth:CNST-002
template: Constraint
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-09T21:11:47.879Z
  change_request: OpenAI subscription linking
  scope: first-time-approval
version: 1
applicability: { axis_invariant: true }
statement: "OpenAI linking uses Authorization Code with S256 PKCE through direct HTTP. The authorize URL carries response_type=code, client_id, redirect_uri=http://localhost:1455/auth/callback, scope=openid profile email offline_access, state, code_challenge, and code_challenge_method=S256. Code and refresh exchanges are application/x-www-form-urlencoded POSTs to the token endpoint with the same client_id; code exchange also sends redirect_uri and code_verifier."
rationale: "Matches the OpenAI browser-code subscription flow while preserving the proxy's existing begin-link and manual complete-link contract and avoiding a runtime dependency on Codex CLI."
test_obligations: [to:spp-subscription-oauth:CNST-002:openai_wire_shape]
---
```

## 14. Migrations

`none`.

## 15. Deltas

```yaml
---
id: spp-subscription-oauth:DLT-003
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-09T21:11:55.174Z
  change_request: OpenAI subscription linking
  scope: first-time-approval
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "OpenAI stops being a provider_not_implemented seam. beginLink for provider=openai returns an OpenAI browser authorization URL carrying the persisted state and S256 PKCE challenge. After the user authorizes and submits the resulting link code, completeLink exchanges that code directly with the OpenAI token endpoint, verifies the returned access token, and returns an OAuthGrant whose provider remains openai. refresh exchanges the stored refresh token directly with OpenAI. The service never invokes the codex executable and does not import Codex CLI state. Anthropic behavior and the SubscriptionOAuthProvider port shape are unchanged."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "Every OpenAI provider operation raised provider_not_implemented and no network request was attempted."
tests_new_behavior: "The OpenAI adapter builds a state-bound PKCE URL, exchanges a submitted code for access/refresh credentials, refreshes credentials with refresh_token, and performs all operations through injected HTTP against a fake OpenAI endpoint without spawning codex."
test_obligations:
  [
    to:spp-subscription-oauth:DLT-003:openai_begin,
    to:spp-subscription-oauth:DLT-003:openai_exchange,
    to:spp-subscription-oauth:DLT-003:openai_refresh,
    to:spp-subscription-oauth:DLT-003:direct_http_only,
  ]
---
```

```yaml
---
id: spp-subscription-oauth:DLT-004
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-09T21:12:01.496Z
  change_request: OpenAI subscription linking
  scope: first-time-approval
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "For provider=openai, verifyCredentials validates the freshly exchanged Bearer against the OpenAI accounts endpoint rather than an inference request: 2xx is valid, 401/403 is invalid, and network failure or any other status is inconclusive. Anthropic keeps its existing minimal inference verification. This specializes spp-subscription-oauth:BEH-005 without changing completeLink's valid/invalid/inconclusive gate."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "OpenAI verifyCredentials raised provider_not_implemented."
tests_new_behavior: "A fake OpenAI accounts endpoint proves the Bearer is sent only in Authorization and each status class maps to the existing CredentialVerdict taxonomy."
test_obligations: [to:spp-subscription-oauth:DLT-004:openai_verify]
---
```

```yaml
---
id: spp-subscription-oauth:DLT-005
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-09T22:21:04.959Z
  change_request: Fix OpenAI credential verification
  scope: first-time-approval
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "OpenAI credential verification no longer calls the OAuth issuer's /api/accounts route. The adapter extracts chatgpt_account_id from the freshly exchanged access-token JWT claim https://api.openai.com/auth and performs GET https://chatgpt.com/backend-api/wham/accounts/check with Authorization: Bearer <access_token> and ChatGPT-Account-ID: <account_id>. A 2xx response is valid, 401/403 or a missing account claim is invalid, and network failure or any other status is inconclusive. No Codex executable or Codex local state is used."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "A valid OpenAI ChatGPT grant was sent to https://auth.openai.com/api/accounts without ChatGPT-Account-ID; the route rejected it and completeLink returned subscription_credentials_invalid."
tests_new_behavior: "A live-shaped JWT and fake ChatGPT accounts-check endpoint prove that both required headers are sent to the backend route and a 2xx response allows completeLink to create the OpenAI subscription; malformed/missing account claims and 401/403 remain rejected."
test_obligations:
  - to:spp-subscription-oauth:DLT-005:chatgpt_accounts_check
  - to:spp-subscription-oauth:DLT-005:valid_openai_link_regression
---
```

## 16. Implementation bindings

`none`.

## 17. Open questions

- `oq:spp-subscription-oauth-live` — exact Anthropic token endpoint URL, redirect
  URI, and whether the pasted code carries the state are unverified live; wire
  tests run against a faked endpoint, one manual live login validates the flow.

## 18. Assumptions

`none`.

## 19. Out of scope

OpenAI inference routing, OpenAI load harvesting, and an OpenAI active prober.
