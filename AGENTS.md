# AGENTS.md — `subscription-proxy-pool`

Vendor-neutral guide for AI agents working in this package. It is a standalone
Node 20+/TypeScript service (its own git, `spec/`, `.sdd/`).

## What it is

Pools AI-subscription OAuth credentials and proxies the Anthropic Messages API
for Claude Code, auto-selecting the least-loaded subscription. See
[`README.md`](./README.md) for the surface and config.

## Spec-first (SDD)

The `spec/` tree is the source of truth (`.sdd/config.json`). Before changing
behaviour:

1. Find the partition under `spec/partitions/<slice>.md` (or a surface/policy).
2. Update the spec first (tighten an ID or add a `Delta`); new IDs land
   `lifecycle.status: proposed`.
3. `npm run sdd:lint` MUST be 0 before writing code.
4. Never self-approve: promotion `proposed → approved` is a non-agent reviewer
   running `sdd approve` + `sdd finalize`.

Every normative ID carries a `Test obligation` closed by a test marked
`@covers <partition>:<id>`.

## Conventions

- **Hexagonal vertical slices**: `src/features/<slice>/{domain,application,ports/{inbound,outbound},adapters/{inbound,outbound},tests}`.
  Cross-cutting kernel in `src/shared/`. Composition root in `src/infrastructure/`.
- **Ports, not drivers**: repositories depend on the `Engine` port and write
  `?`-placeholder SQL; no repository imports `better-sqlite3`/`pg` directly.
- **Provider seams**: all provider specifics live behind `IdentityProvider`
  (L1) and `SubscriptionOAuthProvider` (L2) + their registries. Nothing above
  the adapters references `api.anthropic.com`, `sk-ant-*`, or a concrete OIDC
  issuer (`pol:POL-PROVIDER-001`).
- **Secrets**: subscription OAuth tokens are encrypted at rest (AES-256-GCM,
  key ring from `SPP_TOKEN_CRYPT_KEYS`, held outside the DB) (`pol:POL-SECRET-001`);
  caller credentials (proxy keys, sessions) are stored hashed (SHA-256). Never
  log or return any secret.
- **Two credentials**: the inference surface accepts only a proxy key; the
  management surface only a session (`pol:POL-AUTH-001`). Not interchangeable.
- **Tests**: inline JSON-result runners on `tsx` (no Jest/Vitest/Mocha). Each
  `*.test.ts` prints `{ suite, results: [{ name, ok, error? }] }` and exits
  non-zero on failure. Register suites in `tests/suites.ts`.
- **Strict TS**: no `any`, no non-null `!`, no unsafe `as`. `npm run tsc` clean.

## Gates before proposing a change

```sh
npm run tsc && npm test && npm run sdd:lint
```
