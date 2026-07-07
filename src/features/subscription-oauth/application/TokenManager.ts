/*
 * Single-flight OAuth token lifecycle (spp-subscription-oauth). Proactive
 * refresh when near expiry, reactive refresh on 401. Concurrent refreshers for
 * one subscription coalesce on a per-id promise so the token endpoint is hit
 * once; a rotated refresh token is persisted before the promise resolves.
 */

import type { Clock } from "../../../shared/domain/Clock.ts";
import type { ProviderId } from "../../../shared/domain/Provider.ts";
import type { SubscriptionOAuthProvider } from "../ports/outbound/SubscriptionOAuthProvider.ts";
import type {
	TokenStore,
	TokenSubscription,
} from "../ports/outbound/TokenStore.ts";

export class RefreshFailed extends Error {
	constructor(
		readonly subscriptionId: string,
		cause: string,
	) {
		super(`refresh_failed:${subscriptionId}:${cause}`);
		this.name = "RefreshFailed";
	}
}

export class TokenManager {
	private readonly inflight = new Map<string, Promise<string>>();

	constructor(
		private readonly store: TokenStore,
		private readonly providers: ReadonlyMap<
			ProviderId,
			SubscriptionOAuthProvider
		>,
		private readonly clock: Clock,
		private readonly skewMs = 120_000,
	) {}

	/* Return a usable access token, refreshing proactively if near expiry. */
	async ensureFresh(sub: TokenSubscription): Promise<string> {
		const remaining = Date.parse(sub.tokenExpiresAt) - this.clock.nowMs();
		if (Number.isFinite(remaining) && remaining > this.skewMs) {
			return sub.accessToken;
		}
		return this.refresh(sub);
	}

	/* Force a refresh regardless of expiry (reactive 401 path). */
	async refreshNow(sub: TokenSubscription): Promise<string> {
		return this.refresh(sub);
	}

	private refresh(sub: TokenSubscription): Promise<string> {
		const existing = this.inflight.get(sub.subscriptionId);
		if (existing !== undefined) {
			return existing;
		}
		const run = this.doRefresh(sub).finally(() => {
			this.inflight.delete(sub.subscriptionId);
		});
		this.inflight.set(sub.subscriptionId, run);
		return run;
	}

	private async doRefresh(sub: TokenSubscription): Promise<string> {
		const provider = this.providers.get(sub.provider);
		if (provider === undefined) {
			throw new RefreshFailed(
				sub.subscriptionId,
				`no_provider:${sub.provider}`,
			);
		}
		try {
			const grant = await provider.refresh(sub.refreshToken);
			await this.store.updateTokens(
				sub.subscriptionId,
				grant,
				this.clock.nowIso(),
			);
			return grant.accessToken;
		} catch (err) {
			const cause = err instanceof Error ? err.message : String(err);
			await this.store.markUnusable(
				sub.subscriptionId,
				cause,
				this.clock.nowIso(),
			);
			throw new RefreshFailed(sub.subscriptionId, cause);
		}
	}
}
