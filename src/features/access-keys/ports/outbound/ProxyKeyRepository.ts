/* Driven port for proxy-key persistence. */

import type { ProxyKeyRecord } from "../../domain/ProxyKey.ts";

export interface ProxyKeyRepository {
	insert(record: ProxyKeyRecord): Promise<void>;
	findByHash(keyHash: string): Promise<ProxyKeyRecord | undefined>;
	findById(keyId: string): Promise<ProxyKeyRecord | undefined>;
	revoke(keyId: string, revokedAt: string): Promise<void>;
	listByUser(userId: string): Promise<ProxyKeyRecord[]>;
}
