/*
 * At-rest secret encryption (spp-subscriptions:DLT-001): AES-256-GCM in a
 * versioned envelope "v1.<keyId>.<base64url(iv|tag|ciphertext)>". Encrypt uses
 * the highest key id; decrypt selects the key by id, so new keys rotate writes.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const SCHEME = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class SecretCrypter {
	private readonly keys: ReadonlyMap<number, Buffer>;
	private readonly currentKeyId: number;

	constructor(keys: ReadonlyMap<number, Buffer>) {
		if (keys.size === 0) {
			throw new Error("secret_crypter_no_keys");
		}
		for (const [id, key] of keys) {
			if (key.length !== KEY_BYTES) {
				throw new Error(`secret_crypter_key_length:${id}:${key.length}`);
			}
		}
		this.keys = keys;
		this.currentKeyId = Math.max(...keys.keys());
	}

	encrypt(plaintext: string): string {
		const iv = randomBytes(IV_BYTES);
		const cipher = createCipheriv(
			"aes-256-gcm",
			this.keyFor(this.currentKeyId),
			iv,
		);
		const ciphertext = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]);
		const envelope = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
		return `${SCHEME}.${this.currentKeyId}.${envelope.toString("base64url")}`;
	}

	decrypt(cryptogram: string): string {
		const [scheme, keyIdRaw, payload] = cryptogram.split(".");
		if (scheme !== SCHEME || keyIdRaw === undefined || payload === undefined) {
			throw new Error("secret_crypter_bad_envelope");
		}
		const keyId = Number(keyIdRaw);
		if (!Number.isInteger(keyId)) {
			throw new Error("secret_crypter_bad_envelope");
		}
		const envelope = Buffer.from(payload, "base64url");
		if (envelope.length < IV_BYTES + TAG_BYTES) {
			throw new Error("secret_crypter_bad_envelope");
		}
		const iv = envelope.subarray(0, IV_BYTES);
		const tag = envelope.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
		const ciphertext = envelope.subarray(IV_BYTES + TAG_BYTES);
		const decipher = createDecipheriv("aes-256-gcm", this.keyFor(keyId), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]).toString("utf8");
	}

	rotate(cryptogram: string): string {
		return this.encrypt(this.decrypt(cryptogram));
	}

	private keyFor(keyId: number): Buffer {
		const key = this.keys.get(keyId);
		if (key === undefined) {
			throw new Error(`secret_crypter_unknown_key:${keyId}`);
		}
		return key;
	}
}
