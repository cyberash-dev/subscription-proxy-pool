/*
 * SQLite adapter for the shared PKCE session store. `consume` uses a
 * conditional UPDATE ... RETURNING so a session is redeemable exactly once even
 * under concurrent callbacks.
 */

import type { Engine } from "../db/Engine.ts";
import type {
	PkceSessionRecord,
	PkceSessionRepository,
} from "./PkceSession.ts";

interface Row {
	readonly session_id: string;
	readonly kind: "login" | "subscription";
	readonly provider: string;
	readonly verifier: string;
	readonly nonce: string | null;
	readonly redirect_after: string | null;
	readonly pool_kind: "user" | "donor" | null;
	readonly owner_user_id: string | null;
	readonly created_at: string;
	readonly consumed_at: string | null;
}

function toRecord(row: Row): PkceSessionRecord {
	return {
		sessionId: row.session_id,
		kind: row.kind,
		provider: row.provider,
		verifier: row.verifier,
		nonce: row.nonce ?? undefined,
		redirectAfter: row.redirect_after ?? undefined,
		poolKind: row.pool_kind ?? undefined,
		ownerUserId: row.owner_user_id ?? undefined,
		createdAt: row.created_at,
		consumedAt: row.consumed_at ?? undefined,
	};
}

export class SqlitePkceSessionRepository implements PkceSessionRepository {
	constructor(private readonly engine: Engine) {}

	async create(record: PkceSessionRecord): Promise<void> {
		await this.engine.run(
			`INSERT INTO pkce_sessions(session_id, kind, provider, verifier, nonce,
			   redirect_after, pool_kind, owner_user_id, created_at, consumed_at)
			 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
			[
				record.sessionId,
				record.kind,
				record.provider,
				record.verifier,
				record.nonce ?? null,
				record.redirectAfter ?? null,
				record.poolKind ?? null,
				record.ownerUserId ?? null,
				record.createdAt,
			],
		);
	}

	async consume(
		sessionId: string,
		consumedAt: string,
	): Promise<PkceSessionRecord | undefined> {
		return this.engine.transaction(async (tx) => {
			const row = await tx.get<Row>(
				"SELECT * FROM pkce_sessions WHERE session_id = ? AND consumed_at IS NULL",
				[sessionId],
			);
			if (row === undefined) {
				return undefined;
			}
			await tx.run(
				"UPDATE pkce_sessions SET consumed_at = ? WHERE session_id = ?",
				[consumedAt, sessionId],
			);
			return toRecord(row);
		});
	}
}
