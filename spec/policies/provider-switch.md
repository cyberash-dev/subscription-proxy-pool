# Policy — `pol:POL-PROVIDER-001`

```yaml
id: pol:POL-PROVIDER-001
template: Policy
lifecycle.status: approved
version: 1
applicability:
  partitions: [spp-auth, spp-subscription-oauth, spp-proxy]
  feature_flag: not_applicable
  axis_invariant: true
policy_kind: authorization
negative_test_obligations: [to:pol:POL-PROVIDER-001:neg-1]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-04T14:48:38.115Z
  change_request: "subscription-proxy-pool: first-time approval"
  scope: first-time-approval
```

## Rule

All provider-specific behaviour lives behind two switchable ports and their
registries: `IdentityProvider` (level 1: OIDC issuers) and
`SubscriptionOAuthProvider` (level 2: Anthropic now, OpenAI as a seam). Slices
above the provider adapters are provider-agnostic and MUST NOT reference
`api.anthropic.com`, `sk-ant-*` literals, or a concrete OIDC issuer. Selecting an
unimplemented provider yields a typed `provider_not_implemented`, never a leak or
a partial call.

## Negative test obligations

- `to:pol:POL-PROVIDER-001:neg-1` — selecting the OpenAI provider returns
  `provider_not_implemented` through the same port shape as Anthropic, proving
  the seam without provider-specific branching in callers.

## Approval

```yaml
approval_record: not_applicable_for_proposed
```

## Open-Q

`none`.

```yaml
---
id: pol:DLT-001
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-09T21:12:07.582Z
  change_request: OpenAI subscription linking
  scope: first-time-approval
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "OpenAI becomes an implemented SubscriptionOAuthProvider. The old negative obligation that OpenAI returns provider_not_implemented is withdrawn and replaced by proof that OpenAI provider-specific URLs, parameters, token parsing, refresh, and verification remain inside its outbound adapter while application callers use the unchanged provider-neutral port."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "Selecting OpenAI always returned provider_not_implemented."
tests_new_behavior: "Selecting OpenAI executes its adapter through the shared port; provider-specific literals do not appear in subscription application code."
test_obligations: [to:pol:DLT-001:openai_adapter_boundary]
---
```
