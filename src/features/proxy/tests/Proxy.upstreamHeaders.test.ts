/*
 * Upstream header preparation: the client's anthropic-beta is merged with the
 * mandatory oauth/claude-code tokens (deduped, empty segments dropped);
 * betaFrom normalizes the inbound header (string, list, or absent).
 *
 * @covers spp-proxy:DLT-003
 */

import { betaFrom } from "../../../shared/http/HttpUtil.ts";
import {
	drain,
	FakeSelector,
	FakeUpstream,
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

async function testMergesClientBeta(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok")]),
		upstream,
	});
	await drain(
		await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "claude-opus-4-8" },
			clientBeta:
				"claude-code-20250219,,extended-cache-ttl-2025-04-11, ,context-management-2025-06-27",
			wantStream: false,
		}),
	);

	const tokens = upstream.requests[0].headers["anthropic-beta"].split(",");

	assert(tokens.includes("oauth-2025-04-20"), "mandatory oauth token present");
	assert(
		tokens.includes("extended-cache-ttl-2025-04-11"),
		"client extended-cache-ttl token forwarded",
	);
	assert(
		tokens.includes("context-management-2025-06-27"),
		"client context-management token forwarded",
	);
	assert(
		tokens.filter((t) => t === "claude-code-20250219").length === 1,
		"overlapping token not duplicated",
	);
	assert(!tokens.includes(""), "empty beta segments dropped");
}

async function testMandatoryBetaWithoutClient(): Promise<void> {
	const upstream = new FakeUpstream(() => jsonResponse(200));
	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok")]),
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

	assert(
		upstream.requests[0].headers["anthropic-beta"] ===
			"oauth-2025-04-20,claude-code-20250219",
		"no client beta yields exactly the mandatory tokens",
	);
}

function testBetaFromNormalizesHeader(): void {
	assert(betaFrom(undefined) === undefined, "absent header yields undefined");
	assert(
		betaFrom("extended-cache-ttl-2025-04-11") ===
			"extended-cache-ttl-2025-04-11",
		"string header returned unchanged",
	);
	assert(
		betaFrom(["beta-a", "beta-b"]) === "beta-a,beta-b",
		"list header joined with comma",
	);
}

async function main(): Promise<void> {
	await runTest("merges_client_beta", testMergesClientBeta);
	await runTest(
		"mandatory_without_client_beta",
		testMandatoryBetaWithoutClient,
	);
	await runTest("beta_from_normalizes_header", testBetaFromNormalizesHeader);

	const report = { suite: "ProxyUpstreamHeaders", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
