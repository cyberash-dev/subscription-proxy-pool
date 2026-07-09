# Surface — `spp-mgmt-http@1`

The management + auth HTTP surface. `/auth/*` is public (OIDC login); `/api/*` is
behind an L1 session bearer.

```yaml
id: spp-mgmt-http:SURF-001
template: Surface
lifecycle.status: approved
version: 1
name: spp-mgmt-http
semver: 1.0.0
boundary_type: api
applicability: { axis_invariant: true }
auth: "/auth/* public; /api/* require Authorization: Bearer <session>"
members:
  - spp-auth:BEH-001
  - spp-auth:BEH-002
  - spp-access-keys:BEH-001
  - spp-subscription-oauth:BEH-001
  - spp-subscriptions:BEH-001
concurrency_model:
  {
    actor_concurrency: multi_global,
    read_consistency: read_committed,
    idempotency: not_applicable,
    time_source: wall_clock,
  }
test_obligations: [to:spp-mgmt-http:SURF-001:session_gate]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-04T14:48:38.442Z
  change_request: "subscription-proxy-pool: first-time approval"
  scope: first-time-approval
```

```yaml
---
id: spp-mgmt-http:DLT-001
template: Delta
lifecycle.status: approved
version: 1
baseline_version: spp:BL-001
kind: contract_change
applicability: { axis_invariant: true }
statement: "POST /api/subscriptions/complete gains two failure outcomes when the freshly exchanged credentials do not verify: subscription_credentials_invalid (upstream 401/403) and subscription_verification_unavailable (verification inconclusive after retries). The happy-path response (201 {subscription_id}) is unchanged. Additive error surface -> spp-mgmt-http minor bump 1.0.0 -> 1.1.0."
compatibility_action: reject
tests_old_behavior: "complete returned 201 for any successfully exchanged code."
tests_new_behavior: "complete returns a typed error (no subscription created) when the exchanged credentials fail verification."
test_obligations: [to:spp-mgmt-http:DLT-001:complete_rejects_invalid]
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-06T22:56:44.305Z
  change_request: approve landed proxy/egress/oauth-verify spec (implemented + @covers-tested)
  scope: first-time-approval
---
```

```yaml
---
id: spp-mgmt-http:DLT-002
template: Delta
lifecycle.status: approved
approval_record:
  owner_role: tech-lead
  approver_identity: cyberash
  timestamp: 2026-07-09T21:12:18.021Z
  change_request: OpenAI subscription linking
  scope: first-time-approval
version: 1
baseline_version: spp:BL-001
kind: behavior_change
applicability: { axis_invariant: true }
statement: "POST /api/subscriptions/login with provider=openai now returns 200 with the existing {authorize_url,state} shape instead of provider_not_implemented. After the user submits the OpenAI link code to POST /api/subscriptions/complete with the existing {state,code,label?} shape, the endpoint returns 201 {subscription_id}; GET /api/subscriptions and GET /api/pools expose provider=openai while continuing to omit tokens. Existing Anthropic shapes are unchanged. Additive provider support bumps the effective spp-mgmt-http version from 1.1.0 to 1.2.0."
compatibility_action: no_longer_guaranteed
tests_old_behavior: "An OpenAI begin-link request failed with provider_not_implemented and could not create a subscription."
tests_new_behavior: "An authenticated management client completes the OpenAI begin/code/complete flow and observes one token-free provider=openai subscription in its pool."
test_obligations: [to:spp-mgmt-http:DLT-002:openai_link]
---
```

## Members

- `GET /auth/login/:provider` → 302 to the OIDC authorize URL.
- `GET /auth/callback?state=&code=` → mints a session (`{ session_token, user_id, expires_at }`).
- `POST /api/keys` · `GET /api/keys` · `DELETE /api/keys/:id` — proxy-key management.
- `POST /api/subscriptions/login` · `POST /api/subscriptions/complete` — link a subscription.
- `GET /api/subscriptions` · `PATCH /api/subscriptions/:id` — list / disable.
- `GET /api/pools` — per-pool subscriptions with utilization + fence state.

All `/api/*` require a valid session bearer (`pol:POL-AUTH-001`); the session and
the proxy key are not interchangeable.
