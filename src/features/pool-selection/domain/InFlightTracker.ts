/*
 * In-memory per-subscription in-flight counter (per process). Biases selection
 * so concurrent requests spread across subscriptions instead of piling onto the
 * momentarily-lowest-utilization one.
 */

export class InFlightTracker {
	private readonly counts = new Map<string, number>();

	get(subscriptionId: string): number {
		return this.counts.get(subscriptionId) ?? 0;
	}

	increment(subscriptionId: string): void {
		this.counts.set(subscriptionId, this.get(subscriptionId) + 1);
	}

	decrement(subscriptionId: string): void {
		const next = this.get(subscriptionId) - 1;
		if (next <= 0) {
			this.counts.delete(subscriptionId);
		} else {
			this.counts.set(subscriptionId, next);
		}
	}
}
