# Partition — `spp-db`

## 1. Context

The storage kernel: an async `Engine` port with one `?`-placeholder SQL dialect,
a working SQLite backend, a Postgres seam, and a forward-only migration runner.
Every slice's repository depends on the port, never on a driver, so a future
Postgres store needs no repository change.

## 2. Glossary

See [`../00-glossary.md`](../00-glossary.md).

## 3. Partition

```yaml
partition_id: spp-db
owner_team: subscription-proxy-pool
gate_scope:
  baseline-valid: "this file §4 Brownfield baseline + src/shared/db/ + migrations/"
  spec-valid: this file
  implementation-valid: src/shared/db/tests/
dependencies_on_other_partitions: []
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
        src/shared/db/Engine.ts,
        src/shared/db/SqliteEngine.ts,
        src/shared/db/Migrations.ts,
      ]
  datasets: [migrations/001-initial.sql]
  flags: [SPP_ENGINE, SPP_PG_URL]
  freshness_token: pending
unmodeled: []
```

## 5. Surfaces

`none` (the Engine port is an internal contract, not an external Surface).

## 6. Requirements

`none`.

## 7. Data contracts

```yaml
- id: spp-db:CNT-001
  template: Contract
  lifecycle.status: approved
  version: 1
  surface_ref: not_applicable
  applicability: { axis_invariant: true }
  schema:
    request: "Engine.{get,all,run}(sql, params?) with `?` placeholders; transaction(fn) atomic"
    response: "RunResult{changes}; rows typed by the caller via <Row>"
  external_identifiers: not_applicable
  preconditions: "sql uses `?` placeholders; params are string|number|bigint|null"
  postconditions: "run mutations report affected-row count; transaction is atomic"
  error_taxonomy: "isUniqueViolation(err) recognises UNIQUE / PRIMARY-KEY violations"
  concurrency_model:
    {
      actor_concurrency: single_writer,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: not_applicable,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-db:CNT-001:roundtrip]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:26.519Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 8. Invariants

```yaml
- id: spp-db:INV-001
  template: Invariant
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  predicate: "Every repository depends only on the Engine port and writes `?`-placeholder SQL; no repository imports better-sqlite3 or pg directly."
  evidence: public_api
  stability: internal
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-db:INV-001:port_roundtrip]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:26.837Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-db:INV-002
  template: Invariant
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  predicate: "transaction(fn) runs its body in one atomic, serialised transaction; on a thrown body it rolls back and no row persists."
  evidence: test_probe
  stability: internal
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-db:INV-002:rollback]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:27.174Z
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

```yaml
- id: spp-db:CNST-001
  template: Constraint
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  statement: "Migrations are forward-only and dialect-partitioned (migrations/ for SQLite, migrations/postgres/ for Postgres). Each migration file owns its own INSERT INTO schema_version row; the runner only skips-or-runs. An applied migration is never edited."
  rationale: "Deterministic, idempotent schema evolution across dialects."
  test_obligations: [to:spp-db:CNST-001:schema_present]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:27.513Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

```yaml
---
id: spp-db:CNT-002
template: Contract
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T22:33:56.127Z
  change_request: config-module engine selection (spp.conf.ts database hook)
  scope: first-time-approval
version: 1
surface_ref: not_applicable
applicability: { axis_invariant: true }
schema:
  request: "SppConfigModule.database() (from the SPP_CONFIG module default export) -> EngineConfig; resolved by the composition root before the engine is opened"
  response: "the returned EngineConfig selects the storage engine (sqlite | postgres); when database() is absent, engine selection falls back to the environment (SPP_ENGINE / SPP_PG_URL / SPP_PG_POOL_MAX); a present database() overrides the environment"
external_identifiers: [env=SPP_CONFIG]
preconditions: "SPP_CONFIG references an importable ESM module whose default export satisfies SppConfigModule; when present, database is a function returning a valid EngineConfig"
postconditions: "the server opens the engine returned by database() when present, otherwise the env-selected engine; migrations are applied on open exactly as for env selection"
error_taxonomy: "config_module_bad_shape when database is present but not a function"
concurrency_model:
  {
    actor_concurrency: single_writer,
    read_consistency: read_committed,
    idempotency: not_applicable,
    time_source: not_applicable,
  }
data_scope: all_data
policy_refs: []
test_obligations:
  [
    to:spp-db:CNT-002:module_selects_engine,
    to:spp-db:CNT-002:bad_shape_rejected,
  ]
---
```

```yaml
---
id: spp-db:BEH-001
template: Behavior
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T22:33:56.193Z
  change_request: config-module engine selection (spp.conf.ts database hook)
  scope: first-time-approval
version: 1
applicability: { axis_invariant: true }
given: A composition root starting the server with an optional SPP_CONFIG module.
when: The engine is resolved at wire time.
then: When the config module exports database(), the server opens the engine it returns; otherwise the server opens the engine selected from the environment (SPP_ENGINE / SPP_PG_URL / SPP_PG_POOL_MAX). A config-module selection overrides the environment.
concurrency_model:
  {
    actor_concurrency: single_writer,
    read_consistency: read_committed,
    idempotency: not_applicable,
    time_source: not_applicable,
  }
data_scope: all_data
policy_refs: []
test_obligations: [to:spp-db:BEH-001:env_fallback_when_absent]
---
```

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
