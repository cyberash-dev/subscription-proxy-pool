/*
 * The switchable L1 identity port (pol:POL-PROVIDER-001). One implementation
 * per identity kind; the registry selects by provider name. All OIDC/provider
 * specifics live behind this interface so the rest of `auth` stays generic.
 */

import type { PkceChallenge } from "../../../../shared/pkce/Pkce.ts";
import type { ExternalIdentity } from "../../domain/User.ts";

export interface AuthorizeUrlInput {
	readonly state: string;
	readonly nonce: string;
	readonly challenge: PkceChallenge;
	readonly redirectUri: string;
}

export interface ExchangeCodeInput {
	readonly code: string;
	readonly verifier: string;
	readonly nonce: string;
	readonly redirectUri: string;
}

export interface IdentityProvider {
	readonly name: string;
	buildAuthorizeUrl(input: AuthorizeUrlInput): Promise<string>;
	exchangeCode(input: ExchangeCodeInput): Promise<ExternalIdentity>;
}
