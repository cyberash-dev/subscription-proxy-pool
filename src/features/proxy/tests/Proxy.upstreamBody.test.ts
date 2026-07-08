/*
 * Upstream body preparation: the client's context_management field is forwarded
 * verbatim (the client's context-management beta now reaches the upstream), and
 * the rest of the body is unchanged.
 *
 * @covers spp-proxy:DLT-004
 * @covers spp-proxy:DLT-002 compatibility_action=no_longer_guaranteed
 */

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

async function testForwardsContextManagement(): Promise<void> {
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
				messages: [],
				context_management: { edits: [] },
			},
			wantStream: false,
		}),
	);

	const forwarded = JSON.parse(upstream.requests[0].body) as {
		context_management?: { edits?: unknown };
		model?: unknown;
		messages?: unknown;
	};
	assert(
		Array.isArray(forwarded.context_management?.edits),
		"context_management forwarded verbatim to upstream body",
	);
	assert(forwarded.model === "claude-opus-4-8", "model preserved");
	assert(Array.isArray(forwarded.messages), "messages preserved");
}

async function main(): Promise<void> {
	await runTest("forwards_context_management", testForwardsContextManagement);

	const report = { suite: "ProxyUpstreamBody", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
