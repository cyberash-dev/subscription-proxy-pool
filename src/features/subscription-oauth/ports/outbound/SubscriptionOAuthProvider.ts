/*
 * Switchable L2 provider port (pol:POL-PROVIDER-001). Anthropic implements it;
 * OpenAI is a stub seam. All provider OAuth specifics (endpoints, client id,
 * token format) live behind this interface.
 */

import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import type { PkceChallenge } from "../../../../shared/pkce/Pkce.ts";
import type { OAuthGrant } from "../../domain/OAuthGrant.ts";

export interface AuthorizeUrlInput {
	readonly state: string;
	readonly challenge: PkceChallenge;
}

export interface ExchangeCodeInput {
	readonly code: string;
	readonly verifier: string;
}

/*
 * Single-attempt liveness classification of an access token against the
 * provider's inference upstream (spp-subscription-oauth:BEH-005): `valid` when
 * authenticated (quota not asserted), `invalid` on an auth/permission rejection,
 * `inconclusive` when undetermined (network failure, timeout, other status).
 */
export type CredentialVerdict = "valid" | "invalid" | "inconclusive";

export interface SubscriptionOAuthProvider {
	readonly providerId: ProviderId;
	buildAuthorizeUrl(input: AuthorizeUrlInput): Promise<string>;
	exchangeCode(input: ExchangeCodeInput): Promise<OAuthGrant>;
	refresh(refreshToken: string): Promise<OAuthGrant>;
	verifyCredentials(accessToken: string): Promise<CredentialVerdict>;
}
