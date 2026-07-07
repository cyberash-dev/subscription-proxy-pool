/*
 * Inference-time credential domain. A proxy key alone resolves to a principal:
 * the user and the pool it draws from (spp-access-keys:INV-001). The wire secret
 * is never stored — only its hash.
 */

export type PoolTarget = "own" | "donor";

export type ProxyKeyStatus = "active" | "revoked";

export interface Principal {
	readonly userId: string;
	readonly poolTarget: PoolTarget;
}

export interface ProxyKeyRecord {
	readonly keyId: string;
	readonly keyHash: string;
	readonly userId: string;
	readonly poolTarget: PoolTarget;
	readonly status: ProxyKeyStatus;
	readonly createdAt: string;
	readonly revokedAt?: string;
}

export interface ProxyKeySummary {
	readonly keyId: string;
	readonly poolTarget: PoolTarget;
	readonly status: ProxyKeyStatus;
	readonly createdAt: string;
}
