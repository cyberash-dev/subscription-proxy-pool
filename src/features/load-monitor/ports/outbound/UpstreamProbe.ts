/* Driven port for the active load prober — a cheap upstream call that returns
 * only the parsed rate-limit sample. */

import type { RateLimitSample } from "../../../../shared/domain/Load.ts";

export interface ProbeInput {
	readonly subscriptionId: string;
	readonly accessToken: string;
}

export interface UpstreamProbe {
	probe(input: ProbeInput): Promise<RateLimitSample>;
}
