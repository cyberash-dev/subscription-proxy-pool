/*
 * PKCE (RFC 7636) challenge generation shared by both OAuth levels — L1 OIDC
 * login and L2 subscription linking. S256 only.
 */

import { createHash, randomBytes } from "node:crypto";

export interface PkceChallenge {
	readonly verifier: string;
	readonly challenge: string;
	readonly method: "S256";
}

function base64Url(bytes: Buffer): string {
	return bytes.toString("base64url");
}

export function generatePkce(): PkceChallenge {
	const verifier = base64Url(randomBytes(32));
	const challenge = base64Url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge, method: "S256" };
}

/* A random opaque value for the OAuth `state` / OIDC `nonce` parameters. */
export function randomToken(): string {
	return base64Url(randomBytes(24));
}
