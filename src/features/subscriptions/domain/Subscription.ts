/*
 * Pooled subscription domain (spp-subscriptions:INV-001): exactly one pool per
 * subscription; tokens plaintext (pol:POL-SECRET-001), never on a read summary.
 */

import type { PoolKind } from "../../../shared/domain/Pool.ts";
import type { ProviderId } from "../../../shared/domain/Provider.ts";

export type SubscriptionStatus = "active" | "disabled" | "unusable" | "revoked";

/* eslint-disable-next-line max-properties-per-class/max-properties -- data entity mirrors the DB row (subscriptions); reshaping is a spec Delta, not a lint refactor */
export interface Subscription {
	readonly subscriptionId: string;
	readonly provider: ProviderId;
	readonly poolKind: PoolKind;
	readonly ownerUserId?: string;
	readonly label?: string;
	readonly status: SubscriptionStatus;
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly tokenExpiresAt: string;
	readonly scopes: string;
	readonly unusableReason?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/* Management read shape — no token columns (pol:POL-SECRET-001 negative). */
export interface SubscriptionSummary {
	readonly subscriptionId: string;
	readonly provider: ProviderId;
	readonly poolKind: PoolKind;
	readonly ownerUserId?: string;
	readonly label?: string;
	readonly status: SubscriptionStatus;
	readonly tokenExpiresAt: string;
	readonly createdAt: string;
}

/* Structurally identical to an OAuthGrant — a refreshed token set to persist. */
export interface TokenUpdate {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresAt: string;
	readonly scopes: string;
}

export function toSummary(subscription: Subscription): SubscriptionSummary {
	return {
		subscriptionId: subscription.subscriptionId,
		provider: subscription.provider,
		poolKind: subscription.poolKind,
		ownerUserId: subscription.ownerUserId,
		label: subscription.label,
		status: subscription.status,
		tokenExpiresAt: subscription.tokenExpiresAt,
		createdAt: subscription.createdAt,
	};
}
