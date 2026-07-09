/*
 * Credential liveness check: AnthropicOAuthProvider.verifyCredentials classifies
 * the upstream status, and completeLink gates the link on it — rejecting invalid
 * creds and retrying inconclusive ones before giving up (no subscription added).
 *
 * @covers spp-subscription-oauth:BEH-005
 * @covers spp-subscription-oauth:DLT-001
 * @covers spp-subscription-oauth:DLT-004
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteEngine } from "../../../shared/db/SqliteEngine.ts";
import { applyMigrations } from "../../../shared/db/Migrations.ts";
import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { ProviderId } from "../../../shared/domain/Provider.ts";
import type { FetchFn } from "../../../shared/http/Fetch.ts";
import { SqlitePkceSessionRepository } from "../../../shared/pkce/SqlitePkceSessionRepository.ts";
import { SubscriptionOAuthService } from "../application/SubscriptionOAuthService.ts";
import { AnthropicOAuthProvider } from "../adapters/outbound/AnthropicOAuthProvider.ts";
import { OpenAiOAuthProvider } from "../adapters/outbound/OpenAiOAuthProvider.ts";
import type { OAuthGrant } from "../domain/OAuthGrant.ts";
import type {
	AuthorizeUrlInput,
	CredentialVerdict,
	ExchangeCodeInput,
	SubscriptionOAuthProvider,
} from "../ports/outbound/SubscriptionOAuthProvider.ts";

interface TestRecord {
	name: string;
	ok: boolean;
	error?: string;
}
const results: TestRecord[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
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

function statusFetch(status: number): FetchFn {
	return () => Promise.resolve(new Response(null, { status }));
}

function anthropicWith(fetchFn: FetchFn): AnthropicOAuthProvider {
	return new AnthropicOAuthProvider({
		clock: new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
		fetchFn,
		apiBase: "https://upstream.test",
	});
}

async function verdictForStatus(status: number): Promise<CredentialVerdict> {
	return anthropicWith(statusFetch(status)).verifyCredentials("tok");
}

async function testValidStatusesAreValid(): Promise<void> {
	for (const status of [200, 201, 429, 529]) {
		assert(
			(await verdictForStatus(status)) === "valid",
			`status ${status} classified valid`,
		);
	}
}

async function testAuthStatusesAreInvalid(): Promise<void> {
	for (const status of [401, 403]) {
		assert(
			(await verdictForStatus(status)) === "invalid",
			`status ${status} classified invalid`,
		);
	}
}

async function testOtherStatusesAreInconclusive(): Promise<void> {
	for (const status of [500, 502, 400]) {
		assert(
			(await verdictForStatus(status)) === "inconclusive",
			`status ${status} classified inconclusive`,
		);
	}
}

async function testNetworkFailureIsInconclusive(): Promise<void> {
	const rejecting: FetchFn = () => Promise.reject(new Error("network down"));

	const verdict = await anthropicWith(rejecting).verifyCredentials("tok");

	assert(verdict === "inconclusive", "network failure is inconclusive");
}

async function testOpenAiValidStatusIsValid(): Promise<void> {
	let capturedUrl = "";
	let capturedInit: RequestInit | undefined;
	const fetchFn: FetchFn = (input, init) => {
		capturedUrl =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		capturedInit = init;
		return Promise.resolve(new Response("{}", { status: 200 }));
	};
	const verdict = await new OpenAiOAuthProvider({ fetchFn })
		.verifyCredentials("openai-token")
		.catch(() => "inconclusive" as const);

	assert(verdict === "valid", "OpenAI 2xx credential check is valid");
	assert(
		capturedUrl === "https://auth.openai.com/api/accounts",
		"OpenAI accounts endpoint",
	);
	assert(capturedInit !== undefined, "accounts request captured");
	const headers = new Headers(capturedInit.headers);
	assert(
		headers.get("authorization") === "Bearer openai-token",
		"subscription Bearer forwarded",
	);
}

async function testOpenAiUnauthorizedStatusIsInvalid(): Promise<void> {
	const provider = new OpenAiOAuthProvider({ fetchFn: statusFetch(401) });

	const verdict = await provider.verifyCredentials("openai-token");

	assert(verdict === "invalid", "OpenAI 401 credential check is invalid");
}

async function testOpenAiForbiddenStatusIsInvalid(): Promise<void> {
	const provider = new OpenAiOAuthProvider({ fetchFn: statusFetch(403) });

	const verdict = await provider.verifyCredentials("openai-token");

	assert(verdict === "invalid", "OpenAI 403 credential check is invalid");
}

async function testOpenAiServerErrorIsInconclusive(): Promise<void> {
	const provider = new OpenAiOAuthProvider({ fetchFn: statusFetch(500) });

	const verdict = await provider.verifyCredentials("openai-token");

	assert(
		verdict === "inconclusive",
		"OpenAI 500 credential check is inconclusive",
	);
}

async function testOpenAiNetworkFailureIsInconclusive(): Promise<void> {
	const rejecting: FetchFn = () => Promise.reject(new Error("network down"));
	const provider = new OpenAiOAuthProvider({ fetchFn: rejecting });

	const verdict = await provider.verifyCredentials("openai-token");

	assert(verdict === "inconclusive", "OpenAI network failure is inconclusive");
}

class FakeGateProvider implements SubscriptionOAuthProvider {
	readonly providerId: ProviderId = "anthropic";
	verifyCalls = 0;

	constructor(private readonly verdicts: ReadonlyArray<CredentialVerdict>) {}

	buildAuthorizeUrl(_input: AuthorizeUrlInput): Promise<string> {
		return Promise.resolve("https://stub.test/authorize?state=x");
	}

	exchangeCode(_input: ExchangeCodeInput): Promise<OAuthGrant> {
		return Promise.resolve({
			accessToken: "at-verify",
			refreshToken: "rt-verify",
			expiresAt: "2026-07-04T02:00:00.000Z",
			scopes: "user:inference",
		});
	}

	refresh(_refreshToken: string): Promise<OAuthGrant> {
		return Promise.reject(new Error("not used"));
	}

	verifyCredentials(_accessToken: string): Promise<CredentialVerdict> {
		const index = Math.min(this.verifyCalls, this.verdicts.length - 1);
		this.verifyCalls += 1;
		return Promise.resolve(this.verdicts[index]);
	}
}

interface GateOutcome {
	readonly linked: boolean;
	readonly message: string;
	readonly provider: FakeGateProvider;
}

async function completeWith(
	verdicts: ReadonlyArray<CredentialVerdict>,
): Promise<GateOutcome> {
	const dir = mkdtempSync(join(tmpdir(), "spp-verify-"));
	const db = new Database(join(dir, "pool.db"));
	const engine = new SqliteEngine(db);
	await applyMigrations(engine);
	const provider = new FakeGateProvider(verdicts);
	const service = new SubscriptionOAuthService(
		new Map<ProviderId, SubscriptionOAuthProvider>([["anthropic", provider]]),
		new SqlitePkceSessionRepository(engine),
		new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
	);
	try {
		const begin = await service.beginLink({
			provider: "anthropic",
			poolKind: "donor",
		});
		let message = "";
		let linked = false;
		try {
			await service.completeLink({ state: begin.state, code: "c" });
			linked = true;
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}
		return { linked, message, provider };
	} finally {
		await engine.close();
		rmSync(dir, { recursive: true, force: true });
	}
}

async function testValidCredentialsLink(): Promise<void> {
	const outcome = await completeWith(["valid"]);

	assert(outcome.linked, "valid credentials complete the link");
	assert(outcome.provider.verifyCalls === 1, "verified exactly once");
}

async function testInvalidCredentialsRejected(): Promise<void> {
	const outcome = await completeWith(["invalid"]);

	assert(!outcome.linked, "invalid credentials abort the link");
	assert(
		outcome.message.includes("subscription_credentials_invalid"),
		"invalid credentials raise subscription_credentials_invalid",
	);
	assert(
		outcome.provider.verifyCalls === 1,
		"no retry on a definitive invalid",
	);
}

async function testInconclusiveRetriesThenRejects(): Promise<void> {
	const outcome = await completeWith([
		"inconclusive",
		"inconclusive",
		"inconclusive",
	]);

	assert(!outcome.linked, "persistently inconclusive verification aborts");
	assert(
		outcome.message.includes("subscription_verification_unavailable"),
		"exhausted retries raise subscription_verification_unavailable",
	);
	assert(
		outcome.provider.verifyCalls === 3,
		"retried up to the attempt budget",
	);
}

async function testInconclusiveThenValidLinks(): Promise<void> {
	const outcome = await completeWith(["inconclusive", "valid"]);

	assert(outcome.linked, "a transient inconclusive is retried into a valid");
	assert(outcome.provider.verifyCalls === 2, "succeeded on the second attempt");
}

async function main(): Promise<void> {
	await runTest("valid_statuses_are_valid", testValidStatusesAreValid);
	await runTest("auth_statuses_are_invalid", testAuthStatusesAreInvalid);
	await runTest(
		"other_statuses_are_inconclusive",
		testOtherStatusesAreInconclusive,
	);
	await runTest(
		"network_failure_is_inconclusive",
		testNetworkFailureIsInconclusive,
	);
	await runTest("openai_valid_status_is_valid", testOpenAiValidStatusIsValid);
	await runTest(
		"openai_unauthorized_status_is_invalid",
		testOpenAiUnauthorizedStatusIsInvalid,
	);
	await runTest(
		"openai_forbidden_status_is_invalid",
		testOpenAiForbiddenStatusIsInvalid,
	);
	await runTest(
		"openai_server_error_is_inconclusive",
		testOpenAiServerErrorIsInconclusive,
	);
	await runTest(
		"openai_network_failure_is_inconclusive",
		testOpenAiNetworkFailureIsInconclusive,
	);
	await runTest("valid_credentials_link", testValidCredentialsLink);
	await runTest("invalid_credentials_rejected", testInvalidCredentialsRejected);
	await runTest(
		"inconclusive_retries_then_rejects",
		testInconclusiveRetriesThenRejects,
	);
	await runTest(
		"inconclusive_then_valid_links",
		testInconclusiveThenValidLinks,
	);

	const report = { suite: "SubscriptionVerify", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
