/*
 * OpenAI provider stub — the declared multi-provider seam (spp-subscription-oauth:BEH-004).
 * It satisfies the SubscriptionOAuthProvider shape so the registry and every
 * caller stay provider-agnostic, but every operation reports not-implemented
 * until the OpenAI OAuth flow is built.
 */

import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import type { OAuthGrant } from "../../domain/OAuthGrant.ts";
import type {
	AuthorizeUrlInput,
	CredentialVerdict,
	ExchangeCodeInput,
	SubscriptionOAuthProvider,
} from "../../ports/outbound/SubscriptionOAuthProvider.ts";

export class ProviderNotImplemented extends Error {
	constructor(readonly provider: ProviderId) {
		super(`provider_not_implemented:${provider}`);
		this.name = "ProviderNotImplemented";
	}
}

export class OpenAiOAuthProvider implements SubscriptionOAuthProvider {
	readonly providerId: ProviderId = "openai";

	buildAuthorizeUrl(_input: AuthorizeUrlInput): Promise<string> {
		return Promise.reject(new ProviderNotImplemented("openai"));
	}

	exchangeCode(_input: ExchangeCodeInput): Promise<OAuthGrant> {
		return Promise.reject(new ProviderNotImplemented("openai"));
	}

	refresh(_refreshToken: string): Promise<OAuthGrant> {
		return Promise.reject(new ProviderNotImplemented("openai"));
	}

	verifyCredentials(_accessToken: string): Promise<CredentialVerdict> {
		return Promise.reject(new ProviderNotImplemented("openai"));
	}
}
