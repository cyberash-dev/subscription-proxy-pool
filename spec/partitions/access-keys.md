# Partition — `spp-access-keys`

## 1. Context

The inference-time credential (level 2 caller auth): a proxy key that resolves to
a principal `(user, pool target)`. Issued under an L1 session; the secret is
returned once and stored hashed. The key alone decides the pool; no request
header may override it.

## 2. Glossary

See [`../00-glossary.md`](../00-glossary.md).

## 3. Partition

```yaml
partition_id: spp-access-keys
owner_team: subscription-proxy-pool
gate_scope:
  baseline-valid: "this file §4 + src/features/access-keys/"
  spec-valid: this file + pol:POL-AUTH-001 + pol:POL-SECRET-001
  implementation-valid: src/features/access-keys/tests/
dependencies_on_other_partitions: []
default_policy_set: [pol:POL-AUTH-001, pol:POL-SECRET-001]
debt_budget:
  unmodeled_count_at_phase1: 0
  target_per_pr: shrink >= 1
```

## 4. Brownfield baseline

```yaml
discovery_scope:
  entrypoints:
    http_routes: [POST /api/keys, GET /api/keys, DELETE /api/keys/:id]
  datasets: [proxy_keys]
  flags: []
  freshness_token: pending
unmodeled: []
```

## 5. Surfaces

- `spp-mgmt-http@1` (key routes).

## 6. Requirements

```yaml
- id: spp-access-keys:BEH-001
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: An authenticated user and a pool target.
  when: issueKey(userId, poolTarget) is called.
  then: A new proxy key secret is minted and returned once; only its SHA-256 hash is persisted with the user and pool target.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: [pol:POL-SECRET-001]
  test_obligations: [to:spp-access-keys:BEH-001:issue_once]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:22.476Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-access-keys:BEH-002
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: An incoming proxy-key bearer.
  when: resolvePrincipal(bearer) is called.
  then: An active key resolves to its principal (user, pool target); an unknown or revoked key resolves to undefined.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: [pol:POL-AUTH-001]
  test_obligations: [to:spp-access-keys:BEH-002:resolve]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:22.819Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-access-keys:BEH-003
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A key owned by a user.
  when: revokeKey(userId, keyId) is called.
  then: The owner's key is revoked and stops resolving; a non-owner's revoke is rejected (not found).
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: idempotent,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-access-keys:BEH-003:revoke_owner_only]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:23.154Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 7. Data contracts

`none`.

## 8. Invariants

```yaml
- id: spp-access-keys:INV-001
  template: Invariant
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  predicate: "A proxy key maps to exactly one (user, pool target); the pool target is fixed at issuance and is never selected by a request header."
  evidence: public_api
  stability: contractual
  data_scope: all_data
  policy_refs: [pol:POL-AUTH-001]
  test_obligations: [to:spp-access-keys:INV-001:one_principal]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:23.493Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 9. External dependencies

`none`.

## 10. Generated artifacts

`none`.

## 11. Localization

`none`.

## 12. Policies

`default_policy_set: [pol:POL-AUTH-001, pol:POL-SECRET-001]`.

## 13. Constraints

`none`.

## 14. Migrations

`none`.

## 15. Deltas

`none`.

## 16. Implementation bindings

`none`.

## 17. Open questions

`none`.

## 18. Assumptions

`none`.

## 19. Out of scope

`none`.
