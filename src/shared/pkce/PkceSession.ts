/*
 * Transient PKCE flow state, single-use, shared by L1 login and L2 subscription
 * linking (the `pkce_sessions` table). Distinguished by `kind`.
 */

export type PkceKind = "login" | "subscription";

export interface PkceSessionRecord {
	readonly sessionId: string;
	readonly kind: PkceKind;
	readonly provider: string;
	readonly verifier: string;
	readonly nonce?: string;
	readonly redirectAfter?: string;
	readonly poolKind?: "user" | "donor";
	readonly ownerUserId?: string;
	readonly createdAt: string;
	readonly consumedAt?: string;
}

export interface PkceSessionRepository {
	create(record: PkceSessionRecord): Promise<void>;
	/* Atomically fetch an unconsumed session and mark it consumed. Returns
	 * undefined if it is missing or already consumed (single-use guarantee). */
	consume(
		sessionId: string,
		consumedAt: string,
	): Promise<PkceSessionRecord | undefined>;
}
