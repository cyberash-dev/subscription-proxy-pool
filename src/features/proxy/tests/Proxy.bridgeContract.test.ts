/*
 * OpenAI bridge external contract against a loopback HTTP bridge with the real
 * fetch gateway: the exact request reaches the bridge, an Anthropic-compatible
 * stream is relayed, and count_tokens returns a 404 not_found_error envelope.
 *
 * @covers spp-proxy:EXT-002
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { FetchUpstreamGateway } from "../adapters/outbound/FetchUpstreamGateway.ts";
import {
	FakeSelector,
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

interface CapturedRequest {
	method?: string;
	url?: string;
	authorization?: string;
	accountId?: string;
	accept?: string;
	contentType?: string;
	body: string;
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function headerValue(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function testBridgeStreamContract(): Promise<void> {
	const captured: CapturedRequest = { body: "" };
	const bridge = createServer((req, response) => {
		void readBody(req).then((body) => {
			captured.method = req.method;
			captured.url = req.url;
			captured.authorization = headerValue(req.headers["authorization"]);
			captured.accountId = headerValue(req.headers["chatgpt-account-id"]);
			captured.accept = headerValue(req.headers["accept"]);
			captured.contentType = headerValue(req.headers["content-type"]);
			captured.body = body;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write("event: message_start\ndata: {}\n\n");
			response.write("event: message_stop\ndata: {}\n\n");
			response.end();
		});
	});
	const port = await listen(bridge);

	try {
		const useCase = mkUseCase({
			selector: new FakeSelector([mkOpenAiSub("s1", "acct-9")]),
			upstream: new FetchUpstreamGateway(),
			openaiBridgeBaseUrl: `http://127.0.0.1:${port}`,
		});
		const relay = await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages",
			body: { model: "gpt-4o", stream: true, messages: [] },
			wantStream: true,
		});
		const text = await new Response(relay.body).text();
		relay.release();

		assert(captured.method === "POST", "bridge receives a POST");
		assert(captured.url === "/v1/messages", "original path forwarded");
		assert(
			captured.authorization === `Bearer ${mkOpenAiToken("acct-9")}`,
			"OpenAI Bearer reaches the bridge",
		);
		assert(captured.accountId === "acct-9", "account id reaches the bridge");
		assert(captured.accept === "text/event-stream", "stream accept forwarded");
		assert(
			captured.contentType === "application/json",
			"json content-type forwarded",
		);
		const forwarded = JSON.parse(captured.body) as {
			model?: unknown;
			system?: unknown;
		};
		assert(forwarded.model === "gpt-4o", "model forwarded verbatim");
		assert(forwarded.system === undefined, "no identity injected");
		assert(relay.status === 200, "bridge 200 relayed");
		assert(
			text ===
				"event: message_start\ndata: {}\n\nevent: message_stop\ndata: {}\n\n",
			"Anthropic-compatible SSE relayed unchanged",
		);
	} finally {
		await close(bridge);
	}
}

async function testBridgeCountTokensNotFound(): Promise<void> {
	const bridge = createServer((req, response) => {
		void readBody(req).then(() => {
			response.writeHead(404, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					type: "error",
					error: {
						type: "not_found_error",
						message: "count_tokens unsupported",
					},
				}),
			);
		});
	});
	const port = await listen(bridge);

	try {
		const useCase = mkUseCase({
			selector: new FakeSelector([mkOpenAiSub("s1", "acct-9")]),
			upstream: new FetchUpstreamGateway(),
			openaiBridgeBaseUrl: `http://127.0.0.1:${port}`,
		});
		const relay = await useCase.handle({
			bearer: "good-own",
			path: "/v1/messages/count_tokens",
			body: { model: "gpt-4o" },
			wantStream: false,
		});
		const payload = JSON.parse(await new Response(relay.body).text()) as {
			error?: { type?: unknown };
		};
		relay.release();

		assert(relay.status === 404, "bridge 404 relayed for count_tokens");
		assert(
			payload.error?.type === "not_found_error",
			"not_found_error envelope relayed",
		);
	} finally {
		await close(bridge);
	}
}

async function main(): Promise<void> {
	await runTest("bridge_stream_contract", testBridgeStreamContract);
	await runTest("bridge_count_tokens_not_found", testBridgeCountTokensNotFound);

	const report = { suite: "ProxyBridgeContract", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
