/*
 * Small node:http helpers shared by the proxy and management servers: bounded
 * body buffering, JSON responses, and bearer extraction. No framework.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { HttpError, badRequest } from "./Errors.ts";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function readBody(
	req: IncomingMessage,
	maxBytes: number = MAX_BODY_BYTES,
): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		total += buffer.length;
		if (total > maxBytes) {
			throw new HttpError(
				413,
				"invalid_request_error",
				"request body too large",
			);
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
	const raw = await readBody(req);
	if (raw.length === 0) {
		/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- empty body maps to the caller's optional shape */
		return {} as T;
	}
	try {
		/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse boundary; caller narrows */
		return JSON.parse(raw.toString("utf8")) as T;
	} catch {
		throw badRequest("malformed JSON body");
	}
}

export function bearerFrom(req: IncomingMessage): string | undefined {
	const header = req.headers.authorization;
	if (header === undefined) {
		return undefined;
	}
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match?.[1]?.trim();
}

export function sendJson(
	response: ServerResponse,
	status: number,
	body: unknown,
	extraHeaders: Readonly<Record<string, string>> = {},
): void {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload).toString(),
		...extraHeaders,
	});
	response.end(payload);
}

export function sendError(response: ServerResponse, err: unknown): void {
	if (err instanceof HttpError) {
		const extra: Record<string, string> = {};
		if (err.retryAfterSeconds !== undefined) {
			extra["retry-after"] = String(err.retryAfterSeconds);
		}
		sendJson(response, err.status, err.body(), extra);
		return;
	}
	const message = err instanceof Error ? err.message : String(err);
	sendJson(response, 500, {
		type: "error",
		error: { type: "api_error", message },
	});
}
