/* Driving port for subscription management. */

import type { PoolKind } from "../../../../shared/domain/Pool.ts";
import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import type { SubscriptionSummary } from "../../domain/Subscription.ts";

export interface AddSubscriptionInput {
	readonly provider: ProviderId;
	readonly poolKind: PoolKind;
	readonly ownerUserId?: string;
	readonly label?: string;
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly tokenExpiresAt: string;
	readonly scopes: string;
}

export interface SubscriptionsPort {
	add(input: AddSubscriptionInput): Promise<{ subscriptionId: string }>;
	/* Disable a user-pool subscription the caller owns. */
	disable(userId: string, subscriptionId: string): Promise<void>;
	list(filter: {
		readonly poolKind?: PoolKind;
		readonly ownerUserId?: string;
		readonly provider?: ProviderId;
	}): Promise<SubscriptionSummary[]>;
}
