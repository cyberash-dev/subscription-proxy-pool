/*
 * Level-1 auth end-to-end against a fake OIDC issuer (local http server signing
 * real RS256 id_tokens): login begin/complete, create-or-link, session resolve,
 * single-use state, logout.
 *
 * @covers spp-auth:BEH-001
 * @covers spp-auth:BEH-002
 * @covers spp-auth:BEH-003
 * @covers spp-auth:BEH-004
 * @covers spp-auth:INV-001
 * @covers spp-auth:INV-002
 * @covers spp-auth:CNT-001
 */

import Database from "better-sqlite3";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import {
	generateKeyPairSync,
	type KeyObject,
	sign as cryptoSign,
} from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";

import { SqliteEngine } from "../../../shared/db/SqliteEngine.ts";
import { applyMigrations } from "../../../shared/db/Migrations.ts";
import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { OidcProviderConfig } from "../../../shared/config/Env.ts";
import { SqlitePkceSessionRepository } from "../../../shared/pkce/SqlitePkceSessionRepository.ts";
import { AuthService } from "../application/AuthService.ts";
import { GenericOidcIdentityProvider } from "../adapters/outbound/GenericOidcIdentityProvider.ts";
import {
	SqliteUserIdentityRepository,
	SqliteUserRepository,
} from "../adapters/outbound/SqliteUserRepository.ts";
import { SqliteSessionRepository } from "../adapters/outbound/SqliteSessionRepository.ts";
import type { IdentityProvider } from "../ports/outbound/IdentityProvider.ts";

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

function b64url(input: Buffer | string): string {
	return Buffer.from(input).toString("base64url");
}

interface FakeOidc {
	readonly issuer: string;
	subject: string;
	setNonce(nonce: string): void;
	close(): Promise<void>;
}

async function startFakeOidc(): Promise<FakeOidc> {
	const { publicKey, privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key-1" };
	const state = { nonce: "", subject: "subject-abc", issuer: "" };

	function signIdToken(privKey: KeyObject): string {
		const header = b64url(
			JSON.stringify({ alg: "RS256", kid: "test-key-1", typ: "JWT" }),
		);
		const payload = b64url(
			JSON.stringify({
				iss: state.issuer,
				sub: state.subject,
				aud: "test-client",
				exp: Math.floor(Date.now() / 1000) + 3600,
				nonce: state.nonce,
				email: "alice@example.com",
			}),
		);
		const signingInput = `${header}.${payload}`;
		const signature = cryptoSign(
			"RSA-SHA256",
			Buffer.from(signingInput),
			privKey,
		);
		return `${signingInput}.${b64url(signature)}`;
	}

	const server: Server = createServer(
		(req: IncomingMessage, res: ServerResponse) => {
			const url = req.url ?? "";
			if (url.startsWith("/.well-known/openid-configuration")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						issuer: state.issuer,
						authorization_endpoint: `${state.issuer}/authorize`,
						token_endpoint: `${state.issuer}/token`,
						jwks_uri: `${state.issuer}/jwks`,
					}),
				);
				return;
			}
			if (url.startsWith("/jwks")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ keys: [jwk] }));
				return;
			}
			if (url.startsWith("/token")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id_token: signIdToken(privateKey),
						token_type: "Bearer",
					}),
				);
				return;
			}
			res.writeHead(404);
			res.end();
		},
	);

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	state.issuer = `http://127.0.0.1:${port}`;

	return {
		get issuer() {
			return state.issuer;
		},
		get subject() {
			return state.subject;
		},
		set subject(value: string) {
			state.subject = value;
		},
		setNonce: (nonce: string) => {
			state.nonce = nonce;
		},
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve())),
			),
	};
}

interface Harness {
	readonly auth: AuthService;
	readonly fake: FakeOidc;
	readonly clock: FakeClock;
	readonly cleanup: () => Promise<void>;
}

async function mkHarness(): Promise<Harness> {
	const fake = await startFakeOidc();
	const dir = mkdtempSync(join(tmpdir(), "spp-auth-"));
	const db = new Database(join(dir, "pool.db"));
	const engine = new SqliteEngine(db);
	await applyMigrations(engine);
	const clock = new FakeClock(Date.parse("2026-07-04T00:00:00.000Z"));

	const config: OidcProviderConfig = {
		name: "test",
		issuer: fake.issuer,
		clientId: "test-client",
		clientSecret: "",
		scopes: "openid email profile",
	};
	const provider = new GenericOidcIdentityProvider(config, clock);
	const providers = new Map<string, IdentityProvider>([["test", provider]]);

	const auth = new AuthService({
		providers,
		pkce: new SqlitePkceSessionRepository(engine),
		users: new SqliteUserRepository(engine),
		identities: new SqliteUserIdentityRepository(engine),
		sessions: new SqliteSessionRepository(engine),
		clock,
		redirectUri: "http://127.0.0.1:9999/auth/callback",
		sessionTtlMs: 3600_000,
	});

	return {
		auth,
		fake,
		clock,
		cleanup: async () => {
			await engine.close();
			rmSync(dir, { recursive: true, force: true });
			await fake.close();
		},
	};
}

function nonceFrom(authorizeUrl: string): string {
	const nonce = new URL(authorizeUrl).searchParams.get("nonce");
	if (nonce === null) {
		throw new Error("authorize URL missing nonce");
	}
	return nonce;
}

async function login(h: Harness): Promise<{ token: string; userId: string }> {
	const begin = await h.auth.beginLogin({ provider: "test" });
	h.fake.setNonce(nonceFrom(begin.authorizeUrl));
	const complete = await h.auth.completeLogin({
		state: begin.state,
		code: "auth-code",
	});
	return { token: complete.sessionToken, userId: complete.userId };
}

async function testBeginLoginBuildsPkceAuthorizeUrl(): Promise<void> {
	const h = await mkHarness();
	try {
		const begin = await h.auth.beginLogin({ provider: "test" });
		const url = new URL(begin.authorizeUrl);
		assert(
			url.searchParams.get("code_challenge") !== null,
			"has code_challenge",
		);
		assert(
			url.searchParams.get("code_challenge_method") === "S256",
			"S256 challenge method",
		);
		assert(
			url.searchParams.get("state") === begin.state,
			"state echoed in url",
		);
		assert(url.searchParams.get("nonce") !== null, "has nonce");
	} finally {
		await h.cleanup();
	}
}

async function testCompleteLoginCreatesUserAndSession(): Promise<void> {
	const h = await mkHarness();
	try {
		const session = await login(h);
		assert(session.token.startsWith("spp_sess_"), "session token minted");
		const principal = await h.auth.resolveSession(session.token);
		assert(
			principal?.userId === session.userId,
			"session resolves to the user",
		);
	} finally {
		await h.cleanup();
	}
}

async function testSecondLoginLinksSameUser(): Promise<void> {
	const h = await mkHarness();
	try {
		const first = await login(h);
		const second = await login(h);
		assert(
			first.userId === second.userId,
			"same subject reuses the user account",
		);
	} finally {
		await h.cleanup();
	}
}

async function testNewSubjectIsNewUser(): Promise<void> {
	const h = await mkHarness();
	try {
		const first = await login(h);
		h.fake.subject = "subject-different";
		const second = await login(h);
		assert(
			first.userId !== second.userId,
			"different subject creates a new user",
		);
	} finally {
		await h.cleanup();
	}
}

async function testResolveSessionRejectsUnknownAndExpired(): Promise<void> {
	const h = await mkHarness();
	try {
		assert(
			(await h.auth.resolveSession("spp_sess_bogus")) === undefined,
			"unknown token rejected",
		);
		const session = await login(h);
		h.clock.advance(3600_001);
		assert(
			(await h.auth.resolveSession(session.token)) === undefined,
			"expired session rejected",
		);
	} finally {
		await h.cleanup();
	}
}

async function testReusedStateRejected(): Promise<void> {
	const h = await mkHarness();
	try {
		const begin = await h.auth.beginLogin({ provider: "test" });
		h.fake.setNonce(nonceFrom(begin.authorizeUrl));
		await h.auth.completeLogin({ state: begin.state, code: "c1" });
		let threw = false;
		try {
			await h.auth.completeLogin({ state: begin.state, code: "c2" });
		} catch {
			threw = true;
		}
		assert(threw, "reused login state is rejected (single-use)");
	} finally {
		await h.cleanup();
	}
}

async function testLogoutRevokesSession(): Promise<void> {
	const h = await mkHarness();
	try {
		const session = await login(h);
		await h.auth.logout(session.token);
		assert(
			(await h.auth.resolveSession(session.token)) === undefined,
			"revoked session no longer resolves",
		);
	} finally {
		await h.cleanup();
	}
}

async function main(): Promise<void> {
	await runTest(
		"begin_login_builds_pkce_authorize_url",
		testBeginLoginBuildsPkceAuthorizeUrl,
	);
	await runTest(
		"complete_login_creates_user_and_session",
		testCompleteLoginCreatesUserAndSession,
	);
	await runTest("second_login_links_same_user", testSecondLoginLinksSameUser);
	await runTest("new_subject_is_new_user", testNewSubjectIsNewUser);
	await runTest(
		"resolve_session_rejects_unknown_and_expired",
		testResolveSessionRejectsUnknownAndExpired,
	);
	await runTest("reused_state_rejected", testReusedStateRejected);
	await runTest("logout_revokes_session", testLogoutRevokesSession);

	const report = { suite: "Auth", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
