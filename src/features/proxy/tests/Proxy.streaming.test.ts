/*
 * Byte-for-byte SSE streaming passthrough end-to-end through the HTTP server
 * against a stub upstream.
 *
 * @covers spp-proxy:CNT-001
 * @covers spp-proxy:EXT-001
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

async function testStreamingPassthroughEndToEnd(): Promise<void> {
	const sseChunks = [
		"event: message_start\ndata: {}\n\n",
		'event: content_block_delta\ndata: {"text":"hi"}\n\n',
		"event: message_stop\ndata: {}\n\n",
	];
	const upstreamServer: Server = createServer((_req, response) => {
		response.writeHead(200, { "content-type": "text/event-stream" });
		for (const chunk of sseChunks) {
			response.write(chunk);
		}
		response.end();
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

	try {
		const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
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
		assert(response.status === 200, "proxy relays 200");
		assert(
			response.headers.get("content-type") === "text/event-stream",
			"content-type relayed",
		);
		const text = await response.text();
		assert(text === sseChunks.join(""), "SSE bytes relayed unchanged");
	} finally {
		await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
		await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
	}
}

async function main(): Promise<void> {
	await runTest(
		"streaming_passthrough_end_to_end",
		testStreamingPassthroughEndToEnd,
	);

	const report = { suite: "ProxyStreaming", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
