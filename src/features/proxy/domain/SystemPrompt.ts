/*
 * Anthropic request/response shaping (spp-proxy:BEH-002/BEH-004/INV-001):
 * identity system block for non-Haiku, exact upstream header set (no x-api-key),
 * hop-by-hop header filtering on relay.
 */

import {
	ANTHROPIC_BETA,
	ANTHROPIC_VERSION,
	CLAUDE_CODE_IDENTITY,
	HOP_BY_HOP_HEADERS,
	isHaikuModel,
} from "../../../shared/anthropic/Constants.ts";

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function isIdentityTextBlock(block: unknown): boolean {
	if (typeof block !== "object" || block === null) {
		return false;
	}
	if (!("type" in block) || block.type !== "text") {
		return false;
	}
	return (
		"text" in block &&
		typeof block.text === "string" &&
		block.text.startsWith(CLAUDE_CODE_IDENTITY)
	);
}

/*
 * Return a body whose `system` begins with the Claude Code identity block for
 * non-Haiku models. Haiku is exempt and passed through untouched. The client's
 * own system content is preserved, only prefixed.
 */
export function ensureIdentitySystemBlock(
	body: Record<string, unknown>,
	model: string,
): Record<string, unknown> {
	if (isHaikuModel(model)) {
		return body;
	}
	const system = body.system;
	if (system === undefined) {
		return { ...body, system: [{ type: "text", text: CLAUDE_CODE_IDENTITY }] };
	}
	if (typeof system === "string") {
		if (system.startsWith(CLAUDE_CODE_IDENTITY)) {
			return body;
		}
		return { ...body, system: `${CLAUDE_CODE_IDENTITY}\n\n${system}` };
	}
	if (isUnknownArray(system)) {
		if (system.length > 0 && isIdentityTextBlock(system[0])) {
			return body;
		}
		return {
			...body,
			system: [{ type: "text", text: CLAUDE_CODE_IDENTITY }, ...system],
		};
	}
	return body;
}

export function modelOf(body: Record<string, unknown>): string {
	return typeof body.model === "string" ? body.model : "";
}

/* spp-proxy:DLT-002 — the pooled Anthropic endpoint rejects context_management
 * (the proxy sends a fixed anthropic-beta that does not enable it), so drop it
 * from the upstream body; clients may still send it and it is ignored. */
export function dropUnsupportedUpstreamFields(
	body: Record<string, unknown>,
): Record<string, unknown> {
	const cleaned: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (key === "context_management") {
			continue;
		}
		cleaned[key] = value;
	}
	return cleaned;
}

export function buildUpstreamHeaders(
	accessToken: string,
): Record<string, string> {
	return {
		authorization: `Bearer ${accessToken}`,
		"anthropic-version": ANTHROPIC_VERSION,
		"anthropic-beta": ANTHROPIC_BETA,
		"content-type": "application/json",
	};
}

/* Copy safe response headers for relay: drop hop-by-hop, set-cookie, and
 * content-encoding/content-length — the upstream client decompresses the body,
 * so relaying them corrupts the client decode (spp-proxy:DLT-001). */
export function filterResponseHeaders(source: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	source.forEach((value, key) => {
		const lower = key.toLowerCase();
		if (
			HOP_BY_HOP_HEADERS.has(lower) ||
			lower === "set-cookie" ||
			lower === "content-encoding" ||
			lower === "content-length"
		) {
			return;
		}
		out[lower] = value;
	});
	return out;
}
