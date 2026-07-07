# Policy — `pol:POL-SECRET-001`

```yaml
id: pol:POL-SECRET-001
template: Policy
lifecycle.status: approved
version: 1
applicability:
  partitions:
    [spp-auth, spp-access-keys, spp-subscriptions, spp-subscription-oauth]
  feature_flag: not_applicable
  axis_invariant: true
policy_kind: pii
negative_test_obligations: [to:pol:POL-SECRET-001:neg-1]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-04T14:48:37.793Z
  change_request: "subscription-proxy-pool: first-time approval"
  scope: first-time-approval
```

## Rule

Subscription OAuth access/refresh tokens are stored **encrypted at rest**
(AES-256-GCM, versioned envelope; the encryption key is held outside the
database) per `spp-subscriptions:DLT-001`. PKCE verifiers are transient and
deleted on flow completion. Caller credentials that are
presented on every request — proxy keys and management session bearers — are
stored **hashed** (SHA-256), never plaintext. No secret (plaintext token, ciphertext, hash,
or verifier) may appear in a log line, an HTTP error body, the `/health`
response, or any read Surface.

## Negative test obligations

- `to:pol:POL-SECRET-001:neg-1` — a subscription read summary MUST expose no
  token column (`accessToken` / `refreshToken` absent from the summary shape).

## Approval

```yaml
approval_record: not_applicable_for_proposed
```

## Open-Q

- `oq:pol-secret-at-rest-encryption` — RESOLVED: at-rest encryption is now in effect via
  `spp-subscriptions:DLT-001` (AES-256-GCM). This Open-Q is superseded.
