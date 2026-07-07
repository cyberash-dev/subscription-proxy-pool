/*
 * Level-2 subscription OAuth domain: the grant a provider yields (and later
 * refreshes). These tokens ARE persisted (they are the inference credential),
 * unlike the transient L1 identity tokens.
 */

export interface OAuthGrant {
	readonly accessToken: string;
	readonly refreshToken: string;
	/* ISO-8601 instant the access token expires. */
	readonly expiresAt: string;
	readonly scopes: string;
}

export type { PoolKind } from "../../../shared/domain/Pool.ts";
