/*
 * OpenAI subscription authorization: fixed browser URL, PKCE code exchange,
 * refresh-token rotation, and strict validation of token responses.
 *
 * @covers spp-subscription-oauth:DLT-003
 * @covers spp-subscription-oauth:DLT-005
 * @covers spp-subscription-oauth:EXT-002
 * @covers spp-subscription-oauth:CNST-002
 * @covers pol:POL-PROVIDER-001
 * @covers pol:DLT-001
 */

import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { FetchFn } from "../../../shared/http/Fetch.ts";
import { OpenAiOAuthProvider } from "../adapters/outbound/OpenAiOAuthProvider.ts";

interface TestRecord {
	name: string;
	ok: boolean;
	error?: string;
}

interface CapturedRequest {
	url: string;
	init?: RequestInit;
}

const results: TestRecord[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
		results.push({ name, ok: true });
	} catch (error) {
		const message =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		results.push({ name, ok: false, error: message });
	}
}

function assert(condition: boolean, label: string): asserts condition {
	if (!condition) {
		throw new Error(label);
	}
}

function requestUrl(input: Parameters<FetchFn>[0]): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

function tokenResponseFetch(captured: CapturedRequest): FetchFn {
	return (input, init) => {
		captured.url = requestUrl(input);
		captured.init = init;
		return Promise.resolve(
			new Response(
				JSON.stringify({
					access_token: "openai-access",
					refresh_token: "openai-refresh",
					expires_in: 3600,
					scope: "openid profile email offline_access",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
	};
}

function formBody(captured: CapturedRequest): URLSearchParams {
	assert(captured.init !== undefined, "request captured");
	assert(typeof captured.init.body === "string", "request body is a string");
	return new URLSearchParams(captured.init.body);
}

function accessTokenWithPayload(payload: unknown): string {
	const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
		"base64url",
	);
	return `header.${encodedPayload}.signature`;
}

function successfulAccountsFetch(): FetchFn {
	return () => Promise.resolve(new Response(null, { status: 200 }));
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
	return promise.then(
		() => "",
		(error: unknown) =>
			error instanceof Error ? error.message : String(error),
	);
}

async function testBuildsPkceUrl(): Promise<void> {
	const authorizeUrl = await new OpenAiOAuthProvider().buildAuthorizeUrl({
		state: "state-1",
		challenge: { challenge: "challenge-1", method: "S256", verifier: "v" },
	});

	const url = new URL(authorizeUrl);
	assert(url.origin === "https://auth.openai.com", "OpenAI auth origin");
	assert(url.pathname === "/oauth/authorize", "OpenAI authorize path");
	assert(url.searchParams.get("response_type") === "code", "code flow");
	assert(
		url.searchParams.get("client_id") === "app_EMoamEEZ73f0CkXaXp7hrann",
		"public OpenAI client id",
	);
	assert(
		url.searchParams.get("redirect_uri") ===
			"http://localhost:1455/auth/callback",
		"registered redirect URI",
	);
	assert(
		url.searchParams.get("scope") === "openid profile email offline_access",
		"subscription scopes",
	);
	assert(url.searchParams.get("state") === "state-1", "state forwarded");
	assert(
		url.searchParams.get("code_challenge") === "challenge-1",
		"PKCE challenge forwarded",
	);
	assert(
		url.searchParams.get("code_challenge_method") === "S256",
		"PKCE S256 selected",
	);
}

async function testExchangesCode(): Promise<void> {
	const captured: CapturedRequest = { url: "" };
	const provider = new OpenAiOAuthProvider({
		clock: new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
		fetchFn: tokenResponseFetch(captured),
	});

	const grant = await provider.exchangeCode({
		code: "code-1",
		verifier: "verifier-1",
	});

	assert(
		captured.url === "https://auth.openai.com/oauth/token",
		"OpenAI token endpoint",
	);
	assert(captured.init?.method === "POST", "token exchange uses POST");
	const headers = new Headers(captured.init.headers);
	assert(
		headers.get("content-type") === "application/x-www-form-urlencoded",
		"token exchange is form encoded",
	);
	const form = formBody(captured);
	assert(form.get("grant_type") === "authorization_code", "grant type");
	assert(form.get("code") === "code-1", "link code forwarded");
	assert(form.get("code_verifier") === "verifier-1", "verifier forwarded");
	assert(
		form.get("redirect_uri") === "http://localhost:1455/auth/callback",
		"registered redirect URI forwarded",
	);
	assert(
		form.get("client_id") === "app_EMoamEEZ73f0CkXaXp7hrann",
		"public client id forwarded",
	);
	assert(grant.accessToken === "openai-access", "access token mapped");
	assert(grant.refreshToken === "openai-refresh", "refresh token mapped");
	assert(grant.expiresAt === "2026-07-04T01:00:00.000Z", "expiry mapped");
}

async function testRefreshesGrant(): Promise<void> {
	const captured: CapturedRequest = { url: "" };
	const provider = new OpenAiOAuthProvider({
		clock: new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
		fetchFn: tokenResponseFetch(captured),
	});

	const grant = await provider.refresh("old-refresh");

	const form = formBody(captured);
	assert(form.get("grant_type") === "refresh_token", "refresh grant type");
	assert(
		form.get("refresh_token") === "old-refresh",
		"stored refresh token forwarded",
	);
	assert(
		form.get("client_id") === "app_EMoamEEZ73f0CkXaXp7hrann",
		"public client id forwarded",
	);
	assert(grant.accessToken === "openai-access", "rotated access token mapped");
	assert(
		grant.refreshToken === "openai-refresh",
		"rotated refresh token mapped",
	);
}

async function testRejectsFailedTokenRequest(): Promise<void> {
	const fetchFn: FetchFn = () =>
		Promise.resolve(new Response(null, { status: 400 }));
	const provider = new OpenAiOAuthProvider({ fetchFn });

	const message = await rejectionMessage(
		provider.exchangeCode({ code: "bad-code", verifier: "verifier" }),
	);

	assert(message === "openai_token_request_failed:400", "HTTP error retained");
}

async function testRejectsIncompleteTokenResponse(): Promise<void> {
	const fetchFn: FetchFn = () =>
		Promise.resolve(
			new Response(JSON.stringify({ access_token: "access-only" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
	const provider = new OpenAiOAuthProvider({ fetchFn });

	const message = await rejectionMessage(provider.refresh("refresh-token"));

	assert(
		message === "openai_token_response_incomplete",
		"missing token rejected",
	);
}

async function testRejectsMalformedAccessToken(): Promise<void> {
	const provider = new OpenAiOAuthProvider({
		fetchFn: successfulAccountsFetch(),
	});

	const verdict = await provider.verifyCredentials("not-a-jwt");

	assert(verdict === "invalid", "malformed access token rejected");
}

async function testRejectsInvalidAccessTokenPayload(): Promise<void> {
	const provider = new OpenAiOAuthProvider({
		fetchFn: successfulAccountsFetch(),
	});

	const verdict = await provider.verifyCredentials("header.not-json.signature");

	assert(verdict === "invalid", "invalid access token payload rejected");
}

async function testRejectsNonObjectAccessTokenPayload(): Promise<void> {
	const provider = new OpenAiOAuthProvider({
		fetchFn: successfulAccountsFetch(),
	});

	const verdict = await provider.verifyCredentials(accessTokenWithPayload([]));

	assert(verdict === "invalid", "non-object access token payload rejected");
}

async function testRejectsMissingAuthClaims(): Promise<void> {
	const provider = new OpenAiOAuthProvider({
		fetchFn: successfulAccountsFetch(),
	});

	const verdict = await provider.verifyCredentials(accessTokenWithPayload({}));

	assert(verdict === "invalid", "missing OpenAI auth claims rejected");
}

async function main(): Promise<void> {
	await runTest("builds_pkce_url", testBuildsPkceUrl);
	await runTest("exchanges_code", testExchangesCode);
	await runTest("refreshes_grant", testRefreshesGrant);
	await runTest("rejects_failed_token_request", testRejectsFailedTokenRequest);
	await runTest(
		"rejects_incomplete_token_response",
		testRejectsIncompleteTokenResponse,
	);
	await runTest(
		"rejects_malformed_access_token",
		testRejectsMalformedAccessToken,
	);
	await runTest(
		"rejects_invalid_access_token_payload",
		testRejectsInvalidAccessTokenPayload,
	);
	await runTest(
		"rejects_non_object_access_token_payload",
		testRejectsNonObjectAccessTokenPayload,
	);
	await runTest("rejects_missing_auth_claims", testRejectsMissingAuthClaims);

	const report = { suite: "OpenAiOAuth", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((result) => !result.ok)) {
		process.exit(1);
	}
}

void main();
