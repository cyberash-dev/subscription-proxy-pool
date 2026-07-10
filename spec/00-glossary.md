# 00 — Glossary

Non-normative shared vocabulary.

- **Level 1 / identity** — authenticating a person via social OIDC to work with
  the pool. Yields an ExternalIdentity and a management session.
- **Level 2 / inference credential** — the stored Anthropic or OpenAI
  subscription OAuth grant used to pay for inference.
- **Identity provider** — an OIDC issuer (Microsoft/Google/…) behind the
  `IdentityProvider` port.
- **Subscription provider** — Anthropic or OpenAI behind the
  `SubscriptionOAuthProvider` port.
- **External identity** — `(issuer, subject)` verified at L1 login, plus email.
- **Session** — a management-API bearer credential (stored hashed).
- **Proxy key** — the inference-time bearer credential a Claude Code client
  presents; stored hashed; binds a user and a pool target.
- **Principal** — the resolved `(user, pool target)` of a proxy key.
- **Pool** — a set of subscriptions. **User pool** is owned by one user; the
  **donor / communal pool** is shared.
- **Pool kind** — where a subscription lives: `user` or `donor`.
- **Pool target** — which pool a proxy key draws from: `own` or `donor`.
- **Grant** — an OAuth access/refresh token pair with an expiry.
- **Link code** — the single-use code shown after provider authorization and
  submitted to complete a subscription link.
- **Representative window** — the authoritative rate-limit window
  (`anthropic-ratelimit-unified-representative-claim`): 5h or 7d.
- **Fence** — excluding a subscription from selection while it is rate-limited
  or in cooldown.
- **Harvest** — recording a load snapshot from response headers.
- **Probe** — a cheap Haiku request that reads fresh rate-limit headers for an
  idle subscription.
- **OpenAI model family** — a model identifier beginning with `gpt-` or
  `codex-`, or matching `o<digits>` followed by end-of-string or `-`.
- **OpenAI bridge** — the separately deployed `dumb-codex-oai-proxy` service
  that accepts an Anthropic Messages request plus one OpenAI subscription
  credential and returns an Anthropic-compatible response.
