/* Driven port for load-snapshot persistence (owns subscription_load). */

import type { LoadSnapshot } from "../../../../shared/domain/Load.ts";

export interface LoadRepository {
	insertSnapshot(snapshot: LoadSnapshot): Promise<void>;
	latestBySubscription(
		subscriptionId: string,
	): Promise<LoadSnapshot | undefined>;
}
