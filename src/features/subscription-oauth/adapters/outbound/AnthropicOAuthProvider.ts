/*
 * Anthropic (Claude Code) OAuth provider (spp-subscription-oauth:CNST-001).
 * PKCE authorization-code with the public Claude Code client id; exchange and
 * refresh are x-www-form-urlencoded POSTs. Endpoints are overridable so tests
 * can point at a fake token server. Live wire details are OQ-001.
 */

import type { Clock } from "../../../../shared/domain/Clock.ts";
import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import { type FetchFn, systemFetch } from "../../../../shared/http/Fetch.ts";
import {
	ANTHROPIC_API_BASE,
	ANTHROPIC_AUTHORIZE_URL,
	ANTHROPIC_BETA,
	ANTHROPIC_OAUTH_SCOPES,
	ANTHROPIC_PROBE_MODEL,
	ANTHROPIC_REDIRECT_URI,
	ANTHROPIC_TOKEN_URL,
	ANTHROPIC_VERSION,
	CLAUDE_CODE_CLIENT_ID,
} from "../../../../shared/anthropic/Constants.ts";
import type { OAuthGrant } from "../../domain/OAuthGrant.ts";
import type {
	AuthorizeUrlInput,
	CredentialVerdict,
	ExchangeCodeInput,
	SubscriptionOAuthProvider,
} from "../../ports/outbound/SubscriptionOAuthProvider.ts";

export interface AnthropicOAuthOptions {
	readonly clock: Clock;
	readonly fetchFn?: FetchFn;
	readonly authorizeUrl?: string;
	readonly tokenUrl?: string;
	readonly redirectUri?: string;
	readonly clientId?: string;
	readonly scopes?: string;
	readonly apiBase?: string;
	readonly verifyModel?: string;
}

interface TokenResponseJson {
	readonly access_token?: string;
	readonly refresh_token?: string;
	readonly expires_in?: number;
	readonly scope?: string;
}

export class AnthropicOAuthProvider implements SubscriptionOAuthProvider {
	readonly providerId: ProviderId = "anthropic";
	private readonly clock: Clock;
	private readonly fetchFn: FetchFn;
	private readonly authorizeUrl: string;
	private readonly tokenUrl: string;
	private readonly redirectUri: string;
	private readonly clientId: string;
	private readonly scopes: string;
	private readonly apiBase: string;
	private readonly verifyModel: string;

	constructor(options: AnthropicOAuthOptions) {
		this.clock = options.clock;
		this.fetchFn = options.fetchFn ?? systemFetch;
		this.authorizeUrl = options.authorizeUrl ?? ANTHROPIC_AUTHORIZE_URL;
		this.tokenUrl = options.tokenUrl ?? ANTHROPIC_TOKEN_URL;
		this.redirectUri = options.redirectUri ?? ANTHROPIC_REDIRECT_URI;
		this.clientId = options.clientId ?? CLAUDE_CODE_CLIENT_ID;
		this.scopes = options.scopes ?? ANTHROPIC_OAUTH_SCOPES.join(" ");
		this.apiBase = options.apiBase ?? ANTHROPIC_API_BASE;
		this.verifyModel = options.verifyModel ?? ANTHROPIC_PROBE_MODEL;
	}

	async verifyCredentials(accessToken: string): Promise<CredentialVerdict> {
		let status: number;
		try {
			const resp = await this.fetchFn(`${this.apiBase}/v1/messages`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"anthropic-version": ANTHROPIC_VERSION,
					"anthropic-beta": ANTHROPIC_BETA,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: this.verifyModel,
					max_tokens: 1,
					messages: [{ role: "user", content: "." }],
				}),
			});
			status = resp.status;
			await resp.body?.cancel().catch(() => undefined);
		} catch {
			return "inconclusive";
		}
		return classifyVerdict(status);
	}

	buildAuthorizeUrl(input: AuthorizeUrlInput): Promise<string> {
		const url = new URL(this.authorizeUrl);
		url.searchParams.set("code", "true");
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", this.clientId);
		url.searchParams.set("redirect_uri", this.redirectUri);
		url.searchParams.set("scope", this.scopes);
		url.searchParams.set("state", input.state);
		url.searchParams.set("code_challenge", input.challenge.challenge);
		url.searchParams.set("code_challenge_method", input.challenge.method);
		return Promise.resolve(url.toString());
	}

	async exchangeCode(input: ExchangeCodeInput): Promise<OAuthGrant> {
		/* The manual Claude Code code arrives as `code#state`; forward both. */
		const hashIndex = input.code.indexOf("#");
		const code = hashIndex >= 0 ? input.code.slice(0, hashIndex) : input.code;
		const state =
			hashIndex >= 0 ? input.code.slice(hashIndex + 1) : input.verifier;
		return this.tokenRequest({
			grant_type: "authorization_code",
			code,
			state,
			redirect_uri: this.redirectUri,
			client_id: this.clientId,
			code_verifier: input.verifier,
		});
	}

	async refresh(refreshToken: string): Promise<OAuthGrant> {
		return this.tokenRequest({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: this.clientId,
		});
	}

	private async tokenRequest(
		fields: Record<string, string>,
	): Promise<OAuthGrant> {
		const resp = await this.fetchFn(this.tokenUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify(fields),
		});
		if (!resp.ok) {
			throw new Error(`anthropic_token_request_failed: ${resp.status}`);
		}
		/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- HTTP JSON boundary */
		const json = (await resp.json()) as TokenResponseJson;
		if (json.access_token === undefined || json.refresh_token === undefined) {
			throw new Error("anthropic_token_response_incomplete");
		}
		const expiresInMs = (json.expires_in ?? 3600) * 1000;
		return {
			accessToken: json.access_token,
			refreshToken: json.refresh_token,
			expiresAt: new Date(this.clock.nowMs() + expiresInMs).toISOString(),
			scopes: json.scope ?? this.scopes,
		};
	}
}

function classifyVerdict(status: number): CredentialVerdict {
	if (status === 401 || status === 403) {
		return "invalid";
	}
	if ((status >= 200 && status < 300) || status === 429 || status === 529) {
		return "valid";
	}
	return "inconclusive";
}
