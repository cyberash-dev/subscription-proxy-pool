/*
 * OpenAI bridge forwarding: exact bridge request (configured URL, Bearer,
 * account id, headers, verbatim body without identity), header hygiene,
 * refresh-on-401 then provider-local failover, cooldown, count_tokens relay.
 *
 * @covers spp-proxy:BEH-007
 * @covers spp-proxy:CNT-002
 */

import { FakeClock } from "../../../shared/domain/Clock.ts";
import {
	FakeLoadMonitor,
	FakeSelector,
	FakeTokens,
	FakeUpstream,
	drain,
	jsonResponse,
	mkOpenAiSub,
	mkOpenAiToken,
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

async function testForwardsToConfiguredBridge(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkOpenAiSub("s1", "acct-42")]),
		upstream,
		openaiBridgeBaseUrl: "https://custom-bridge.test",
	});

	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
			wantStream: false,
		}),
	);

	const request = upstream.requests[0];
	assert(
		request.url === "https://custom-bridge.test/v1/messages",
		"bridge URL comes from configuration and keeps the original path",
	);
	assert(request.method === "POST", "bridge request is a POST");
	assert(
		request.headers["authorization"] === `Bearer ${mkOpenAiToken("acct-42")}`,
		"selected OpenAI access token forwarded as Bearer",
	);
	assert(
		request.headers["chatgpt-account-id"] === "acct-42",
		"ChatGPT-Account-ID derived from the token claim",
	);
	assert(
		request.headers["content-type"] === "application/json",
		"bridge content-type is application/json",
	);
	assert(
		request.headers["accept"] === "application/json",
		"non-stream request accepts application/json",
	);
	const forwarded = JSON.parse(request.body) as {
		model?: unknown;
		system?: unknown;
	};
	assert(forwarded.model === "gpt-4o", "model forwarded unchanged");
	assert(
		forwarded.system === undefined,
		"no Claude identity injected on the OpenAI route",
	);
}

async function testBridgeHeaderHygiene(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkOpenAiSub("s1", "acct-7")]),
		upstream,
	});

	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			clientBeta: "extended-cache-ttl-2025-04-11",
			body: { model: "gpt-4o" },
			wantStream: false,
		}),
	);

	const headers = upstream.requests[0].headers;
	assert(
		!("anthropic-version" in headers),
		"no anthropic-version to the bridge",
	);
	assert(!("anthropic-beta" in headers), "no anthropic-beta to the bridge");
	assert(!("x-api-key" in headers), "no x-api-key to the bridge");
	assert(
		headers["authorization"] === `Bearer ${mkOpenAiToken("acct-7")}`,
		"only the pooled OpenAI Bearer is present, not the proxy key",
	);
}

async function testStreamAcceptHeader(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkOpenAiSub("s1", "acct-1")]),
		upstream,
	});

	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "gpt-4o", stream: true },
			wantStream: true,
		}),
	);

	assert(
		upstream.requests[0].headers["accept"] === "text/event-stream",
		"stream request accepts text/event-stream",
	);
}

async function testRefreshThenFailover(): Promise<void> {
	const tokens = new FakeTokens(false, mkOpenAiToken("acct-refreshed"));
	const upstream = new FakeUpstream((_request, index) =>
		index < 2 ? jsonResponse(401) : jsonResponse(200),
	);
	const useCase = mkUseCase({
		selector: new FakeSelector([
			mkOpenAiSub("s1", "acct-1"),
			mkOpenAiSub("s2", "acct-2"),
		]),
		upstream,
		tokens,
	});

	const relay = await useCase.handle({
		bearer: "good-donor",
		path: "/v1/messages",
		body: { model: "gpt-4o" },
		wantStream: false,
	});

	assert(relay.status === 200, "failed over to the second OpenAI subscription");
	assert(tokens.refreshCount === 1, "refreshed once on the first subscription");
	assert(
		upstream.requests.length === 3,
		"s1 initial 401, s1 refreshed 401, then s2 succeeds",
	);
	await drain(relay);
}

async function testCooldownFailover(): Promise<void> {
	const loadMonitor = new FakeLoadMonitor();
	const upstream = new FakeUpstream((_request, index) =>
		index === 0
			? jsonResponse(429, { "retry-after": "300" })
			: jsonResponse(200),
	);
	const useCase = mkUseCase({
		selector: new FakeSelector([
			mkOpenAiSub("s1", "acct-1"),
			mkOpenAiSub("s2", "acct-2"),
		]),
		upstream,
		loadMonitor,
		clock: new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
	});

	const relay = await useCase.handle({
		bearer: "good-donor",
		path: "/v1/messages",
		body: { model: "gpt-4o" },
		wantStream: false,
	});

	assert(
		relay.status === 200,
		"429 fails over to the next OpenAI subscription",
	);
	const s1Sample = loadMonitor.samples.find((s) => s.id === "s1");
	assert(
		s1Sample?.sample.cooldownUntil !== undefined,
		"bridge 429 records cooldown metadata for s1",
	);
	await drain(relay);
}

async function testCountTokensRelaysBridge(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(404));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkOpenAiSub("s1", "acct-1")]),
		upstream,
	});

	const relay = await useCase.handle({
		bearer: "good-own",
		path: "/v1/messages/count_tokens",
		body: { model: "gpt-4o" },
		wantStream: false,
	});

	assert(relay.status === 404, "bridge 404 relayed for count_tokens");
	assert(
		upstream.requests[0].url.endsWith("/v1/messages/count_tokens"),
		"count_tokens path preserved to the bridge",
	);
	await drain(relay);
}

async function main(): Promise<void> {
	await runTest(
		"forwards_to_configured_bridge",
		testForwardsToConfiguredBridge,
	);
	await runTest("bridge_header_hygiene", testBridgeHeaderHygiene);
	await runTest("stream_accept_header", testStreamAcceptHeader);
	await runTest("refresh_then_failover", testRefreshThenFailover);
	await runTest("cooldown_failover", testCooldownFailover);
	await runTest("count_tokens_relays_bridge", testCountTokensRelaysBridge);

	const report = { suite: "ProxyOpenAiBridge", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
