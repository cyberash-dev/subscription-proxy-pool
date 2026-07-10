# 00 — Context

> Non-normative. Frames the package before the partition specs. Anything
> load-bearing for code generation lives inside a normative ID in
> `partitions/`, `surfaces/`, or `policies/`.

## What this package is

`subscription-proxy-pool` pools AI-subscription OAuth credentials and exposes an
Anthropic-compatible HTTP proxy for Claude Code. It:

- Pools per-user and shared "donor" subscriptions and auto-selects the
  least-loaded, non-rate-limited subscription per request.
- Runs a two-level authorization model: level 1 is user identity via social
  OIDC (Microsoft/Google/…); level 2 is the stored Claude Code subscription OAuth
  grant that pays for inference.
- Proxies `POST /v1/messages` for Claude Code. Anthropic models go directly to
  Anthropic with the pooled Anthropic Bearer and required beta headers. OpenAI
  model families go through a separately deployed Anthropic-to-OpenAI bridge
  with a pooled OpenAI subscription credential.
- Refreshes subscription tokens (single-flight), fences rate-limited
  subscriptions, and probes idle ones on a schedule.

## What this package is not

- Not a model or a protocol translator. It brokers credentials and forwards to
  Anthropic or to the separately deployed OpenAI bridge.
- Not multi-instance: in-process state (in-flight counters, single-flight
  refresh) assumes one instance per `SPP_HOME`.
- OpenAI subscriptions are linked and stored through a direct provider
  browser-code flow; their inference requests are translated by the separate
  bridge service.

## Two-level authorization

| Level            | Credential                        | Surface                       |
| ---------------- | --------------------------------- | ----------------------------- |
| L1 identity      | OIDC session bearer               | management HTTP `/api/*`      |
| L2 inference     | subscription OAuth grant (stored) | forwarded by provider route   |
| Inference caller | proxy key bearer                  | inference HTTP `/v1/messages` |

The session bearer and the proxy key are distinct credentials and are not
interchangeable (`pol:POL-AUTH-001`).

## Brownfield baseline anchor

The block below is the SDD anchor `sdd check` reads. It is non-normative on its
own; specific facts are preserved or changed only through the per-partition
normative IDs that reference them. `freshness_token` / `baseline_commit_sha`
are managed by `sdd token` / `sdd refresh`.

```yaml
---
id: spp:BL-001
type: BrownfieldBaseline
baseline_version: m1-2026-07-04
freshness_token: 420c8dd354c2bbaf7d18ae57876888ab7c30ce55d7d10271eefd643493469d2b
baseline_commit_sha: e9fb78a16460de9c2e2aad4a2ceb93861ec20736
mechanism: git_tree_hash_v1
discovery_scope:
  - kind: source_tree
    path: src/
    coverage_evidence: per-partition specs cite slice paths under src/features/<slice>/{domain,application,ports,adapters,tests}; src/shared/* hosts cross-cutting kernel (db engine, pkce, oidc, anthropic constants, http, domain primitives)
  - kind: migrations
    path: migrations/
    coverage_evidence: SQL migration 001 referenced by spp-db and the per-slice repository specs
  - kind: build_config
    path: package.json
    coverage_evidence: read of dependencies (better-sqlite3, pg), engines.node>=20, scripts (serve/migrate/test/tsc/sdd:*)
  - kind: build_config
    path: tsconfig.json
    coverage_evidence: read (strict, ES2022, ESM)
  - kind: build_config
    path: .sdd/config.json
    coverage_evidence: declares baseline_id, discovery_scope, mechanism, partitions
unmodeled: []
debt_budget:
  legitimate_debt_count_at_authoring: 0
  unmodeled_count_at_authoring: 0
  next_pr_target: keep unmodeled at 0; refresh BL-001 when src/, migrations/, or build config change
---
```
