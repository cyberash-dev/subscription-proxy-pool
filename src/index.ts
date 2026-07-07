/*
 * Public API surface for external consumers: authors of an SPP_CONFIG module
 * (`SppConfigModule` + engine selection) and of an `IdentityProvider` adapter
 * wired through it. Runtime code stays internal; this only re-exports the
 * contract types an integrator needs.
 */

export type {
	SppConfigModule,
	IdentityProviderContext,
} from "./infrastructure/SppConfigModule.ts";
export type {
	IdentityProvider,
	AuthorizeUrlInput,
	ExchangeCodeInput,
} from "./features/auth/ports/outbound/IdentityProvider.ts";
export type { ExternalIdentity } from "./features/auth/domain/User.ts";
export type {
	EngineConfig,
	SqliteEngineConfig,
	PostgresEngineConfig,
} from "./shared/db/Connection.ts";
export type { Clock } from "./shared/domain/Clock.ts";
export type { FetchFn } from "./shared/http/Fetch.ts";
export type { PkceChallenge } from "./shared/pkce/Pkce.ts";
