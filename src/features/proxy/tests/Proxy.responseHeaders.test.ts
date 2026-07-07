/*
 * Response-header hygiene end-to-end: the upstream HTTP client decompresses the
 * body transparently, so the relay must not forward content-encoding (else the
 * client decodes plaintext as gzip and fails with ZlibError).
 *
 * @covers spp-proxy:DLT-001
 */

import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

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

async function testRelayStripsContentEncoding(): Promise<void> {
	const payload = JSON.stringify({ model: "claude-opus-4-8", ok: true });
	const gzipped = gzipSync(Buffer.from(payload, "utf8"));
	const upstreamServer: Server = createServer((_req, response) => {
		response.writeHead(200, {
			"content-type": "application/json",
			"content-encoding": "gzip",
		});
		response.end(gzipped);
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
			body: JSON.stringify({ model: "claude-opus-4-8", messages: [] }),
		});
		assert(response.status === 200, "proxy relays 200");
		assert(
			response.headers.get("content-encoding") === null,
			"content-encoding stripped on relay",
		);
		const body = (await response.json()) as { ok?: boolean };
		assert(body.ok === true, "decompressed body readable by client");
	} finally {
		await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
		await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
	}
}

async function main(): Promise<void> {
	await runTest(
		"relay_strips_content_encoding",
		testRelayStripsContentEncoding,
	);

	const report = { suite: "ProxyResponseHeaders", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
