/*
 * Driven port for subscription persistence + pool queries. Structurally
 * satisfies the subscription-oauth TokenStore (findById / updateTokens /
 * markUnusable) so the TokenManager reuses it without a cross-slice import.
 */

import type { PoolKind } from "../../../../shared/domain/Pool.ts";
import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import type {
	Subscription,
	SubscriptionStatus,
	TokenUpdate,
} from "../../domain/Subscription.ts";

export interface SubscriptionFilter {
	readonly poolKind?: PoolKind;
	readonly ownerUserId?: string;
	readonly provider?: ProviderId;
}

export interface SubscriptionRepository {
	insert(subscription: Subscription): Promise<void>;
	findById(subscriptionId: string): Promise<Subscription | undefined>;
	updateTokens(
		subscriptionId: string,
		tokens: TokenUpdate,
		updatedAt: string,
	): Promise<void>;
	markUnusable(
		subscriptionId: string,
		reason: string,
		updatedAt: string,
	): Promise<void>;
	setStatus(
		subscriptionId: string,
		status: SubscriptionStatus,
		updatedAt: string,
	): Promise<void>;
	/* Active subscriptions in one pool (own pool keyed by owner, or donor). */
	listByPool(
		poolKind: PoolKind,
		ownerUserId: string | null,
		provider: ProviderId,
	): Promise<Subscription[]>;
	/* All active subscriptions, any pool (prober). */
	listActive(): Promise<Subscription[]>;
	/* Management read: subscriptions matching the filter, all statuses. */
	list(filter: SubscriptionFilter): Promise<Subscription[]>;
}
