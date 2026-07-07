/*
 * Pure least-loaded selection (spp-pool-selection:INV-001/INV-002): lowest
 * representative-window utilization; unknown counts as mid; fenced never picked.
 */

import type { LoadSnapshot } from "../../../shared/domain/Load.ts";

const UNKNOWN_SCORE = 0.5;
const NEAR_FULL = 0.98;
const IN_FLIGHT_WEIGHT = 0.05;

export interface SelectionCandidate {
	readonly subscriptionId: string;
	readonly snapshot?: LoadSnapshot;
	readonly inFlight: number;
}

export type SelectionResult =
	| { readonly kind: "ok"; readonly subscriptionId: string }
	| { readonly kind: "no_capacity"; readonly retryAfterSeconds: number }
	| { readonly kind: "empty" };

function windowUtil(snapshot: LoadSnapshot): number | undefined {
	if (snapshot.representative === "7d") {
		return snapshot.util7d;
	}
	if (snapshot.representative === "5h") {
		return snapshot.util5h;
	}
	const values = [snapshot.util5h, snapshot.util7d].filter(
		(v): v is number => v !== undefined,
	);
	return values.length > 0 ? Math.max(...values) : undefined;
}

export function loadScore(snapshot: LoadSnapshot | undefined): number {
	if (snapshot === undefined) {
		return UNKNOWN_SCORE;
	}
	const util = windowUtil(snapshot);
	if (util === undefined) {
		return UNKNOWN_SCORE;
	}
	return Math.min(Math.max(util, 0), 1);
}

export function isEligible(
	snapshot: LoadSnapshot | undefined,
	nowMs: number,
): boolean {
	if (snapshot === undefined) {
		return true;
	}
	if (snapshot.cooldownUntil !== undefined && snapshot.cooldownUntil > nowMs) {
		return false;
	}
	if (snapshot.unifiedStatus === "rate_limited") {
		return false;
	}
	return loadScore(snapshot) < NEAR_FULL;
}

function representativeResetMs(
	snapshot: LoadSnapshot | undefined,
): number | undefined {
	if (snapshot === undefined) {
		return undefined;
	}
	if (snapshot.cooldownUntil !== undefined) {
		return snapshot.cooldownUntil;
	}
	const reset =
		snapshot.representative === "7d" ? snapshot.reset7d : snapshot.reset5h;
	return reset !== undefined ? reset * 1000 : undefined;
}

export function selectLeastLoaded(
	candidates: ReadonlyArray<SelectionCandidate>,
	nowMs: number,
): SelectionResult {
	if (candidates.length === 0) {
		return { kind: "empty" };
	}
	const eligible = candidates.filter((c) => isEligible(c.snapshot, nowMs));
	if (eligible.length === 0) {
		return {
			kind: "no_capacity",
			retryAfterSeconds: soonestRetry(candidates, nowMs),
		};
	}
	const ranked = [...eligible].sort((a, b) => {
		const scoreA = loadScore(a.snapshot) + IN_FLIGHT_WEIGHT * a.inFlight;
		const scoreB = loadScore(b.snapshot) + IN_FLIGHT_WEIGHT * b.inFlight;
		if (scoreA !== scoreB) {
			return scoreA - scoreB;
		}
		if (a.inFlight !== b.inFlight) {
			return a.inFlight - b.inFlight;
		}
		return a.subscriptionId.localeCompare(b.subscriptionId);
	});
	return { kind: "ok", subscriptionId: ranked[0].subscriptionId };
}

function soonestRetry(
	candidates: ReadonlyArray<SelectionCandidate>,
	nowMs: number,
): number {
	let soonest: number | undefined;
	for (const candidate of candidates) {
		const reset = representativeResetMs(candidate.snapshot);
		if (reset === undefined) {
			continue;
		}
		soonest = soonest === undefined ? reset : Math.min(soonest, reset);
	}
	if (soonest === undefined) {
		return 30;
	}
	return Math.max(1, Math.ceil((soonest - nowMs) / 1000));
}
