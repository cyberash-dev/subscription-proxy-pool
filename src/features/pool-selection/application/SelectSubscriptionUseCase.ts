/*
 * Orchestrates least-loaded selection (spp-pool-selection). Borrows the
 * subscriptions and load-monitor driven ports (per plan) to gather candidates,
 * runs the pure selector, and returns the chosen subscription — or throws a 503.
 */

import type { Clock } from "../../../shared/domain/Clock.ts";
import { noCapacity } from "../../../shared/http/Errors.ts";
import type { LoadRepository } from "../../load-monitor/ports/outbound/LoadRepository.ts";
import type { Subscription } from "../../subscriptions/domain/Subscription.ts";
import type { SubscriptionRepository } from "../../subscriptions/ports/outbound/SubscriptionRepository.ts";
import type { InFlightTracker } from "../domain/InFlightTracker.ts";
import {
	type SelectionCandidate,
	selectLeastLoaded,
} from "../domain/Selection.ts";
import type {
	PoolSelectionPort,
	SelectionRequest,
} from "../ports/inbound/PoolSelectionPort.ts";

export class SelectSubscriptionUseCase implements PoolSelectionPort {
	constructor(
		private readonly subscriptions: SubscriptionRepository,
		private readonly loads: LoadRepository,
		private readonly inFlight: InFlightTracker,
		private readonly clock: Clock,
	) {}

	async select(
		request: SelectionRequest,
		exclude: ReadonlySet<string> = new Set(),
	): Promise<Subscription> {
		const poolKind = request.poolTarget === "own" ? "user" : "donor";
		const ownerUserId = request.poolTarget === "own" ? request.userId : null;
		const pool = await this.subscriptions.listByPool(
			poolKind,
			ownerUserId,
			request.provider,
		);
		const eligible = pool.filter((s) => !exclude.has(s.subscriptionId));

		const candidates = await this.gatherCandidates(eligible);
		const result = selectLeastLoaded(candidates, this.clock.nowMs());
		if (result.kind === "ok") {
			const chosen = eligible.find(
				(s) => s.subscriptionId === result.subscriptionId,
			);
			if (chosen !== undefined) {
				return chosen;
			}
		}
		const retryAfter =
			result.kind === "no_capacity" ? result.retryAfterSeconds : 30;
		throw noCapacity(retryAfter);
	}

	private async gatherCandidates(
		subscriptions: ReadonlyArray<Subscription>,
	): Promise<SelectionCandidate[]> {
		return Promise.all(
			subscriptions.map(async (subscription) => ({
				subscriptionId: subscription.subscriptionId,
				snapshot: await this.loads.latestBySubscription(
					subscription.subscriptionId,
				),
				inFlight: this.inFlight.get(subscription.subscriptionId),
			})),
		);
	}
}
