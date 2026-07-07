/*
 * At-rest secret encryption: round-trip, versioned ciphertext envelope, random
 * IV, key rotation, and fail-closed decrypt.
 *
 * @covers spp-subscriptions:DLT-001
 */

import { SecretCrypter } from "../SecretCrypter.ts";

interface TestRecord {
	name: string;
	ok: boolean;
	error?: string;
}
const results: TestRecord[] = [];

async function runTest(
	name: string,
	fn: () => Promise<void> | void,
): Promise<void> {
	try {
		await fn();
		results.push({ name, ok: true });
	} catch (err) {
		const message =
			err instanceof Error ? (err.stack ?? err.message) : String(err);
		results.push({ name, ok: false, error: message });
	}
}

function assert(cond: boolean, label: string): void {
	if (!cond) {
		throw new Error(label);
	}
}

function assertThrows(fn: () => unknown, label: string): void {
	let threw = false;
	try {
		fn();
	} catch {
		threw = true;
	}
	assert(threw, label);
}

function keyOf(fill: number): Buffer {
	return Buffer.alloc(32, fill);
}

function crypterWith(...ids: number[]): SecretCrypter {
	return new SecretCrypter(new Map(ids.map((id) => [id, keyOf(id)])));
}

const TOKEN = "sk-ant-oat-secret-value";

function testRoundTrip(): void {
	const crypter = crypterWith(1);

	const restored = crypter.decrypt(crypter.encrypt(TOKEN));

	assert(restored === TOKEN, "decrypt(encrypt(x)) === x");
}

function testEnvelopeIsCiphertext(): void {
	const crypter = crypterWith(1);

	const cryptogram = crypter.encrypt(TOKEN);

	assert(
		cryptogram.startsWith("v1.1."),
		"versioned envelope prefix v1.<keyId>.",
	);
	assert(!cryptogram.includes(TOKEN), "plaintext absent from the envelope");
}

function testIvIsRandom(): void {
	const crypter = crypterWith(1);

	const a = crypter.encrypt(TOKEN);
	const b = crypter.encrypt(TOKEN);

	assert(a !== b, "same plaintext encrypts to a different envelope each time");
}

function testUnknownKeyFailsClosed(): void {
	const writer = crypterWith(1);
	const cryptogram = writer.encrypt(TOKEN);
	const otherRing = crypterWith(2);

	assertThrows(
		() => otherRing.decrypt(cryptogram),
		"envelope keyId absent from the ring throws",
	);
}

function testWrongKeyFailsClosed(): void {
	const cryptogram = new SecretCrypter(new Map([[1, keyOf(1)]])).encrypt(TOKEN);
	const sameIdOtherKey = new SecretCrypter(new Map([[1, keyOf(9)]]));

	assertThrows(
		() => sameIdOtherKey.decrypt(cryptogram),
		"authentication tag mismatch throws",
	);
}

function testTamperedFailsClosed(): void {
	const crypter = crypterWith(1);
	const cryptogram = crypter.encrypt(TOKEN);
	const tampered = `${cryptogram.slice(0, -2)}${cryptogram.endsWith("A") ? "B" : "A"}`;

	assertThrows(() => crypter.decrypt(tampered), "tampered ciphertext throws");
}

function testRotateReencryptsToCurrentKey(): void {
	const old = new SecretCrypter(new Map([[1, keyOf(1)]])).encrypt(TOKEN);
	const ring = crypterWith(1, 2);

	const rotated = ring.rotate(old);

	assert(
		rotated.startsWith("v1.2."),
		"rotate re-encrypts under the highest keyId",
	);
	assert(
		ring.decrypt(rotated) === TOKEN,
		"rotated envelope decrypts to original",
	);
}

function testRejectsEmptyRing(): void {
	assertThrows(
		() => new SecretCrypter(new Map()),
		"constructing with no keys throws",
	);
}

function testRejectsWrongKeyLength(): void {
	assertThrows(
		() => new SecretCrypter(new Map([[1, Buffer.alloc(16, 1)]])),
		"constructing with a non-32-byte key throws",
	);
}

function testMalformedEnvelopeFailsClosed(): void {
	const crypter = crypterWith(1);

	assertThrows(() => crypter.decrypt(""), "empty string throws");
	assertThrows(() => crypter.decrypt("v2.1.AAAA"), "wrong scheme throws");
	assertThrows(() => crypter.decrypt("v1.x.AAAA"), "non-integer keyId throws");
	assertThrows(() => crypter.decrypt("v1.1"), "missing payload throws");
	assertThrows(() => crypter.decrypt("v1.1.QQ"), "too-short envelope throws");
}

async function main(): Promise<void> {
	await runTest("round_trip", testRoundTrip);
	await runTest("envelope_is_ciphertext", testEnvelopeIsCiphertext);
	await runTest("iv_is_random", testIvIsRandom);
	await runTest("unknown_key_fails_closed", testUnknownKeyFailsClosed);
	await runTest("wrong_key_fails_closed", testWrongKeyFailsClosed);
	await runTest("tampered_fails_closed", testTamperedFailsClosed);
	await runTest(
		"rotate_reencrypts_to_current_key",
		testRotateReencryptsToCurrentKey,
	);
	await runTest("rejects_empty_ring", testRejectsEmptyRing);
	await runTest("rejects_wrong_key_length", testRejectsWrongKeyLength);
	await runTest(
		"malformed_envelope_fails_closed",
		testMalformedEnvelopeFailsClosed,
	);

	const report = { suite: "SecretCrypter", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
