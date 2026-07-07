/* SQLite adapter for proxy keys (spp-access-keys). */

import type { Engine } from "../../../../shared/db/Engine.ts";
import type {
	PoolTarget,
	ProxyKeyRecord,
	ProxyKeyStatus,
} from "../../domain/ProxyKey.ts";
import type { ProxyKeyRepository } from "../../ports/outbound/ProxyKeyRepository.ts";

interface Row {
	readonly key_id: string;
	readonly key_hash: string;
	readonly user_id: string;
	readonly pool_target: PoolTarget;
	readonly status: ProxyKeyStatus;
	readonly created_at: string;
	readonly revoked_at: string | null;
}

function toRecord(row: Row): ProxyKeyRecord {
	return {
		keyId: row.key_id,
		keyHash: row.key_hash,
		userId: row.user_id,
		poolTarget: row.pool_target,
		status: row.status,
		createdAt: row.created_at,
		revokedAt: row.revoked_at ?? undefined,
	};
}

export class SqliteProxyKeyRepository implements ProxyKeyRepository {
	constructor(private readonly engine: Engine) {}

	async insert(record: ProxyKeyRecord): Promise<void> {
		await this.engine.run(
			`INSERT INTO proxy_keys(key_id, key_hash, user_id, pool_target, status, created_at, revoked_at)
			 VALUES(?, ?, ?, ?, ?, ?, NULL)`,
			[
				record.keyId,
				record.keyHash,
				record.userId,
				record.poolTarget,
				record.status,
				record.createdAt,
			],
		);
	}

	async findByHash(keyHash: string): Promise<ProxyKeyRecord | undefined> {
		const row = await this.engine.get<Row>(
			"SELECT * FROM proxy_keys WHERE key_hash = ?",
			[keyHash],
		);
		return row === undefined ? undefined : toRecord(row);
	}

	async findById(keyId: string): Promise<ProxyKeyRecord | undefined> {
		const row = await this.engine.get<Row>(
			"SELECT * FROM proxy_keys WHERE key_id = ?",
			[keyId],
		);
		return row === undefined ? undefined : toRecord(row);
	}

	async revoke(keyId: string, revokedAt: string): Promise<void> {
		await this.engine.run(
			"UPDATE proxy_keys SET status = 'revoked', revoked_at = ? WHERE key_id = ? AND status = 'active'",
			[revokedAt, keyId],
		);
	}

	async listByUser(userId: string): Promise<ProxyKeyRecord[]> {
		const rows = await this.engine.all<Row>(
			"SELECT * FROM proxy_keys WHERE user_id = ? ORDER BY created_at",
			[userId],
		);
		return rows.map(toRecord);
	}
}
