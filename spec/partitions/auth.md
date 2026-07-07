# Partition — `spp-auth`

## 1. Context

Level-1 identity: authenticate a person via social OIDC and mint a management
session. Provider specifics live behind the `IdentityProvider` port; the registry
selects by name. Social-provider tokens are used only to obtain the id_token and
are never persisted.

## 2. Glossary

See [`../00-glossary.md`](../00-glossary.md).

## 3. Partition

```yaml
partition_id: spp-auth
owner_team: subscription-proxy-pool
gate_scope:
  baseline-valid: "this file §4 + src/features/auth/ + src/shared/{pkce,oidc}/"
  spec-valid: this file + pol:POL-AUTH-001 + pol:POL-PROVIDER-001
  implementation-valid: src/features/auth/tests/
dependencies_on_other_partitions: []
default_policy_set: [pol:POL-AUTH-001, pol:POL-PROVIDER-001]
debt_budget:
  unmodeled_count_at_phase1: 0
  target_per_pr: shrink >= 1
```

## 4. Brownfield baseline

```yaml
discovery_scope:
  entrypoints:
    http_routes: [GET /auth/login/:provider, GET /auth/callback]
  datasets: [users, user_identities, auth_sessions, pkce_sessions]
  flags: [SPP_OIDC_*, SPP_SESSION_TTL_MS, SPP_PUBLIC_URL]
  freshness_token: pending
unmodeled: []
```

## 5. Surfaces

- `spp-mgmt-http@1` (auth routes) — specified in the management surface.

## 6. Requirements

```yaml
- id: spp-auth:BEH-001
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A configured OIDC provider.
  when: beginLogin({provider}) is called.
  then: A PKCE login session (state, nonce, verifier) is persisted and an authorize URL carrying response_type=code, client_id, redirect_uri, scope, state, nonce, code_challenge, code_challenge_method=S256 is returned.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: [pol:POL-PROVIDER-001]
  test_obligations: [to:spp-auth:BEH-001:authorize_url]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:23.835Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-auth:BEH-002
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: An unconsumed login session for a state.
  when: completeLogin({state, code}) is called.
  then: The code is exchanged, the id_token is verified (signature, iss, aud, exp, nonce), the user is created-or-linked by (issuer, subject), and a new session bearer is minted (returned once, stored hashed).
  negative_cases:
    - "unknown or already-consumed state → invalid_request_error"
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: single_use_state,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: [pol:POL-AUTH-001]
  test_obligations: [to:spp-auth:BEH-002:create_or_link]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:24.170Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-auth:BEH-003
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A session bearer.
  when: resolveSession(bearer) is called.
  then: A valid, unexpired, unrevoked session resolves to its user; otherwise resolution is undefined (unauthorized at the boundary).
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-auth:BEH-003:resolve]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:24.504Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-auth:BEH-004
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A session bearer.
  when: logout(bearer) is called.
  then: The session is revoked and no longer resolves.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: idempotent,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-auth:BEH-004:revoke]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:24.838Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 7. Data contracts

```yaml
id: spp-auth:CNT-001
template: Contract
lifecycle.status: approved
version: 1
surface_ref: not_applicable
applicability: { axis_invariant: true }
schema:
  request: "IdentityProvider.buildAuthorizeUrl(input); exchangeCode(input) -> ExternalIdentity{issuer, subject, email?}"
  response: "a verified ExternalIdentity; the verification method is adapter-defined (the generic-OIDC adapter uses an RS256 id_token via discovery + JWKS; a plain-OAuth2 adapter verifies via its own userinfo call)"
external_identifiers: [oidc_discovery=/.well-known/openid-configuration]
preconditions: "the adapter can reach its provider's authorize and token endpoints; the generic-OIDC adapter additionally requires OIDC discovery, a JWKS endpoint and an RS256 id_token"
postconditions: "the adapter verifies the identity before returning it; the generic-OIDC adapter validates iss, aud, exp and nonce on the id_token; a userinfo-based adapter trusts the authenticated userinfo response"
error_taxonomy: "identity_exchange_failed | identity_unverified | id_token_bad_signature | id_token_bad_issuer | id_token_bad_audience | id_token_expired | id_token_bad_nonce"
concurrency_model:
  {
    actor_concurrency: multi_global,
    read_consistency: not_applicable,
    idempotency: not_applicable,
    time_source: wall_clock,
  }
data_scope: all_data
policy_refs: [pol:POL-PROVIDER-001]
test_obligations: [to:spp-auth:CNT-001:oidc_verify]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-04T14:48:25.181Z
  change_request: "subscription-proxy-pool: first-time approval"
  scope: first-time-approval
```

```yaml
---
id: spp-auth:CNT-002
template: Contract
lifecycle.status: approved
version: 1
surface_ref: not_applicable
applicability: { axis_invariant: true }
schema:
  request: "SppConfigModule.identityProviders(ctx: {clock, fetch}) -> Record<string, IdentityProvider>, imported from the module referenced by SPP_CONFIG"
  response: "each returned provider is registered under its key in the identity registry and is resolvable via /auth/login/:provider; config-module keys override SPP_OIDC_* keys on name collision"
external_identifiers: [env=SPP_CONFIG]
preconditions: "SPP_CONFIG references an importable ESM module whose default export satisfies SppConfigModule"
postconditions: "providers from the config module are selectable exactly like SPP_OIDC_* providers; an absent SPP_CONFIG leaves the registry built from SPP_OIDC_* alone"
error_taxonomy: "config_module_load_failed | config_module_bad_shape"
concurrency_model:
  {
    actor_concurrency: multi_global,
    read_consistency: not_applicable,
    idempotency: not_applicable,
    time_source: wall_clock,
  }
data_scope: all_data
policy_refs: [pol:POL-PROVIDER-001]
test_obligations: [to:spp-auth:CNT-002:config_module_registers_provider]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-04T14:48:25.511Z
  change_request: "subscription-proxy-pool: first-time approval"
  scope: first-time-approval
---
```

## 8. Invariants

```yaml
- id: spp-auth:INV-001
  template: Invariant
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  predicate: "A session resolves to exactly one user; create-or-link keys the user on (issuer, subject)."
  evidence: test_probe
  stability: internal
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-auth:INV-001:one_user]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:25.839Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-auth:INV-002
  template: Invariant
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  predicate: "Social-provider access/refresh tokens are never persisted; only the ExternalIdentity link and our own session are stored."
  evidence: public_api
  stability: contractual
  data_scope: all_data
  policy_refs: [pol:POL-SECRET-001]
  test_obligations: [to:spp-auth:INV-002:no_social_tokens]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:26.182Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 9. External dependencies

`none` (OIDC issuers are provider-configured at runtime).

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

- `oq:spp-auth-live-issuer` — concrete Microsoft/Google issuer quirks (non-standard
  userinfo, email placement) are unverified live; the generic-OIDC adapter is
  validated against a fake issuer. Default: id_token claims only.

## 18. Assumptions

`none`.

## 19. Out of scope

Concrete provider configs (they are runtime `SPP_OIDC_*` values, not spec).
