# Partition — `spp-subscriptions`

## 1. Context

The pooled subscription store: add a verified L2 grant to a user pool or the
donor pool, disable, and list. A subscription belongs to exactly one pool. Read
summaries never carry token columns.

## 2. Glossary

See [`../00-glossary.md`](../00-glossary.md).

## 3. Partition

```yaml
partition_id: spp-subscriptions
owner_team: subscription-proxy-pool
gate_scope:
  baseline-valid: "this file §4 + src/features/subscriptions/"
  spec-valid: this file + pol:POL-SECRET-001
  implementation-valid: src/features/subscriptions/tests/
dependencies_on_other_partitions: []
default_policy_set: [pol:POL-SECRET-001]
debt_budget:
  unmodeled_count_at_phase1: 0
  target_per_pr: shrink >= 1
```

## 4. Brownfield baseline

```yaml
discovery_scope:
  entrypoints:
    http_routes:
      [
        POST /api/subscriptions/complete,
        GET /api/subscriptions,
        PATCH /api/subscriptions/:id,
      ]
  datasets: [subscriptions]
  flags: []
  freshness_token: pending
unmodeled: []
```

## 5. Surfaces

- `spp-mgmt-http@1` (subscription routes).

## 6. Requirements

```yaml
- id: spp-subscriptions:BEH-001
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A verified grant, provider, and an owner user.
  when: add with poolKind=user, an ownerUserId and a grant is called.
  then: An active subscription is stored in that user's pool with the owner set.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-subscriptions:BEH-001:add_user_pool]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:35.751Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-subscriptions:BEH-002
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A verified grant and provider.
  when: add with poolKind=donor and a grant is called.
  then: An active subscription is stored in the donor pool with no owner.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-subscriptions:BEH-002:add_donor_pool]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:36.112Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-subscriptions:BEH-003
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A user-pool subscription owned by a user.
  when: disable(userId, subscriptionId) is called.
  then: The owner's subscription is disabled and excluded from active pool selection; a non-owner disable is rejected.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: idempotent,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-subscriptions:BEH-003:disable]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:36.444Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 7. Data contracts

```yaml
- id: spp-subscriptions:CNT-001
  template: Contract
  lifecycle.status: approved
  version: 1
  surface_ref: not_applicable
  applicability: { axis_invariant: true }
  schema:
    request: "list(filter) -> SubscriptionSummary[]"
    response: "SubscriptionSummary{subscriptionId, provider, poolKind, ownerUserId?, label?, status, tokenExpiresAt, createdAt}"
  external_identifiers: not_applicable
  preconditions: not_applicable
  postconditions: "no token column (accessToken / refreshToken) appears on any summary"
  error_taxonomy: not_applicable
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: not_applicable,
    }
  data_scope: all_data
  policy_refs: [pol:POL-SECRET-001]
  test_obligations: [to:spp-subscriptions:CNT-001:summary_no_tokens]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:36.772Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 8. Invariants

```yaml
- id: spp-subscriptions:INV-001
  template: Invariant
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  predicate: "A subscription belongs to exactly one pool: pool_kind=user implies owner set; pool_kind=donor implies owner null (enforced by a DB CHECK and validated before insert)."
  evidence: db_constraint
  stability: contractual
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-subscriptions:INV-001:one_pool]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:37.094Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

```yaml
---
id: spp-subscriptions:DLT-001
template: Delta
lifecycle.status: approved
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "access_token and refresh_token are persisted as authenticated ciphertext (AES-256-GCM in a versioned envelope v1.<keyId>.<base64url(iv|tag|ciphertext)>) and decrypted on read; the encryption key is held outside the database (secret store / process env), not in the DB, code, or logs. This withdraws the plaintext-at-rest clause of pol:POL-SECRET-001 (was: raw token stored plaintext, at-rest control = DB file mode 0600). The external contract is unchanged: no token appears on any Surface and spp-subscriptions:CNT-001 keeps exposing no token columns, so no Surface is bumped. Caller credentials stay hashed; PKCE verifiers stay transient plaintext, deleted on flow completion."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "the subscriptions table stored access_token and refresh_token as the raw token string (plaintext at rest)."
tests_new_behavior: "a row read directly from the subscriptions table shows access_token and refresh_token as a v1.<keyId>.<base64url> ciphertext envelope rather than the raw token, and findById returns the original token; a tampered envelope or one encrypted under an out-of-ring key fails closed (decrypt throws) instead of returning a value."
test_obligations:
  [
    to:spp-subscriptions:DLT-001:tokens_encrypted_at_rest,
    to:spp-subscriptions:DLT-001:decrypt_fails_closed,
  ]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T19:23:18.207Z
  change_request: encrypt subscription tokens at rest (AES-256-GCM)
  scope: first-time-approval
---
```

## 9. External dependencies

`none`.

## 10. Generated artifacts

`none`.

## 11. Localization

`none`.

## 12. Policies

`default_policy_set: [pol:POL-SECRET-001]`.

## 13. Constraints

`none`.

## 14. Migrations

`none`.

## 15. Deltas

`none`.

## 16. Implementation bindings

`none`.

## 17. Open questions

- `oq:spp-subscriptions-donor-disable` — disabling a donor subscription is
  admin-only in M1 (the per-user API disables only owned user-pool subscriptions).

## 18. Assumptions

`none`.

## 19. Out of scope

`none`.
