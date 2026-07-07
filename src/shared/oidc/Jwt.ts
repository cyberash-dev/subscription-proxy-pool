/*
 * Minimal OIDC id_token verification with node:crypto (RS256 only — the alg
 * Google/Microsoft and most OIDC issuers sign with). Verifies the JWKS signature
 * plus iss / aud / exp / nonce. Kept dependency-free (no jose).
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

export interface Jwk extends JsonWebKey {
	readonly kid?: string;
	readonly alg?: string;
	readonly use?: string;
}

export interface IdTokenClaims {
	readonly iss: string;
	readonly sub: string;
	readonly aud: string | string[];
	readonly exp: number;
	readonly nonce?: string;
	readonly email?: string;
	readonly [claim: string]: unknown;
}

interface DecodedJwt {
	readonly header: { readonly alg: string; readonly kid?: string };
	readonly payload: IdTokenClaims;
	readonly signingInput: string;
	readonly signature: Buffer;
}

function decodeSegment<T>(segment: string): T {
	/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JWT segment JSON boundary */
	return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
}

function decode(idToken: string): DecodedJwt {
	const parts = idToken.split(".");
	if (parts.length !== 3) {
		throw new Error("id_token_malformed: expected three segments");
	}
	const [headerSeg, payloadSeg, signatureSeg] = parts;
	return {
		header: decodeSegment(headerSeg),
		payload: decodeSegment(payloadSeg),
		signingInput: `${headerSeg}.${payloadSeg}`,
		signature: Buffer.from(signatureSeg, "base64url"),
	};
}

function audienceMatches(aud: string | string[], expected: string): boolean {
	return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

export interface VerifyOptions {
	readonly jwks: ReadonlyArray<Jwk>;
	readonly issuer: string;
	readonly audience: string;
	readonly nonce?: string;
	readonly nowSeconds: number;
}

export function verifyIdToken(
	idToken: string,
	options: VerifyOptions,
): IdTokenClaims {
	const decoded = decode(idToken);
	if (decoded.header.alg !== "RS256") {
		throw new Error(`id_token_unsupported_alg: ${decoded.header.alg}`);
	}
	const jwk = pickKey(options.jwks, decoded.header.kid);
	const key = createPublicKey({ key: jwk, format: "jwk" });
	const isSignatureValid = cryptoVerify(
		"RSA-SHA256",
		Buffer.from(decoded.signingInput),
		key,
		decoded.signature,
	);
	if (!isSignatureValid) {
		throw new Error("id_token_bad_signature");
	}
	const claims = decoded.payload;
	if (claims.iss !== options.issuer) {
		throw new Error("id_token_bad_issuer");
	}
	if (!audienceMatches(claims.aud, options.audience)) {
		throw new Error("id_token_bad_audience");
	}
	if (typeof claims.exp !== "number" || claims.exp <= options.nowSeconds) {
		throw new Error("id_token_expired");
	}
	if (options.nonce !== undefined && claims.nonce !== options.nonce) {
		throw new Error("id_token_bad_nonce");
	}
	return claims;
}

function pickKey(jwks: ReadonlyArray<Jwk>, kid?: string): Jwk {
	if (kid !== undefined) {
		const match = jwks.find((key) => key.kid === kid);
		if (match !== undefined) {
			return match;
		}
	}
	const first = jwks[0];
	if (first === undefined) {
		throw new Error("id_token_no_jwk");
	}
	return first;
}
