/*
 * Cross-cutting load types shared by load-monitor (which produces them) and
 * pool-selection (which reads them). A RateLimitSample is what the Anthropic
 * unified rate-limit headers yield; a LoadSnapshot is a persisted sample.
 */

export type UnifiedStatus = "allowed" | "rate_limited";
export type RepresentativeWindow = "5h" | "7d";

/* eslint-disable-next-line max-properties-per-class/max-properties -- one field per unified rate-limit header (spp-load-monitor:CNT-001) */
export interface RateLimitSample {
	readonly unifiedStatus?: UnifiedStatus;
	readonly representative?: RepresentativeWindow;
	readonly util5h?: number;
	readonly reset5h?: number;
	readonly status5h?: string;
	readonly util7d?: number;
	readonly reset7d?: number;
	readonly status7d?: string;
	readonly retryAfterS?: number;
	/* Unix ms until which the subscription is fenced (from 429 / rate_limited). */
	readonly cooldownUntil?: number;
	readonly httpStatus?: number;
}

export type LoadSource = "passive" | "probe";

export interface LoadSnapshot extends RateLimitSample {
	readonly subscriptionId: string;
	readonly sampledAt: string;
	readonly source: LoadSource;
}
