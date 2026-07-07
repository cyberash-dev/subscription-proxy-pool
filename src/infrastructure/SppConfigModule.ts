/*
 * Deployment config-module contract: SPP_CONFIG points at a module whose default
 * export satisfies this. The composition root merges its identity providers into
 * the registry beside the SPP_OIDC_* ones (spp-auth:CNT-002) and, when database()
 * is present, selects the storage engine from it, overriding env (spp-db:CNT-002).
 */

import type { Clock } from "../shared/domain/Clock.ts";
import type { FetchFn } from "../shared/http/Fetch.ts";
import type { IdentityProvider } from "../features/auth/ports/outbound/IdentityProvider.ts";
import type { EngineConfig } from "../shared/db/Connection.ts";

export interface IdentityProviderContext {
	readonly clock: Clock;
	readonly fetch: FetchFn;
}

export interface SppConfigModule {
	readonly identityProviders?: (
		ctx: IdentityProviderContext,
	) => Record<string, IdentityProvider>;
	readonly database?: () => EngineConfig;
}
