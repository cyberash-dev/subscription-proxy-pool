/*
 * Inference proxy orchestration (spp-proxy:BEH-001..004, INV-001): resolve
 * principal, select least-loaded, ensure token, inject identity, forward,
 * harvest headers, relay; 401 → one refresh+retry, 429/5xx → bounded failover.
 */

import type { Clock } from "../../../shared/domain/Clock.ts";
import { noCapacity, unauthorized } from "../../../shared/http/Errors.ts";
import type { AccessKeysPort } from "../../access-keys/ports/inbound/AccessKeysPort.ts";
import { parseRateLimitHeaders } from "../../load-monitor/domain/RateLimit.ts";
import type { LoadMonitorPort } from "../../load-monitor/ports/inbound/LoadMonitorPort.ts";
import { InFlightTracker } from "../../pool-selection/domain/InFlightTracker.ts";
import type { PoolSelectionPort } from "../../pool-selection/ports/inbound/PoolSelectionPort.ts";
import {
	RefreshFailed,
	TokenManager,
} from "../../subscription-oauth/application/TokenManager.ts";
import type { Subscription } from "../../subscriptions/domain/Subscription.ts";
import {
	buildUpstreamHeaders,
	dropUnsupportedUpstreamFields,
	ensureIdentitySystemBlock,
	filterResponseHeaders,
	modelOf,
} from "../domain/SystemPrompt.ts";
import type { UpstreamGateway } from "../ports/outbound/UpstreamGateway.ts";
import type {
	ProxyPort,
	ProxyRelay,
	ProxyRequest,
} from "../ports/inbound/ProxyPort.ts";

export interface HandleMessagesDeps {
	readonly accessKeys: AccessKeysPort;
	readonly selector: PoolSelectionPort;
	readonly tokens: Pick<TokenManager, "ensureFresh" | "refreshNow">;
	readonly upstream: UpstreamGateway;
	readonly loadMonitor: LoadMonitorPort;
	readonly inFlight: InFlightTracker;
	readonly clock: Clock;
	readonly anthropicBaseUrl: string;
	readonly maxAttempts?: number;
}

export class HandleMessagesUseCase implements ProxyPort {
	constructor(private readonly deps: HandleMessagesDeps) {}

	async handle(request: ProxyRequest): Promise<ProxyRelay> {
		const principal =
			request.bearer !== undefined
				? await this.deps.accessKeys.resolvePrincipal(request.bearer)
				: undefined;
		if (principal === undefined) {
			throw unauthorized("invalid or missing proxy key");
		}

		const maxAttempts = this.deps.maxAttempts ?? 3;
		const tried = new Set<string>();
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			/* A no-capacity select throws 503 and propagates out directly. */
			const subscription = await this.deps.selector.select(
				{
					poolTarget: principal.poolTarget,
					userId: principal.userId,
					provider: "anthropic",
				},
				tried,
			);
			tried.add(subscription.subscriptionId);
			this.deps.inFlight.increment(subscription.subscriptionId);
			let isReleased = false;
			const release = (): void => {
				if (!isReleased) {
					isReleased = true;
					this.deps.inFlight.decrement(subscription.subscriptionId);
				}
			};

			try {
				const relay = await this.attempt(request, subscription);
				if (relay === "failover") {
					release();
					continue;
				}
				return { ...relay, release };
			} catch (err) {
				release();
				if (err instanceof RefreshFailed) {
					continue;
				}
				throw err;
			}
		}
		throw noCapacity(30);
	}

	private async attempt(
		request: ProxyRequest,
		subscription: Subscription,
	): Promise<Omit<ProxyRelay, "release"> | "failover"> {
		let accessToken = await this.deps.tokens.ensureFresh(subscription);
		let response = await this.forwardOnce(request, accessToken);
		await this.harvest(subscription.subscriptionId, response);

		if (response.status === 401) {
			await response.body?.cancel();
			/* Reactive refresh (throws RefreshFailed → caller fails over). */
			accessToken = await this.deps.tokens.refreshNow(subscription);
			response = await this.forwardOnce(request, accessToken);
			await this.harvest(subscription.subscriptionId, response);
			if (response.status === 401) {
				await response.body?.cancel();
				return "failover";
			}
		}

		if (this.isRetriable(response.status)) {
			await response.body?.cancel();
			return "failover";
		}

		return {
			status: response.status,
			headers: filterResponseHeaders(response.headers),
			body: response.body,
		};
	}

	private forwardOnce(
		request: ProxyRequest,
		accessToken: string,
	): Promise<Response> {
		const injected = dropUnsupportedUpstreamFields(
			ensureIdentitySystemBlock(request.body, modelOf(request.body)),
		);
		const headers = buildUpstreamHeaders(accessToken);
		headers["accept"] = request.wantStream
			? "text/event-stream"
			: "application/json";
		return this.deps.upstream.forward({
			url: `${this.deps.anthropicBaseUrl}${request.path}`,
			method: "POST",
			headers,
			body: JSON.stringify(injected),
		});
	}

	private async harvest(
		subscriptionId: string,
		response: Response,
	): Promise<void> {
		const sample = parseRateLimitHeaders(
			(name) => response.headers.get(name),
			response.status,
			this.deps.clock.nowMs(),
		);
		await this.deps.loadMonitor.recordLoad(subscriptionId, sample);
	}

	private isRetriable(status: number): boolean {
		return status === 429 || status === 529 || status >= 500;
	}
}
