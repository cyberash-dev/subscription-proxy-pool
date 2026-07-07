# Policy — `pol:POL-AUTH-001`

```yaml
id: pol:POL-AUTH-001
template: Policy
lifecycle.status: approved
version: 1
applicability:
  partitions: [spp-auth, spp-access-keys, spp-proxy]
  feature_flag: not_applicable
  axis_invariant: true
policy_kind: authorization
negative_test_obligations: [to:pol:POL-AUTH-001:neg-1]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-04T14:48:37.464Z
  change_request: "subscription-proxy-pool: first-time approval"
  scope: first-time-approval
```

## Rule

Pool selection is bound solely to the resolved proxy-key principal; no request
header may override the user or the pool target. The two authorization surfaces
carry distinct, non-interchangeable credentials: the inference surface
(`/v1/messages`) accepts ONLY a proxy-key bearer; the management surface
(`/api/*`) accepts ONLY an L1 session bearer. A session bearer is not valid for
inference, and a proxy key is not valid for management.

## Negative test obligations

- `to:pol:POL-AUTH-001:neg-1` — an unknown/missing proxy key on the inference
  surface is rejected `401`, and a missing session on the management surface is
  rejected `401`; the pool used is the one bound to the key, not any header.

## Approval

```yaml
approval_record: not_applicable_for_proposed
```

## Open-Q

`none`.
