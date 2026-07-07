/*
 * Cross-cutting scalar helpers: opaque id minting and secret hashing. Kept in
 * one place so every slice mints ids and hashes bearer secrets identically.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

/* ISO-8601 timestamp string (branding is by convention, not a nominal type). */
export type Iso = string;

export function newUuid(): string {
	return randomUUID();
}

/* A URL-safe opaque secret (proxy keys, session tokens) with a readable prefix. */
export function newOpaqueSecret(prefix: string): string {
	return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/* Stable SHA-256 hex of a bearer secret — what we persist instead of the secret. */
export function hashSecret(secret: string): string {
	return createHash("sha256").update(secret, "utf8").digest("hex");
}
