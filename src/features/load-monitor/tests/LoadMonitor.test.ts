/*
 * Load monitoring: unified-header parsing, passive record, and the idle prober
 * (probe fresh, skip cooldown, skip recently-seen).
 *
 * @covers spp-load-monitor:BEH-001
 * @covers spp-load-monitor:BEH-002
 * @covers spp-load-monitor:BEH-003
 * @covers spp-load-monitor:CNT-001
 * @covers spp-load-monitor:CNST-001
 * @covers spp-load-monitor:DLT-001
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteEngine } from "../../../shared/db/SqliteEngine.ts";
import { applyMigrations } from "../../../shared/db/Migrations.ts";
import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { RateLimitSample } from "../../../shared/domain/Load.ts";
import type { ProviderId } from "../../../shared/domain/Provider.ts";
import { parseRateLimitHeaders } from "../domain/RateLimit.ts";
import { LoadMonitorService } from "../application/LoadMonitorService.ts";
import { SqliteLoadRepository } from "../adapters/outbound/SqliteLoadRepository.ts";
import type {
	ProbeInput,
	UpstreamProbe,
} from "../ports/outbound/UpstreamProbe.ts";

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

function getFrom(
	map: Record<string, string>,
): (name: string) => string | undefined {
	return (name) => map[name];
}

const NOW = Date.parse("2026-07-04T00:00:00.000Z");

function testParseAllowedHeaders(): void {
	const sample = parseRateLimitHeaders(
		getFrom({
			"anthropic-ratelimit-unified-status": "allowed",
			"anthropic-ratelimit-unified-representative-claim": "five_hour",
			"anthropic-ratelimit-unified-5h-utilization": "0.42",
			"anthropic-ratelimit-unified-5h-reset": "1790000000",
			"anthropic-ratelimit-unified-7d-utilization": "0.10",
		}),
		200,
		NOW,
	);
	assert(sample.unifiedStatus === "allowed", "status parsed");
	assert(sample.representative === "5h", "five_hour mapped to 5h");
	assert(sample.util5h === 0.42, "5h utilization parsed");
	assert(sample.util7d === 0.1, "7d utilization parsed");
	assert(sample.cooldownUntil === undefined, "allowed → no cooldown");
}

function testParse429SetsCooldownFromRetryAfter(): void {
	const sample = parseRateLimitHeaders(
		getFrom({ "retry-after": "120" }),
		429,
		NOW,
	);
	assert(sample.retryAfterS === 120, "retry-after parsed");
	assert(sample.cooldownUntil === NOW + 120_000, "cooldown from retry-after");
}

function testParseRateLimitedSetsCooldownFromReset(): void {
	const reset = 2_000_000_000;
	const sample = parseRateLimitHeaders(
		getFrom({
			"anthropic-ratelimit-unified-status": "rate_limited",
			"anthropic-ratelimit-unified-representative-claim": "five_hour",
			"anthropic-ratelimit-unified-5h-reset": String(reset),
		}),
		200,
		NOW,
	);
	assert(
		sample.cooldownUntil === reset * 1000,
		"cooldown from representative reset",
	);
}

function testParseAbsentHeadersAreUnknown(): void {
	const sample = parseRateLimitHeaders(getFrom({}), 200, NOW);
	assert(sample.unifiedStatus === undefined, "unknown status");
	assert(sample.util5h === undefined, "unknown utilization");
	assert(sample.cooldownUntil === undefined, "no cooldown");
	assert(sample.httpStatus === 200, "http status recorded");
}

class FakeProbe implements UpstreamProbe {
	readonly probed: string[] = [];
	probe(input: ProbeInput): Promise<RateLimitSample> {
		this.probed.push(input.subscriptionId);
		return Promise.resolve({
			unifiedStatus: "allowed",
			util5h: 0.1,
			httpStatus: 200,
		});
	}
}

interface ProberHarness {
	readonly service: LoadMonitorService;
	readonly loads: SqliteLoadRepository;
	readonly probe: FakeProbe;
	readonly engine: SqliteEngine;
	readonly cleanup: () => void;
}

async function insertSub(engine: SqliteEngine, id: string): Promise<void> {
	await engine.run(
		`INSERT INTO subscriptions(subscription_id, provider, pool_kind, owner_user_id, status,
		   access_token, refresh_token, token_expires_at, scopes, created_at, updated_at)
		 VALUES(?, 'anthropic', 'donor', NULL, 'active', 'a', 'r', '2030-01-01T00:00:00.000Z', 'x',
		        datetime('now'), datetime('now'))`,
		[id],
	);
}

async function mkProberHarness(): Promise<ProberHarness> {
	const dir = mkdtempSync(join(tmpdir(), "spp-load-"));
	const db = new Database(join(dir, "pool.db"));
	const engine = new SqliteEngine(db);
	await applyMigrations(engine);
	for (const id of ["sub-1", "sub-2", "sub-3"]) {
		await insertSub(engine, id);
	}
	const loads = new SqliteLoadRepository(engine);
	const probe = new FakeProbe();
	const clock = new FakeClock(NOW);
	const service = new LoadMonitorService({
		loads,
		probe,
		clock,
		idleThresholdMs: 120_000,
		listActiveSubscriptionIds: () =>
			Promise.resolve(["sub-1", "sub-2", "sub-3"]),
		ensureFreshToken: () => Promise.resolve("tok"),
	});
	return {
		service,
		loads,
		probe,
		engine,
		cleanup: () => {
			try {
				db.close();
			} catch {
				/* ignore */
			}
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

async function testRecordLoadPersistsSnapshot(): Promise<void> {
	const h = await mkProberHarness();
	try {
		await h.service.recordLoad("sub-1", {
			unifiedStatus: "allowed",
			util5h: 0.3,
			httpStatus: 200,
		});
		const latest = await h.loads.latestBySubscription("sub-1");
		assert(latest?.util5h === 0.3, "snapshot persisted");
		assert(latest?.source === "passive", "recorded as passive");
	} finally {
		h.cleanup();
	}
}

async function testProbeIdleProbesFreshSkipsCooldownAndRecent(): Promise<void> {
	const h = await mkProberHarness();
	try {
		/* sub-2 is fenced (cooldown in the future). */
		await h.loads.insertSnapshot({
			subscriptionId: "sub-2",
			sampledAt: new Date(NOW - 10_000).toISOString(),
			source: "passive",
			cooldownUntil: NOW + 60_000,
			httpStatus: 429,
		});
		/* sub-3 was seen recently (within the idle threshold). */
		await h.loads.insertSnapshot({
			subscriptionId: "sub-3",
			sampledAt: new Date(NOW - 60_000).toISOString(),
			source: "passive",
			util5h: 0.2,
			httpStatus: 200,
		});

		await h.service.probeIdle();

		assert(h.probe.probed.length === 1, "only one subscription probed");
		assert(
			h.probe.probed[0] === "sub-1",
			"the idle, uncooled subscription was probed",
		);
		const latest = await h.loads.latestBySubscription("sub-1");
		assert(latest?.source === "probe", "probe result recorded");
	} finally {
		h.cleanup();
	}
}

async function testProbeIdleRequestsAnthropicSubscriptions(): Promise<void> {
	const h = await mkProberHarness();
	try {
		let requestedProvider: ProviderId | undefined;
		const service = new LoadMonitorService({
			loads: h.loads,
			probe: h.probe,
			clock: new FakeClock(NOW),
			idleThresholdMs: 120_000,
			listActiveSubscriptionIds: (provider?: ProviderId) => {
				requestedProvider = provider;
				return Promise.resolve([]);
			},
			ensureFreshToken: () => Promise.resolve("tok"),
		});

		await service.probeIdle();

		assert(
			requestedProvider === "anthropic",
			"idle prober requests only Anthropic subscriptions",
		);
	} finally {
		h.cleanup();
	}
}

async function main(): Promise<void> {
	await runTest("parse_allowed_headers", () => {
		testParseAllowedHeaders();
	});
	await runTest("parse_429_sets_cooldown_from_retry_after", () => {
		testParse429SetsCooldownFromRetryAfter();
	});
	await runTest("parse_rate_limited_sets_cooldown_from_reset", () => {
		testParseRateLimitedSetsCooldownFromReset();
	});
	await runTest("parse_absent_headers_are_unknown", () => {
		testParseAbsentHeadersAreUnknown();
	});
	await runTest(
		"record_load_persists_snapshot",
		testRecordLoadPersistsSnapshot,
	);
	await runTest(
		"probe_idle_probes_fresh_skips_cooldown_and_recent",
		testProbeIdleProbesFreshSkipsCooldownAndRecent,
	);
	await runTest(
		"probe_idle_requests_anthropic_subscriptions",
		testProbeIdleRequestsAnthropicSubscriptions,
	);

	const report = { suite: "LoadMonitor", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
