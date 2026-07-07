/*
 * Proxy-key use cases (spp-access-keys). Issue mints a secret returned once and
 * stores only its hash; resolvePrincipal is the inference hot path; the pool is
 * bound to the key, never chosen by a request header (spp-access-keys:INV-001).
 */

import type { Clock } from "../../../shared/domain/Clock.ts";
import {
	hashSecret,
	newOpaqueSecret,
	newUuid,
} from "../../../shared/domain/Scalars.ts";
import { notFound } from "../../../shared/http/Errors.ts";
import type {
	PoolTarget,
	Principal,
	ProxyKeySummary,
} from "../domain/ProxyKey.ts";
import type { ProxyKeyRepository } from "../ports/outbound/ProxyKeyRepository.ts";
import type {
	AccessKeysPort,
	IssuedKey,
} from "../ports/inbound/AccessKeysPort.ts";

export class AccessKeysService implements AccessKeysPort {
	constructor(
		private readonly keys: ProxyKeyRepository,
		private readonly clock: Clock,
	) {}

	async issueKey(userId: string, poolTarget: PoolTarget): Promise<IssuedKey> {
		const secret = newOpaqueSecret("spp_pk");
		const keyId = newUuid();
		await this.keys.insert({
			keyId,
			keyHash: hashSecret(secret),
			userId,
			poolTarget,
			status: "active",
			createdAt: this.clock.nowIso(),
		});
		return { keyId, secret, poolTarget };
	}

	async revokeKey(userId: string, keyId: string): Promise<void> {
		const record = await this.keys.findById(keyId);
		if (record === undefined || record.userId !== userId) {
			throw notFound(`proxy key not found: ${keyId}`);
		}
		await this.keys.revoke(keyId, this.clock.nowIso());
	}

	async listKeys(userId: string): Promise<ProxyKeySummary[]> {
		const records = await this.keys.listByUser(userId);
		return records.map((record) => ({
			keyId: record.keyId,
			poolTarget: record.poolTarget,
			status: record.status,
			createdAt: record.createdAt,
		}));
	}

	async resolvePrincipal(bearer: string): Promise<Principal | undefined> {
		const record = await this.keys.findByHash(hashSecret(bearer));
		if (record === undefined || record.status !== "active") {
			return undefined;
		}
		return { userId: record.userId, poolTarget: record.poolTarget };
	}
}
