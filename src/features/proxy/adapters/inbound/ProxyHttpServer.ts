/*
 * Inference HTTP surface (spp-proxy-http). Raw node:http. Routes POST
 * /v1/messages(+/count_tokens) and GET /health; authenticates the proxy-key
 * bearer via the use case; relays the upstream response, streaming with
 * backpressure and cancelling on client abort.
 */

import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

import { notFound } from "../../../../shared/http/Errors.ts";
import {
	bearerFrom,
	readJson,
	sendError,
	sendJson,
} from "../../../../shared/http/HttpUtil.ts";
import type { ProxyPort, ProxyRelay } from "../../ports/inbound/ProxyPort.ts";

export class ProxyHttpServer {
	constructor(private readonly proxy: ProxyPort) {}

	createServer(): Server {
		return createServer((req, response) => {
			void this.handle(req, response);
		});
	}

	private async handle(
		req: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		try {
			const method = req.method ?? "GET";
			const path = (req.url ?? "/").split("?")[0];

			if (method === "GET" && (path === "/health" || path === "/healthz")) {
				sendJson(response, 200, { status: "ok" });
				return;
			}
			if (
				method === "POST" &&
				(path === "/v1/messages" || path === "/v1/messages/count_tokens")
			) {
				const bearer = bearerFrom(req);
				const body = await readJson<Record<string, unknown>>(req);
				const isStream = body.stream === true && path === "/v1/messages";
				const relay = await this.proxy.handle({
					bearer,
					path,
					body,
					wantStream: isStream,
				});
				await this.relay(response, relay);
				return;
			}
			throw notFound(`no route for ${method} ${path}`);
		} catch (err) {
			if (response.headersSent) {
				response.destroy();
				return;
			}
			sendError(response, err);
		}
	}

	private async relay(
		response: ServerResponse,
		relay: ProxyRelay,
	): Promise<void> {
		response.writeHead(relay.status, relay.headers);
		try {
			if (relay.body !== null) {
				await pump(relay.body, response);
			}
			response.end();
		} finally {
			relay.release();
		}
	}
}

async function pump(
	stream: ReadableStream<Uint8Array>,
	response: ServerResponse,
): Promise<void> {
	const reader = stream.getReader();
	let isAborted = false;
	response.on("close", () => {
		isAborted = true;
		void reader.cancel().catch(() => undefined);
	});
	try {
		for (;;) {
			const { done: isDone, value } = await reader.read();
			if (isDone || isAborted) {
				break;
			}
			if (value !== undefined) {
				await write(response, Buffer.from(value));
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function write(response: ServerResponse, chunk: Buffer): Promise<void> {
	return new Promise((resolve) => {
		if (response.write(chunk)) {
			resolve();
		} else {
			response.once("drain", resolve);
		}
	});
}
