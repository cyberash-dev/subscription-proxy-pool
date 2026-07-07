/* Driving port for proxy-key management + inference-time resolution. */

import type {
	Principal,
	PoolTarget,
	ProxyKeySummary,
} from "../../domain/ProxyKey.ts";

export interface IssuedKey {
	readonly keyId: string;
	/* The plaintext secret — returned once, never stored or re-derivable. */
	readonly secret: string;
	readonly poolTarget: PoolTarget;
}

export interface AccessKeysPort {
	issueKey(userId: string, poolTarget: PoolTarget): Promise<IssuedKey>;
	revokeKey(userId: string, keyId: string): Promise<void>;
	listKeys(userId: string): Promise<ProxyKeySummary[]>;
	/* Hot path: resolve an incoming proxy-key bearer to its principal. */
	resolvePrincipal(bearer: string): Promise<Principal | undefined>;
}
