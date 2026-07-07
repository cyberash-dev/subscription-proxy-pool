/*
 * Inference proxy use cases: auth, pool routing, identity injection, header
 * hygiene, refresh-on-401, 429 failover, refresh-failure failover, no-capacity,
 * passive harvest. Streaming passthrough is in Proxy.streaming.test.ts.
 *
 * @covers spp-proxy:BEH-001
 * @covers spp-proxy:BEH-002
 * @covers spp-proxy:BEH-003
 * @covers spp-proxy:BEH-004
 * @covers spp-proxy:INV-001
 * @covers pol:POL-AUTH-001
 */

import { HttpError } from "../../../shared/http/Errors.ts";
import {
	FakeLoadMonitor,
	FakeSelector,
	FakeTokens,
	FakeUpstream,
	drain,
	jsonResponse,
	mkSub,
	mkUseCase,
} from "./proxyFakes.ts";

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

async function testRejectsMissingOrBadKey(): Promise<void> {
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok")]),
		upstream: new FakeUpstream(() => jsonResponse(200)),
	});
	for (const bearer of [undefined, "bad"]) {
		let status = 0;
		try {
			await useCase.handle({
				bearer,
				path: "/v1/messages",
				body: {},
				wantStream: false,
			});
		} catch (err) {
			status = err instanceof HttpError ? err.status : 0;
		}
		assert(status === 401, `bearer ${String(bearer)} rejected with 401`);
	}
}

async function testRoutesToPrincipalPool(): Promise<void> {
	const selector = new FakeSelector([mkSub("s1", "tok")]);
	const useCase = mkUseCase({
		selector,
		upstream: new FakeUpstream(() => jsonResponse(200)),
	});
	await drain(
		await useCase.handle({
			bearer: "good-donor",
			path: "/v1/messages",
			body: { model: "claude-opus-4-8" },
			wantStream: false,
		}),
	);
	assert(
		selector.lastRequest?.poolTarget === "donor",
		"donor key routes to donor pool",
	);
	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "claude-opus-4-8" },
			wantStream: false,
		}),
	);
	assert(
		selector.lastRequest?.poolTarget === "own",
		"own key routes to own pool",
	);
}

async function testInjectsIdentityForNonHaiku(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok")]),
		upstream,
	});
	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "claude-opus-4-8", messages: [] },
			wantStream: false,
		}),
	);
	const forwarded = JSON.parse(upstream.requests[0].body) as {
		system?: unknown;
	};
	assert(Array.isArray(forwarded.system), "system injected as array");
	const first = (forwarded.system as Array<{ text?: string }>)[0];
	assert(
		typeof first.text === "string" &&
			first.text.startsWith(
				"You are Claude Code, Anthropic's official CLI for Claude.",
			),
		"identity block prepended for non-Haiku",
	);
}

async function testHaikuUntouched(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok")]),
		upstream,
	});
	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "claude-haiku-4-5", messages: [] },
			wantStream: false,
		}),
	);
	const forwarded = JSON.parse(upstream.requests[0].body) as {
		system?: unknown;
	};
	assert(
		forwarded.system === undefined,
		"Haiku request left without a system block",
	);
}

async function testForwardsModelAndThinking(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok")]),
		upstream,
	});
	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: {
				model: "claude-opus-4-8",
				max_tokens: 4096,
				thinking: { type: "enabled", budget_tokens: 8000 },
				messages: [],
			},
			wantStream: false,
		}),
	);
	const forwarded = JSON.parse(upstream.requests[0].body) as {
		model?: unknown;
		max_tokens?: unknown;
		thinking?: { type?: unknown; budget_tokens?: unknown };
	};
	assert(forwarded.model === "claude-opus-4-8", "model forwarded unchanged");
	assert(forwarded.max_tokens === 4096, "max_tokens forwarded unchanged");
	assert(
		forwarded.thinking?.type === "enabled" &&
			forwarded.thinking?.budget_tokens === 8000,
		"thinking (reasoning-effort) block forwarded unchanged",
	);
}

async function testHeaderHygiene(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok-a")]),
		upstream,
	});
	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "claude-opus-4-8" },
			wantStream: false,
		}),
	);
	const headers = upstream.requests[0].headers;
	assert(headers["authorization"] === "Bearer tok-a", "our Bearer injected");
	assert(
		headers["anthropic-version"] === "2023-06-01",
		"anthropic-version set",
	);
	assert(
		headers["anthropic-beta"].includes("oauth-2025-04-20"),
		"anthropic-beta set",
	);
	assert(!("x-api-key" in headers), "no x-api-key forwarded");
}

async function testRefreshOn401RetriesOnce(): Promise<void> {
	const tokens = new FakeTokens();
	const upstream = new FakeUpstream((request, index) => {
		if (index === 0) {
			return jsonResponse(401);
		}
		assert(
			request.headers["authorization"] === "Bearer refreshed-token",
			"retry uses refreshed token",
		);
		return jsonResponse(200);
	});
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok-a")]),
		upstream,
		tokens,
	});
	const relay = await useCase.handle({
		bearer: "good-own",
		path: "/v1/messages",
		body: { model: "claude-opus-4-8" },
		wantStream: false,
	});
	assert(relay.status === 200, "200 after refresh retry");
	assert(tokens.refreshCount === 1, "refreshed exactly once");
	await drain(relay);
}

async function testFailoverOn429(): Promise<void> {
	const loadMonitor = new FakeLoadMonitor();
	const upstream = new FakeUpstream((request) =>
		request.headers["authorization"] === "Bearer tok-1"
			? jsonResponse(429, { "retry-after": "300" })
			: jsonResponse(200),
	);
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok-1"), mkSub("s2", "tok-2")]),
		upstream,
		loadMonitor,
	});
	const relay = await useCase.handle({
		bearer: "good-donor",
		path: "/v1/messages",
		body: { model: "claude-opus-4-8" },
		wantStream: false,
	});
	assert(relay.status === 200, "failed over to the healthy subscription");
	assert(upstream.requests.length === 2, "both subscriptions attempted");
	const s1Sample = loadMonitor.samples.find((s) => s.id === "s1");
	assert(
		s1Sample?.sample.cooldownUntil !== undefined,
		"429 recorded a cooldown for s1",
	);
	await drain(relay);
}

async function testRefreshFailureFailsOver(): Promise<void> {
	const upstream = new FakeUpstream((request) =>
		request.headers["authorization"] === "Bearer tok-1"
			? jsonResponse(401)
			: jsonResponse(200),
	);
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok-1"), mkSub("s2", "tok-2")]),
		upstream,
		tokens: new FakeTokens(true),
	});
	const relay = await useCase.handle({
		bearer: "good-donor",
		path: "/v1/messages",
		body: { model: "claude-opus-4-8" },
		wantStream: false,
	});
	assert(
		relay.status === 200,
		"refresh failure fell over to the next subscription",
	);
	await drain(relay);
}

async function testNoCapacity(): Promise<void> {
	const useCase = mkUseCase({
		selector: new FakeSelector([]),
		upstream: new FakeUpstream(() => jsonResponse(200)),
	});
	let status = 0;
	try {
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: {},
			wantStream: false,
		});
	} catch (err) {
		status = err instanceof HttpError ? err.status : 0;
	}
	assert(status === 503, "empty pool yields 503");
}

async function testPassiveHarvest(): Promise<void> {
	const loadMonitor = new FakeLoadMonitor();
	const upstream = new FakeUpstream(() =>
		jsonResponse(200, {
			"anthropic-ratelimit-unified-status": "allowed",
			"anthropic-ratelimit-unified-representative-claim": "five_hour",
			"anthropic-ratelimit-unified-5h-utilization": "0.33",
		}),
	);
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok")]),
		upstream,
		loadMonitor,
	});
	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "claude-opus-4-8" },
			wantStream: false,
		}),
	);
	assert(
		loadMonitor.samples[0]?.sample.util5h === 0.33,
		"unified headers harvested passively",
	);
}

async function main(): Promise<void> {
	await runTest("rejects_missing_or_bad_key", testRejectsMissingOrBadKey);
	await runTest("routes_to_principal_pool", testRoutesToPrincipalPool);
	await runTest(
		"injects_identity_for_non_haiku",
		testInjectsIdentityForNonHaiku,
	);
	await runTest("haiku_untouched", testHaikuUntouched);
	await runTest("forwards_model_and_thinking", testForwardsModelAndThinking);
	await runTest("header_hygiene", testHeaderHygiene);
	await runTest("refresh_on_401_retries_once", testRefreshOn401RetriesOnce);
	await runTest("failover_on_429", testFailoverOn429);
	await runTest("refresh_failure_fails_over", testRefreshFailureFailsOver);
	await runTest("no_capacity_503", testNoCapacity);
	await runTest("passive_harvest_records_sample", testPassiveHarvest);

	const report = { suite: "Proxy", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
