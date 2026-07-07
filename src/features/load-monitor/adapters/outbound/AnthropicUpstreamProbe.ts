/*
 * Cheapest viable load probe: a minimal Haiku /v1/messages call. Haiku is exempt
 * from the Claude Code system-prompt rule, so the body is trivial; only the
 * unified rate-limit headers are read (spp-load-monitor:BEH-003 / CNST-001). The
 * body is discarded. Costs ~one tiny billed request per idle subscription.
 */

import {
	ANTHROPIC_API_BASE,
	ANTHROPIC_BETA,
	ANTHROPIC_PROBE_MODEL,
	ANTHROPIC_VERSION,
} from "../../../../shared/anthropic/Constants.ts";
import type { Clock } from "../../../../shared/domain/Clock.ts";
import type { RateLimitSample } from "../../../../shared/domain/Load.ts";
import { type FetchFn, systemFetch } from "../../../../shared/http/Fetch.ts";
import { parseRateLimitHeaders } from "../../domain/RateLimit.ts";
import type {
	ProbeInput,
	UpstreamProbe,
} from "../../ports/outbound/UpstreamProbe.ts";

export interface AnthropicUpstreamProbeOptions {
	readonly clock: Clock;
	readonly fetchFn?: FetchFn;
	readonly apiBase?: string;
	readonly model?: string;
}

export class AnthropicUpstreamProbe implements UpstreamProbe {
	private readonly clock: Clock;
	private readonly fetchFn: FetchFn;
	private readonly apiBase: string;
	private readonly model: string;

	constructor(options: AnthropicUpstreamProbeOptions) {
		this.clock = options.clock;
		this.fetchFn = options.fetchFn ?? systemFetch;
		this.apiBase = options.apiBase ?? ANTHROPIC_API_BASE;
		this.model = options.model ?? ANTHROPIC_PROBE_MODEL;
	}

	async probe(input: ProbeInput): Promise<RateLimitSample> {
		const resp = await this.fetchFn(`${this.apiBase}/v1/messages`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${input.accessToken}`,
				"anthropic-version": ANTHROPIC_VERSION,
				"anthropic-beta": ANTHROPIC_BETA,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: this.model,
				max_tokens: 1,
				messages: [{ role: "user", content: "." }],
			}),
		});
		const sample = parseRateLimitHeaders(
			(name) => resp.headers.get(name),
			resp.status,
			this.clock.nowMs(),
		);
		await resp.body?.cancel().catch(() => undefined);
		return sample;
	}
}
