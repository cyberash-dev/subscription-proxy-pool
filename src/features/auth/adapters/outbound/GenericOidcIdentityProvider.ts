/*
 * Config-driven OIDC identity provider (spp-auth:CNT-001, spp-auth:INV-002).
 * OIDC discovery + JWKS id_token verification; social tokens never persisted.
 */

import type { Clock } from "../../../../shared/domain/Clock.ts";
import type { OidcProviderConfig } from "../../../../shared/config/Env.ts";
import { type FetchFn, systemFetch } from "../../../../shared/http/Fetch.ts";
import { type Jwk, verifyIdToken } from "../../../../shared/oidc/Jwt.ts";
import type { ExternalIdentity } from "../../domain/User.ts";
import type {
	AuthorizeUrlInput,
	ExchangeCodeInput,
	IdentityProvider,
} from "../../ports/outbound/IdentityProvider.ts";

interface DiscoveryDoc {
	readonly authorization_endpoint: string;
	readonly token_endpoint: string;
	readonly jwks_uri: string;
}

interface TokenResponse {
	readonly id_token?: string;
}

interface JwksResponse {
	readonly keys?: ReadonlyArray<Jwk>;
}

export class GenericOidcIdentityProvider implements IdentityProvider {
	readonly name: string;
	private discoveryCache: DiscoveryDoc | undefined;

	constructor(
		private readonly config: OidcProviderConfig,
		private readonly clock: Clock,
		private readonly fetchFn: FetchFn = systemFetch,
	) {
		this.name = config.name;
	}

	async buildAuthorizeUrl(input: AuthorizeUrlInput): Promise<string> {
		const discovery = await this.discovery();
		const url = new URL(discovery.authorization_endpoint);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("client_id", this.config.clientId);
		url.searchParams.set("redirect_uri", input.redirectUri);
		url.searchParams.set("scope", this.config.scopes);
		url.searchParams.set("state", input.state);
		url.searchParams.set("nonce", input.nonce);
		url.searchParams.set("code_challenge", input.challenge.challenge);
		url.searchParams.set("code_challenge_method", input.challenge.method);
		return url.toString();
	}

	async exchangeCode(input: ExchangeCodeInput): Promise<ExternalIdentity> {
		const discovery = await this.discovery();
		const form = new URLSearchParams({
			grant_type: "authorization_code",
			code: input.code,
			redirect_uri: input.redirectUri,
			client_id: this.config.clientId,
			code_verifier: input.verifier,
		});
		if (this.config.clientSecret.length > 0) {
			form.set("client_secret", this.config.clientSecret);
		}
		const tokenResp = await this.fetchFn(discovery.token_endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				accept: "application/json",
			},
			body: form,
		});
		if (!tokenResp.ok) {
			throw new Error(`oidc_token_exchange_failed: ${tokenResp.status}`);
		}
		const token = await this.readJson<TokenResponse>(tokenResp);
		if (token.id_token === undefined) {
			throw new Error("oidc_token_response_missing_id_token");
		}
		const jwks = await this.fetchJwks(discovery.jwks_uri);
		const claims = verifyIdToken(token.id_token, {
			jwks,
			issuer: this.config.issuer,
			audience: this.config.clientId,
			nonce: input.nonce.length > 0 ? input.nonce : undefined,
			nowSeconds: Math.floor(this.clock.nowMs() / 1000),
		});
		return {
			issuer: claims.iss,
			subject: claims.sub,
			email: typeof claims.email === "string" ? claims.email : undefined,
		};
	}

	private async discovery(): Promise<DiscoveryDoc> {
		if (this.discoveryCache !== undefined) {
			return this.discoveryCache;
		}
		const base = this.config.issuer.replace(/\/$/, "");
		const resp = await this.fetchFn(`${base}/.well-known/openid-configuration`);
		if (!resp.ok) {
			throw new Error(`oidc_discovery_failed: ${resp.status}`);
		}
		const doc = await this.readJson<DiscoveryDoc>(resp);
		this.discoveryCache = doc;
		return doc;
	}

	private async fetchJwks(jwksUri: string): Promise<ReadonlyArray<Jwk>> {
		const resp = await this.fetchFn(jwksUri);
		if (!resp.ok) {
			throw new Error(`oidc_jwks_failed: ${resp.status}`);
		}
		const body = await this.readJson<JwksResponse>(resp);
		return body.keys ?? [];
	}

	private async readJson<T>(resp: Response): Promise<T> {
		/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- HTTP JSON boundary; caller declares the shape */
		return (await resp.json()) as T;
	}
}
