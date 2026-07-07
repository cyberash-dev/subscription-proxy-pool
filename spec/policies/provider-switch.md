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
