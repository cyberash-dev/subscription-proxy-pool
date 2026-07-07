# Partition — `spp-pool-selection`

## 1. Context

Pure least-loaded selection over a pool's subscriptions and their load snapshots.
Picks the eligible candidate with the lowest representative-window utilization,
skips fenced (rate-limited / cooldown / near-full) subscriptions, and reports
no-capacity with a retry hint when the pool is exhausted.

## 2. Glossary

See [`../00-glossary.md`](../00-glossary.md).

## 3. Partition

```yaml
partition_id: spp-pool-selection
owner_team: subscription-proxy-pool
gate_scope:
  baseline-valid: "this file §4 + src/features/pool-selection/"
  spec-valid: this file
  implementation-valid: src/features/pool-selection/tests/
dependencies_on_other_partitions:
  - "spp-subscriptions@1  # borrows SubscriptionRepository for pool listing"
  - "spp-load-monitor@1   # borrows LoadRepository for latest snapshots"
default_policy_set: []
debt_budget:
  unmodeled_count_at_phase1: 0
  target_per_pr: shrink >= 1
```

## 4. Brownfield baseline

```yaml
discovery_scope:
  entrypoints:
    modules:
      [
        src/features/pool-selection/domain/Selection.ts,
        src/features/pool-selection/application/SelectSubscriptionUseCase.ts,
      ]
  datasets: [subscriptions, subscription_load]
  flags: []
  freshness_token: pending
unmodeled: []
```

## 5. Surfaces

`none`.

## 6. Requirements

```yaml
- id: spp-pool-selection:BEH-001
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A pool whose subscriptions are all fenced (rate-limited or in cooldown), or an empty pool.
  when: select is called.
  then: A typed no_capacity is returned (503 at the boundary) with a retry-after derived from the soonest reset; an empty pool retries after a default.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-pool-selection:BEH-001:no_capacity]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:29.512Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-pool-selection:BEH-002
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A candidate with no load snapshot yet.
  when: select is called.
  then: The candidate is eligible (unknown counts as mid-load) so fresh subscriptions still receive traffic.
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-pool-selection:BEH-002:unknown_eligible]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:29.859Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 7. Data contracts

`none`.

## 8. Invariants

```yaml
- id: spp-pool-selection:INV-001
  template: Invariant
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  predicate: "select returns the eligible candidate with the lowest representative-window utilization (plus a small in-flight bias); ties break deterministically by in-flight then subscription id."
  evidence: test_probe
  stability: internal
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-pool-selection:INV-001:least_loaded]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:30.194Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-pool-selection:INV-002
  template: Invariant
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  predicate: "A candidate whose latest snapshot is rate_limited, in cooldown (reset in the future), or near-full (utilization >= 0.98) is never selected while fenced, and becomes eligible again once the cooldown passes."
  evidence: test_probe
  stability: internal
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-pool-selection:INV-002:fence]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:30.538Z
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

`default_policy_set: []`.

## 13. Constraints

`none`.

## 14. Migrations

`none`.

## 15. Deltas

`none`.

## 16. Implementation bindings

`none`.

## 17. Open questions

- `oq:spp-pool-selection-concurrency` — two concurrent requests may pick the same
  least-loaded subscription before either's load lands; accepted for M1 (the
  in-flight bias mitigates, passive harvest self-corrects).

## 18. Assumptions

`none`.

## 19. Out of scope

Cross-instance selection (single-instance only in M1).
