/* Deterministic single-key SecretCrypter for tests (key id 1, 32-byte key). */

import { SecretCrypter } from "../SecretCrypter.ts";

export function crypterForTests(): SecretCrypter {
	return new SecretCrypter(new Map([[1, Buffer.alloc(32, 7)]]));
}
