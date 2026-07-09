/*
 * Management + auth HTTP surface end-to-end: OIDC login → session, key issue /
 * list / revoke, subscription link (donor + user) → list, pool status, and
 * session gating. Exercises ManagementHttpServer wired to the real services.
 *
 * @covers spp-mgmt-http:SURF-001
 * @covers spp-mgmt-http:DLT-001
 * @covers spp-mgmt-http:DLT-002
 * @covers pol:POL-AUTH-001
 */

import Database from "better-sqlite3";
import { type Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteEngine } from "../../shared/db/SqliteEngine.ts";
import { applyMigrations } from "../../shared/db/Migrations.ts";
import { FakeClock } from "../../shared/domain/Clock.ts";
import type { ProviderId } from "../../shared/domain/Provider.ts";
import { SqlitePkceSessionRepository } from "../../shared/pkce/SqlitePkceSessionRepository.ts";
import { AuthService } from "../../features/auth/application/AuthService.ts";
import {
	SqliteUserIdentityRepository,
	SqliteUserRepository,
} from "../../features/auth/adapters/outbound/SqliteUserRepository.ts";
import { SqliteSessionRepository } from "../../features/auth/adapters/outbound/SqliteSessionRepository.ts";
import type { ExternalIdentity } from "../../features/auth/domain/User.ts";
import type {
	ExchangeCodeInput,
	IdentityProvider,
} from "../../features/auth/ports/outbound/IdentityProvider.ts";
import { AccessKeysService } from "../../features/access-keys/application/AccessKeysService.ts";
import { SqliteProxyKeyRepository } from "../../features/access-keys/adapters/outbound/SqliteProxyKeyRepository.ts";
import { SubscriptionOAuthService } from "../../features/subscription-oauth/application/SubscriptionOAuthService.ts";
import { AnthropicOAuthProvider } from "../../features/subscription-oauth/adapters/outbound/AnthropicOAuthProvider.ts";
import { OpenAiOAuthProvider } from "../../features/subscription-oauth/adapters/outbound/OpenAiOAuthProvider.ts";
import type { SubscriptionOAuthProvider } from "../../features/subscription-oauth/ports/outbound/SubscriptionOAuthProvider.ts";
import { SubscriptionsService } from "../../features/subscriptions/application/SubscriptionsService.ts";
import { SqliteSubscriptionRepository } from "../../features/subscriptions/adapters/outbound/SqliteSubscriptionRepository.ts";
import { crypterForTests } from "../../shared/crypto/tests/crypterForTests.ts";
import { SqliteLoadRepository } from "../../features/load-monitor/adapters/outbound/SqliteLoadRepository.ts";
import { ManagementHttpServer } from "../ManagementHttpServer.ts";

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

class FakeIdentityProvider implements IdentityProvider {
	readonly name = "test";
	buildAuthorizeUrl(input: { state: string; nonce: string }): Promise<string> {
		return Promise.resolve(
			`https://idp.test/authorize?state=${input.state}&nonce=${input.nonce}`,
		);
	}
	exchangeCode(_input: ExchangeCodeInput): Promise<ExternalIdentity> {
		return Promise.resolve({
			issuer: "https://idp.test",
			subject: "subject-1",
			email: "alice@test",
		});
	}
}

interface TokenServer {
	readonly url: string;
	readonly baseUrl: string;
	close(): Promise<void>;
}

async function startTokenServer(verifyStatus = 200): Promise<TokenServer> {
	const { createServer } = await import("node:http");
	let n = 0;
	const server = createServer((req, res) => {
		if ((req.url ?? "").startsWith("/v1/messages")) {
			res.writeHead(verifyStatus, { "content-type": "application/json" });
			res.end("{}");
			return;
		}
		n += 1;
		res.writeHead(200, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				access_token: `at-${n}`,
				refresh_token: `rt-${n}`,
				expires_in: 3600,
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}/token`,
		baseUrl: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

interface Harness {
	readonly base: string;
	readonly cleanup: () => Promise<void>;
}

async function mkHarness(verifyStatus = 200): Promise<Harness> {
	const tokenServer = await startTokenServer(verifyStatus);
	const dir = mkdtempSync(join(tmpdir(), "spp-mgmt-"));
	const db = new Database(join(dir, "pool.db"));
	const engine = new SqliteEngine(db);
	await applyMigrations(engine);
	const clock = new FakeClock(Date.parse("2026-07-04T00:00:00.000Z"));
	const pkce = new SqlitePkceSessionRepository(engine);

	const auth = new AuthService({
		providers: new Map<string, IdentityProvider>([
			["test", new FakeIdentityProvider()],
		]),
		pkce,
		users: new SqliteUserRepository(engine),
		identities: new SqliteUserIdentityRepository(engine),
		sessions: new SqliteSessionRepository(engine),
		clock,
		redirectUri: "http://localhost/auth/callback",
		sessionTtlMs: 3_600_000,
	});
	const subProviders = new Map<ProviderId, SubscriptionOAuthProvider>([
		[
			"anthropic",
			new AnthropicOAuthProvider({
				clock,
				tokenUrl: tokenServer.url,
				apiBase: tokenServer.baseUrl,
				authorizeUrl: "https://a.test/authorize",
				redirectUri: "https://a.test/cb",
				clientId: "cc",
			}),
		],
		[
			"openai",
			new OpenAiOAuthProvider({
				clock,
				tokenUrl: tokenServer.url,
				accountsUrl: `${tokenServer.baseUrl}/openai/accounts`,
			}),
		],
	]);
	const server: Server = new ManagementHttpServer({
		auth,
		accessKeys: new AccessKeysService(
			new SqliteProxyKeyRepository(engine),
			clock,
		),
		subscriptionOauth: new SubscriptionOAuthService(subProviders, pkce, clock),
		subscriptions: new SubscriptionsService(
			new SqliteSubscriptionRepository(engine, crypterForTests()),
			clock,
		),
		loads: new SqliteLoadRepository(engine),
	}).createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;

	return {
		base: `http://127.0.0.1:${port}`,
		cleanup: async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await engine.close();
			rmSync(dir, { recursive: true, force: true });
			await tokenServer.close();
		},
	};
}

async function login(base: string): Promise<string> {
	const begin = await fetch(`${base}/auth/login/test`, { redirect: "manual" });
	const location = begin.headers.get("location");
	if (location === null) {
		throw new Error("no redirect location");
	}
	const state = new URL(location).searchParams.get("state");
	const callback = await fetch(`${base}/auth/callback?state=${state}&code=abc`);
	const body = (await callback.json()) as { session_token: string };
	return body.session_token;
}

function authed(session: string): {
	authorization: string;
	"content-type": string;
} {
	return {
		authorization: `Bearer ${session}`,
		"content-type": "application/json",
	};
}

async function testSessionRequired(): Promise<void> {
	const h = await mkHarness();
	try {
		const resp = await fetch(`${h.base}/api/keys`);
		assert(resp.status === 401, "GET /api/keys without a session is 401");
	} finally {
		await h.cleanup();
	}
}

async function testLoginIssuesSessionAndKeys(): Promise<void> {
	const h = await mkHarness();
	try {
		const session = await login(h.base);
		assert(session.startsWith("spp_sess_"), "login yields a session token");

		const issued = await fetch(`${h.base}/api/keys`, {
			method: "POST",
			headers: authed(session),
			body: JSON.stringify({ pool_target: "own" }),
		});
		assert(issued.status === 201, "key issued");
		const key = (await issued.json()) as { key_id: string; secret: string };
		assert(key.secret.startsWith("spp_pk_"), "proxy key secret returned once");

		const list = await fetch(`${h.base}/api/keys`, {
			headers: authed(session),
		});
		const listed = (await list.json()) as { keys: unknown[] };
		assert(listed.keys.length === 1, "issued key is listed");

		const revoked = await fetch(`${h.base}/api/keys/${key.key_id}`, {
			method: "DELETE",
			headers: authed(session),
		});
		assert(revoked.status === 200, "key revoked");
	} finally {
		await h.cleanup();
	}
}

async function linkSubscription(
	base: string,
	session: string,
	poolKind: "user" | "donor",
	provider: ProviderId = "anthropic",
): Promise<void> {
	const begin = await fetch(`${base}/api/subscriptions/login`, {
		method: "POST",
		headers: authed(session),
		body: JSON.stringify({ provider, pool_kind: poolKind }),
	});
	assert(begin.status === 200, `${provider} subscription link starts`);
	const beginBody = (await begin.json()) as { state: string };
	const complete = await fetch(`${base}/api/subscriptions/complete`, {
		method: "POST",
		headers: authed(session),
		body: JSON.stringify({ state: beginBody.state, code: "abc#state" }),
	});
	assert(complete.status === 201, `${provider} subscription linked`);
}

async function testSubscriptionLinkAndPools(): Promise<void> {
	const h = await mkHarness();
	try {
		const session = await login(h.base);
		await linkSubscription(h.base, session, "user");
		await linkSubscription(h.base, session, "donor");

		const subs = await fetch(`${h.base}/api/subscriptions`, {
			headers: authed(session),
		});
		const subsBody = (await subs.json()) as { subscriptions: unknown[] };
		assert(subsBody.subscriptions.length === 1, "own-pool subscription listed");

		const pools = await fetch(`${h.base}/api/pools`, {
			headers: authed(session),
		});
		const poolsBody = (await pools.json()) as {
			own: unknown[];
			donor: unknown[];
		};
		assert(poolsBody.own.length === 1, "own pool has one subscription");
		assert(poolsBody.donor.length === 1, "donor pool has one subscription");
	} finally {
		await h.cleanup();
	}
}

async function testOpenAiSubscriptionLink(): Promise<void> {
	const h = await mkHarness();
	try {
		const session = await login(h.base);
		await linkSubscription(h.base, session, "user", "openai");

		const subscriptionsResponse = await fetch(`${h.base}/api/subscriptions`, {
			headers: authed(session),
		});
		const subscriptionsBody = (await subscriptionsResponse.json()) as {
			subscriptions: Array<{ provider: ProviderId }>;
		};
		const [subscription] = subscriptionsBody.subscriptions;
		assert(subscription !== undefined, "OpenAI subscription summary returned");
		assert(subscription.provider === "openai", "OpenAI provider preserved");
	} finally {
		await h.cleanup();
	}
}

async function testBadSessionRejected(): Promise<void> {
	const h = await mkHarness();
	try {
		const resp = await fetch(`${h.base}/api/pools`, {
			headers: { authorization: "Bearer spp_sess_bogus" },
		});
		assert(resp.status === 401, "invalid session rejected");
	} finally {
		await h.cleanup();
	}
}

async function testCompleteRejectsInvalidCredentials(): Promise<void> {
	const h = await mkHarness(401);
	try {
		const session = await login(h.base);
		const begin = await fetch(`${h.base}/api/subscriptions/login`, {
			method: "POST",
			headers: authed(session),
			body: JSON.stringify({ provider: "anthropic", pool_kind: "user" }),
		});
		const beginBody = (await begin.json()) as { state: string };

		const complete = await fetch(`${h.base}/api/subscriptions/complete`, {
			method: "POST",
			headers: authed(session),
			body: JSON.stringify({ state: beginBody.state, code: "abc#state" }),
		});
		assert(complete.status >= 400, "complete with invalid credentials fails");

		const subs = await fetch(`${h.base}/api/subscriptions`, {
			headers: authed(session),
		});
		const subsBody = (await subs.json()) as { subscriptions: unknown[] };
		assert(
			subsBody.subscriptions.length === 0,
			"no subscription is added when credentials do not verify",
		);
	} finally {
		await h.cleanup();
	}
}

async function main(): Promise<void> {
	await runTest("session_required", testSessionRequired);
	await runTest("login_issues_session_and_keys", testLoginIssuesSessionAndKeys);
	await runTest("subscription_link_and_pools", testSubscriptionLinkAndPools);
	await runTest("openai_subscription_link", testOpenAiSubscriptionLink);
	await runTest("bad_session_rejected", testBadSessionRejected);
	await runTest(
		"complete_rejects_invalid_credentials",
		testCompleteRejectsInvalidCredentials,
	);

	const report = { suite: "Management", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
