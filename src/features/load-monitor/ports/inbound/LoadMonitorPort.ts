/* Driving port for load monitoring: passive record + active probe sweep. */

import type { RateLimitSample } from "../../../../shared/domain/Load.ts";

export interface LoadMonitorPort {
	/* Passive harvest: record a sample observed on a proxied response. */
	recordLoad(subscriptionId: string, sample: RateLimitSample): Promise<void>;
	/* Active sweep: probe subscriptions idle beyond the threshold. */
	probeIdle(): Promise<void>;
}
