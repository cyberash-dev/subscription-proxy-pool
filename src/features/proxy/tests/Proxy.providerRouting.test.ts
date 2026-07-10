/*
 * Model-based provider routing: the request model picks the subscription
 * provider, failover stays inside the selected provider (no cross-provider
 * fallback), and the Anthropic route is unchanged for every non-OpenAI model.
 *
 * @covers spp-proxy:BEH-006
 * @covers spp-proxy:INV-003
 * @covers spp-proxy:DLT-005
 * @covers spp-proxy-http:DLT-001
 */

import type { ProviderId } from "../../../shared/domain/Provider.ts";
import { HttpError } from "../../../shared/http/Errors.ts";
import {
	FakeSelector,
	FakeUpstream,
	drain,
	jsonResponse,
	mkOpenAiSub,
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

const ROUTING_CASES: ReadonlyArray<[string, ProviderId]> = [
	["gpt-4o", "openai"],
	["codex-mini-latest", "openai"],
	["o3", "openai"],
	["o1-preview", "openai"],
	["claude-opus-4-8", "anthropic"],
	["claude-haiku-4-5", "anthropic"],
	["", "anthropic"],
];

async function testModelRoutesProvider(): Promise<void> {
	for (const [model, expected] of ROUTING_CASES) {
		const sub =
			expected === "openai" ? mkOpenAiSub("s1", "acct-1") : mkSub("s1", "tok");
		const selector = new FakeSelector([sub]);
		const useCase = mkUseCase({
			selector,
			upstream: new FakeUpstream(() => jsonResponse(200)),
		});
		await drain(
			await useCase.handle({
				bearer: "good-own",
				path: "/v1/messages",
				body: { model },
				wantStream: false,
			}),
		);
		assert(
			selector.lastRequest?.provider === expected,
			`${model || "<empty>"} routes to ${expected}`,
		);
	}
}

async function testNoCrossProviderFallback(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const selector = new FakeSelector([]);
	const useCase = mkUseCase({ selector, upstream });

	let status = 0;
	try {
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "gpt-4o" },
			wantStream: false,
		});
	} catch (err) {
		status = err instanceof HttpError ? err.status : 0;
	}

	assert(status === 503, "no OpenAI capacity yields 503 overloaded");
	assert(
		selector.lastRequest?.provider === "openai",
		"only the OpenAI pool was queried",
	);
	assert(
		upstream.requests.length === 0,
		"no upstream forward, no fallback to the Anthropic pool",
	);
}

async function testAnthropicRouteUnchanged(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const selector = new FakeSelector([mkSub("s1", "tok-a")]);
	const useCase = mkUseCase({ selector, upstream });

	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "claude-opus-4-8", messages: [] },
			wantStream: false,
		}),
	);

	const request = upstream.requests[0];
	assert(
		request.url.startsWith("https://upstream.test"),
		"Anthropic model forwarded to the Anthropic upstream",
	);
	assert(
		request.headers["authorization"] === "Bearer tok-a",
		"pooled Anthropic Bearer injected",
	);
	assert(
		request.headers["anthropic-version"] === "2023-06-01",
		"anthropic-version retained on the Anthropic route",
	);
	assert(
		!("chatgpt-account-id" in request.headers),
		"no bridge account header on the Anthropic route",
	);
	const forwarded = JSON.parse(request.body) as { system?: unknown };
	assert(
		Array.isArray(forwarded.system),
		"identity block still injected on the Anthropic route",
	);
}

async function main(): Promise<void> {
	await runTest("model_routes_provider", testModelRoutesProvider);
	await runTest("no_cross_provider_fallback", testNoCrossProviderFallback);
	await runTest("anthropic_route_unchanged", testAnthropicRouteUnchanged);

	const report = { suite: "ProxyProviderRouting", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
