/*
 * Least-loaded selection: score, eligibility fence, tie-breaks, no-capacity, and
 * an end-to-end select over a SQLite pool.
 *
 * @covers spp-pool-selection:INV-001
 * @covers spp-pool-selection:INV-002
 * @covers spp-pool-selection:BEH-001
 * @covers spp-pool-selection:BEH-002
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteEngine } from "../../../shared/db/SqliteEngine.ts";
import { applyMigrations } from "../../../shared/db/Migrations.ts";
import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { LoadSnapshot } from "../../../shared/domain/Load.ts";
import { HttpError } from "../../../shared/http/Errors.ts";
import { SqliteLoadRepository } from "../../load-monitor/adapters/outbound/SqliteLoadRepository.ts";
import { SqliteSubscriptionRepository } from "../../subscriptions/adapters/outbound/SqliteSubscriptionRepository.ts";
import { crypterForTests } from "../../../shared/crypto/tests/crypterForTests.ts";
import { InFlightTracker } from "../domain/InFlightTracker.ts";
import {
	type SelectionCandidate,
	isEligible,
	loadScore,
	selectLeastLoaded,
} from "../domain/Selection.ts";
import { SelectSubscriptionUseCase } from "../application/SelectSubscriptionUseCase.ts";

interface TestRecord {
	name: string;
	ok: boolean;
	error?: string;
}
const results: TestRecord[] = [];

async function runTest(
	name: string,
	fn: () => Promise<void> | void,
): Promise<void> {
	try {
		await fn();
		results.push({ name, ok: true });
	} catch (err) {
		const message =
			err instanceof Error ? (err.stack ?? err.message) : String(err);
		results.push({ name, ok: false, error: message });
	}
}

function assert(cond: boolean, label: string): void {
	if (!cond) {
		throw new Error(label);
	}
}

const NOW = Date.parse("2026-07-04T00:00:00.000Z");

function snap(id: string, fields: Partial<LoadSnapshot>): LoadSnapshot {
	return {
		subscriptionId: id,
		sampledAt: new Date(NOW).toISOString(),
		source: "passive",
		representative: "5h",
		...fields,
	};
}

function cand(
	id: string,
	snapshot?: LoadSnapshot,
	inFlight = 0,
): SelectionCandidate {
	return { subscriptionId: id, snapshot, inFlight };
}

function testChoosesLowestUtilization(): void {
	const result = selectLeastLoaded(
		[
			cand("a", snap("a", { util5h: 0.8 })),
			cand("b", snap("b", { util5h: 0.2 })),
			cand("c", snap("c", { util5h: 0.5 })),
		],
		NOW,
	);
	assert(
		result.kind === "ok" && result.subscriptionId === "b",
		"lowest utilization chosen",
	);
}

function testUnknownSnapshotIsMidAndEligible(): void {
	assert(loadScore(undefined) === 0.5, "unknown scores 0.5");
	const result = selectLeastLoaded(
		[cand("a", snap("a", { util5h: 0.7 })), cand("fresh", undefined)],
		NOW,
	);
	assert(
		result.kind === "ok" && result.subscriptionId === "fresh",
		"fresh subscription (0.5) beats a 0.7-loaded one",
	);
}

function testFencedCooldownExcluded(): void {
	const fenced = snap("a", { cooldownUntil: NOW + 60_000 });
	assert(!isEligible(fenced, NOW), "cooldown in the future is fenced");
	assert(
		isEligible(fenced, NOW + 61_000),
		"eligible again after cooldown passes",
	);
}

function testRateLimitedAndNearFullExcluded(): void {
	assert(
		!isEligible(snap("a", { unifiedStatus: "rate_limited" }), NOW),
		"rate_limited fenced",
	);
	assert(!isEligible(snap("a", { util5h: 0.99 }), NOW), "near-full fenced");
	assert(isEligible(snap("a", { util5h: 0.5 }), NOW), "mid load eligible");
}

function testAllFencedYieldsNoCapacityWithRetry(): void {
	const result = selectLeastLoaded(
		[
			cand("a", snap("a", { cooldownUntil: NOW + 120_000 })),
			cand("b", snap("b", { cooldownUntil: NOW + 45_000 })),
		],
		NOW,
	);
	assert(result.kind === "no_capacity", "all fenced → no_capacity");
	assert(
		result.kind === "no_capacity" && result.retryAfterSeconds === 45,
		"retry-after from the soonest reset",
	);
}

function testEmptyPool(): void {
	assert(selectLeastLoaded([], NOW).kind === "empty", "empty pool reported");
}

function testInFlightBiasBreaksTie(): void {
	const result = selectLeastLoaded(
		[
			cand("busy", snap("busy", { util5h: 0.5 }), 3),
			cand("idle", snap("idle", { util5h: 0.5 }), 0),
		],
		NOW,
	);
	assert(
		result.kind === "ok" && result.subscriptionId === "idle",
		"equal utilization → the less busy subscription wins",
	);
}

function testDeterministicTieBreakById(): void {
	const result = selectLeastLoaded(
		[
			cand("zeta", snap("zeta", { util5h: 0.4 })),
			cand("alpha", snap("alpha", { util5h: 0.4 })),
		],
		NOW,
	);
	assert(
		result.kind === "ok" && result.subscriptionId === "alpha",
		"id tie-break is deterministic",
	);
}

async function insertDonorSub(engine: SqliteEngine, id: string): Promise<void> {
	const crypter = crypterForTests();
	await engine.run(
		`INSERT INTO subscriptions(subscription_id, provider, pool_kind, owner_user_id, status,
		   access_token, refresh_token, token_expires_at, scopes, created_at, updated_at)
		 VALUES(?, 'anthropic', 'donor', NULL, 'active', ?, ?, '2030-01-01T00:00:00.000Z', 'x',
		        datetime('now'), datetime('now'))`,
		[id, crypter.encrypt("a"), crypter.encrypt("r")],
	);
}

async function testEndToEndSelectAndExclude(): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "spp-select-"));
	const db = new Database(join(dir, "pool.db"));
	const engine = new SqliteEngine(db);
	try {
		await applyMigrations(engine);
		await insertDonorSub(engine, "sub-hi");
		await insertDonorSub(engine, "sub-lo");
		const loads = new SqliteLoadRepository(engine);
		await loads.insertSnapshot(
			snap("sub-hi", { util5h: 0.9, source: "passive" }),
		);
		await loads.insertSnapshot(
			snap("sub-lo", { util5h: 0.1, source: "passive" }),
		);

		const useCase = new SelectSubscriptionUseCase(
			new SqliteSubscriptionRepository(engine, crypterForTests()),
			loads,
			new InFlightTracker(),
			new FakeClock(NOW),
		);

		const chosen = await useCase.select({
			poolTarget: "donor",
			userId: "user-a",
			provider: "anthropic",
		});
		assert(
			chosen.subscriptionId === "sub-lo",
			"least-loaded donor subscription selected",
		);

		const excluded = await useCase.select(
			{ poolTarget: "donor", userId: "user-a", provider: "anthropic" },
			new Set(["sub-lo"]),
		);
		assert(
			excluded.subscriptionId === "sub-hi",
			"exclusion forces the next candidate",
		);

		let status = 0;
		try {
			await useCase.select(
				{ poolTarget: "donor", userId: "user-a", provider: "anthropic" },
				new Set(["sub-lo", "sub-hi"]),
			);
		} catch (err) {
			status = err instanceof HttpError ? err.status : 0;
		}
		assert(status === 503, "exhausted pool yields 503");
	} finally {
		try {
			db.close();
		} catch {
			/* ignore */
		}
		rmSync(dir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	await runTest("chooses_lowest_utilization", () => {
		testChoosesLowestUtilization();
	});
	await runTest("unknown_snapshot_is_mid_and_eligible", () => {
		testUnknownSnapshotIsMidAndEligible();
	});
	await runTest("fenced_cooldown_excluded", () => {
		testFencedCooldownExcluded();
	});
	await runTest("rate_limited_and_near_full_excluded", () => {
		testRateLimitedAndNearFullExcluded();
	});
	await runTest("all_fenced_yields_no_capacity_with_retry", () => {
		testAllFencedYieldsNoCapacityWithRetry();
	});
	await runTest("empty_pool", () => {
		testEmptyPool();
	});
	await runTest("in_flight_bias_breaks_tie", () => {
		testInFlightBiasBreaksTie();
	});
	await runTest("deterministic_tie_break_by_id", () => {
		testDeterministicTieBreakById();
	});
	await runTest("end_to_end_select_and_exclude", testEndToEndSelectAndExclude);

	const report = { suite: "PoolSelection", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
