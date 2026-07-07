/* Driving port for pool selection. Returns the chosen subscription (with its
 * tokens) or throws a 503 when the pool has no capacity. */

import type { PoolTarget } from "../../../../shared/domain/Pool.ts";
import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import type { Subscription } from "../../../subscriptions/domain/Subscription.ts";

export interface SelectionRequest {
	readonly poolTarget: PoolTarget;
	readonly userId: string;
	readonly provider: ProviderId;
}

export interface PoolSelectionPort {
	select(
		request: SelectionRequest,
		exclude?: ReadonlySet<string>,
	): Promise<Subscription>;
}
