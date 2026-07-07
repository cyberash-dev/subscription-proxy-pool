/*
 * Single-flight token refresh: cached when fresh, refresh near expiry, coalesced
 * concurrent refresh, and mark-unusable on failure.
 *
 * @covers spp-subscription-oauth:BEH-003
 */

import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { ProviderId } from "../../../shared/domain/Provider.ts";
import type { OAuthGrant } from "../domain/OAuthGrant.ts";
import { TokenManager } from "../application/TokenManager.ts";
import type {
	CredentialVerdict,
	SubscriptionOAuthProvider,
} from "../ports/outbound/SubscriptionOAuthProvider.ts";
import type {
	TokenStore,
	TokenSubscription,
} from "../ports/outbound/TokenStore.ts";

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

class FakeStore implements TokenStore {
	readonly subs = new Map<string, TokenSubscription>();
	readonly updated: string[] = [];
	readonly unusable: string[] = [];

	findById(id: string): Promise<TokenSubscription | undefined> {
		return Promise.resolve(this.subs.get(id));
	}

	updateTokens(
		id: string,
		grant: OAuthGrant,
		_updatedAt: string,
	): Promise<void> {
		const existing = this.subs.get(id);
		if (existing !== undefined) {
			this.subs.set(id, {
				...existing,
				accessToken: grant.accessToken,
				refreshToken: grant.refreshToken,
				tokenExpiresAt: grant.expiresAt,
			});
		}
		this.updated.push(id);
		return Promise.resolve();
	}

	markUnusable(id: string, _reason: string, _updatedAt: string): Promise<void> {
		this.unusable.push(id);
		return Promise.resolve();
	}
}

class FakeRefreshProvider implements SubscriptionOAuthProvider {
	readonly providerId: ProviderId = "anthropic";
	refreshCount = 0;
	shouldFail = false;

	buildAuthorizeUrl(): Promise<string> {
		return Promise.resolve("https://example.test/authorize");
	}

	exchangeCode(): Promise<OAuthGrant> {
		return Promise.reject(new Error("not used"));
	}

	async refresh(_refreshToken: string): Promise<OAuthGrant> {
		this.refreshCount += 1;
		await new Promise((resolve) => setTimeout(resolve, 5));
		if (this.shouldFail) {
			throw new Error("refresh boom");
		}
		return {
			accessToken: `fresh-${this.refreshCount}`,
			refreshToken: `newrt-${this.refreshCount}`,
			expiresAt: new Date(Date.parse("2026-07-04T02:00:00.000Z")).toISOString(),
			scopes: "user:inference",
		};
	}

	verifyCredentials(_accessToken: string): Promise<CredentialVerdict> {
		return Promise.resolve("valid");
	}
}

function nearExpirySub(): TokenSubscription {
	return {
		subscriptionId: "sub-1",
		provider: "anthropic",
		accessToken: "old",
		refreshToken: "rt-old",
		/* expired relative to the fixed clock below */
		tokenExpiresAt: "2026-07-04T00:00:30.000Z",
		status: "active",
	};
}

function mkTokenManager(
	provider: FakeRefreshProvider,
	store: FakeStore,
): TokenManager {
	const clock = new FakeClock(Date.parse("2026-07-04T00:00:00.000Z"));
	const providers = new Map<ProviderId, SubscriptionOAuthProvider>([
		["anthropic", provider],
	]);
	return new TokenManager(store, providers, clock);
}

async function testReturnsCachedWhenNotNearExpiry(): Promise<void> {
	const provider = new FakeRefreshProvider();
	const store = new FakeStore();
	const manager = mkTokenManager(provider, store);
	const sub: TokenSubscription = {
		...nearExpirySub(),
		tokenExpiresAt: "2026-07-04T05:00:00.000Z",
	};
	const token = await manager.ensureFresh(sub);
	assert(token === "old", "fresh token returned without refresh");
	assert(provider.refreshCount === 0, "no refresh performed");
}

async function testRefreshesNearExpiry(): Promise<void> {
	const provider = new FakeRefreshProvider();
	const store = new FakeStore();
	const manager = mkTokenManager(provider, store);
	const token = await manager.ensureFresh(nearExpirySub());
	assert(token === "fresh-1", "refreshed token returned");
	assert(store.updated.includes("sub-1"), "new tokens persisted");
}

async function testRefreshIsSingleFlight(): Promise<void> {
	const provider = new FakeRefreshProvider();
	const store = new FakeStore();
	const manager = mkTokenManager(provider, store);
	const sub = nearExpirySub();
	const [a, b] = await Promise.all([
		manager.ensureFresh(sub),
		manager.ensureFresh(sub),
	]);
	assert(a === b, "both callers get the same token");
	assert(
		provider.refreshCount === 1,
		"concurrent refresh coalesced to one call",
	);
}

async function testRefreshFailureMarksUnusable(): Promise<void> {
	const provider = new FakeRefreshProvider();
	provider.shouldFail = true;
	const store = new FakeStore();
	const manager = mkTokenManager(provider, store);
	let threw = false;
	try {
		await manager.ensureFresh(nearExpirySub());
	} catch {
		threw = true;
	}
	assert(threw, "refresh failure propagates");
	assert(store.unusable.includes("sub-1"), "subscription marked unusable");
}

async function main(): Promise<void> {
	await runTest(
		"returns_cached_when_not_near_expiry",
		testReturnsCachedWhenNotNearExpiry,
	);
	await runTest("refreshes_near_expiry", testRefreshesNearExpiry);
	await runTest("refresh_is_single_flight", testRefreshIsSingleFlight);
	await runTest(
		"refresh_failure_marks_unusable",
		testRefreshFailureMarksUnusable,
	);

	const report = { suite: "TokenManager", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
