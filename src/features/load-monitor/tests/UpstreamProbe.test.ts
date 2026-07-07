/*
 * Active prober adapters: the Haiku probe parses rate-limit headers from a fake
 * upstream, and the worker ticks probeIdle on its interval.
 *
 * @covers spp-load-monitor:BEH-003
 * @covers spp-load-monitor:CNST-001
 */

import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { FetchFn } from "../../../shared/http/Fetch.ts";
import { AnthropicUpstreamProbe } from "../adapters/outbound/AnthropicUpstreamProbe.ts";
import { LoadProbeWorker } from "../adapters/inbound/LoadProbeWorker.ts";
import type { LoadMonitorPort } from "../ports/inbound/LoadMonitorPort.ts";

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

async function testProbeParsesHeaders(): Promise<void> {
	let capturedUrl = "";
	let capturedAuth = "";
	const fetchFn: FetchFn = (url, init) => {
		if (typeof url === "string") {
			capturedUrl = url;
		}
		capturedAuth = String(
			(init?.headers as Record<string, string> | undefined)?.["authorization"],
		);
		return Promise.resolve(
			new Response(JSON.stringify({ id: "msg" }), {
				status: 200,
				headers: {
					"anthropic-ratelimit-unified-status": "allowed",
					"anthropic-ratelimit-unified-representative-claim": "five_hour",
					"anthropic-ratelimit-unified-5h-utilization": "0.5",
				},
			}),
		);
	};
	const probe = new AnthropicUpstreamProbe({
		clock: new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
		fetchFn,
		apiBase: "https://upstream.test",
	});
	const sample = await probe.probe({
		subscriptionId: "s1",
		accessToken: "tok",
	});
	assert(
		capturedUrl === "https://upstream.test/v1/messages",
		"probes /v1/messages",
	);
	assert(capturedAuth === "Bearer tok", "probe uses the subscription token");
	assert(sample.util5h === 0.5, "probe harvests the utilization");
}

async function testWorkerTicksProbeIdle(): Promise<void> {
	let calls = 0;
	const monitor: LoadMonitorPort = {
		recordLoad: () => Promise.resolve(),
		probeIdle: () => {
			calls += 1;
			return Promise.resolve();
		},
	};
	const worker = new LoadProbeWorker(monitor, 5);
	worker.start();
	/* idempotent: a second start does not add a timer */
	worker.start();
	try {
		/* A ref'd timeout keeps the loop alive; the worker's unref'd interval
		 * fires several times within the window. */
		await new Promise<void>((resolve) => setTimeout(resolve, 60));
		assert(calls >= 1, "worker invoked probeIdle on its interval");
	} finally {
		worker.stop();
	}
}

async function main(): Promise<void> {
	await runTest("probe_parses_headers", testProbeParsesHeaders);
	await runTest("worker_ticks_probe_idle", testWorkerTicksProbeIdle);

	const report = { suite: "UpstreamProbe", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
