# Partition — `spp-load-monitor`

## 1. Context

Load monitoring: passively harvest Anthropic unified rate-limit headers on every
proxied response, and actively probe idle subscriptions on a schedule. Owns the
`subscription_load` table.

## 2. Glossary

See [`../00-glossary.md`](../00-glossary.md).

## 3. Partition

```yaml
partition_id: spp-load-monitor
owner_team: subscription-proxy-pool
gate_scope:
  baseline-valid: "this file §4 + src/features/load-monitor/"
  spec-valid: this file
  implementation-valid: src/features/load-monitor/tests/
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
        src/features/load-monitor/domain/RateLimit.ts,
        src/features/load-monitor/application/LoadMonitorService.ts,
      ]
  datasets: [subscription_load]
  flags: [SPP_PROBE_ENABLED, SPP_PROBE_PERIOD_MS, SPP_IDLE_THRESHOLD_MS]
  freshness_token: pending
unmodeled: []
```

## 5. Surfaces

`none`.

## 6. Requirements

```yaml
- id: spp-load-monitor:BEH-001
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: A proxied upstream response with rate-limit headers.
  when: recordLoad(subscriptionId, sample) is called.
  then: A load snapshot is persisted with source=passive.
  concurrency_model:
    {
      actor_concurrency: single_writer,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-load-monitor:BEH-001:passive_record]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:27.835Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-load-monitor:BEH-002
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: An upstream 429 (or a rate_limited unified status).
  when: the headers are parsed.
  then: The snapshot records rate_limited with a cooldown deadline derived from retry-after or the representative window reset.
  concurrency_model:
    {
      actor_concurrency: single_writer,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-load-monitor:BEH-002:cooldown]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:28.171Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval

- id: spp-load-monitor:BEH-003
  template: Behavior
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  given: Active subscriptions, some idle beyond the threshold.
  when: probeIdle() runs.
  then: Subscriptions idle beyond the threshold and not in cooldown are probed with a cheap Haiku request; recently-seen or cooled subscriptions are skipped; a single probe failure does not stop the sweep.
  concurrency_model:
    {
      actor_concurrency: single_writer,
      read_consistency: read_committed,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-load-monitor:BEH-003:probe_idle]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:28.509Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 7. Data contracts

```yaml
- id: spp-load-monitor:CNT-001
  template: Contract
  lifecycle.status: approved
  version: 1
  surface_ref: not_applicable
  applicability: { axis_invariant: true }
  schema:
    request: "parseRateLimitHeaders(get, httpStatus, nowMs)"
    response: "RateLimitSample from anthropic-ratelimit-unified-{status,5h-*,7d-*,representative-claim} and retry-after"
  external_identifiers:
    [
      anthropic-ratelimit-unified-status,
      anthropic-ratelimit-unified-representative-claim,
      anthropic-ratelimit-unified-5h-reset,
      anthropic-ratelimit-unified-5h-utilization,
      retry-after,
    ]
  preconditions: not_applicable
  postconditions: "every field is optional and NaN-guarded; representative-claim (five_hour/seven_day) selects the authoritative window (5h/7d)"
  error_taxonomy: not_applicable
  concurrency_model:
    {
      actor_concurrency: multi_global,
      read_consistency: not_applicable,
      idempotency: not_applicable,
      time_source: wall_clock,
    }
  data_scope: all_data
  policy_refs: []
  test_obligations: [to:spp-load-monitor:CNT-001:header_parse]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:28.838Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 8. Invariants

`none`.

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
- id: spp-load-monitor:CNST-001
  template: Constraint
  lifecycle.status: approved
  version: 1
  applicability: { axis_invariant: true }
  statement: "The active prober is opt-in (SPP_PROBE_ENABLED) and only probes subscriptions idle beyond SPP_IDLE_THRESHOLD_MS; each probe is a Haiku max_tokens=1 request whose body is discarded."
  rationale: "Bound the quota cost of active probing; harvest fresh headers only for otherwise-idle subscriptions."
  test_obligations: [to:spp-load-monitor:CNST-001:idle_only]
  approval_record:
    owner_role: tech-lead
    approver_identity: cyberash
    timestamp: 2026-07-04T14:48:29.171Z
    change_request: "subscription-proxy-pool: first-time approval"
    scope: first-time-approval
```

## 14. Migrations

`none`.

## 15. Deltas

```yaml
---
id: spp-load-monitor:DLT-001
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-09T21:12:23.356Z
  change_request: OpenAI subscription linking
  scope: first-time-approval
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "The Anthropic active prober receives only active provider=anthropic subscriptions. Active OpenAI subscriptions are excluded from probeIdle until an OpenAI-specific prober is specified; no OpenAI access token is sent to api.anthropic.com. Passive Anthropic harvesting and selection are unchanged."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "The prober enumerated every active subscription without filtering provider."
tests_new_behavior: "With one active Anthropic and one active OpenAI subscription, the Anthropic probe is called only for the Anthropic subscription."
test_obligations: [to:spp-load-monitor:DLT-001:anthropic_only_probe]
---
```

## 16. Implementation bindings

`none`.

## 17. Open questions

- `oq:spp-load-monitor-probe-cost` — whether a Haiku max_tokens=1 probe is
  quota-free is unverified; treated as a tiny billed request, hence opt-in.

## 18. Assumptions

- `assume:spp-load-monitor-unified-headers` — the `anthropic-ratelimit-unified-*`
  header family is present on OAuth responses (observed, undocumented); missing
  headers degrade to unknown, never a crash.

## 19. Out of scope

`none`.
