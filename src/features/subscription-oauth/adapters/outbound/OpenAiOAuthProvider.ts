/*
 * OpenAI ChatGPT subscription authorization adapter. Provider-specific browser,
 * token, and account endpoints stay behind SubscriptionOAuthProvider.
 */

import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import { systemClock, type Clock } from "../../../../shared/domain/Clock.ts";
import { type FetchFn, systemFetch } from "../../../../shared/http/Fetch.ts";
import {
	CHATGPT_ACCOUNT_ID_HEADER,
	chatGptAccountId,
} from "../../../../shared/openai/Constants.ts";
import type { OAuthGrant } from "../../domain/OAuthGrant.ts";
import type {
	AuthorizeUrlInput,
	CredentialVerdict,
	ExchangeCodeInput,
	SubscriptionOAuthProvider,
} from "../../ports/outbound/SubscriptionOAuthProvider.ts";

export interface OpenAiOAuthOptions {
	readonly clock?: Clock;
	readonly fetchFn?: FetchFn;
	readonly authorizeUrl?: string;
	readonly tokenUrl?: string;
	readonly accountsUrl?: string;
	readonly redirectUri?: string;
	readonly clientId?: string;
	readonly scopes?: string;
}

export class OpenAiOAuthProvider implements SubscriptionOAuthProvider {
	readonly providerId: ProviderId = "openai";
	private readonly clock: Clock;
	private readonly fetchFn: FetchFn;
	private readonly authorizeUrl: string;
	private readonly tokenUrl: string;
	private readonly accountsUrl: string;
	private readonly redirectUri: string;
	private readonly clientId: string;
	private readonly scopes: string;

	constructor(options: OpenAiOAuthOptions = {}) {
		this.clock = options.clock ?? systemClock;
		this.fetchFn = options.fetchFn ?? systemFetch;
		this.authorizeUrl =
			options.authorizeUrl ?? "https://auth.openai.com/oauth/authorize";
		this.tokenUrl = options.tokenUrl ?? "https://auth.openai.com/oauth/token";
		this.accountsUrl =
			options.accountsUrl ??
			"https://chatgpt.com/backend-api/wham/accounts/check";
		this.redirectUri =
			options.redirectUri ?? "http://localhost:1455/auth/callback";
		this.clientId = options.clientId ?? "app_EMoamEEZ73f0CkXaXp7hrann";
		this.scopes = options.scopes ?? "openid profile email offline_access";
	}

	buildAuthorizeUrl(input: AuthorizeUrlInput): Promise<string> {
		const url = new URL(this.authorizeUrl);
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
		return this.tokenRequest({
			grant_type: "authorization_code",
			code: input.code,
			redirect_uri: this.redirectUri,
			client_id: this.clientId,
			code_verifier: input.verifier,
		});
	}

	refresh(refreshToken: string): Promise<OAuthGrant> {
		return this.tokenRequest({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: this.clientId,
		});
	}

	async verifyCredentials(accessToken: string): Promise<CredentialVerdict> {
		const accountId = chatGptAccountId(accessToken);
		if (accountId === undefined) {
			return "invalid";
		}
		let response: Response;
		try {
			response = await this.fetchFn(this.accountsUrl, {
				method: "GET",
				headers: {
					authorization: `Bearer ${accessToken}`,
					[CHATGPT_ACCOUNT_ID_HEADER]: accountId,
					accept: "application/json",
				},
			});
		} catch {
			return "inconclusive";
		}
		await response.body?.cancel().catch(() => undefined);
		if (response.status === 401 || response.status === 403) {
			return "invalid";
		}
		return response.ok ? "valid" : "inconclusive";
	}

	private async tokenRequest(
		fields: Record<string, string>,
	): Promise<OAuthGrant> {
		const response = await this.fetchFn(this.tokenUrl, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				accept: "application/json",
			},
			body: new URLSearchParams(fields).toString(),
		});
		if (!response.ok) {
			throw new Error(`openai_token_request_failed:${response.status}`);
		}
		const json: unknown = await response.json();
		if (!isJsonObject(json)) {
			throw new Error("openai_token_response_invalid");
		}
		const accessToken = json.access_token;
		const refreshToken = json.refresh_token;
		if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
			throw new Error("openai_token_response_incomplete");
		}
		const expiresIn =
			typeof json.expires_in === "number" ? json.expires_in : 3600;
		return {
			accessToken,
			refreshToken,
			expiresAt: new Date(this.clock.nowMs() + expiresIn * 1000).toISOString(),
			scopes: typeof json.scope === "string" ? json.scope : this.scopes,
		};
	}
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
