/*
 * Regression: an upstream body failure after the client response headers are
 * committed must not trigger a second writeHead. The proxy terminates that one
 * connection and the process stays alive to serve other requests.
 *
 * @covers spp-proxy:INV-002
 */

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { ProxyHttpServer } from "../adapters/inbound/ProxyHttpServer.ts";
import { FetchUpstreamGateway } from "../adapters/outbound/FetchUpstreamGateway.ts";
import { FakeSelector, mkSub, mkUseCase } from "./proxyFakes.ts";

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

function delay(ms: number): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function testMidStreamUpstreamFailureKeepsServerAlive(): Promise<void> {
	const upstreamServer: Server = createServer((_req, response) => {
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.write("event: message_start\ndata: {}\n\n");
		setTimeout(() => response.destroy(), 25);
	});
	await new Promise<void>((resolve) =>
		upstreamServer.listen(0, "127.0.0.1", resolve),
	);
	const upstreamPort = (upstreamServer.address() as AddressInfo).port;

	const useCase = mkUseCase({
		selector: new FakeSelector([mkSub("s1", "tok")]),
		upstream: new FetchUpstreamGateway(),
		anthropicBaseUrl: `http://127.0.0.1:${upstreamPort}`,
	});
	const proxyServer = new ProxyHttpServer(useCase).createServer();
	await new Promise<void>((resolve) =>
		proxyServer.listen(0, "127.0.0.1", resolve),
	);
	const proxyPort = (proxyServer.address() as AddressInfo).port;

	let sawDoubleWriteRejection = false;
	const onUnhandled = (reason: unknown): void => {
		if (String(reason).includes("ERR_HTTP_HEADERS_SENT")) {
			sawDoubleWriteRejection = true;
		}
	};
	process.on("unhandledRejection", onUnhandled);

	let streamResponse: Response | undefined;
	try {
		streamResponse = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
			method: "POST",
			headers: {
				authorization: "Bearer good-own",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: "claude-opus-4-8",
				stream: true,
				messages: [],
			}),
		});
		assert(
			streamResponse.status === 200,
			"headers relayed before upstream drop",
		);

		await delay(100);
		assert(
			!sawDoubleWriteRejection,
			"no ERR_HTTP_HEADERS_SENT after mid-stream upstream drop",
		);

		const health = await fetch(`http://127.0.0.1:${proxyPort}/health`);
		assert(health.status === 200, "proxy survives and still serves /health");
		await health.text();
	} finally {
		await streamResponse?.body?.cancel().catch(() => undefined);
		process.off("unhandledRejection", onUnhandled);
		await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
		await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
	}
}

async function main(): Promise<void> {
	await runTest(
		"mid_stream_upstream_failure_keeps_server_alive",
		testMidStreamUpstreamFailureKeepsServerAlive,
	);

	const report = { suite: "ProxyMidStreamFailure", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
