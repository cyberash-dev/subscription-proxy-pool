/*
 * Narrow driven port the TokenManager needs over subscriptions: read tokens,
 * persist a refreshed grant, or mark the subscription unusable. The subscriptions
 * slice's repository structurally satisfies this — no cross-slice import needed.
 */

import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import type { OAuthGrant } from "../../domain/OAuthGrant.ts";

export interface TokenSubscription {
	readonly subscriptionId: string;
	readonly provider: ProviderId;
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly tokenExpiresAt: string;
	readonly status: string;
}

export interface TokenStore {
	findById(subscriptionId: string): Promise<TokenSubscription | undefined>;
	updateTokens(
		subscriptionId: string,
		grant: OAuthGrant,
		updatedAt: string,
	): Promise<void>;
	markUnusable(
		subscriptionId: string,
		reason: string,
		updatedAt: string,
	): Promise<void>;
}
