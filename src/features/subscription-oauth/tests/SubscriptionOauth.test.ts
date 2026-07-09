/*
 * Level-2 subscription OAuth: PKCE begin/complete against a fake token server,
 * single-use link state, and the provider stub. Token refresh is covered in
 * TokenManager.test.ts.
 *
 * @covers spp-subscription-oauth:BEH-001
 * @covers spp-subscription-oauth:BEH-002
 * @covers spp-subscription-oauth:BEH-004
 * @covers spp-subscription-oauth:CNT-001
 * @covers spp-subscription-oauth:CNST-001
 * @covers spp-subscription-oauth:DLT-002
 * @covers spp-subscription-oauth:EXT-001
 */

import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";

import { SqliteEngine } from "../../../shared/db/SqliteEngine.ts";
import { applyMigrations } from "../../../shared/db/Migrations.ts";
import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { ProviderId } from "../../../shared/domain/Provider.ts";
import { SqlitePkceSessionRepository } from "../../../shared/pkce/SqlitePkceSessionRepository.ts";
import { SubscriptionOAuthService } from "../application/SubscriptionOAuthService.ts";
import { AnthropicOAuthProvider } from "../adapters/outbound/AnthropicOAuthProvider.ts";
import type { SubscriptionOAuthProvider } from "../ports/outbound/SubscriptionOAuthProvider.ts";

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

function assert(cond: boolean, label: string): asserts cond {
	if (!cond) {
		throw new Error(label);
	}
}

interface CapturedToken {
	contentType: string;
	grantType?: string;
	code?: string;
	state?: string;
	codeVerifier?: string;
}

interface TokenServer {
	readonly url: string;
	readonly baseUrl: string;
	readonly captured: CapturedToken;
	close(): Promise<void>;
}

async function startTokenServer(): Promise<TokenServer> {
	let n = 0;
	const captured: CapturedToken = { contentType: "" };
	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			if (!(req.url ?? "").startsWith("/token")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end("{}");
				return;
			}
			captured.contentType = String(req.headers["content-type"]);
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
				string,
				unknown
			>;
			captured.grantType =
				typeof body.grant_type === "string" ? body.grant_type : undefined;
			captured.code = typeof body.code === "string" ? body.code : undefined;
			captured.state = typeof body.state === "string" ? body.state : undefined;
			captured.codeVerifier =
				typeof body.code_verifier === "string" ? body.code_verifier : undefined;
			n += 1;
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					access_token: `at-${n}`,
					refresh_token: `rt-${n}`,
					expires_in: 3600,
					scope: "user:inference",
				}),
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}/token`,
		baseUrl: `http://127.0.0.1:${port}`,
		captured,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve())),
			),
	};
}

interface Harness {
	readonly service: SubscriptionOAuthService;
	readonly captured: CapturedToken;
	readonly cleanup: () => Promise<void>;
}

async function mkHarness(): Promise<Harness> {
	const server = await startTokenServer();
	const dir = mkdtempSync(join(tmpdir(), "spp-suboauth-"));
	const db = new Database(join(dir, "pool.db"));
	const engine = new SqliteEngine(db);
	await applyMigrations(engine);
	await engine.run(
		"INSERT INTO users(user_id, created_at) VALUES('user-a', datetime('now'))",
	);
	const clock = new FakeClock(Date.parse("2026-07-04T00:00:00.000Z"));
	const anthropic = new AnthropicOAuthProvider({
		clock,
		tokenUrl: server.url,
		apiBase: server.baseUrl,
		authorizeUrl: "https://example.test/authorize",
		redirectUri: "https://example.test/cb",
		clientId: "cc",
	});
	const providers = new Map<ProviderId, SubscriptionOAuthProvider>([
		["anthropic", anthropic],
	]);
	const service = new SubscriptionOAuthService(
		providers,
		new SqlitePkceSessionRepository(engine),
		clock,
	);
	return {
		service,
		captured: server.captured,
		cleanup: async () => {
			await engine.close();
			rmSync(dir, { recursive: true, force: true });
			await server.close();
		},
	};
}

async function testBeginLinkBuildsPkceUrl(): Promise<void> {
	const h = await mkHarness();
	try {
		const begin = await h.service.beginLink({
			provider: "anthropic",
			poolKind: "donor",
		});
		const url = new URL(begin.authorizeUrl);
		assert(
			url.searchParams.get("code_challenge") !== null,
			"has code_challenge",
		);
		assert(url.searchParams.get("state") === begin.state, "state echoed");
	} finally {
		await h.cleanup();
	}
}

async function testCompleteLinkExchangesCode(): Promise<void> {
	const h = await mkHarness();
	try {
		const begin = await h.service.beginLink({
			provider: "anthropic",
			poolKind: "user",
			ownerUserId: "user-a",
		});
		const linked = await h.service.completeLink({
			state: begin.state,
			code: "abc#state",
		});
		assert(
			linked.grant.accessToken.startsWith("at-"),
			"grant carries an access token",
		);
		assert(linked.provider === "anthropic", "provider carried through");
		assert(linked.poolKind === "user", "pool kind carried through");
		assert(linked.ownerUserId === "user-a", "owner carried through");
	} finally {
		await h.cleanup();
	}
}

async function testExchangeSendsJsonWithState(): Promise<void> {
	const h = await mkHarness();
	try {
		const begin = await h.service.beginLink({
			provider: "anthropic",
			poolKind: "donor",
		});
		await h.service.completeLink({
			state: begin.state,
			code: "the-code#the-state",
		});

		assert(
			h.captured.contentType === "application/json",
			"token exchange posts application/json",
		);
		assert(
			h.captured.grantType === "authorization_code",
			"grant_type is authorization_code",
		);
		assert(h.captured.code === "the-code", "code is parsed from code#state");
		assert(h.captured.state === "the-state", "state forwarded from code#state");
		assert(h.captured.codeVerifier !== undefined, "code_verifier is sent");
	} finally {
		await h.cleanup();
	}
}

async function testCompleteLinkSingleUse(): Promise<void> {
	const h = await mkHarness();
	try {
		const begin = await h.service.beginLink({
			provider: "anthropic",
			poolKind: "donor",
		});
		await h.service.completeLink({ state: begin.state, code: "c1" });
		let threw = false;
		try {
			await h.service.completeLink({ state: begin.state, code: "c2" });
		} catch {
			threw = true;
		}
		assert(threw, "reused link state rejected");
	} finally {
		await h.cleanup();
	}
}

async function testUserPoolRequiresOwner(): Promise<void> {
	const h = await mkHarness();
	try {
		let threw = false;
		try {
			await h.service.beginLink({ provider: "anthropic", poolKind: "user" });
		} catch {
			threw = true;
		}
		assert(threw, "user-pool link without owner is rejected");
	} finally {
		await h.cleanup();
	}
}

async function main(): Promise<void> {
	await runTest("begin_link_builds_pkce_url", testBeginLinkBuildsPkceUrl);
	await runTest("complete_link_exchanges_code", testCompleteLinkExchangesCode);
	await runTest(
		"exchange_sends_json_with_state",
		testExchangeSendsJsonWithState,
	);
	await runTest("complete_link_single_use", testCompleteLinkSingleUse);
	await runTest("user_pool_requires_owner", testUserPoolRequiresOwner);
	const report = { suite: "SubscriptionOauth", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
