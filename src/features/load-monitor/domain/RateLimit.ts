/*
 * Parse Anthropic unified rate-limit headers into a RateLimitSample
 * (spp-load-monitor:CNT-001). Every field is optional and NaN-guarded: absent or
 * malformed headers degrade to "unknown", never a crash. A 429 (or a
 * rate_limited status) yields a cooldown deadline.
 */

import type {
	RateLimitSample,
	RepresentativeWindow,
} from "../../../shared/domain/Load.ts";

export type HeaderGet = (name: string) => string | null | undefined;

const DEFAULT_COOLDOWN_MS = 5 * 60_000;

function numOrUndefined(raw: string | null | undefined): number | undefined {
	if (raw === null || raw === undefined || raw.trim().length === 0) {
		return undefined;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function unifiedStatus(
	raw: string | null | undefined,
): "allowed" | "rate_limited" | undefined {
	return raw === "allowed" || raw === "rate_limited" ? raw : undefined;
}

function representative(
	raw: string | null | undefined,
): RepresentativeWindow | undefined {
	if (raw === "five_hour") {
		return "5h";
	}
	if (raw === "seven_day") {
		return "7d";
	}
	return undefined;
}

export function parseRateLimitHeaders(
	get: HeaderGet,
	httpStatus: number,
	nowMs: number,
): RateLimitSample {
	const status = unifiedStatus(get("anthropic-ratelimit-unified-status"));
	const claim = representative(
		get("anthropic-ratelimit-unified-representative-claim"),
	);
	const util5h = numOrUndefined(
		get("anthropic-ratelimit-unified-5h-utilization"),
	);
	const reset5h = numOrUndefined(get("anthropic-ratelimit-unified-5h-reset"));
	const util7d = numOrUndefined(
		get("anthropic-ratelimit-unified-7d-utilization"),
	);
	const reset7d = numOrUndefined(get("anthropic-ratelimit-unified-7d-reset"));
	const retryAfterS =
		httpStatus === 429 ? numOrUndefined(get("retry-after")) : undefined;

	const representativeReset = claim === "7d" ? reset7d : reset5h;
	const cooldownUntil = computeCooldown(
		httpStatus,
		status,
		retryAfterS,
		representativeReset,
		nowMs,
	);

	return {
		unifiedStatus: status,
		representative: claim,
		util5h,
		reset5h,
		status5h: get("anthropic-ratelimit-unified-5h-status") ?? undefined,
		util7d,
		reset7d,
		status7d: get("anthropic-ratelimit-unified-7d-status") ?? undefined,
		retryAfterS,
		cooldownUntil,
		httpStatus,
	};
}

function computeCooldown(
	httpStatus: number,
	status: "allowed" | "rate_limited" | undefined,
	retryAfterS: number | undefined,
	representativeReset: number | undefined,
	nowMs: number,
): number | undefined {
	if (httpStatus === 429) {
		if (retryAfterS !== undefined) {
			return nowMs + retryAfterS * 1000;
		}
		if (representativeReset !== undefined) {
			return representativeReset * 1000;
		}
		return nowMs + DEFAULT_COOLDOWN_MS;
	}
	if (status === "rate_limited") {
		return representativeReset !== undefined
			? representativeReset * 1000
			: nowMs + DEFAULT_COOLDOWN_MS;
	}
	return undefined;
}
