/*
 * Egress forward-proxy routing: with an egress proxy configured, outbound fetch
 * is tunneled through the HTTP CONNECT proxy; NO_PROXY hosts bypass it; with no
 * proxy the global dispatcher is left untouched.
 *
 * @covers spp-proxy:BEH-005
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";

import { installEgressProxy } from "../../../shared/net/EgressProxy.ts";

interface TestRecord {
	name: string;
	ok: boolean;
	error?: string;
}
const results: TestRecord[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
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

interface ConnectProxy {
	readonly port: number;
	readonly connects: string[];
	close(): Promise<void>;
}

/* A fake HTTP CONNECT proxy that records every tunnel target and refuses it. */
async function startConnectProxy(): Promise<ConnectProxy> {
	const connects: string[] = [];
	const server: Server = createServer();
	server.on("connect", (req, socket) => {
		connects.push(req.url ?? "");
		socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
		socket.destroy();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: (server.address() as AddressInfo).port,
		connects,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

function testNoProxyLeavesDispatcherUntouched(): void {
	const before = getGlobalDispatcher();

	const installed = installEgressProxy(undefined, undefined);

	assert(installed === false, "no proxy url → not installed");
	assert(
		getGlobalDispatcher() === before,
		"global dispatcher is left untouched without a proxy url",
	);
}

async function testExternalRequestTunnelsThroughProxy(): Promise<void> {
	const proxy = await startConnectProxy();
	const before = getGlobalDispatcher();
	try {
		installEgressProxy(`http://127.0.0.1:${proxy.port}`, undefined);

		await fetch("https://blocked.anthropic.invalid/v1/messages", {
			headers: { authorization: "Bearer secret" },
		}).catch(() => undefined);

		assert(
			proxy.connects.includes("blocked.anthropic.invalid:443"),
			"external HTTPS request is tunneled through the CONNECT proxy",
		);
	} finally {
		setGlobalDispatcher(before);
		await proxy.close();
	}
}

async function testNoProxyHostBypassesProxy(): Promise<void> {
	const proxy = await startConnectProxy();
	const before = getGlobalDispatcher();
	try {
		installEgressProxy(
			`http://127.0.0.1:${proxy.port}`,
			"skip.anthropic.invalid",
		);

		await fetch("https://skip.anthropic.invalid/x").catch(() => undefined);

		assert(
			!proxy.connects.some((target) => target.includes("anthropic.invalid")),
			"a NO_PROXY host bypasses the forward-proxy",
		);
	} finally {
		setGlobalDispatcher(before);
		await proxy.close();
	}
}

async function main(): Promise<void> {
	await runTest("no_proxy_leaves_dispatcher_untouched", () =>
		Promise.resolve(testNoProxyLeavesDispatcherUntouched()),
	);
	await runTest(
		"external_request_tunnels_through_proxy",
		testExternalRequestTunnelsThroughProxy,
	);
	await runTest("no_proxy_host_bypasses_proxy", testNoProxyHostBypassesProxy);

	const report = { suite: "EgressProxy", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
