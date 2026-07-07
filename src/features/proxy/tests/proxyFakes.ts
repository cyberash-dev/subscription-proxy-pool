/* Shared fakes + harness for the proxy suites (not a suite itself). */

import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { RateLimitSample } from "../../../shared/domain/Load.ts";
import type {
	AccessKeysPort,
	IssuedKey,
} from "../../access-keys/ports/inbound/AccessKeysPort.ts";
import type {
	Principal,
	ProxyKeySummary,
} from "../../access-keys/domain/ProxyKey.ts";
import type { LoadMonitorPort } from "../../load-monitor/ports/inbound/LoadMonitorPort.ts";
import { InFlightTracker } from "../../pool-selection/domain/InFlightTracker.ts";
import type {
	PoolSelectionPort,
	SelectionRequest,
} from "../../pool-selection/ports/inbound/PoolSelectionPort.ts";
import { RefreshFailed } from "../../subscription-oauth/application/TokenManager.ts";
import type { TokenSubscription } from "../../subscription-oauth/ports/outbound/TokenStore.ts";
import type { Subscription } from "../../subscriptions/domain/Subscription.ts";
import { noCapacity } from "../../../shared/http/Errors.ts";
import {
	HandleMessagesUseCase,
	type HandleMessagesDeps,
} from "../application/HandleMessagesUseCase.ts";
import type {
	UpstreamGateway,
	UpstreamRequest,
} from "../ports/outbound/UpstreamGateway.ts";

export function mkSub(id: string, accessToken: string): Subscription {
	return {
		subscriptionId: id,
		provider: "anthropic",
		poolKind: "donor",
		status: "active",
		accessToken,
		refreshToken: `rt-${id}`,
		tokenExpiresAt: "2030-01-01T00:00:00.000Z",
		scopes: "user:inference",
		createdAt: "2026-07-04T00:00:00.000Z",
		updatedAt: "2026-07-04T00:00:00.000Z",
	};
}

export class FakeAccessKeys implements AccessKeysPort {
	resolvePrincipal(bearer: string): Promise<Principal | undefined> {
		if (bearer === "good-own") {
			return Promise.resolve({ userId: "u", poolTarget: "own" });
		}
		if (bearer === "good-donor") {
			return Promise.resolve({ userId: "u", poolTarget: "donor" });
		}
		return Promise.resolve(undefined);
	}
	issueKey(): Promise<IssuedKey> {
		return Promise.reject(new Error("unused"));
	}
	revokeKey(): Promise<void> {
		return Promise.reject(new Error("unused"));
	}
	listKeys(): Promise<ProxyKeySummary[]> {
		return Promise.resolve([]);
	}
}

export class FakeSelector implements PoolSelectionPort {
	lastRequest: SelectionRequest | undefined;
	constructor(private readonly subs: Subscription[]) {}
	select(
		request: SelectionRequest,
		exclude: ReadonlySet<string> = new Set(),
	): Promise<Subscription> {
		this.lastRequest = request;
		const next = this.subs.find((s) => !exclude.has(s.subscriptionId));
		if (next === undefined) {
			return Promise.reject(noCapacity(30));
		}
		return Promise.resolve(next);
	}
}

export class FakeTokens {
	refreshCount = 0;
	constructor(private readonly failRefresh = false) {}
	ensureFresh(sub: TokenSubscription): Promise<string> {
		return Promise.resolve(sub.accessToken);
	}
	refreshNow(sub: TokenSubscription): Promise<string> {
		this.refreshCount += 1;
		if (this.failRefresh) {
			return Promise.reject(new RefreshFailed(sub.subscriptionId, "boom"));
		}
		return Promise.resolve("refreshed-token");
	}
}

export class FakeLoadMonitor implements LoadMonitorPort {
	readonly samples: Array<{ id: string; sample: RateLimitSample }> = [];
	recordLoad(subscriptionId: string, sample: RateLimitSample): Promise<void> {
		this.samples.push({ id: subscriptionId, sample });
		return Promise.resolve();
	}
	probeIdle(): Promise<void> {
		return Promise.resolve();
	}
}

export type Responder = (
	request: UpstreamRequest,
	callIndex: number,
) => Response;

export class FakeUpstream implements UpstreamGateway {
	readonly requests: UpstreamRequest[] = [];
	private calls = 0;
	constructor(private readonly responder: Responder) {}
	forward(request: UpstreamRequest): Promise<Response> {
		this.requests.push(request);
		const response = this.responder(request, this.calls);
		this.calls += 1;
		return Promise.resolve(response);
	}
}

export function mkUseCase(
	overrides: Partial<HandleMessagesDeps> & {
		selector: PoolSelectionPort;
		upstream: UpstreamGateway;
	},
): HandleMessagesUseCase {
	return new HandleMessagesUseCase({
		accessKeys: overrides.accessKeys ?? new FakeAccessKeys(),
		selector: overrides.selector,
		tokens: overrides.tokens ?? new FakeTokens(),
		upstream: overrides.upstream,
		loadMonitor: overrides.loadMonitor ?? new FakeLoadMonitor(),
		inFlight: overrides.inFlight ?? new InFlightTracker(),
		clock:
			overrides.clock ?? new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
		anthropicBaseUrl: overrides.anthropicBaseUrl ?? "https://upstream.test",
		maxAttempts: overrides.maxAttempts,
	});
}

export function jsonResponse(
	status: number,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify({ ok: status === 200 }), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

export async function drain(relay: {
	body: ReadableStream<Uint8Array> | null;
	release: () => void;
}): Promise<void> {
	await relay.body?.cancel();
	relay.release();
}
