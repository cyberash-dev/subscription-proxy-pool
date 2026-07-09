/*
 * Load monitoring use cases (spp-load-monitor): passive harvest on every
 * proxied response, and an active prober for idle subscriptions. Subscription
 * listing and token refresh are injected as functions so this slice stays
 * decoupled from subscriptions / subscription-oauth.
 */

import type { Clock } from "../../../shared/domain/Clock.ts";
import type {
	LoadSource,
	RateLimitSample,
} from "../../../shared/domain/Load.ts";
import type { ProviderId } from "../../../shared/domain/Provider.ts";
import type { LoadRepository } from "../ports/outbound/LoadRepository.ts";
import type { UpstreamProbe } from "../ports/outbound/UpstreamProbe.ts";
import type { LoadMonitorPort } from "../ports/inbound/LoadMonitorPort.ts";

export interface LoadMonitorDeps {
	readonly loads: LoadRepository;
	readonly probe: UpstreamProbe;
	readonly clock: Clock;
	readonly idleThresholdMs: number;
	readonly listActiveSubscriptionIds: (
		provider: ProviderId,
	) => Promise<ReadonlyArray<string>>;
	readonly ensureFreshToken: (subscriptionId: string) => Promise<string>;
}

export class LoadMonitorService implements LoadMonitorPort {
	constructor(private readonly deps: LoadMonitorDeps) {}

	async recordLoad(
		subscriptionId: string,
		sample: RateLimitSample,
	): Promise<void> {
		await this.persist(subscriptionId, sample, "passive");
	}

	async probeIdle(): Promise<void> {
		const nowMs = this.deps.clock.nowMs();
		const ids = await this.deps.listActiveSubscriptionIds("anthropic");
		for (const subscriptionId of ids) {
			try {
				if (await this.shouldSkip(subscriptionId, nowMs)) {
					continue;
				}
				const accessToken = await this.deps.ensureFreshToken(subscriptionId);
				const sample = await this.deps.probe.probe({
					subscriptionId,
					accessToken,
				});
				await this.persist(subscriptionId, sample, "probe");
			} catch {
				/* a single subscription's probe failure must not stop the sweep */
			}
		}
	}

	private async shouldSkip(
		subscriptionId: string,
		nowMs: number,
	): Promise<boolean> {
		const latest = await this.deps.loads.latestBySubscription(subscriptionId);
		if (latest === undefined) {
			return false;
		}
		if (latest.cooldownUntil !== undefined && latest.cooldownUntil > nowMs) {
			return true;
		}
		const lastSeenMs = Date.parse(latest.sampledAt);
		return (
			Number.isFinite(lastSeenMs) &&
			nowMs - lastSeenMs < this.deps.idleThresholdMs
		);
	}

	private async persist(
		subscriptionId: string,
		sample: RateLimitSample,
		source: LoadSource,
	): Promise<void> {
		await this.deps.loads.insertSnapshot({
			...sample,
			subscriptionId,
			sampledAt: this.deps.clock.nowIso(),
			source,
		});
	}
}
