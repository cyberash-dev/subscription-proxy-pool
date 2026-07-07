/*
 * Subscription management use cases (spp-subscriptions): add to a user/donor
 * pool, disable, list. Enforces the one-pool membership invariant
 * (spp-subscriptions:INV-001) before the DB CHECK does.
 */

import type { Clock } from "../../../shared/domain/Clock.ts";
import { newUuid } from "../../../shared/domain/Scalars.ts";
import { badRequest, notFound } from "../../../shared/http/Errors.ts";
import { toSummary, type SubscriptionSummary } from "../domain/Subscription.ts";
import type { SubscriptionRepository } from "../ports/outbound/SubscriptionRepository.ts";
import type {
	AddSubscriptionInput,
	SubscriptionsPort,
} from "../ports/inbound/SubscriptionsPort.ts";

export class SubscriptionsService implements SubscriptionsPort {
	constructor(
		private readonly repo: SubscriptionRepository,
		private readonly clock: Clock,
	) {}

	async add(input: AddSubscriptionInput): Promise<{ subscriptionId: string }> {
		const ownerUserId = this.validatedOwner(input.poolKind, input.ownerUserId);
		const subscriptionId = newUuid();
		const now = this.clock.nowIso();
		await this.repo.insert({
			subscriptionId,
			provider: input.provider,
			poolKind: input.poolKind,
			ownerUserId,
			label: input.label,
			status: "active",
			accessToken: input.accessToken,
			refreshToken: input.refreshToken,
			tokenExpiresAt: input.tokenExpiresAt,
			scopes: input.scopes,
			createdAt: now,
			updatedAt: now,
		});
		return { subscriptionId };
	}

	async disable(userId: string, subscriptionId: string): Promise<void> {
		const subscription = await this.repo.findById(subscriptionId);
		if (subscription === undefined || subscription.ownerUserId !== userId) {
			throw notFound(`subscription not found: ${subscriptionId}`);
		}
		await this.repo.setStatus(subscriptionId, "disabled", this.clock.nowIso());
	}

	async list(filter: {
		readonly poolKind?: "user" | "donor";
		readonly ownerUserId?: string;
		readonly provider?: "anthropic" | "openai";
	}): Promise<SubscriptionSummary[]> {
		const subscriptions = await this.repo.list(filter);
		return subscriptions.map(toSummary);
	}

	private validatedOwner(
		poolKind: "user" | "donor",
		ownerUserId: string | undefined,
	): string | undefined {
		if (poolKind === "user" && ownerUserId === undefined) {
			throw badRequest("user-pool subscription requires an owner");
		}
		if (poolKind === "donor" && ownerUserId !== undefined) {
			throw badRequest("donor-pool subscription must not have an owner");
		}
		return poolKind === "user" ? ownerUserId : undefined;
	}
}
